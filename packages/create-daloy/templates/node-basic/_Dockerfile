# syntax=docker/dockerfile:1.7
# Container-first defaults for a DaloyJS app.
#
# Hardening shipped out of the box:
#   - Non-root runtime user (uid 1001).
#   - Read-only root filesystem at runtime (use `--read-only` or set
#     `readOnlyRootFilesystem: true` in your orchestrator).
#   - `STOPSIGNAL SIGTERM` so the framework's graceful-shutdown drain
#     fires on container stop.
#   - `HEALTHCHECK` wired to the `/healthz` route registered in
#     `src/build-app.ts`.
#   - `tini` as PID 1 for proper signal forwarding and zombie reaping.
#   - Minimal runner surface: no `curl` / no extra OS packages. The
#     healthcheck uses BusyBox `wget` already in `node:*-alpine`.
#   - Base image is consumed through the `NODE_IMAGE` ARG so you can
#     pin to an immutable digest (recommended for production):
#       docker build --build-arg \
#         NODE_IMAGE=node:24-alpine@sha256:<digest> .
#     Dependabot's `docker` ecosystem (see `.github/dependabot.yml`)
#     keeps the digest fresh. The companion `container-scan.yml`
#     workflow lints this file with hadolint and scans the built
#     image with Trivy on every PR.

# Override at build time to pin a specific digest:
#   NODE_IMAGE=node:24-alpine@sha256:<digest>
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
# tini only — no curl, no extra packages. BusyBox `wget` (already in
# alpine) is enough for the HEALTHCHECK below.
RUN apk add --no-cache tini && \
    addgroup -S app -g 1001 && \
    adduser -S app -G app -u 1001
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null --spider http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
