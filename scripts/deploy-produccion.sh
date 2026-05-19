#!/usr/bin/env bash
# Despliegue SIGEX backend → Railway + migraciones
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3 Migraciones (DATABASE_URL en .env con DATABASE_SSL=true)"
if [[ -f .env ]] && grep -q DATABASE_URL .env; then
  export $(grep -E '^DATABASE_(URL|SSL)=' .env | xargs) || true
fi
if [[ "${DATABASE_URL:-}" == *railway* ]]; then
  export DATABASE_SSL=true
fi
node scripts/run-all-migrations.js

echo "==> 2/3 Deploy Railway (servicio sigex-backend)"
railway up --detach

echo "==> 3/3 Listo. Probar: curl https://sigex-backend-production.up.railway.app/"
echo "    Endpoints (requieren token): /api/solicitudes /api/correspondencia /api/remuneraciones …"
