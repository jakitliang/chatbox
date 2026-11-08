"""Run same-origin nginx and Gunicorn as one non-root, supervised service."""

import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

origin = os.environ.get("CHATBOX_PUBLIC_ORIGIN", "http://127.0.0.1:1212")
from sync_service import authority, loopback

parsed = urlsplit(origin)
if origin != f"{parsed.scheme}://{parsed.netloc}" or not authority(parsed.netloc) or not (parsed.scheme == "https" or (parsed.scheme == "http" and (parsed.hostname == "localhost" or loopback(parsed.hostname)))):
    raise SystemExit("CHATBOX_PUBLIC_ORIGIN must be exact HTTPS or loopback HTTP origin")
os.environ["CHATBOX_INTEGRATED_ORIGIN"] = origin
# Internal backend is not published and must not inherit a host listening port.
os.environ["CHATBOX_SERVER_PORT"] = "4567"
config = f"""
worker_processes 1;
pid /tmp/nginx.pid;
error_log stderr warn;
events {{ worker_connections 1024; }}
http {{
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  client_body_temp_path /tmp/nginx-client;
  proxy_temp_path /tmp/nginx-proxy;
  fastcgi_temp_path /tmp/nginx-fastcgi;
  uwsgi_temp_path /tmp/nginx-uwsgi;
  scgi_temp_path /tmp/nginx-scgi;
  server {{
    listen 1212;
    server_name _;
    root /web;
    client_max_body_size 2m;
    location = /healthz {{
      proxy_pass http://127.0.0.1:4567/admin/login;
      proxy_set_header Host {parsed.netloc};
      proxy_set_header X-Forwarded-Proto {parsed.scheme};
    }}
    location ~ ^/(admin|api)(/|$) {{
      proxy_pass http://127.0.0.1:4567;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto {parsed.scheme};
      proxy_set_header X-Forwarded-For "";
      proxy_read_timeout 120s;
      proxy_request_buffering off;
      proxy_buffering off;
    }}
    location / {{ try_files $uri $uri/ /index.html; }}
  }}
}}
"""
Path("/tmp/nginx.conf").write_text(config)
stop = threading.Event()
def shutdown(*_):
    stop.set()
signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)
children = []
try:
    children.append(subprocess.Popen(["gunicorn", "--config", "/app/gunicorn.conf.py", "sync_service:create_app()"], env=os.environ))
    children.append(subprocess.Popen(["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"]))
    while not stop.wait(0.5):
        if any(child.poll() is not None for child in children):
            raise SystemExit("Integrated subprocess exited; restarting container is required")
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 30
    for child in children:
        try:
            child.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()