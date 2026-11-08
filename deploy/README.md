# Integrated Web and backend deployment

Both image stages use Debian Bookworm Slim. Debian packages use USTC mirrors; Node binaries and npm dependencies use npmmirror.

From the project root:

```sh
cp .env.example .env
# Edit .env and set CHATBOX_ADMIN_PASSWORD (12–1024 characters).
docker compose up -d --build
```

Open http://127.0.0.1:1212 for the Web client and http://127.0.0.1:1212/admin for the backend. The reserved `admin` account manages users only; ordinary users register separately and manage their own uploaded snapshots.

The container proxies `/admin` and `/api` to an unpublished loopback backend. Web sync settings suggest the current browser origin, but saving the address and uploading/downloading remain explicit manual actions. No automatic login, sync, or restore occurs.

Configuration is mounted read-only from the root `.env`; private server data persists in the root `data/` directory. This is separate from standalone deployment's `server/data/`; no implicit migration occurs. Back up the data directory with the service stopped. Do not commit credentials or data.

If changing CHATBOX_WEB_PORT, update CHATBOX_PUBLIC_ORIGIN to the matching exact browser origin (no trailing slash). Port 1212 must be free; a development server using it must first be stopped. Remote use requires an external HTTPS reverse proxy and CHATBOX_PUBLIC_ORIGIN set to its exact HTTPS origin. The default published port is loopback-only.

Run `docker compose up -d --build` after source changes, or `docker compose up -d --force-recreate` after configuration changes. `docker compose down` preserves host data.

The runtime uses a read-only root filesystem, writable temporary directories, UID/GID 10001 after startup, and supervises Nginx plus Gunicorn. Snapshots are plaintext at rest; this is not end-to-end encryption or an atomic full-client backup.
