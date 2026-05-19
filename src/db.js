const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL?.trim();

/**
 * Postgres local casi nunca usa SSL; forzar SSL rompe con "does not support SSL connections".
 * En Railway / producción remota: definí DATABASE_SSL=true en el .env.
 */
function resolveSsl(url) {
  if (!url) return false;
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (/railway\.app|rlwy\.net/i.test(url)) return { rejectUnauthorized: false };
  return false;
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: resolveSsl(connectionString),
    })
  : new Pool({
      host: process.env.PGHOST || '127.0.0.1',
      port: parseInt(process.env.PGPORT || '5433', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'sigex',
    });

pool
  .connect()
  .then((client) => {
    console.log('✅ PostgreSQL conectado');
    client.release();
  })
  .catch((err) => console.error('❌ Error PostgreSQL:', err.message));

module.exports = pool;
