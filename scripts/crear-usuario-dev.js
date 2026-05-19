/**
 * Crea o actualiza un usuario solo para desarrollo local.
 * Uso (desde la carpeta sigex): node scripts/crear-usuario-dev.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const LOGIN = 'ingreso_local';
const PASSWORD = 'SigexLocal2026';
const NOMBRE = 'Usuario desarrollo';
const ROL = 'Super Admin';
const AREA = 'Administración';

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.query(
    `INSERT INTO usuarios (login, password_hash, nombre, rol, area, activo)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (login) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       nombre = EXCLUDED.nombre,
       rol = EXCLUDED.rol,
       area = EXCLUDED.area,
       activo = true`,
    [LOGIN, hash, NOMBRE, ROL, AREA]
  );
  console.log('Listo. Ingresá en el front con:');
  console.log('  Usuario:', LOGIN);
  console.log('  Contraseña:', PASSWORD);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
