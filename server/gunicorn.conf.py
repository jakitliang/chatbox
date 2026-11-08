import os

# Linux host networking preserves real loopback peers and exact proxy trust.
bind = "127.0.0.1:" + os.environ.get("CHATBOX_SERVER_PORT", "4567")
workers = 1
threads = 4
worker_class = "gthread"
timeout = 120
graceful_timeout = 30
accesslog = None
errorlog = "-"
# Do not let Gunicorn trust forwarded scheme headers implicitly.
forwarded_allow_ips = ""
secure_scheme_headers = {}
worker_tmp_dir = "/tmp"