# Producción — empezar limpio (Opción A)

Borra **todos** los datos de prueba en Railway y deja solo un administrador real que vos definís.

## Qué se borra / qué no

| Se elimina | No se toca |
|------------|------------|
| Expedientes, solicitudes, contratos | Estructura de tablas (esquema) |
| Documentos en Postgres (referencias) | Código en Vercel/Railway |
| Usuarios (`admin`, `ingreso_local`, etc.) | Dominio sigex.cl |
| Correspondencia de prueba | |

Los **archivos en Cloudinary** hay que borrarlos aparte (panel Cloudinary → carpeta `sigex`).

---

## Paso 1 — URL de la base en Railway

1. [railway.app](https://railway.app) → proyecto → servicio **PostgreSQL**.
2. Copiá **`DATABASE_URL`** (postgresql://…).

En tu Mac, en la carpeta `sigex`, editá `.env` (solo para este proceso, no subas este archivo a Git):

```env
DATABASE_URL=postgresql://...   # pegar la de Railway
DATABASE_SSL=true
```

---

## Paso 2 — Vaciar la base

```bash
cd /Users/pablosantelices/sigex
CONFIRM_PRODUCCION_RESET=yes npm run db:produccion:reset
```

Deberías ver: `Base de datos vacía`.

---

## Paso 3 — Crear tu Super Admin real

Elegí login y contraseña **fuertes** (no uses `ingreso_local` ni `password`):

```bash
ADMIN_LOGIN=admin.ap \
ADMIN_PASSWORD='TuClaveSegura2026!' \
ADMIN_NOMBRE='Pablo Santelices' \
npm run db:produccion:admin
```

---

## Paso 4 — Cloudinary

1. [cloudinary.com](https://cloudinary.com) → **Media Library**.
2. Borrá la carpeta **`sigex`** (o todo el contenido de prueba).

Sin esto, viejos PDF podrían seguir en la nube aunque la base esté vacía.

---

## Paso 5 — Probar sigex.cl

1. Abrí https://sigex.cl/login  
2. Entrá con el **ADMIN_LOGIN** y **ADMIN_PASSWORD** del paso 3.  
3. El dashboard debe mostrar **0** expedientes / sin filas de prueba.  
4. Creá un registro de prueba real y, si todo OK, seguí trabajando en limpio.

---

## Si algo falla

| Error | Solución |
|-------|----------|
| SSL / conexión | `DATABASE_SSL=true` en `.env` |
| `relation "correspondencia" does not exist` | `npm run db:migrate:correspondencia` con la misma `DATABASE_URL` |
| Sigue viendo datos viejos | Cerrá sesión, borrá cookies de sigex.cl, volvé a entrar |

---

## No volver a cargar usuarios de prueba

No ejecutes en producción:

- `npm run db:init` (inserta `admin` / `ingreso_local` del `schema.sql`)
- `npm run user:dev`

Solo `db:produccion:admin` para usuarios nuevos.
