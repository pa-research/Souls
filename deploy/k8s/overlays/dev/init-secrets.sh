#!/bin/sh
# Writes secrets.env for the dev overlay with random passwords (kept if it already exists).
set -eu
cd "$(dirname "$0")"
[ -s secrets.env ] && { echo "secrets.env exists"; exit 0; }
umask 077
random() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32; }
db=$(random)
admin=$(random)
cat > secrets.env <<EOT
postgres-password=$db
ConnectionStrings__Souls=Host=souls-postgres;Port=5432;Database=souls;Username=souls;Password=$db
Souls__Admin__Password=$admin
EOT
echo "created secrets.env (administrator 'admin', password: $admin)"
