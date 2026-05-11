const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('../cloudinary');
const streamifier = require('streamifier');

// Usar memoria en vez de disco
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function uploadToCloudinary(buffer, filename, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder: `sigex/${folder}`,
        resource_type: 'raw',
        public_id: filename,
        use_filename: true,
        unique_filename: false,
        access_mode: 'public'
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// Subir documento a expediente
router.post('/:expId', auth, upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, tipo, version, observacion } = req.body;
    let file_path = null;
    let file_size = null;
    let mime_type = null;

    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.]/g,'_')}`;
      const result = await uploadToCloudinary(req.file.buffer, filename, `expedientes/${req.params.expId}`);
      file_path = result.secure_url;
      file_size = req.file.size;
      mime_type = req.file.mimetype;
    }

    const result = await db.query(
      `INSERT INTO documentos (expediente_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.expId, nombre, tipo, req.body.formato||'PDF', version||1, observacion, file_path, file_size, mime_type, req.user.login]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.expId, req.user.login, 'Documento cargado', `"${nombre}" (${tipo})`, 'documento']
    );
    res.status(201).json(result.rows[0]);
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
