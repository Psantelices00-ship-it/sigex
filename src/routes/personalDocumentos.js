const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { validatePersonalPdf, personalDocMaxBytes } = require('../lib/personalPdfValidate');
const {
  isTipoDocumentalValido,
  tipoDocumentalLabel,
  cloudinaryFolder,
  cloudinaryFilename,
  calcularEstadoDocumento,
} = require('../lib/personalDocTypes');
const { requireAccesoPersonal, requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: personalDocMaxBytes() },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.pdf')) return cb(null, true);
    cb(new Error('Solo se aceptan archivos PDF (.pdf)'));
  },
});

function parseDateInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

async function loadFuncionario(funcionarioId) {
  const r = await db.query('SELECT * FROM personal_funcionarios WHERE id = $1', [funcionarioId]);
  return r.rows[0] || null;
}

router.get('/funcionarios/:funcionarioId/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const row = await db.query(
      `SELECT d.* FROM personal_documentos d
       JOIN personal_funcionarios f ON f.id = d.funcionario_id
       WHERE d.id = $1 AND d.funcionario_id = $2`,
      [req.params.docId, req.params.funcionarioId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Documento no encontrado' });
    const doc = row.rows[0];
    if (!doc.file_path) return res.status(404).json({ error: 'Sin archivo' });

    await registrarAuditoriaPersonal(req, {
      accion: req.query.download === '1' ? 'documento_descargar' : 'documento_ver',
      entidad: 'personal_documentos',
      entidad_id: doc.id,
      funcionario_id: req.params.funcionarioId,
      documento_id: doc.id,
      detalle_json: { tipo_documental: doc.tipo_documental, nombre: doc.nombre_archivo },
    });

    await streamRemoteFileToResponse(doc.file_path, res, {
      mimeType: doc.mime_type || 'application/pdf',
      filename: doc.nombre_archivo,
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/funcionarios/:funcionarioId/documentos/historial/:tipoDocumental', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const tipo = String(req.params.tipoDocumental || '').trim();
    if (!isTipoDocumentalValido(tipo)) return res.status(400).json({ error: 'Tipo documental inválido' });
    const rows = await db.query(
      `SELECT * FROM personal_documentos
       WHERE funcionario_id = $1 AND tipo_documental = $2
       ORDER BY version_num DESC, created_at DESC`,
      [req.params.funcionarioId, tipo]
    );
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/funcionarios/:funcionarioId/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const funcionario = await loadFuncionario(req.params.funcionarioId);
    if (!funcionario) return res.status(404).json({ error: 'Funcionario no encontrado' });

    const tipo = String(req.body?.tipo_documental || '').trim();
    if (!isTipoDocumentalValido(tipo)) {
      return res.status(400).json({ error: 'Tipo documental inválido' });
    }
    if (!req.file?.buffer) return res.status(400).json({ error: 'Debe adjuntar un archivo PDF' });

    const pdfErr = validatePersonalPdf(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (pdfErr) return res.status(400).json({ error: pdfErr });

    const fechaVenc = parseDateInput(req.body?.fecha_vencimiento);
    const fechaCarga = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const folder = cloudinaryFolder(funcionario.tipo_funcionario, funcionario.rut_normalizado, tipo);
    const fname = cloudinaryFilename(funcionario.rut_normalizado, tipo, fechaCarga);

    const uploaded = await uploadToCloudinary(req.file.buffer, fname, folder, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    const prev = await db.query(
      `SELECT id, version_num FROM personal_documentos
       WHERE funcionario_id = $1 AND tipo_documental = $2 AND es_activo = TRUE`,
      [funcionario.id, tipo]
    );

    if (prev.rows.length) {
      await db.query(
        `UPDATE personal_documentos SET es_activo = FALSE WHERE id = $1`,
        [prev.rows[0].id]
      );
    }

    const verRow = await db.query(
      `SELECT COALESCE(MAX(version_num), 0)::int AS mx FROM personal_documentos
       WHERE funcionario_id = $1 AND tipo_documental = $2`,
      [funcionario.id, tipo]
    );
    const versionNum = (verRow.rows[0]?.mx || 0) + 1;
    const estado = fechaVenc ? calcularEstadoDocumento(fechaVenc) : 'vigente';

    const result = await db.query(
      `INSERT INTO personal_documentos
        (funcionario_id, tipo_documental, version_num, es_activo, nombre_archivo, file_path, file_size,
         mime_type, cloudinary_public_id, fecha_vencimiento, estado, cargado_por)
       VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        funcionario.id,
        tipo,
        versionNum,
        fname,
        uploaded.secure_url,
        req.file.size,
        'application/pdf',
        uploaded.public_id || null,
        fechaVenc,
        estado,
        req.user.login,
      ]
    );

    const accion = prev.rows.length ? 'documento_reemplazar' : 'documento_cargar';
    await registrarAuditoriaPersonal(req, {
      accion,
      entidad: 'personal_documentos',
      entidad_id: result.rows[0].id,
      funcionario_id: funcionario.id,
      documento_id: result.rows[0].id,
      detalle_json: {
        tipo_documental: tipo,
        tipo_label: tipoDocumentalLabel(tipo),
        version: versionNum,
        reemplazo_de: prev.rows[0]?.id || null,
      },
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/funcionarios/:funcionarioId/documentos/:docId', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const row = await db.query(
      `SELECT * FROM personal_documentos WHERE id = $1 AND funcionario_id = $2 AND es_activo = TRUE`,
      [req.params.docId, req.params.funcionarioId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Documento activo no encontrado' });

    await db.query(`UPDATE personal_documentos SET es_activo = FALSE, estado = 'pendiente' WHERE id = $1`, [
      req.params.docId,
    ]);

    await registrarAuditoriaPersonal(req, {
      accion: 'documento_eliminar',
      entidad: 'personal_documentos',
      entidad_id: req.params.docId,
      funcionario_id: req.params.funcionarioId,
      documento_id: req.params.docId,
      detalle_json: { tipo_documental: row.rows[0].tipo_documental },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
