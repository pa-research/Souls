#!/usr/bin/env bash
set -euo pipefail

[[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/heads/main ]] || exit 1
[[ ${GITHUB_REPOSITORY_OWNER:-} =~ ^[a-zA-Z0-9-]+$ ]] || exit 1
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]{0,19}$ ]] || exit 1
[[ ${GITHUB_RUN_NUMBER:-} =~ ^[1-9][0-9]{0,8}$ ]] || exit 1
[[ ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]{0,2}$ ]] || exit 1

owner=${GITHUB_REPOSITORY_OWNER,,}
candidate="candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
release="main-$((GITHUB_RUN_NUMBER * 1000 + GITHUB_RUN_ATTEMPT))-${GITHUB_SHA:0:7}"

# Both candidates must exist before either release tag becomes visible.
for target in web server; do
  docker buildx imagetools inspect "ghcr.io/${owner}/souls-${target}:${candidate}" > /dev/null
done
for target in web server; do
  image="ghcr.io/${owner}/souls-${target}"
  docker buildx imagetools create --prefer-index=false -t "${image}:${release}" "${image}:${candidate}"
done
