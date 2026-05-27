# Desplegar backend a Railway (un solo comando)

Desde tu Mac (terminal normal, no sandbox):

```bash
cd /Users/pablosantelices/sigex
./scripts/deploy-produccion.sh
```

Eso ejecuta migraciones con `DATABASE_URL` de `.env` y luego `railway up --detach`.

**Requisitos en `.env`:**

```env
DATABASE_URL=postgresql://...   # copiar de Railway → PostgreSQL
DATABASE_SSL=true
```

Al desplegar, Railway también corre `releaseCommand` (`node scripts/run-all-migrations.js`) antes de arrancar el servicio.

## Verificar API en producción

Sin token deberías ver **401** (ruta existe), no **404** HTML:

```bash
BASE="https://sigex-backend-production.up.railway.app"
for p in solicitudes correspondencia remuneraciones honorarios cheques caja-chica compras contratos; do
  echo -n "/api/$p "; curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/$p"
done
```

## Frontend (Vercel)

Ya se hizo push de `sigex-frontend` a GitHub. En Vercel → Environment Variables (Production):

| Variable | Valor |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | `https://sigex-backend-production.up.railway.app` |
| `SIGEX_REMUNERACIONES_DEV_STUB` | `0` |

Redeploy Vercel después del deploy del backend.
