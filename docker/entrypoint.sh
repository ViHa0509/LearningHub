#!/bin/sh
# Apply the migrations, then serve the API and the built app on $PORT (Render) or 8080.
set -e
alembic upgrade head
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips "${LH_FORWARDED_ALLOW_IPS:-127.0.0.1}"
