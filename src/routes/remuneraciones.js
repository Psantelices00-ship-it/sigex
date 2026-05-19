const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function periodoLabel(mes, anio) {
  const m = Number(mes);
  const y = Number(anio);
  const mi = Number.isFinite(m) ? Math.min(Math.max(Math.floor(m), 1), 12) : 1;
  const yi = Number.isFinite(y) ? y : new Date().getFullYear();
  return `${MESES[mi - 1]} ${yi}`;
}

function publicPeriodo(row, docs) {
  return {
    ...row,
    periodo: row.periodo || periodoLabel(row.mes, row.anio),
    documentos: docs || [],
  };
}

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM remuneraciones_documentos d WHERE d.periodo_id = p.id) AS total_docs
       FROM remuneraciones_periodos p
       ORDER BY p.anio DESC, p.mes DESC`
    );
    res.json(result.rows.map((r) => publicPeriodo(r)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM remuneraciones_documentos WHERE id=$1 AND periodo_id=$2',
      [req.params.docId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const doc = row.rows[0];
    if (!doc.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(doc.file_path, res, { mimeType: doc.mime_type, filename: doc.nombre });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const p = await db.query('SELECT * FROM remuneraciones_periodos WHERE id=$1', [req.params.id]);
    if (!p.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query(
      'SELECT * FROM remuneraciones_documentos WHERE periodo_id=$1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(publicPeriodo(p.rows[0], docs.rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const mes = Number(req.body.mes);
    const anio = Number(req.body.anio);
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Mes inválido (1-12)' });
    }
    if (!Number.isFinite(anio) || anio < 2000) {
      return res.status(400).json({ error: 'Año inválido' });
    }
    const dup = await db.query('SELECT id FROM remuneraciones_periodos WHERE mes=$1 AND anio=$2', [mes, anio]);
    if (dup.rows.length) return res.status(400).json({ error: `Ya existe el período ${periodoLabel(mes, anio)}` });
    const label = periodoLabel(mes, anio);
    const result = await db.query(
      `INSERT INTO remuneraciones_periodos (mes, anio, periodo, descripcion, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [mes, anio, label, req.body.descripcion || null, req.user.login]
    );
    res.status(201).json(publicPeriodo(result.rows[0], []));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updatePeriodo(req, res) {
  try {
    const prev = await db.query('SELECT * FROM remuneraciones_periodos WHERE id=$1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const { descripcion, estado, monto_total } = req.body;
    const updates = [];
    const params = [];
    let i = 1;
    if (descripcion !== undefined) {
      updates.push(`descripcion = $${i++}`);
      params.push(descripcion);
    }
    if (estado !== undefined) {
      updates.push(`estado = $${i++}`);
      params.push(estado);
    }
    if (monto_total !== undefined) {
      updates.push(`monto_total = $${i++}`);
      params.push(Number(monto_total) || 0);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const q = `UPDATE remuneraciones_periodos SET ${updates.join(', ')} WHERE id=$${params.length} RETURNING *`;
    const result = await db.query(q, params);
    const docs = await db.query('SELECT * FROM remuneraciones_documentos WHERE periodo_id=$1', [req.params.id]);
    res.json(publicPeriodo(result.rows[0], docs.rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.put('/:id', auth, updatePeriodo);
router.patch('/:id', auth, updatePeriodo);

router.patch('/:id/archivo', auth, async (req, res) => {
  try {
    const { caja, estante, posicion, sala, fecha_archivo, obs_archivo } = req.body;
    const result = await db.query(
      `UPDATE remuneraciones_periodos SET
        caja=$1, estante=$2, posicion=$3, sala=$4, fecha_archivo=$5, obs_archivo=$6,
        archivado_por=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [caja, estante, posicion || null, sala || null, fecha_archivo || null, obs_archivo || null, req.user.login, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query('SELECT * FROM remuneraciones_documentos WHERE periodo_id=$1', [req.params.id]);
    res.json(publicPeriodo(result.rows[0], docs.rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const p = await db.query('SELECT id FROM remuneraciones_periodos WHERE id=$1', [req.params.id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo' });
    const { nombre, tipo, version, observacion } = req.body;
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const fname = `${Date.now()}-${baseName}.${ext}`;
    const uploaded = await uploadToCloudinary(req.file.buffer, fname, `remuneraciones/${req.params.id}`, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    const result = await db.query(
      `INSERT INTO remuneraciones_documentos (periodo_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.params.id,
        nombre || req.file.originalname,
        tipo || 'Otro',
        req.body.formato || 'PDF',
        version || 1,
        observacion || null,
        uploaded.secure_url,
        req.file.size,
        req.file.mimetype,
        req.user.login,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query(
      'DELETE FROM remuneraciones_documentos WHERE id=$1 AND periodo_id=$2 RETURNING id',
      [req.params.docId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    await db.query('DELETE FROM remuneraciones_periodos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
