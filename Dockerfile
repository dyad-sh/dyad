# VPS-friendly Dyad desktop container
# Runs Dyad in an XFCE virtual desktop and exposes it through noVNC behind nginx.
# This is not a native Dyad web rewrite; it is a practical containerized desktop version.

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    VNC_GEOMETRY=1440x900 \
    VNC_DEPTH=24 \
    DATA_DIR=/data \
    DYAD_USER=dyad \
    ELECTRON_DISABLE_SANDBOX=1 \
    NO_AT_BRIDGE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget git gnupg xz-utils unzip \
    xfce4 xfce4-terminal dbus-x11 x11-xserver-utils xvfb xauth \
    x11vnc novnc websockify nginx supervisor x11-utils apache2-utils \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2t64 \
    libgbm1 libdrm2 libxshmfence1 libnotify4 libsecret-1-0 \
    libsqlite3-0 fuse3 \
    python3 python3-pip \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*
# Node.js 24+ is required by Dyad. Use NodeSource current stream.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && npm install -g pnpm@latest \
# Browser file/folder manager for persistent Dyad data and generated apps.
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN useradd -m -s /bin/bash ${DYAD_USER} \
    && mkdir -p /opt/dyad /data/userData /data/apps /data/cache /data/downloads /var/log/supervisor \
    && chown -R ${DYAD_USER}:${DYAD_USER} /opt/dyad /data
WORKDIR /opt/dyad
COPY --chown=${DYAD_USER}:${DYAD_USER} . /opt/dyad
USER ${DYAD_USER}
RUN npm ci --no-audit --no-fund \
    && npm run package \
    && mkdir -p /home/${DYAD_USER}/Desktop \
    && ln -sf /data/apps /home/${DYAD_USER}/Desktop/dyad-apps \
    && ln -sf /data/userData /home/${DYAD_USER}/Desktop/dyad-userData \
    && ln -sf /data/downloads /home/${DYAD_USER}/Desktop/downloads
USER root
COPY vps-container/scripts/start-dyad.sh /usr/local/bin/start-dyad.sh
COPY vps-container/scripts/start-filebrowser.sh /usr/local/bin/start-filebrowser.sh
COPY vps-container/scripts/start-x11vnc.sh /usr/local/bin/start-x11vnc.sh
COPY vps-container/scripts/start-nginx.sh /usr/local/bin/start-nginx.sh
COPY vps-container/supervisord.conf /etc/supervisor/conf.d/dyad-vps.conf
COPY vps-container/nginx/default.conf /etc/nginx/sites-available/default
RUN chmod +x /usr/local/bin/start-dyad.sh /usr/local/bin/start-filebrowser.sh /usr/local/bin/start-x11vnc.sh /usr/local/bin/start-nginx.sh
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/dyad-vps.conf"]
