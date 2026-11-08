"""Flask HTTP contract and user-scoped V3 configuration editor."""

import hashlib
import hmac
import ipaddress
import os
import secrets
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import dotenv_values
from contextlib import closing
from urllib.parse import urlsplit

from flask import Flask, abort, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.exceptions import HTTPException

try:
    from .snapshot_avatars import assistant_avatar, resource_index
    from .settings_forms import GROUPS, settings_form
    from .sync_store import CHUNK, MAX, SyncStore, default_directory, fsync_directory
    from .snapshot_validation import decode, encode, entries_statistics, readonly, validate_snapshot
except ImportError:
    from snapshot_avatars import assistant_avatar, resource_index
    from settings_forms import GROUPS, settings_form
    from sync_store import CHUNK, MAX, SyncStore, default_directory, fsync_directory
    from snapshot_validation import decode, encode, entries_statistics, readonly, validate_snapshot

DEFAULT_ORIGINS = {"http://localhost:1212", "http://127.0.0.1:1212", "http://[::1]:1212", "null"}
CORS_HEADERS = {"content-type", "authorization", "x-chunk-sha256", "x-snapshot-sha256", "accept"}


def loopback(address):
    try:
        return ipaddress.ip_address(address).is_loopback
    except (ValueError, TypeError):
        return False


def authority(host):
    try:
        parsed = urlsplit("http://" + host)
        parsed.port
        if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or any(c.isspace() for c in host):
            return None
        return parsed.hostname
    except ValueError:
        return None


def hash_file(file):
    file.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: file.read(CHUNK), b""):
        digest.update(chunk)
    file.seek(0)
    return digest.hexdigest()


def create_app(data_dir=None, *, trusted_proxy_peers=None, allowed_hosts=None, allowed_origins=None):
    app = Flask(__name__, static_folder=None)
    store = SyncStore(data_dir if data_dir is not None else default_directory())
    # Explicit test/custom data directories never read deployment secrets.
    config_path = Path(__file__).parent / ".env"
    config = dotenv_values(config_path, interpolate=False) if data_dir is None and os.access(config_path, os.R_OK) else {}
    def setting(name, default=""):
        return os.environ.get(name, config.get(name) or default)

    def configured_values(name):
        return {value.strip() for value in setting(name).split(",") if value.strip()}

    store.configure_admin(os.environ.get("CHATBOX_ADMIN_PASSWORD", config.get("CHATBOX_ADMIN_PASSWORD")))
    app.extensions["sync_store"] = store
    peers = set(trusted_proxy_peers) if trusted_proxy_peers is not None else configured_values("CHATBOX_SYNC_PROXY_PEERS")
    hosts = set(allowed_hosts) if allowed_hosts is not None else configured_values("CHATBOX_SYNC_HOSTS")
    origins = set(allowed_origins) if allowed_origins is not None else (configured_values("CHATBOX_SYNC_ORIGINS") or DEFAULT_ORIGINS)
    dev_cors = setting("CHATBOX_SYNC_DEV_CORS") == "1" and not hosts and not peers
    integrated_origin = setting("CHATBOX_INTEGRATED_ORIGIN")
    if integrated_origin:
        parsed = urlsplit(integrated_origin)
        if integrated_origin != f"{parsed.scheme}://{parsed.netloc}" or not authority(parsed.netloc) or not (parsed.scheme == "https" or (parsed.scheme == "http" and (parsed.hostname == "localhost" or loopback(parsed.hostname)))):
            raise ValueError("Integrated origin must be exact HTTPS or loopback HTTP origin")
        if hosts or peers:
            raise ValueError("Integrated origin cannot be combined with standalone proxy settings")
        origins = origins | {integrated_origin}

    def permitted_origin(origin):
        if origin in origins:
            return True
        if not dev_cors or not origin:
            return False
        parsed = urlsplit(origin)
        return (origin == f"{parsed.scheme}://{parsed.netloc}" and authority(parsed.netloc)
                and parsed.scheme in {"http", "https"}
                and (parsed.hostname == "localhost" or loopback(parsed.hostname)))
    for peer in peers:
        ipaddress.ip_address(peer)  # Exact socket peers only; no wildcard CIDR trust.
    if peers and not hosts:
        raise ValueError("Trusted TLS reverse proxy requires an explicit Host allowlist")
    if any(not authority(host) or host != host.lower() for host in hosts):
        raise ValueError("Hosts must be exact lowercase authorities, optionally including a port")
    for origin in origins:
        if origin == "null":
            continue
        parsed = urlsplit(origin)
        if origin != f"{parsed.scheme}://{parsed.netloc}" or not authority(parsed.netloc) or (parsed.scheme != "https" and not (parsed.scheme == "http" and (parsed.hostname == "localhost" or loopback(parsed.hostname)))):
            raise ValueError("Origins must be exact HTTPS origins or loopback HTTP origins")
    app.config.update(SECRET_KEY=store.secret(), MAX_CONTENT_LENGTH=CHUNK + 65536,
                      SESSION_COOKIE_NAME="chatbox_sync_admin", SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE="Strict", SESSION_COOKIE_PATH="/admin",
                      SESSION_COOKIE_SECURE=bool(hosts or peers or integrated_origin.startswith("https://")))
    store.cleanup()
    registration_enabled = setting("CHATBOX_SYNC_REGISTRATION", "0" if hosts or peers or integrated_origin.startswith("https://") else "1") == "1"
    app.jinja_env.globals["registration_enabled"] = registration_enabled

    def csrf():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        return session["csrf"]
    app.jinja_env.globals["csrf_token"] = csrf

    @app.before_request
    def protect():
        hostname = authority(request.host)
        secure = request.is_secure
        if integrated_origin:
            parsed = urlsplit(integrated_origin)
            if not loopback(request.remote_addr) or request.host != parsed.netloc or request.headers.get("X-Forwarded-Proto") != parsed.scheme:
                abort(403, "Integrated backend requires its local same-origin proxy")
            secure = parsed.scheme == "https"
        elif request.remote_addr in peers:
            # Proxy must overwrite this header and preserve the externally allowlisted Host.
            if request.headers.get("X-Forwarded-Proto") != "https" or request.host not in hosts:
                abort(403, "Trusted proxy must report HTTPS and an allowlisted Host")
            secure = True
        elif hosts:
            if request.host not in hosts or not secure:
                abort(403, "Direct connections require HTTPS and an allowlisted Host")
        elif not (loopback(request.remote_addr) and (hostname == "localhost" or loopback(hostname))):
            abort(403, "Only loopback HTTP is enabled; configure trusted TLS deployment explicitly")
        g.external_origin = ("https" if secure else "http") + "://" + request.host
        origin = request.headers.get("Origin")
        if request.path.startswith("/admin"):
            if origin is not None and origin != g.external_origin:
                abort(403, "Admin requires same-origin requests")
            if request.method == "POST":
                supplied = request.form.get("csrf_token", "")
                if not session.get("csrf") or not hmac.compare_digest(session["csrf"].encode(), supplied.encode()):
                    abort(403, "Invalid CSRF token")
            if request.path not in {"/admin/login", "/admin/register"}:
                g.owner = store.owner(session.get("token"))
                if not g.owner:
                    session.clear()
                    if request.method == "GET":
                        return redirect(url_for("admin_login"), code=303)
                    abort(401, "Admin login required")
        elif origin is not None and not permitted_origin(origin):
            abort(403, "Origin is not allowlisted")
        if request.method == "OPTIONS":
            if request.path.startswith("/admin"):
                abort(403)
            headers = {v.strip().lower() for v in request.headers.get("Access-Control-Request-Headers", "").split(",") if v.strip()}
            if request.headers.get("Access-Control-Request-Method", "GET") not in {"GET", "POST"} or headers - CORS_HEADERS:
                abort(403, "Unsupported preflight")
            return "", 204
        if request.path.startswith("/api/") and request.path != "/api/sync/login":
            authorization = request.headers.get("Authorization", "")
            g.token = authorization[7:] if authorization.startswith("Bearer ") else ""
            g.owner = store.owner(g.token)
            if not g.owner:
                abort(401, "Valid bearer session required")
            if g.owner == "admin" and request.path != "/api/sync/logout":
                abort(403, "The reserved administrator cannot use client sync")

    @app.after_request
    def headers(response):
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                 "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
                                 "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})
        response.vary.add("Origin")
        origin = request.headers.get("Origin")
        if not request.path.startswith("/admin") and permitted_origin(origin) and hasattr(g, "external_origin"):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = ", ".join(sorted(CORS_HEADERS))
            response.headers["Access-Control-Expose-Headers"] = "X-Chunk-SHA256, X-Snapshot-SHA256"
            if dev_cors and request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Private-Network") == "true":
                response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/admin"):
            return render_template("sync_error.html", message=error.description), error.code
        response = jsonify(error=error.description)
        response.status_code = error.code
        if error.code == 401:
            response.headers["WWW-Authenticate"] = "Bearer"
        return response

    def body():
        if request.content_length is not None and request.content_length > 65536:
            abort(413)
        value = request.get_json()
        if not isinstance(value, dict):
            abort(400, "JSON object required")
        return value

    def operation(function, *args):
        try:
            return function(*args)
        except LookupError as error:
            abort(404, str(error))
        except OverflowError as error:
            abort(429, str(error))
        except (ValueError, UnicodeError, sqlite3.Error) as error:
            abort(400, str(error) if not isinstance(error, sqlite3.Error) else "Invalid SQLite snapshot")

    @app.post("/api/sync/login")
    def login():
        value = body()
        if value.get("username") == "admin":
            abort(403, "The reserved administrator must sign in to the management console")
        token, status = store.login(value.get("username"), value.get("password"), request.remote_addr or "unknown")
        if not token:
            abort(status, "Login failed" if status == 401 else "Too many login attempts; retry after five minutes")
        return jsonify(token=token)

    @app.post("/api/sync/logout")
    def logout():
        store.logout(g.token)
        return "", 204

    @app.post("/api/sync/uploads")
    def start():
        value = body()
        identifier = operation(store.start, g.owner, value.get("size"), value.get("sha256"))
        return jsonify(id=identifier), 201

    @app.post("/api/sync/uploads/<identifier>/chunks/<int:index>")
    def upload_chunk(identifier, index):
        if request.mimetype != "application/octet-stream":
            abort(415, "application/octet-stream required")
        if request.content_length is not None and request.content_length > CHUNK:
            abort(413)
        content = request.stream.read(CHUNK + 1)
        if len(content) > CHUNK:
            abort(413)
        operation(store.chunk, g.owner, identifier, index, content, request.headers.get("X-Chunk-SHA256"))
        return "", 204

    @app.post("/api/sync/uploads/<identifier>/commit")
    def commit(identifier):
        operation(store.commit, g.owner, identifier)
        return "", 204

    def open_snapshot():
        try:
            return store.snapshot(g.owner).open("rb")
        except FileNotFoundError:
            abort(404, "No snapshot for this user")

    @app.get("/api/sync/snapshot")
    def snapshot():
        with open_snapshot() as file:
            size = os.fstat(file.fileno()).st_size
            return jsonify(size=size, sha256=hash_file(file), chunks=(size + CHUNK - 1) // CHUNK)

    @app.get("/api/sync/snapshot/chunks/<int:index>")
    def download_chunk(index):
        # One descriptor observes one atomic revision even during concurrent publication.
        with open_snapshot() as file:
            size = os.fstat(file.fileno()).st_size
            if not 0 <= index < (size + CHUNK - 1) // CHUNK:
                abort(404, "Chunk not found")
            digest = hash_file(file)
            expected = request.headers.get("X-Snapshot-SHA256")
            if expected is not None and expected != digest:
                abort(409, "Snapshot changed; fetch metadata and restart download")
            file.seek(index * CHUNK)
            content = file.read(CHUNK)
        response = app.response_class(content, mimetype="application/octet-stream")
        response.headers["X-Chunk-SHA256"] = hashlib.sha256(content).hexdigest()
        response.headers["X-Snapshot-SHA256"] = digest
        return response

    @app.get("/")
    def index():
        return redirect(url_for("admin"), code=303)

    @app.route("/admin/login", methods=["GET", "POST"])
    def admin_login():
        error = None
        if request.method == "POST":
            token, status = store.login(request.form.get("username"), request.form.get("password"), request.remote_addr or "unknown")
            if token:
                session.clear()
                session["token"] = token
                csrf()
                return redirect(url_for("admin"), code=303)
            error = "Login failed" if status == 401 else "Too many attempts; retry after five minutes"
            return render_template("sync_login.html", error=error), status
        return render_template("sync_login.html", error=error)

    @app.post("/admin/logout")
    def admin_logout():
        store.logout(session["token"])
        session.clear()
        return redirect(url_for("admin_login"), code=303)

    @app.route("/admin/register", methods=["GET", "POST"])
    def admin_register():
        if not registration_enabled:
            abort(403, "Registration is disabled; contact the server administrator")
        error = None
        status = 200
        if request.method == "POST":
            password = request.form.get("password", "")
            confirmation = request.form.get("confirmation", "")
            if not hmac.compare_digest(password.encode(), confirmation.encode()):
                error, status = "Passwords do not match", 400
            else:
                try:
                    store.register(request.form.get("username"), password, request.remote_addr or "unknown")
                    session.clear()
                    return redirect(url_for("admin_login", registered="1"), code=303)
                except OverflowError as failure:
                    error, status = str(failure), 429
                except (ValueError, UnicodeError) as failure:
                    error, status = str(failure), 400
        return render_template("sync_register.html", error=error), status

    def scoped(username):
        if username == "admin" or g.owner == "admin" or username != g.owner:
            abort(404, "User not found")

    def load_config(username):
        scoped(username)
        path = store.snapshot(username)
        if not path.is_file():
            return None, None
        with path.open("rb") as file:
            revision = hash_file(file)
        with readonly(path) as db:
            values = {p: decode(data) for p, data in db.execute("SELECT path,data FROM archive_entries WHERE path IN ('settings.json','copilots.json','session-settings.json')")}
        return values, revision

    def edit_archive(username, mutate):
        scoped(username)
        source = store.snapshot(username)
        temporary = store.users / ("." + username + "-" + secrets.token_hex(16) + ".tmp")
        try:
            with store.connect() as lock:
                lock.execute("BEGIN IMMEDIATE")
                if not source.is_file():
                    abort(404, "Upload a V3 snapshot first")
                with source.open("rb") as file:
                    if request.form.get("revision") != hash_file(file):
                        abort(409, "Snapshot changed; reload the editor")
                shutil.copyfile(source, temporary)
                os.chmod(temporary, 0o600)
                with closing(sqlite3.connect(temporary)) as db, db:
                    db.execute("PRAGMA trusted_schema=OFF")
                    values = {p: decode(data) for p, data in db.execute("SELECT path,data FROM archive_entries WHERE path IN ('settings.json','copilots.json','session-settings.json')")}
                    operation(mutate, values)
                    for path, value in values.items():
                        db.execute("UPDATE archive_entries SET data=? WHERE path=?", (encode(value), path))
                    stats = operation(entries_statistics, db)
                    old = decode(db.execute("SELECT data FROM archive_entries WHERE path='complete.json'").fetchone()[0])
                    # Preserve optional complete shape and all unrelated entries/meta.
                    db.execute("UPDATE archive_entries SET data=? WHERE path='complete.json'", (encode({key: stats[key] for key in old}),))
                operation(validate_snapshot, temporary)
                with temporary.open("rb") as file:
                    os.fsync(file.fileno())
                os.replace(temporary, source)
                fsync_directory(store.users)
        finally:
            temporary.unlink(missing_ok=True)

    @app.get("/admin")
    def admin():
        if g.owner == "admin":
            return redirect(url_for("users_admin"), code=303)
        return redirect(url_for("user_admin", username=g.owner), code=303)

    def require_admin():
        if g.owner != "admin":
            abort(403, "Administrator access required")

    @app.get("/admin/users")
    def users_admin():
        require_admin()
        return render_template("sync_users.html", username=g.owner, tab="users", users=store.list_users())

    @app.post("/admin/users/<username>/delete")
    def user_delete(username):
        require_admin()
        if request.form.get("confirmation") != username:
            abort(400, "Type the username to confirm deletion")
        operation(store.delete_user, username)
        return redirect(url_for("users_admin", deleted="1"), code=303)

    @app.get("/admin/users/<username>")
    def user_admin(username):
        values, revision = load_config(username)
        tab = request.args.get("tab", "assistants")
        if tab not in {"overview", "assistants", "categories", "settings"}:
            tab = "assistants"
        items = values.get("copilots.json", []) if values else []
        categories = sorted({item.get("category", "").strip() for item in items if item.get("category", "").strip()})
        category_counts = {value: sum(item.get("category", "").strip() == value for item in items) for value in ["", *categories]}
        query = request.args.get("q", "").strip()
        category = request.args.get("category", "")
        filtered = [item for item in items if (not query or query.casefold() in (item.get("name", "") + " " + item.get("description", "") + " " + item.get("category", "")).casefold())
                    and (not category or (not item.get("category", "").strip() if category == "__uncategorized__" else item.get("category", "").strip() == category))]
        pages = max(1, (len(filtered) + 19) // 20)
        page = min(max(request.args.get("page", 1, type=int), 1), pages)
        selected = next((item for item in items if item["id"] == request.args.get("edit")), None)
        snapshot_info = None
        avatar_ids = set()
        if values is not None:
            stat = store.snapshot(username).stat()
            with readonly(store.snapshot(username)) as db:
                resources = resource_index(db)
                for item in filtered[(page - 1) * 20:page * 20]:
                    if assistant_avatar(db, item, resources):
                        avatar_ids.add(item["id"])
                entry_count = db.execute("SELECT COUNT(*) FROM archive_entries").fetchone()[0]
                session_count = db.execute("SELECT COUNT(*) FROM archive_entries WHERE path LIKE 'sessions/%.jsonl'").fetchone()[0]
            snapshot_info = {"size": f"{stat.st_size / 1024:,.1f} KB", "updated": datetime.fromtimestamp(stat.st_mtime, timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                             "entries": entry_count, "sessions": session_count}
        return render_template("sync_admin.html", username=username, values=values, revision=revision,
                               tab=tab, items=items, categories=categories, category_counts=category_counts, query=query, category=category,
                               filtered_count=len(filtered), assistants=filtered[(page - 1) * 20:page * 20],
                               page=page, pages=pages, selected=selected, snapshot_info=snapshot_info, avatar_ids=avatar_ids,
                               settings_groups=GROUPS, preferences=values.get("settings.json", {}) if values else {})

    @app.get("/admin/users/<username>/assistant-avatar")
    def user_assistant_avatar(username):
        scoped(username)
        path = store.snapshot(username)
        if not path.is_file():
            abort(404, "Avatar not found")
        with readonly(path) as db:
            row = db.execute("SELECT data FROM archive_entries WHERE path='copilots.json'").fetchone()
            items = decode(row[0]) if row else []
            item = next((item for item in items if item["id"] == request.args.get("id")), None)
            image = assistant_avatar(db, item, resource_index(db)) if item else None
        if not image:
            abort(404, "Avatar not found")
        content, mime = image
        return app.response_class(content, mimetype=mime)

    @app.post("/admin/users/<username>/assistants")
    def assistant_save(username):
        def mutate(values):
            if "copilots.json" not in values:
                raise ValueError("Snapshot did not select copilots")
            items = values["copilots.json"]
            identifier = request.form.get("id", "")
            original = request.form.get("original_id", "")
            if not identifier or len(identifier) > 4096:
                raise ValueError("Assistant ID required")
            existing = next((item for item in items if item["id"] == original), None) if original else None
            if original and existing is None:
                abort(404, "Assistant not found")
            if any(item["id"] == identifier and item is not existing for item in items):
                raise ValueError("Duplicate assistant ID")
            value = dict(existing) if existing else {"id": identifier, "name": "", "prompt": ""}
            for key in ("id", "name", "prompt", "description", "category"):
                value[key] = request.form.get(key, "")
            if not value["name"]:
                raise ValueError("Assistant name required")
            if existing:
                items[items.index(existing)] = value
            else:
                items.insert(0, value)
        edit_archive(username, mutate)
        return redirect(url_for("user_admin", username=username, tab="assistants", saved="1"), code=303)

    @app.post("/admin/users/<username>/assistants/delete")
    def assistant_delete(username):
        def mutate(values):
            items = values.get("copilots.json", [])
            identifier = request.form.get("id")
            if not any(item["id"] == identifier for item in items):
                abort(404, "Assistant not found")
            values["copilots.json"] = [item for item in items if item["id"] != identifier]
        edit_archive(username, mutate)
        return redirect(url_for("user_admin", username=username, tab="assistants", saved="1"), code=303)

    @app.post("/admin/users/<username>/categories")
    def category_rename(username):
        def mutate(values):
            if "copilots.json" not in values:
                raise ValueError("Snapshot did not select copilots")
            before = request.form.get("category", "")
            after = request.form.get("replacement", "")
            for item in values["copilots.json"]:
                if item.get("category", "").strip() == before.strip():
                    item["category"] = after.strip()
        edit_archive(username, mutate)
        return redirect(url_for("user_admin", username=username, tab="categories", saved="1"), code=303)

    @app.post("/admin/users/<username>/settings")
    def settings_save(username):
        def mutate(values):
            if "settings.json" not in values:
                raise ValueError("Snapshot did not select settings")
            values["settings.json"] = settings_form(request.form, values["settings.json"])
        edit_archive(username, mutate)
        return redirect(url_for("user_admin", username=username, tab="settings", saved="1"), code=303)

    @app.route("/api/<path:unsupported>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unsupported(unsupported):
        abort(404, "Unsupported API; shared catalog runtime has been retired")

    return app