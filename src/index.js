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
app.use('/api/expedientes', require('./routes/expedientes'));
app.use('/api/documentos',  require('./routes/documentos'));
app.use('/api/usuarios',    require('./routes/usuarios'));
app.use('/api/contratos',   require('./routes/contratos'));

app.get('/', (req, res) => res.json({ sistema: 'SIGEX', version: '1.0', estado: 'activo' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 SIGEX corriendo en puerto ${PORT}`));
// force Fri May  8 10:21:07 -04 2026
