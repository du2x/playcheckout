# Production image for the single-container deploy (AD-001): one Fastify
# process serves the built client and the Colyseus WebSocket endpoint.
FROM node:24-slim

RUN npm install -g pnpm@11.24.0

WORKDIR /app

# Install from manifests first so dependency layers cache across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile

COPY . .
# Client-only build (vite); shared/sim/server are consumed as TS source by tsx.
RUN pnpm build

EXPOSE 2567
# node as PID 1 so Fly's SIGTERM reaches Colyseus's built-in drain directly
# (a pnpm wrapper between the signal and the server risks an orphaned server).
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
