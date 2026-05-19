const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const SENTIDOS = new Set(['RECIBIDO', 'ENVIADO']);
const TIPOS = new Set(['MEMO', 'OFICIO', 'REX', 'OTRO']);

function normTipo(t) {
  const u = String(t || 'OTRO').toUpperCase().trim();
  return TIPOS.has(u) ? u : 'OTRO';
}

function normSentido(s) {
  const u = String(s || '').toUpperCase().trim();
  return SENTIDOS.has(u) ? u : null;
}

function nombreArchivoDescarga(row) {
  let n = (row.archivo_nombre && String(row.archivo_nombre).trim()) || 'documento';
  const mime = (row.mime_type || '').toLowerCase();
  const isPdf = mime.includes('pdf') || (row.formato || '').toUpperCase() === 'PDF';
  if (isPdf && !/\.pdf$/i.test(n)) n = `${n.replace(/\.+$/i, '')}.pdf`;
  return n.slice(0, 200);
}

async function subirArchivo(file, correspondenciaId) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  const baseName = file.originalname
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 50);
  const fname = `${Date.now()}-${baseName}.${ext}`;
  const uploaded = await uploadToCloudinary(file.buffer, fname, `correspondencia/${correspondenciaId}`, {
    mimetype: file.mimetype,
    originalname: file.originalname,
  });
  const formato =
    ext === 'pdf'
      ? 'PDF'
      : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
        ? ext.toUpperCase()
        : 'Otro';
  return {
    archivo_nombre: file.originalname,
    file_path: uploaded.secure_url,
    file_size: file.size,
    mime_type: file.mimetype,
    formato,
  };
}

router.get('/', auth, async (req, res) => {
  try {
    const { sentido, q, tipo, desde, hasta } = req.query;
    let query = 'SELECT * FROM correspondencia WHERE 1=1';
    const params = [];
    let i = 1;
    const s = normSentido(sentido);
    if (s) {
      query += ` AND sentido = $${i++}`;
      params.push(s);
    }
    if (tipo) {
      query += ` AND tipo_documento = $${i++}`;
      params.push(normTipo(tipo));
    }
    if (desde) {
      query += ` AND fecha >= $${i++}`;
      params.push(String(desde).slice(0, 10));
    }
    if (hasta) {
      query += ` AND fecha <= $${i++}`;
      params.push(String(hasta).slice(0, 10));
    }
    if (q) {
      const p = `%${q}%`;
      query += ` AND (
        contraparte ILIKE $${i} OR numero_documento ILIKE $${i}
        OR tenor ILIKE $${i} OR COALESCE(observacion,'') ILIKE $${i}
        OR COALESCE(archivo_nombre,'') ILIKE $${i}
      )`;
      params.push(p);
      i++;
    }
    query += ' ORDER BY fecha DESC, created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/archivo', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM correspondencia WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = result.rows[0];
    if (!row.file_path) return res.status(404).json({ error: 'Sin archivo digital' });
    const fname = nombreArchivoDescarga(row);
    let mime = row.mime_type && String(row.mime_type).trim();
    if (!mime || mime.includes('octet-stream')) {
      mime = fname.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mime || 'application/octet-stream';
    }
    await streamRemoteFileToResponse(row.file_path, res, { mimeType: mime, filename: fname });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM correspondencia WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, upload.single('archivo'), async (req, res) => {
  try {
    const sentido = normSentido(req.body.sentido);
    const fecha = String(req.body.fecha || '').slice(0, 10);
    const contraparte = String(req.body.contraparte || '').trim();
    const numero_documento = String(req.body.numero_documento || '').trim();
    const tipo_documento = normTipo(req.body.tipo_documento);
    const tenor = String(req.body.tenor || '').trim();
    const observacion = String(req.body.observacion || '').trim() || null;

    if (!sentido) return res.status(400).json({ error: 'Indique si es recibido o enviado' });
    if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
    if (!contraparte) return res.status(400).json({ error: 'Indique remitente o destinatario' });
    if (!numero_documento) return res.status(400).json({ error: 'Falta el número de documento' });
    if (!tenor) return res.status(400).json({ error: 'Falta el tenor del documento' });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar el documento digital (PDF u otro)' });

    const ins = await db.query(
      `INSERT INTO correspondencia (
        sentido, fecha, contraparte, numero_documento, tipo_documento, tenor, observacion, registrado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        sentido,
        fecha,
        contraparte,
        numero_documento,
        tipo_documento,
        tenor,
        observacion,
        req.user?.nombre || req.user?.login || null,
      ]
    );
    const row = ins.rows[0];
    const arch = await subirArchivo(req.file, row.id);
    const upd = await db.query(
      `UPDATE correspondencia SET
        archivo_nombre = $1, file_path = $2, file_size = $3, mime_type = $4, formato = $5, updated_at = NOW()
      WHERE id = $6 RETURNING *`,
      [arch.archivo_nombre, arch.file_path, arch.file_size, arch.mime_type, arch.formato, row.id]
    );
    res.status(201).json(upd.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, upload.single('archivo'), async (req, res) => {
  try {
    const prev = await db.query('SELECT * FROM correspondencia WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sentido = normSentido(req.body.sentido) || prev.rows[0].sentido;
    const fecha = String(req.body.fecha || prev.rows[0].fecha).slice(0, 10);
    const contraparte = String(req.body.contraparte ?? prev.rows[0].contraparte).trim();
    const numero_documento = String(req.body.numero_documento ?? prev.rows[0].numero_documento).trim();
    const tipo_documento = normTipo(req.body.tipo_documento ?? prev.rows[0].tipo_documento);
    const tenor = String(req.body.tenor ?? prev.rows[0].tenor).trim();
    const observacion =
      req.body.observacion !== undefined
        ? String(req.body.observacion || '').trim() || null
        : prev.rows[0].observacion;

    if (!contraparte || !numero_documento || !tenor) {
      return res.status(400).json({ error: 'Contraparte, número y tenor son obligatorios' });
    }

    let archivo_nombre = prev.rows[0].archivo_nombre;
    let file_path = prev.rows[0].file_path;
    let file_size = prev.rows[0].file_size;
    let mime_type = prev.rows[0].mime_type;
    let formato = prev.rows[0].formato;

    if (req.file) {
      const arch = await subirArchivo(req.file, req.params.id);
      archivo_nombre = arch.archivo_nombre;
      file_path = arch.file_path;
      file_size = arch.file_size;
      mime_type = arch.mime_type;
      formato = arch.formato;
    }

    const upd = await db.query(
      `UPDATE correspondencia SET
        sentido = $1, fecha = $2, contraparte = $3, numero_documento = $4,
        tipo_documento = $5, tenor = $6, observacion = $7,
        archivo_nombre = $8, file_path = $9, file_size = $10, mime_type = $11, formato = $12,
        updated_at = NOW()
      WHERE id = $13 RETURNING *`,
      [
        sentido,
        fecha,
        contraparte,
        numero_documento,
        tipo_documento,
        tenor,
        observacion,
        archivo_nombre,
        file_path,
        file_size,
        mime_type,
        formato,
        req.params.id,
      ]
    );
    res.json(upd.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM correspondencia WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
