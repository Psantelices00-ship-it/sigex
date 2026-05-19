/**
 * Crea el primer Super Admin en producción (sin usuarios de prueba).
 *
 * Uso:
 *   ADMIN_LOGIN=admin.ap ADMIN_PASSWORD='TuClaveSegura12!' ADMIN_NOMBRE='Pablo Santelices' \
 *     node scripts/crear-admin-produccion.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const LOGIN = String(process.env.ADMIN_LOGIN || '').trim();
const PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const NOMBRE = String(process.env.ADMIN_NOMBRE || 'Administrador SIGEX').trim();
const ROL = 'Super Admin';
const AREA = String(process.env.ADMIN_AREA || 'Administración').trim();

async function main() {
  if (!LOGIN || !PASSWORD) {
    console.error('Definí ADMIN_LOGIN y ADMIN_PASSWORD en el entorno.');
    console.error('Ejemplo:');
    console.error(
      "  ADMIN_LOGIN=admin.ap ADMIN_PASSWORD='MiClave2026!' ADMIN_NOMBRE='Nombre Apellido' node scripts/crear-admin-produccion.js"
    );
    process.exit(1);
  }
  if (PASSWORD.length < 10) {
    console.error('ADMIN_PASSWORD debe tener al menos 10 caracteres.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(PASSWORD, 10);
  const result = await db.query(
    `INSERT INTO usuarios (login, password_hash, nombre, rol, area, activo)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (login) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       nombre = EXCLUDED.nombre,
       rol = EXCLUDED.rol,
       area = EXCLUDED.area,
       activo = true
     RETURNING login, nombre, rol`,
    [LOGIN, hash, NOMBRE, ROL, AREA]
  );

  const u = result.rows[0];
  console.log('Super Admin listo:');
  console.log('  Login:', u.login);
  console.log('  Nombre:', u.nombre);
  console.log('  Rol:', u.rol);
  console.log('Ingresá en https://sigex.cl/login con esas credenciales.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
