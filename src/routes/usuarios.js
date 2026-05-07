const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT id, login, nombre, rol, area, activo, ultimo_acceso, created_at FROM usuarios WHERE activo=true ORDER BY nombre');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    const { login, password, nombre, rol, area } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO usuarios (login, password_hash, nombre, rol, area) VALUES ($1,$2,$3,$4,$5) RETURNING id, login, nombre, rol, area',
      [login, hash, nombre, rol, area]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    // Eliminar físicamente
    const result = await db.query('DELETE FROM usuarios WHERE id=$1 AND login != \'admin\' RETURNING login', [req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'No se puede eliminar este usuario' });
    res.json({ ok: true, eliminado: result.rows[0].login });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
