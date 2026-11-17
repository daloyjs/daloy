# Agent image for live agent evals (`pnpm eval --sandbox docker`).
#
# It holds the toolchain, the agent CLI, and Linux builds of the workspace
# dependencies, and NOTHING from this repository: no tasks, hidden tests,
# reference solutions, or graders. Each trial mounts only its own workspace
# at /work. Build it with `pnpm eval:image`, which pipes this file to
# `docker build` with no build context and passes the pinned versions.
#
# Pinned by digest (node:24-bookworm; full image for git). Refresh it
# periodically, like .clusterfuzzlite/Dockerfile.
FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496

ARG PNPM_VERSION
ARG COPILOT_CLI_VERSION
ARG CLAUDE_CODE_VERSION=
ARG CODEX_VERSION=
ARG ZOD_VERSION
ARG TYPESCRIPT_VERSION
ARG TYPES_NODE_VERSION
ARG SPEC_LABEL
LABEL dev.daloyjs.eval.spec=$SPEC_LABEL

# Exact versions, no install-time lifecycle scripts.
RUN set -eu; \
  clis="pnpm@${PNPM_VERSION} @github/copilot@${COPILOT_CLI_VERSION}"; \
  if [ -n "${CLAUDE_CODE_VERSION}" ]; then clis="$clis @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; fi; \
  if [ -n "${CODEX_VERSION}" ]; then clis="$clis @openai/codex@${CODEX_VERSION}"; fi; \
  npm install --global --ignore-scripts $clis; \
  mkdir -p /opt/eval-deps; \
  npm install --prefix /opt/eval-deps --ignore-scripts --no-save --no-package-lock \
    "zod@${ZOD_VERSION}" "typescript@${TYPESCRIPT_VERSION}" "@types/node@${TYPES_NODE_VERSION}"; \
  npm cache clean --force

ENV npm_config_ignore_scripts=true CI=true COPILOT_AUTO_UPDATE=false
USER node
WORKDIR /work
