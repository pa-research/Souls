#!/bin/sh
# The backup service of compose.yaml (mounted as /usr/local/bin/souls-backup into the postgres image):
#   souls-backup               dump the database to /backups now, keep the newest $SOULS_BACKUP_KEEP dumps
#   souls-backup loop          dump whenever the newest dump is older than $SOULS_BACKUP_HOURS hours
#   souls-backup restore FILE  drop the database and recreate it from /backups/FILE (stop web and server first)
set -eu
umask 077
PGPASSWORD=$(cat /run/secrets/postgres-password)
export PGPASSWORD
cd /backups
case ${1:-} in
loop)
    while :; do
        if [ -z "$(find . -name 'souls-*.dump' -mmin "-$((SOULS_BACKUP_HOURS * 60))")" ]; then
            "$0" || echo "backup failed" >&2
        fi
        sleep 300
    done ;;
restore)
    pg_restore --clean --if-exists --create --exit-on-error --dbname postgres "$2"
    echo "restored $2" ;;
*)
    rm -f souls-*.partial
    file=souls-$(date -u +%Y%m%dT%H%M%SZ).dump
    pg_dump --format=custom --file="$file.partial"
    mv "$file.partial" "$file"
    ls souls-*.dump | sort -r | tail -n "+$((SOULS_BACKUP_KEEP + 1))" | xargs -r rm -f
    echo "created $file" ;;
esac
