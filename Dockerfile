FROM node:18-slim

WORKDIR /usr/src/app

# Install system dependencies and create Python virtual environment
RUN apt-get update && apt-get install -y \
    python3-full \
    python3-pip \
    python3-venv \
    redis-server \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

# Activate virtual environment and install Python packages
ENV PATH="/opt/venv/bin:$PATH"

COPY package*.json ./
RUN npm ci --only=production

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

RUN mkdir -p uploads/temp
COPY . .

HEALTHCHECK --interval=30s --timeout=3s \
  CMD redis-cli ping || exit 1

EXPOSE 8080

RUN printf '#!/bin/sh\n\
source /opt/venv/bin/activate\n\
redis-server --daemonize yes\n\
sleep 2\n\
npm start\n' > /usr/src/app/docker-entrypoint.sh && \
    chmod +x /usr/src/app/docker-entrypoint.sh

# Change the entrypoint to use bash instead of sh
ENTRYPOINT ["/bin/bash", "/usr/src/app/docker-entrypoint.sh"]