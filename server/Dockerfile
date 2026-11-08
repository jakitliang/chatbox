FROM debian:bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    CHATBOX_SERVER_DATA_DIR=/var/lib/chatbox

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && groupadd --gid 10001 chatbox \
    && useradd --uid 10001 --gid chatbox --no-create-home --shell /usr/sbin/nologin chatbox \
    && install -d -m 0700 -o chatbox -g chatbox /var/lib/chatbox

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Explicit allowlist: no .env, user databases, downloaded seeds, tests or venv.
COPY app.py sync_service.py sync_store.py snapshot_validation.py settings_forms.py snapshot_avatars.py ./
COPY templates/sync_*.html ./templates/
COPY docker-entrypoint.py gunicorn.conf.py ./

EXPOSE 4567
ENTRYPOINT ["/opt/venv/bin/python", "/app/docker-entrypoint.py"]
CMD ["gunicorn", "--config", "/app/gunicorn.conf.py", "sync_service:create_app()"]