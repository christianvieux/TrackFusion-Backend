# DockerFile

# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Install system dependencies
RUN apk update && apk upgrade && \
    apk add --no-cache \
    python3 \
    bash \
    redis \
    postgresql-client \
    nginx && \
    mkdir -p /run/nginx

# Copy NGINX configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Create required directories for file uploads
RUN mkdir -p uploads/temp

# Copy the rest of the application code
COPY . .

# Add healthcheck for Redis
HEALTHCHECK --interval=30s --timeout=3s \
  CMD redis-cli ping || exit 1

# Expose the port the app runs on
EXPOSE 8080

# Create a startup script
RUN printf '#!/bin/sh\n\
redis-server --daemonize yes\n\
nginx\n\
# Wait for Redis to be ready\n\
until redis-cli ping; do\n\
  echo "Waiting for Redis..."\n\
  sleep 1\n\
done\n\
npm start' > /usr/src/app/docker-entrypoint.sh && \
    chmod +x /usr/src/app/docker-entrypoint.sh

# Verify script exists
RUN ls -la /usr/src/app/docker-entrypoint.sh

# Set the entry point
ENTRYPOINT ["/bin/sh", "/usr/src/app/docker-entrypoint.sh"]