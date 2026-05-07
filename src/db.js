const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  user: 'postgres',
  password: 'postgres',
  database: 'sigex',
  ssl: false
});

pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL conectado en puerto 5433');
    client.release();
  })
  .catch(err => console.error('❌ Error PostgreSQL:', err.message));

module.exports = pool;
