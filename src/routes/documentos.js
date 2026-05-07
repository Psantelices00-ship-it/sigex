const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads', req.params.expId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// Subir documento
router.post('/:expId', auth, upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, tipo, version, observacion } = req.body;
    const file_path = req.file ? `/uploads/${req.params.expId}/${req.file.filename}` : null;
    const file_size = req.file ? req.file.size : null;
    const mime_type = req.file ? req.file.mimetype : null;
    const result = await db.query(
      `INSERT INTO documentos (expediente_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.expId, nombre, tipo, req.body.formato || 'PDF', version || 1, observacion, file_path, file_size, mime_type, req.user.login]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.expId, req.user.login, 'Documento cargado', `"${nombre}" (${tipo})`, 'documento']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Listar documentos de un expediente
router.get('/:expId', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM documentos WHERE expediente_id = $1 ORDER BY created_at', [req.params.expId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar documento
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await db.query('SELECT * FROM documentos WHERE id = $1', [req.params.id]);
    if (!doc.rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (doc.rows[0].file_path) {
      const fullPath = path.join(__dirname, '../..', doc.rows[0].file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await db.query('DELETE FROM documentos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
