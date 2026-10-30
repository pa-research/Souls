#!/bin/sh
# Generates the secrets used by compose.yaml (run once). Existing secrets are kept.
set -eu
cd "$(dirname "$0")/secrets"
umask 077

random() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32; }

if [ ! -s postgres-password ]; then
    random > postgres-password
    echo "created postgres-password"
fi

if [ ! -s ConnectionStrings__Souls ]; then
    printf 'Host=db;Port=5432;Database=souls;Username=souls;Password=%s' "$(cat postgres-password)" > ConnectionStrings__Souls
    echo "created ConnectionStrings__Souls"
fi

if [ ! -s Souls__Admin__Password ]; then
    random > Souls__Admin__Password
    echo "created Souls__Admin__Password (administrator password: $(cat Souls__Admin__Password))"
fi

if [ ! -s Souls__DataProtection__Certificate ]; then
    # Self-signed certificate (base64 PFX) that encrypts the Data Protection keys (login cookies) in the database.
    openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=Souls Data Protection" \
        -keyout /dev/stdout -out /dev/stdout 2>/dev/null \
        | openssl pkcs12 -export -passout pass: | openssl base64 -A > Souls__DataProtection__Certificate
    echo "created Souls__DataProtection__Certificate"
fi

# The containers run as non-root users and need to read the files.
chmod 644 postgres-password ConnectionStrings__Souls Souls__Admin__Password Souls__DataProtection__Certificate
