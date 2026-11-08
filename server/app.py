"""Authenticated manual snapshot sync service entrypoint."""

import logging
import os

try:
    from .sync_service import create_app
except ImportError:
    from sync_service import create_app


if __name__ == "__main__":
    logging.getLogger("werkzeug").disabled = True
    create_app().run(
        host="127.0.0.1", port=int(os.environ.get("CHATBOX_SERVER_PORT", "4567")),
        debug=False, use_reloader=False,
    )