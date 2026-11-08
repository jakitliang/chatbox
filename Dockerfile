FROM debian:bookworm-slim AS web-build
ARG NODE_VERSION=22.16.0
ARG NODE_DIST_MIRROR=https://cdn.npmmirror.com/binaries/node
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
# Bootstrap certificates over HTTP; APT still verifies Debian signatures.
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.ustc.edu.cn/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.ustc.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y --no-install-recommends curl ca-certificates xz-utils \
    && sed -i 's|http://mirrors.ustc.edu.cn|https://mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) exit 1 ;; esac \
    && curl --retry 3 --connect-timeout 30 -fsSLO "${NODE_DIST_MIRROR}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && curl --retry 3 --connect-timeout 30 -fsSLo SHASUMS256.txt "${NODE_DIST_MIRROR}/v${NODE_VERSION}/SHASUMS256.txt" \
    && grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" SHASUMS256.txt
WORKDIR /source
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY patches ./patches
COPY release/app/package.json release/app/package-lock.json ./release/app/
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmmirror.com
COPY src ./src
COPY server/snapshot ./server/snapshot
COPY scripts ./scripts
COPY electron.vite.config.ts vite.config.web.ts tsconfig.json postcss.config.js tailwind.config.js ./
ENV CHATBOX_INTEGRATED_BUILD=1 NODE_ENV=production
RUN pnpm exec vite build --config vite.config.web.ts --outDir /web-dist

FROM debian:bookworm-slim
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.ustc.edu.cn/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.ustc.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH \
    CHATBOX_SERVER_DATA_DIR=/var/lib/chatbox CHATBOX_SERVER_PORT=4567
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends python3 python3-venv nginx ca-certificates \
    && sed -i 's|http://mirrors.ustc.edu.cn|https://mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && groupadd --gid 10001 chatbox \
    && useradd --uid 10001 --gid chatbox --no-create-home --shell /usr/sbin/nologin chatbox \
    && install -d -m 0700 -o chatbox -g chatbox /var/lib/chatbox
WORKDIR /app
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app.py server/sync_service.py server/sync_store.py server/snapshot_validation.py server/settings_forms.py server/snapshot_avatars.py ./
COPY server/templates/sync_*.html ./templates/
COPY server/docker-entrypoint.py server/gunicorn.conf.py ./
COPY deploy/integrated.py ./
COPY --from=web-build /web-dist /web
EXPOSE 1212
ENTRYPOINT ["/opt/venv/bin/python", "/app/docker-entrypoint.py"]
CMD ["/opt/venv/bin/python", "/app/integrated.py"]