const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/solicitudes', require('./routes/solicitudes'));
app.use('/api/expedientes', require('./routes/expedientes'));
app.use('/api/documentos',  require('./routes/documentos'));
app.use('/api/usuarios',    require('./routes/usuarios'));
app.use('/api/contratos',   require('./routes/contratos'));
app.use('/api/compras',     require('./routes/compras'));
app.use('/api/correspondencia', require('./routes/correspondencia'));
app.use('/api/remuneraciones', require('./routes/remuneraciones'));
app.use('/api/honorarios',  require('./routes/honorarios'));
app.use('/api/cheques',     require('./routes/cheques'));
app.use('/api/caja-chica',  require('./routes/caja-chica'));
app.use('/api/archivo-fisico', require('./routes/archivo-fisico'));
app.use('/api/presupuesto',    require('./routes/presupuesto'));

app.get('/', (req, res) =>
  res.json({
    sistema: 'SIGEX',
    version: '1.1.0',
    build: '2026-05-26-cheques',
    estado: 'activo',
    modulos: [
      'auth',
      'solicitudes',
      'expedientes',
      'compras',
      'documentos',
      'usuarios',
      'contratos',
      'correspondencia',
      'remuneraciones',
      'honorarios',
      'cheques',
      'caja-chica',
      'archivo-fisico',
      'presupuesto',
    ],
  })
);

const PORT = process.env.PORT || 3001;
// Railway (y otros PaaS) enrutan el health check a la interfaz IPv4; escuchar solo en localhost falla la revisión de salud.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SIGEX v1.1.0 (cheques+caja-chica) en puerto ${PORT}`);
});
