"""Private filesystem/authentication state for manual whole-snapshot sync."""

import getpass
import argparse
import hashlib
import hmac
import os
import re
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

CHUNK = 1024 * 1024
MAX = 256 * CHUNK
SESSION_TTL = 12 * 60 * 60
STAGING_TTL = 60 * 60
USERNAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z", re.ASCII)
DIGEST = re.compile(r"[a-f0-9]{64}\Z", re.ASCII)
UPLOAD_ID = re.compile(r"[a-f0-9]{32}\Z", re.ASCII)


def default_directory():
    return Path(os.environ.get("CHATBOX_SERVER_DATA_DIR", Path(__file__).parent / "data")).expanduser()


def valid_username(value):
    return isinstance(value, str) and USERNAME.fullmatch(value) is not None


def password_hash(password, salt):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=32768, r=8, p=3, dklen=32, maxmem=64 * 1024 * 1024)


def fsync_directory(path):
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


class SyncStore:
    def __init__(self, directory):
        self.directory = Path(directory).expanduser().resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.users = self.directory / "users"
        self.staging = self.directory / "staging"
        for path in (self.users, self.staging):
            path.mkdir(exist_ok=True, mode=0o700)
            os.chmod(path, 0o700)
        self.database = self.directory / "users.db"
        self.admin_enabled = False
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, salt BLOB NOT NULL, hash BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, username TEXT NOT NULL, size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.execute("INSERT OR IGNORE INTO metadata VALUES('secret', ?)", (secrets.token_hex(32),))
        os.chmod(self.database, 0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def secret(self):
        with self.connect() as db:
            return db.execute("SELECT value FROM metadata WHERE key='secret'").fetchone()[0]

    def provision(self, username, password):
        if username == "admin":
            raise ValueError("admin is reserved; configure CHATBOX_ADMIN_PASSWORD in server/.env")
        if not valid_username(username) or not isinstance(password, str) or not 12 <= len(password) <= 1024:
            raise ValueError("Username must match ASCII [A-Za-z0-9_-]{1,64}; password must have 12–1024 characters")
        salt = secrets.token_bytes(16)
        hashed = password_hash(password, salt)
        with self.connect() as db:
            # Explicit CLI provisioning resets credentials and revokes all existing sessions/staging.
            db.execute("INSERT INTO users VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, hash=excluded.hash", (username, salt, hashed))
            db.execute("DELETE FROM sessions WHERE username=?", (username,))
            db.execute("UPDATE uploads SET expires=0 WHERE username=?", (username,))
        self.cleanup()

    def configure_admin(self, password):
        if not password:
            self.admin_enabled = False
            with self.connect() as db:
                db.execute("DELETE FROM sessions WHERE username='admin'")
                db.execute("UPDATE uploads SET expires=0 WHERE username='admin'")
            self.cleanup()
            return
        if not isinstance(password, str) or not 12 <= len(password) <= 1024:
            raise ValueError("CHATBOX_ADMIN_PASSWORD must have 12–1024 characters")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT salt,hash FROM users WHERE username='admin'").fetchone()
            if not row or not hmac.compare_digest(password_hash(password, row[0]), row[1]):
                salt = secrets.token_bytes(16)
                db.execute("INSERT INTO users VALUES('admin',?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,hash=excluded.hash", (salt, password_hash(password, salt)))
                db.execute("DELETE FROM sessions WHERE username='admin'")
                db.execute("UPDATE uploads SET expires=0 WHERE username='admin'")
        self.admin_enabled = True
        self.cleanup()

    def list_users(self):
        with self.connect() as db:
            names = [row[0] for row in db.execute("SELECT username FROM users WHERE username!='admin' ORDER BY username")]
        result = []
        for username in names:
            path = self.snapshot(username)
            try:
                size = path.stat().st_size
            except FileNotFoundError:
                size = None
            result.append({"username": username, "size": f"{size / 1024:,.1f} KB" if size is not None else None})
        return result

    def delete_user(self, username):
        if not valid_username(username) or username == "admin":
            raise ValueError("Cannot delete the reserved administrator")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise LookupError("User not found")
            identifiers = [row[0] for row in db.execute("SELECT id FROM uploads WHERE username=?", (username,))]
            for identifier in identifiers:
                try:
                    shutil.rmtree(self.staging / identifier)
                except FileNotFoundError:
                    pass
            self.snapshot(username).unlink(missing_ok=True)
            fsync_directory(self.users)
            db.execute("DELETE FROM uploads WHERE username=?", (username,))
            db.execute("DELETE FROM sessions WHERE username=?", (username,))
            db.execute("DELETE FROM users WHERE username=?", (username,))

    def register(self, username, password, peer):
        # Bound expensive scrypt work before validating or hashing new credentials.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            key = "registration:" + peer
            now = time.time()
            row = db.execute("SELECT attempts,expires FROM login_limits WHERE key=?", (key,)).fetchone()
            attempts = row[0] if row and row[1] > now else 0
            expires = row[1] if row and row[1] > now else now + 300
            if attempts >= 5:
                raise OverflowError("Too many registration attempts; retry after five minutes")
            db.execute("INSERT OR REPLACE INTO login_limits VALUES(?,?,?)", (key, attempts + 1, expires))
        if not valid_username(username) or not isinstance(password, str) or not 12 <= len(password) <= 1024:
            raise ValueError("Username must contain 1–64 ASCII letters, digits, _ or -; password must have 12–1024 characters")
        if username.casefold() == "admin":
            raise ValueError("admin is a reserved username and cannot be registered")
        salt = secrets.token_bytes(16)
        hashed = password_hash(password, salt)
        try:
            with self.connect() as db:
                db.execute("INSERT INTO users VALUES(?,?,?)", (username, salt, hashed))
        except sqlite3.IntegrityError:
            raise ValueError("Unable to register this username") from None

    def login(self, username, password, peer):
        now = time.time()
        # Bounded persistent peer and account rate limit, including nonexistent accounts.
        keys = ["peer:" + peer, "user:" + hashlib.sha256(str(username).encode(errors="backslashreplace")).hexdigest()]
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM login_limits WHERE expires<=?", (now,))
            for key in keys:
                row = db.execute("SELECT attempts FROM login_limits WHERE key=?", (key,)).fetchone()
                if row and row[0] >= 20:
                    return None, 429
            for key in keys:
                db.execute("INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", (key, now + 300))
            user = db.execute("SELECT salt,hash FROM users WHERE username=?", (username,)).fetchone() if valid_username(username) and (username != "admin" or self.admin_enabled) else None
        if not isinstance(password, str) or len(password) > 1024:
            return None, 401
        try:
            candidate = password_hash(password, user[0] if user else b"\0" * 16)
        except UnicodeError:
            return None, 401
        if not user or not hmac.compare_digest(candidate, user[1]):
            return None, 401
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT salt,hash FROM users WHERE username=?", (username,)).fetchone()
            if current is None or current[0] != user[0] or current[1] != user[1]:
                return None, 401
            db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), username, now + SESSION_TTL))
        return token, 200

    def owner(self, token):
        if not isinstance(token, str) or len(token) > 128:
            return None
        with self.connect() as db:
            row = db.execute("SELECT username FROM sessions WHERE token_hash=? AND expires>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return row[0] if row and (row[0] != "admin" or self.admin_enabled) else None

    def logout(self, token):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def snapshot(self, owner):
        if not valid_username(owner):
            raise ValueError("Invalid username")
        return self.users / (owner + ".db")

    def cleanup(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            now = time.time()
            expired = db.execute("SELECT id FROM uploads WHERE expires<=?", (now,)).fetchall()
            for row in expired:
                shutil.rmtree(self.staging / row[0], ignore_errors=True)
            db.execute("DELETE FROM uploads WHERE expires<=?", (now,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
            db.execute("DELETE FROM login_limits WHERE expires<=?", (now,))
            active = {row[0] for row in db.execute("SELECT id FROM uploads")}
            for path in self.staging.iterdir():
                if UPLOAD_ID.fullmatch(path.name) and path.name not in active:
                    shutil.rmtree(path, ignore_errors=True)

    def start(self, owner, size, digest):
        if owner == "admin":
            raise ValueError("The reserved administrator cannot store client snapshots")
        if type(size) is not int or not 0 < size <= MAX or not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            raise ValueError("Invalid size or sha256")
        self.cleanup()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM users WHERE username=?", (owner,)).fetchone():
                raise LookupError("User not found")
            if db.execute("SELECT COUNT(*) FROM uploads WHERE username=?", (owner,)).fetchone()[0] >= 2:
                raise OverflowError("At most two active uploads per user")
            identifier = secrets.token_hex(16)
            (self.staging / identifier).mkdir(mode=0o700)
            db.execute("INSERT INTO uploads VALUES(?,?,?,?,?)", (identifier, owner, size, digest, time.time() + STAGING_TTL))
        return identifier

    @contextmanager
    def upload(self, owner, identifier):
        if owner == "admin":
            raise LookupError("The reserved administrator cannot store client snapshots")
        if not UPLOAD_ID.fullmatch(identifier):
            raise LookupError("Upload not found")
        # SQLite write lock serializes chunk/commit/admin mutations across processes.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM uploads WHERE id=? AND username=? AND expires>?", (identifier, owner, time.time())).fetchone()
            if row is None:
                raise LookupError("Upload not found or expired")
            yield db, row, self.staging / identifier

    def chunk(self, owner, identifier, index, content, digest):
        if not isinstance(digest, str) or not DIGEST.fullmatch(digest) or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError("Chunk sha256 mismatch")
        with self.upload(owner, identifier) as (_, row, directory):
            count = (row["size"] + CHUNK - 1) // CHUNK
            if not 0 <= index < count or len(content) != min(CHUNK, row["size"] - index * CHUNK):
                raise ValueError("Invalid chunk index or size")
            path = directory / str(index)
            if path.exists():
                if path.read_bytes() != content:
                    raise ValueError("Chunk already exists with different data")
                return
            pending = directory / "pending"
            with pending.open("wb") as file:
                os.chmod(pending, 0o600)
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            checksum = directory / (str(index) + ".sha256")
            with checksum.open("w", encoding="ascii") as file:
                os.chmod(checksum, 0o600)
                file.write(digest)
                file.flush()
                os.fsync(file.fileno())
            os.replace(pending, path)
            fsync_directory(directory)

    def commit(self, owner, identifier):
        try:
            from .snapshot_validation import validate_snapshot
        except ImportError:
            from snapshot_validation import validate_snapshot
        with self.upload(owner, identifier) as (db, row, directory):
            assembled = directory / "assembled.db"
            digest = hashlib.sha256()
            with assembled.open("wb") as file:
                os.chmod(assembled, 0o600)
                for index in range((row["size"] + CHUNK - 1) // CHUNK):
                    path = directory / str(index)
                    checksum = directory / (str(index) + ".sha256")
                    if not path.is_file() or not checksum.is_file():
                        raise ValueError("Missing chunk")
                    content = path.read_bytes()
                    if len(content) != min(CHUNK, row["size"] - index * CHUNK) or hashlib.sha256(content).hexdigest() != checksum.read_text(encoding="ascii"):
                        raise ValueError("Stored chunk sha256 mismatch")
                    file.write(content)
                    digest.update(content)
                file.flush()
                os.fsync(file.fileno())
            if digest.hexdigest() != row["sha256"] or assembled.stat().st_size != row["size"]:
                raise ValueError("Snapshot sha256 mismatch")
            validate_snapshot(assembled)
            os.replace(assembled, self.snapshot(owner))
            fsync_directory(self.users)
            db.execute("DELETE FROM uploads WHERE id=?", (identifier,))
        shutil.rmtree(directory, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Explicitly provision/reset a sync user (no default credentials)")
    parser.add_argument("--data-dir", type=Path, default=default_directory())
    parser.add_argument("username", nargs="?")
    parser.add_argument("--cleanup", action="store_true", help="Remove expired sessions and upload staging without provisioning")
    args = parser.parse_args()
    if args.cleanup:
        if args.username:
            parser.error("--cleanup does not accept a username")
        SyncStore(args.data_dir).cleanup()
        print("Expired staging and sessions removed.")
        return
    if not valid_username(args.username):
        parser.error("Invalid ASCII username")
    password = getpass.getpass("Password (12–1024 characters): ")
    if password != getpass.getpass("Confirm password: "):
        parser.error("Passwords differ")
    try:
        SyncStore(args.data_dir).provision(args.username, password)
    except ValueError as error:
        parser.error(str(error))
    print("User provisioned; previous sessions revoked.")


if __name__ == "__main__":
    main()