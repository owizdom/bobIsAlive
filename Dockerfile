# ── Build stage ──
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install backend deps
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Install frontend deps
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install

# Copy source
COPY tsconfig.json ./
COPY agents/ ./agents/
COPY frontend/ ./frontend/

# Build backend + frontend
RUN npm run build
RUN cd frontend && npm run build

# ── Runtime stage ──
FROM node:22-slim AS runtime
WORKDIR /app

COPY --from=builder /app/dist           ./dist
COPY --from=builder /app/node_modules   ./node_modules
COPY --from=builder /app/package.json   ./package.json
COPY --from=builder /app/frontend/dist  ./frontend/dist

# Create doodles directory
RUN mkdir -p doodles

EXPOSE 3001
USER root

CMD ["node", "dist/agents/orchestrator.js"]
