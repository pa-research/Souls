#!/bin/sh
# Writes secrets.env for the dev overlay with random passwords and a Data Protection certificate (kept if it exists).
set -eu
cd "$(dirname "$0")"
umask 077
random() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32; }
if [ -s secrets.env ]; then
    echo "secrets.env exists"
else
    db=$(random)
    admin=$(random)
    cat > secrets.env <<EOT
postgres-password=$db
ConnectionStrings__Souls=Host=souls-postgres;Port=5432;Database=souls;Username=souls;Password=$db
Souls__Admin__Password=$admin
EOT
    echo "created secrets.env (administrator 'admin', password: $admin)"
fi
if ! grep -q '^Souls__DataProtection__Certificate=' secrets.env; then
    # Self-signed certificate (base64 PFX) that encrypts the Data Protection keys (login cookies) in the database.
    cert=$(openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=Souls Data Protection" \
        -keyout /dev/stdout -out /dev/stdout 2>/dev/null | openssl pkcs12 -export -passout pass: | openssl base64 -A)
    echo "Souls__DataProtection__Certificate=$cert" >> secrets.env
    echo "added the Data Protection certificate to secrets.env"
fi
