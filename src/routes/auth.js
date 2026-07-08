const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Login
router.post('/login', async (req, res) => {
  try {
    const login = String(req.body?.login || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');

    if (!login || !password) {
      return res.status(400).json({ error: 'Indicá usuario y contraseña' });
    }

    // trim en DB por si quedaron espacios de altas antiguas
    const result = await db.query(
      `SELECT * FROM usuarios
       WHERE lower(trim(both from login)) = $1
         AND activo = true`,
      [login]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign(
      { id: user.id, login: user.login.trim(), nombre: user.nombre, rol: user.rol, area: user.area },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    await db.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1', [user.id]);
    res.json({
      token,
      usuario: {
        id: user.id,
        login: String(user.login).trim(),
        nombre: user.nombre,
        rol: user.rol,
        area: user.area,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar token
router.get('/me', require('../middleware/auth'), async (req, res) => {
  res.json({ usuario: req.user });
});

module.exports = router;
