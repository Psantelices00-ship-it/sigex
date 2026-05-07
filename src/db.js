const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  host: process.env.NODE_ENV !== 'production' ? '127.0.0.1' : undefined,
  port: process.env.NODE_ENV !== 'production' ? 5433 : undefined,
  user: process.env.NODE_ENV !== 'production' ? 'postgres' : undefined,
  password: process.env.NODE_ENV !== 'production' ? 'postgres' : undefined,
  database: process.env.NODE_ENV !== 'production' ? 'sigex' : undefined,
});

pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL conectado');
    client.release();
  })
  .catch(err => console.error('❌ Error PostgreSQL:', err.message));

module.exports = pool;
