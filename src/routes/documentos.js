const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { suggestEstadoFromDocumentos } = require('../lib/expedienteWorkflow');
const multer = require('multer');
const cloudinary = require('../cloudinary');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Ver archivo (ruta fija antes de /:expId para no confundir "ver" con un expediente)
router.get('/ver/:id', async (req, res) => {
  try {
    const doc = await db.query('SELECT * FROM documentos WHERE id = $1', [req.params.id]);
    if (!doc.rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (!doc.rows[0].file_path) return res.status(404).json({ error: 'Sin archivo' });
    res.redirect(doc.rows[0].file_path);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ver archivo con JWT (proxy Cloudinary; mismo motivo que contratos)
router.get('/:expId/:docId/archivo', auth, async (req, res) => {
  try {
    const doc = await db.query(
      'SELECT * FROM documentos WHERE id = $1 AND expediente_id = $2',
      [req.params.docId, req.params.expId]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = doc.rows[0];
    if (!row.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(row.file_path, res, { mimeType: row.mime_type, filename: row.nombre });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

// Subir documento a expediente
router.post('/:expId', auth, upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, tipo, version, observacion } = req.body;
    let file_path = null;
    let file_size = null;
    let mime_type = null;

    if (req.file) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `${Date.now()}-${baseName}.${ext}`;
      const result = await uploadToCloudinary(req.file.buffer, filename, `expedientes/${req.params.expId}`, {
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });
      file_path = result.secure_url;
      file_size = req.file.size;
      mime_type = req.file.mimetype;
    }

    const expRow = await db.query('SELECT id, estado FROM expedientes WHERE id = $1', [req.params.expId]);
    if (!expRow.rows.length) return res.status(404).json({ error: 'Expediente no encontrado' });
    const estadoPrev = expRow.rows[0].estado;

    const result = await db.query(
      `INSERT INTO documentos (expediente_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.expId, nombre, tipo, req.body.formato || 'PDF', version || 1, observacion, file_path, file_size, mime_type, req.user.login]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.expId, req.user.login, 'Documento cargado', `"${nombre}" (${tipo})`, 'documento']
    );

    const allTipos = await db.query('SELECT tipo FROM documentos WHERE expediente_id = $1', [req.params.expId]);
    const nuevoEstado = suggestEstadoFromDocumentos(allTipos.rows, estadoPrev);
    if (nuevoEstado && nuevoEstado !== estadoPrev) {
      await db.query('UPDATE expedientes SET estado = $1, updated_at = NOW() WHERE id = $2', [nuevoEstado, req.params.expId]);
      await db.query(
        'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
        [
          req.params.expId,
          req.user.login,
          'Estado actualizado (automático)',
          `${estadoPrev} → ${nuevoEstado} · al cargar: ${tipo}`,
          'estado',
        ]
      );
    }

    res.status(201).json({
      ...result.rows[0],
      expediente_estado: nuevoEstado || estadoPrev,
      estado_auto: Boolean(nuevoEstado && nuevoEstado !== estadoPrev),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Listar documentos
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
    if (doc.rows[0].file_path && doc.rows[0].file_path.includes('cloudinary')) {
      const publicId = doc.rows[0].file_path.split('/').slice(-1)[0].split('.')[0];
      await cloudinary.uploader.destroy(`sigex/expedientes/${publicId}`).catch(() => {});
    }
    await db.query('DELETE FROM documentos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
