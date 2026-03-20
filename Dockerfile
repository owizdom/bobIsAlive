# ── Build stage ──
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY agents/ ./agents/
COPY dashboard/ ./dashboard/
RUN npm run build

# ── Runtime stage ──
FROM node:22-slim AS runtime
WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY dashboard/index.html             ./dashboard/index.html
COPY scripts/supervise-swarm.sh      ./scripts/supervise-swarm.sh
RUN chmod +x ./scripts/supervise-swarm.sh

VOLUME ["/data"]
EXPOSE 3001
CMD ["bash", "-lc", "npm run supervise"]
