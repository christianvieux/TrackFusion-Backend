FROM node:24.16.0-bookworm-slim AS node-dependencies

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM python:3.12.15-slim-bookworm AS python-dependencies

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN python -m venv "${VIRTUAL_ENV}"
COPY requirements.txt /tmp/requirements.txt
RUN pip install --disable-pip-version-check --no-cache-dir \
    -r /tmp/requirements.txt

FROM python:3.12.15-slim-bookworm AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8081
ENV PYTHON_EXECUTABLE=/opt/venv/bin/python
ENV PATH="/opt/venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dumb-init \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 trackfusion \
    && useradd --system --uid 10001 --gid trackfusion \
        --home-dir /home/trackfusion --create-home trackfusion

COPY --from=node-dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=node-dependencies /build/node_modules /app/node_modules
COPY --from=python-dependencies /opt/venv /opt/venv

WORKDIR /app
COPY --chown=trackfusion:trackfusion . .
RUN mkdir -p uploads/temp \
    && chown -R trackfusion:trackfusion uploads

USER 10001:10001

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
