FROM node:18-slim

# Only FFmpeg needed — no Chromium, no X11 libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root dependencies (ring-client-api, dotenv)
COPY package*.json ./
RUN npm install --production

# Install PWA dependencies (express, ws)
COPY pwa_applet/package*.json ./pwa_applet/
RUN cd pwa_applet && npm install --production

# Copy application code
COPY lib/ ./lib/
COPY cli/ ./cli/
COPY snapshot.mjs ./
COPY pwa_applet/ ./pwa_applet/

# Create data directories
RUN mkdir -p /data /app/pwa_applet/media/recordings /app/pwa_applet/media/timelapses

# Default token path on persistent volume
ENV RING_TOKEN_PATH=/data/ring-token.json
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["node", "pwa_applet/server.mjs"]
