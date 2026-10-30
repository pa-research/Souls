#!/bin/sh
# Replaces the database with a dump made by the backup service:
#   ./deploy/compose/restore.sh souls-20261030T031500Z.dump
# Without an argument it lists the dumps. Uses the same project settings as docker compose (.env, COMPOSE_*).
set -eu
cd "$(dirname "$0")/../.."
if [ $# -eq 0 ]; then
    docker compose exec -T backup ls -l /backups
    echo "usage: $0 <dump>" >&2
    exit 1
fi
docker compose stop web server
docker compose exec -T backup souls-backup restore "$(basename "$1")"
# Runs migrate again (an older dump may need newer migrations) and starts the apps.
docker compose up -d
