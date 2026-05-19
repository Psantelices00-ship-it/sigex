# SIGEX API — backend Express

Repo del **servidor** (JSON en `/`, rutas `/api/...`). El proyecto Compose se llama **`sigex-api`**; el contenedor de Postgres es **`sigex-api-postgres`** (ya no se usa el nombre viejo `sigex-db`, para no mezclar con contenedores manuales viejos).

## Base de datos con Docker

En esta carpeta (`sigex`):

```bash
# Si todavía existe el contenedor antiguo con otro nombre:
docker rm -f sigex-db 2>/dev/null || true

docker compose up -d
```

Esperá a que Postgres esté healthy (`docker compose ps`). Cargá esquema y usuarios de prueba:

```bash
cp .env.example .env
# Editá .env y poné un JWT_SECRET real.
npm run db:init
```

- **`db:init`** ejecuta `src/models/schema.sql` dentro de **`sigex-api-postgres`**.
- Puerto en tu Mac: **5433** (igual que el default en `src/db.js`).

Apagar sin borrar datos:

```bash
docker compose stop
```

Borrar contenedor y volumen (base vacía la próxima vez):

```bash
docker compose down -v
```

Scripts npm: `npm run docker:up` / `npm run docker:down` (equivalente a `docker compose up -d` / `down`).

Usuario extra para pruebas (requiere DB arriba y `.env` con JWT y conexión OK):

```bash
npm run user:dev
```

Crea o actualiza **`ingreso_local`** / **`SigexLocal2026`** (Super Admin).

## Arranque del API

1. Postgres en marcha (Docker arriba) o `DATABASE_URL` en `.env`.
2. `cp .env.example .env` y definí `JWT_SECRET`.
3. `npm run dev` → deberías ver `PostgreSQL conectado` y http://127.0.0.1:3001/ con `estado: activo`.

## Frontends

- **`sigex-app`**: front nuevo (Next 16).
- **`sigex-frontend`**: front anterior (`pages/`).

Ambos usan el mismo API; en `.env.local` del front: `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001` si hace falta.

## Postgres.app (sin Docker)

En `.env`: `PGPORT=5432`, usuario de Mac, y una base con el esquema aplicado (`schema.sql`).

En **Railway** (u otro PaaS que exija SSL con Postgres), agregá en las variables del servicio: **`DATABASE_SSL=true`**. Sin eso, el API conecta sin SSL y suele funcionar en local; en remoto depende del proveedor.
