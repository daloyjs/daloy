#!/usr/bin/env bash
# Run live agent evals in the Docker sandbox with egress limited to an
# allowlist. The eval container joins only an internal Docker network (no
# route out); an egress proxy container, on both that network and the normal
# bridge, tunnels HTTPS to allowlisted host names and logs every decision to
# evals/results/egress-<time>.log.
#
# Build the image first (from the repo root):
#   docker build -f evals/Dockerfile -t daloy-evals .
# Then pass `pnpm eval` arguments through:
#   COPILOT_GITHUB_TOKEN=$(gh auth token) evals/sandbox-run.sh \
#     --agent copilot --sandbox-ack --model claude-sonnet-5.5 --trials 3
#
# Environment:
#   EGRESS_ALLOW  allowlist (default: .githubcopilot.com,api.github.com;
#                 `--mcp docs` adds daloyjs.dev automatically)
#   IMAGE         image name (default: daloy-evals)
set -euo pipefail

IMAGE="${IMAGE:-daloy-evals}"
NETWORK="daloy-evals-internal"
PROXY="daloy-evals-egress-$$"
ALLOW="${EGRESS_ALLOW:-.githubcopilot.com,api.github.com}"
prev=""
for arg in "$@"; do
  if [ "$arg" = "--mcp=docs" ] || { [ "$prev" = "--mcp" ] && [ "$arg" = "docs" ]; }; then
    ALLOW="$ALLOW,daloyjs.dev"
  fi
  prev="$arg"
done

: "${COPILOT_GITHUB_TOKEN:?set COPILOT_GITHUB_TOKEN (for example: export COPILOT_GITHUB_TOKEN=\$(gh auth token))}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS="$REPO_ROOT/evals/results"
mkdir -p "$RESULTS"
LOG="$RESULTS/egress-$(date -u +%Y-%m-%dT%H-%M-%SZ).log"

docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || docker network create --internal "$NETWORK" >/dev/null

docker run -d --rm --name "$PROXY" \
  --cap-drop=ALL --security-opt no-new-privileges --memory 256m \
  -e EGRESS_ALLOW="$ALLOW" \
  --entrypoint node "$IMAGE" --import tsx evals/egress-proxy.ts >/dev/null
docker network connect --alias egress "$NETWORK" "$PROXY"

cleanup() {
  docker logs "$PROXY" >"$LOG" 2>&1 || true
  docker stop "$PROXY" >/dev/null 2>&1 || true
  echo "Egress log: ${LOG#"$REPO_ROOT"/}"
}
trap cleanup EXIT

docker run --rm --network "$NETWORK" \
  --cap-drop=ALL --security-opt no-new-privileges --memory 3g \
  -e COPILOT_GITHUB_TOKEN \
  -e HTTPS_PROXY=http://egress:3128 -e HTTP_PROXY=http://egress:3128 \
  -e NO_PROXY=localhost,127.0.0.1,::1 -e NODE_USE_ENV_PROXY=1 \
  -v "$RESULTS:/home/node/daloy/evals/results" \
  "$IMAGE" "$@"
