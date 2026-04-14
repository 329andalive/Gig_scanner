FROM node:20-slim

# Install Chromium and all dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && echo "Chromium installed at: $(which chromium || which chromium-browser || echo 'NOT FOUND')"

# Tell Puppeteer to use system Chromium — try both possible paths
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Increase shared memory for Chromium (Docker default 64MB is too small)
ENV CHROMIUM_FLAGS="--disable-dev-shm-usage"

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["npx", "tsx", "src/cron/scheduler.ts"]
