# Manual, user-isolated SQLite snapshot sync

Python 3.10+ / Flask 3.1.x / standard-library SQLite. No frontend changes are owned here.
The frontend worker packages/unpackages SQLite and remains responsible for local offline data and manual upload/download/restore actions.
This is full-file **last successful commit wins**, not automatic/incremental sync, merge, or revision history.

## Provision and start

Install the dependencies listed in requirements.txt into a virtual environment. From the repository root:

```sh
server/.venv/bin/python server/sync_store.py --data-dir /absolute/private/data alice
CHATBOX_SERVER_DATA_DIR=/absolute/private/data server/.venv/bin/python server/app.py
```

Provisioning prompts for a password twice using getpass. There are **no default users/passwords**. The admin login page now links to /admin/register: registration is enabled by default for loopback-only deployment and disabled by default for remote TLS deployment. Set CHATBOX_SYNC_REGISTRATION=1 to explicitly enable it or =0 to disable it. Registration requires same-origin CSRF-protected forms, confirmation and valid credentials, is limited to five store registration attempts per peer per five minutes, and never resets an existing account. Newly registered accounts must upload their first snapshot before editing data. Remote open registration requires additional deployment quotas/abuse controls.
Usernames are case-sensitive ASCII `[A-Za-z0-9_-]{1,64}`; passwords must have 12–1024 characters.
Password hashing uses scrypt N=32768, r=8, p=3, 16-byte random salts and 32-byte hashes; parameter changes require explicit credential reprovisioning.
Reprovisioning an existing username explicitly resets its password, revokes its sessions and expires its staging, but preserves its snapshot.
The CLI does not accept passwords on the command line or in environment variables.

Default bind: **127.0.0.1:4567**, no debug/reloader, no request access logging. CHATBOX_SERVER_PORT changes only the port.
Data defaults to the server data directory; CHATBOX_SERVER_DATA_DIR supports an absolute path and `~`.
Use the same data directory for provisioning and runtime.

Data layout under that directory:

- users.db: scrypt password salts/hashes, SHA256-hashed expiring bearer tokens, upload ownership, rate limits, admin signing secret.
- users/&lt;username&gt;.db: only that user's most recently committed SQLite snapshot.
- staging/&lt;random-upload-id&gt;/: bounded temporary chunks, checksums, assembly.
- Existing catalog database/avatars are left untouched and are not a source of user snapshots.

On POSIX, private directories are 0700 and authentication/snapshot/chunk files 0600.
The OS account and storage directory must be trusted; do not permit untrusted filesystem edits/symlinks.
Stop the service and all CLI writers before an operator filesystem backup; copy users.db and the users directory together.
Stage files need not be backed up. Use disk encryption and restricted OS permissions if at-rest secrecy is required.

## Exact client SQLite contract

Send **one self-contained SQLite database**, not a ZIP, JSON dump, live Chatbox DB, or an encrypted envelope.

### Reserved administrator and user management

- `admin` is reserved and cannot be registered or provisioned using the ordinary user CLI. Registration also rejects case variants of this name.
- Set `CHATBOX_ADMIN_PASSWORD` in the backend's `.env` (see `.env.example`), using a unique 12–1024 character password. Process environment overrides the file. Password interpolation is disabled. Never commit or share this file; restrict its filesystem permissions.
- There is no default administrator password. Blank/unset disables administrator login and revokes its sessions, but preserves its existing snapshot. Restart after configuration changes. Changing the configured password revokes old administrator sessions and pending uploads; unchanged passwords preserve sessions.
- Only authenticated `admin` can access `/admin/users`. The list excludes `admin`, shows username and snapshot presence/size, and provides deletion only. It does not expose credentials, stored settings, conversations, or links to another user's archive.
- The reserved administrator lands directly on user management and has no personal overview, assistants, categories, or settings workspace. Client API login and snapshot upload/download/edit are denied for `admin`. Historical administrator snapshots are left on disk untouched but are not accessible through the service.
- Deletion requires CSRF and exact username confirmation; ordinary users and administrator self-deletion are denied. The account, sessions, snapshot, and upload staging are removed. Client-local data is unaffected. An already in-flight download may finish; revoked sessions cannot start new requests.
Its `PRAGMA user_version` is **1** and its only application schema objects are:

```sql
CREATE TABLE archive_entries(path TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE snapshot_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
```

The first PK may also be explicitly NOT NULL; ordinary, STRICT, or WITHOUT ROWID versions are supported individually.
Do not add extra columns/tables/views/triggers/indexes, expressions, defaults, CHECK/FK/generated constraints, or SQLite extensions.
The internal automatic PK index is permitted. WAL mode is rejected: close/checkpoint the worker DB and use DELETE journal mode before producing the standalone file.

Each archive_entries BLOB contains the **exact uncompressed bytes of a Chatbox V3 ZIP entry**, retaining the full portable archive including conversations/resources/configurations. Paths are the real V3 ZIP paths:

- manifest.json: `{format:"chatbox-backup",formatVersion:3,layout:"rows",archiveId,createdAt,producer,selection:{sessions,settings,copilots,credentials}}`.
- complete.json: matching archiveId, and optional V3 counts/resourceBytes/dataBytes/entryCount/uncompressedBytes. Present statistics must match; uncompressedBytes excludes complete.json itself.
- resources.jsonl: always present, even empty. Every resource is indexed exactly once with its size and identity.
- resources/000000.&lt;extension&gt;: raw resource bytes, indexed in resources.jsonl.
- sessions/&lt;canonically URI-encoded-id&gt;.jsonl: V3 session/thread/message rows. Case-folded path collisions are rejected.
- settings.json: the actual settings object, **not** `{settings: ...}`.
- copilots.json: the actual assistant array, **not** `{myCopilots: ...}`. Each item has id/name/prompt and can have category/avatar/backgroundImage/other metadata.
- session-settings.json: shared keys as defined by BackupConfigurations: chat-session-settings, picture-session-settings, session-folders, agent-soul, agent-memories, copilot-memories, copilot-memory-owners, copilot-memory-state-tokens.
- warnings.jsonl: optional V3 warning rows.

Selection flags retain V3 scope semantics: unselected configuration/session entries are rejected, selected settings/copilots require their entries, and credentials requires settings.
Partial V3 selections are accepted; a full backup must be selected by the client if all data is wanted.
snapshot_meta is opaque TEXT key/value metadata: it can be empty and is preserved; **do not put transfer checksums in it** (a self-hash cannot be embedded in the hashed database). The transport hash covers the final whole file.

Commit verifies restricted schema, integrity_check, actual SQLite row types, strict UTF-8 JSON, duplicate JSON keys, V3 control structures, selected configuration scope, path safety, resource completeness/sizes, session headers/ownership/order and present completion statistics.
It does **not** reimplement the entire TypeScript/Zod message schemas or conversation topology validator; the client must perform its standard V3 inspection/import validation before restore.
JSON row limit 16 MiB; configuration entry limit 64 MiB; control entries 64 KiB; total entries at most 65,534. The SQLite envelope and sum of entry bytes are each capped at 256 MiB.

## Exact HTTP contract

All requests below except login require `Authorization: Bearer <token>` even on loopback.
Admin cookies do not authorize client APIs. Tokens last **12 hours** (absolute expiry), persist across restart, and are revoked by logout/reset.
Login errors do not reveal account existence. Persistent limits allow 20 attempts per socket peer and per username per five-minute window (including successful attempts).

`CHUNK = 1,048,576 bytes` (1 MiB), `MAX = 268,435,456 bytes` (256 MiB), indexes are zero-based integers.
All hashes are lowercase 64-character SHA256 hex.

| Method/path | Request | Successful response |
| --- | --- | --- |
| POST /api/sync/login | JSON `{username,password}` | 200 JSON `{token}` |
| POST /api/sync/uploads | JSON `{size,sha256}` (final SQLite file bytes/hash) | 201 JSON `{id}` (random 32-character lowercase hex) |
| POST /api/sync/uploads/&lt;id&gt;/chunks/&lt;index&gt; | raw `application/octet-stream`, `X-Chunk-SHA256` | 204, empty body |
| POST /api/sync/uploads/&lt;id&gt;/commit | no body needed | 204, empty body |
| GET /api/sync/snapshot | no body | 200 JSON `{size,sha256,chunks}`; chunks is an integer count, not an array |
| GET /api/sync/snapshot/chunks/&lt;index&gt; | optional `X-Snapshot-SHA256` revision pin | 200 raw `application/octet-stream`; `X-Chunk-SHA256` and `X-Snapshot-SHA256` response headers |
| POST /api/sync/logout | no body needed | 204, empty body |

Chunk length is exactly CHUNK except the final chunk, whose length is `size - index * CHUNK`. Chunks may arrive out of order; identical retries return 204, conflicting retries return 400.
Commit checks each stored chunk again and the full size/hash, validates SQLite/V3, then fsyncs and atomically replaces only users/&lt;authenticated-username&gt;.db.
Invalid/incomplete commits leave the previous snapshot unchanged. Successful commits consume the upload ID; repeating commit returns 404.
Upload IDs are scoped to their authenticated owner, not usernames supplied by clients.

Upload staging has an absolute **one-hour** expiry; at most two active uploads per user.
Expired IDs immediately fail authorization lookup with 404. Physical cleanup runs at startup, new-upload creation, credential reset and the maintenance CLI:

```sh
server/.venv/bin/python server/sync_store.py --data-dir /absolute/private/data --cleanup
```

Schedule maintenance externally if idle staging must be physically removed promptly; no background cleanup thread is started.
There is no resumable chunk-list/cancel API. A client may retry known chunks during the staging lifetime; otherwise restart with a new upload.

For downloads, fetch metadata, fetch all chunks, validate every chunk SHA and the assembled full SHA/size before any restore.
Send metadata.sha256 as X-Snapshot-SHA256 on every chunk to fail early if another device/admin replaces the snapshot.
Without pinning, concurrent replacement can mix chunks across requests; the mandatory final full-hash check detects this and the client must restart.

JSON errors have `{error: "description"}`. Statuses: 400 invalid payload/checksum/schema/archive; 401 missing/expired/invalid session or login failure; 403 transport/Host/origin/CSRF rejection; 404 absent snapshot/chunk or foreign/expired/consumed upload; 409 pinned revision/stale admin edit; 413 size limit; 415 wrong chunk MIME; 429 login/staging limits. No bearer tokens in query strings.
Authenticated unknown/retired APIs return 404; unauthenticated private API requests return 401 (after transport/origin policy).
OPTIONS is unauthenticated preflight only and exposes no private data.

## TLS, Host, origins and reverse proxies

Default HTTP is allowed only when **both actual socket peer and Host are loopback** (localhost is permitted as Host, not arbitrary DNS names). Arbitrary Forwarded/X-Forwarded-* headers are ignored. No ProxyFix middleware is installed.
Non-loopback access requires explicit HTTPS deployment:

- CHATBOX_SYNC_HOSTS: comma-separated **exact lowercase external Host authorities**, including a port if clients use it; no wildcards.
- CHATBOX_SYNC_ORIGINS: comma-separated exact client origins (scheme + authority, no path/trailing slash). HTTPS, loopback HTTP and explicit `null` are supported; no wildcards.
- CHATBOX_SYNC_PROXY_PEERS: optional comma-separated **exact socket peer IPs** of your trusted TLS terminator; no CIDR/wildcard trust. Requires HOSTS.

Example configuration for a TLS proxy on the same machine:

```sh
CHATBOX_SYNC_HOSTS=sync.example.com \
CHATBOX_SYNC_ORIGINS=https://chat.example.com,null \
CHATBOX_SYNC_PROXY_PEERS=127.0.0.1 \
CHATBOX_SERVER_DATA_DIR=/absolute/private/data \
server/.venv/bin/python server/app.py
```

Terminate TLS using a maintained reverse proxy and valid certificates. Bind the backend to loopback or a private, firewalled interface reachable only by the configured proxy.
The proxy must **overwrite** X-Forwarded-Proto with exactly `https`, reject plaintext client requests (or redirect them before application access), and preserve/overwrite Host with the allowlisted external authority.
Do not pass through client-supplied forwarding headers. Requests from trusted peers missing the exact HTTPS header, with comma-separated schemes, or with an unallowlisted Host are denied.
Only X-Forwarded-Proto from the exact socket allowlist is used; X-Forwarded-For/Host/Forwarded are never used for identity, Host, origins or rate limits.
Peer-wide login limits therefore aggregate behind a proxy; deploy additional trusted proxy-side abuse controls as needed.
Trusting loopback means trusting all local OS processes; firewall/IP trust cannot distinguish processes on one machine.

For direct TLS WSGI deployment, configure HOSTS/ORIGINS but no PROXY_PEERS. The WSGI HTTPS scheme must come from the real TLS server, not untrusted forwarded headers; plaintext external requests are rejected.
The included Flask launcher deliberately remains loopback-only and does not manage certificates. For production use a maintained WSGI server/proxy with timeouts, worker/memory/disk limits and redacted/disabled request logging. WSGI request bodies must enforce Content-Length or correctly mark terminated chunked streams.

Default client origins: http://localhost:1212, http://127.0.0.1:1212, http://[::1]:1212 and `null`.
For local development, CHATBOX_SYNC_DEV_CORS=1 additionally permits exact HTTP/HTTPS loopback origins on other ports and responds to Private Network Access preflight. It is ineffective in external Host/trusted proxy deployments, never permits arbitrary domains, and never bypasses bearer authentication or admin same-origin/CSRF checks. Explicitly configure CHATBOX_SYNC_ORIGINS for a non-loopback forwarded browser origin. CORS cannot fix missing port forwarding or a refused connection.
Explicit ORIGINS replaces that set. `null` supports desktop opaque origins but cannot distinguish Electron from sandboxed pages; bearer authentication is always required.
CORS permits Content-Type, Authorization, Accept, X-Chunk-SHA256 and X-Snapshot-SHA256; permits GET/POST/OPTIONS and exposes X-Chunk-SHA256/X-Snapshot-SHA256. No credentialed CORS or wildcard origins.

**TLS protects transport. Server snapshots are intentionally plaintext and editable; this is NOT E2EE.**
The operator can read conversations, resources, prompts, settings and any credentials included by the worker's V3 selection.
SHA256 is transfer integrity, not protection from a malicious server. Protect tokens, backups and TLS trust accordingly.

## Admin editing

Open /admin. Mandatory login uses the same explicitly provisioned account/password and expiring server-side session.
There is no global superuser browser role: /admin/users/&lt;username&gt; and every mutation are scoped to the logged-in username; foreign users return 404.
Forms require same-origin requests and CSRF tokens (including login/logout), with HttpOnly/SameSite=Strict cookies, Secure cookies in TLS deployments, script-free CSP and escaped HTML.

- Assistant create/edit/delete updates only copilots.json. Editing preserves unknown fields, avatars/background resources and other metadata.
- Categories are optional `category` strings on those assistant items, per the actual CopilotDetail type. Rename/reclassification changes matching items; an empty replacement means unclassified. There is no invented category table.
- Settings editor updates the actual settings.json JSON object. It requires a JSON object; application/provider-specific validation remains the client's job. Preserve settings keys you do not intend to change.
- Only configurations present in the uploaded V3 selection are editable; a new user must upload a snapshot first.
- Editing keeps sessions/resources/shared configuration/snapshot_meta intact, recomputes present complete.json statistics, validates a private copy, and atomically replaces that user's snapshot. Stale form revisions return 409.
- Deleting assistants does not garbage-collect resources or rewrite conversation/copilot-memory references; those are deliberately preserved for client import semantics.

Admin edits are not pushed to clients. A later client upload can overwrite them (last successful whole-snapshot commit wins).

## Tests and operational limitations

```sh
server/.venv/bin/python -m unittest discover -s server -v
server/.venv/bin/python -m py_compile server/app.py server/sync_store.py server/sync_service.py server/snapshot_validation.py server/test_sync.py
```

Tests cover synthetic multi-chunk byte-exact roundtrip, owner isolation, mandatory auth/admin login, password hashing/no defaults, token expiry/revocation, login/staging limits, hash failure rollback, malformed SQLite/schema/V3 rejection, resources/selection, CORS, untrusted proxy headers, HTTPS policy, CSRF, escaped admin edits/revision conflicts and preservation of metadata/unknown fields. Existing offline catalog/import tests remain.

SQLite write locks serialize mutations across workers (including expensive commits). Downloads use one open file descriptor per request, so an atomic replacement does not change an in-progress chunk read.
The runtime has no network dependency and leaves downloaded catalog assets/import tooling intact; former shared catalog routes are retired and no shared catalog is seeded into user snapshots.

Limits: bounded personal/team backup service, not large-scale sync; validation may allocate an entry and its parsed JSON in memory; each download chunk computes the whole-file hash; disk demand can exceed three snapshot sizes per user due to two staging uploads, assembly and the published file; no global disk quota beyond externally configured limits. Filesystem/SQLite publication is not one cross-resource transaction: a crash after atomic replace but before upload metadata deletion may leave a published snapshot and a retryable staging ID, never a partial published file. Startup/maintenance removes orphan staging; a crash during admin editing may leave an unreferenced hidden temporary file under users (remove it with the service stopped). No antivirus/deep content validation, remote certificate/proxy integration test, frontend/Electron end-to-end test, or Windows filesystem atomicity test is claimed.