#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
cat > "$tmp/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CALLS"
[[ ${FAIL_SERVER:-false} != true || $* != *'inspect ghcr.io/pa-research/souls-server:'* ]]
EOF
chmod +x "$tmp/docker"
export PATH="$tmp:$PATH" CALLS="$tmp/calls"
export GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REPOSITORY_OWNER=PA-Research
export GITHUB_SHA=cf516666327b392a3dcf1028fb3ac08ca3614d71 GITHUB_RUN_ID=12345 GITHUB_RUN_NUMBER=4 GITHUB_RUN_ATTEMPT=1
bash "$root/tools/release-images.sh"
[[ $(wc -l < "$CALLS") == 4 ]]
grep -Fx 'buildx imagetools create --prefer-index=false -t ghcr.io/pa-research/souls-web:main-4001-cf51666 ghcr.io/pa-research/souls-web:candidate-12345' "$CALLS" > /dev/null
grep -Fx 'buildx imagetools create --prefer-index=false -t ghcr.io/pa-research/souls-server:main-4001-cf51666 ghcr.io/pa-research/souls-server:candidate-12345' "$CALLS" > /dev/null
: > "$CALLS"
GITHUB_RUN_ATTEMPT=2 bash "$root/tools/release-images.sh"
grep -Fx 'buildx imagetools create --prefer-index=false -t ghcr.io/pa-research/souls-web:main-4002-cf51666 ghcr.io/pa-research/souls-web:candidate-12345' "$CALLS" > /dev/null
: > "$CALLS"
if FAIL_SERVER=true bash "$root/tools/release-images.sh"; then exit 1; fi
[[ $(wc -l < "$CALLS") == 2 ]]
: > "$CALLS"
if GITHUB_RUN_ATTEMPT=1000 bash "$root/tools/release-images.sh"; then exit 1; fi
[[ ! -s "$CALLS" ]]
if GITHUB_REF=refs/heads/dev bash "$root/tools/release-images.sh"; then exit 1; fi
[[ ! -s "$CALLS" ]]
