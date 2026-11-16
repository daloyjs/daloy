# Sandbox image for live agent evals (`pnpm eval`).
#
# A live agent runs shell commands with broad permissions. Inside this
# container it sees only a copy of this repository (no host home directory,
# SSH keys, cloud credentials, or `gh` config), runs as the unprivileged
# `node` user, and gets only the variables you pass with `-e`. Results are
# written to a bind-mounted `evals/results/`. The network stays open because
# the agent must reach its model API; see evals/README.md for the remaining
# risks and the recommended fine-grained token.
#
# Build (from the repo root):
#   docker build -f evals/Dockerfile -t daloy-evals .
# Run:
#   docker run --rm --cap-drop=ALL --security-opt no-new-privileges \
#     -e COPILOT_GITHUB_TOKEN -v "$PWD/evals/results:/home/node/daloy/evals/results" \
#     daloy-evals --agent copilot --sandbox-ack --model claude-sonnet-5.5 --trials 3
#
# Pinned by digest (node:24-bookworm; full image for git). Refresh it
# periodically, like .clusterfuzzlite/Dockerfile.
FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496

# Exact versions; --ignore-scripts so no install-time lifecycle script runs.
ARG PNPM_VERSION=12.3.0
ARG COPILOT_CLI_VERSION=1.0.112
RUN npm install --global --ignore-scripts "pnpm@${PNPM_VERSION}" "@github/copilot@${COPILOT_CLI_VERSION}" \
  && npm cache clean --force

USER node
WORKDIR /home/node/daloy
COPY --chown=node:node . .

# Same posture as CI: frozen lockfile, no lifecycle scripts.
ENV npm_config_ignore_scripts=true CI=true COPILOT_AUTO_UPDATE=false
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

ENTRYPOINT ["node", "--import", "tsx", "evals/run.ts"]
