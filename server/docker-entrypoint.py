"""Read a root-only configuration mount, then permanently drop privileges."""

import os
import sys
from pathlib import Path

from dotenv import dotenv_values

config = Path("/app/.env")
if not config.is_file():
    sys.exit("Mount a .env file at /app/.env; copy .env.example and configure it first.")
for key, value in dotenv_values(config, interpolate=False).items():
    if key.startswith("CHATBOX_") and value is not None:
        os.environ.setdefault(key, value)
password = os.environ.get("CHATBOX_ADMIN_PASSWORD", "")
if not 12 <= len(password) <= 1024:
    sys.exit("Set CHATBOX_ADMIN_PASSWORD to a unique 12–1024 character password in the mounted .env.")

data = Path(os.environ["CHATBOX_SERVER_DATA_DIR"])
data.mkdir(parents=True, exist_ok=True, mode=0o700)
# Restored host backups may belong to the operator rather than the service UID.
# Reject symlinks instead of following them outside the mounted data directory.
for directory, subdirectories, files in os.walk(data, followlinks=False):
    for path in [Path(directory), *(Path(directory) / name for name in subdirectories + files)]:
        if path.is_symlink():
            sys.exit("Data directory must not contain symbolic links.")
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
        os.chown(path, 10001, 10001)
os.setgroups([])
os.setgid(10001)
os.setuid(10001)
os.execvp(sys.argv[1], sys.argv[1:])