const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeLogin(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, login, nombre, rol, area, activo, ultimo_acceso, created_at FROM usuarios WHERE activo=true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });

    const login = normalizeLogin(req.body?.login);
    const password = String(req.body?.password || '');
    const nombre = normalizeText(req.body?.nombre);
    const rol = normalizeText(req.body?.rol);
    const area = normalizeText(req.body?.area) || null;

    if (!login) return res.status(400).json({ error: 'Indicá el login del usuario' });
    if (login.length > 120) return res.status(400).json({ error: 'El login es demasiado largo (máx. 120)' });
    if (!nombre) return res.status(400).json({ error: 'Indicá el nombre del usuario' });
    if (!rol) return res.status(400).json({ error: 'Indicá el rol del usuario' });
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO usuarios (login, password_hash, nombre, rol, area) VALUES ($1,$2,$3,$4,$5) RETURNING id, login, nombre, rol, area',
      [login, hash, nombre, rol, area]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ese login ya está en uso' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    const id = String(req.params.id || '').trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID inválido' });

    const result = await db.query(
      "DELETE FROM usuarios WHERE id=$1 AND login != 'admin' AND login != 'admin.sigex' RETURNING login",
      [id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'No se puede eliminar este usuario' });
    res.json({ ok: true, eliminado: result.rows[0].login });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    const id = String(req.params.id || '').trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID inválido' });

    const login = normalizeLogin(req.body?.login);
    const nombre = normalizeText(req.body?.nombre);
    const rol = normalizeText(req.body?.rol);
    const area = normalizeText(req.body?.area) || null;
    const pw =
      req.body?.password != null && String(req.body.password).trim() !== ''
        ? String(req.body.password)
        : null;

    if (!login) return res.status(400).json({ error: 'Indicá el login del usuario' });
    if (login.length > 120) return res.status(400).json({ error: 'El login es demasiado largo (máx. 120)' });
    if (!nombre) return res.status(400).json({ error: 'Indicá el nombre del usuario' });
    if (!rol) return res.status(400).json({ error: 'Indicá el rol del usuario' });
    if (pw && pw.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });

    if (pw) {
      const hash = await bcrypt.hash(pw, 10);
      const result = await db.query(
        'UPDATE usuarios SET login=$1, nombre=$2, rol=$3, area=$4, password_hash=$5 WHERE id=$6 RETURNING id, login, nombre, rol, area',
        [login, nombre, rol, area, hash, id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
      return res.json(result.rows[0]);
    }

    const result = await db.query(
      'UPDATE usuarios SET login=$1, nombre=$2, rol=$3, area=$4 WHERE id=$5 RETURNING id, login, nombre, rol, area',
      [login, nombre, rol, area, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ese login ya está en uso' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
