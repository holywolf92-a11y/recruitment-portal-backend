# Use Node.js 20 with Chromium pre-installed
FROM node:20-slim

# Install Chromium and required dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxss1 \
    libgtk-3-0 \
    libxshmfence1 \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
# NODE_OPTIONS caps the V8 heap to 384 MB, keeping idle memory low.
# Chromium is launched on-demand only; it does not live in the Node.js heap.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_OPTIONS="--max-old-space-size=384"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source code (bust cache: 2026-01-27)
COPY . .

# Build TypeScript using node directly (4 GB heap for build step)
RUN node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json

# Start the app
CMD ["npm", "start"]
