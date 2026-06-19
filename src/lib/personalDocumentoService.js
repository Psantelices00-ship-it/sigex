const uploadToCloudinary = require('../cloudinary_upload');
const db = require('../db');
const { validatePersonalPdf } = require('./personalPdfValidate');
const {
  isTipoDocumentalValido,
  permiteMultiplesActivos,
  cloudinaryFolder,
  cloudinaryFilename,
  calcularEstadoDocumento,
  PERSONAL_DOC_TIPOS_IMPORTACION,
} = require('./personalDocTypes');

const TIPO_CONSOLIDADO_IMPORT = PERSONAL_DOC_TIPOS_IMPORTACION[0].key;

/**
 * Guarda un PDF en la carpeta del funcionario.
 * @param {object} opts
 * @param {object} opts.funcionario fila personal_funcionarios
 * @param {string} opts.tipo_documental
 * @param {Buffer} opts.buffer
 * @param {string} opts.originalname
 * @param {string} opts.cargado_por
 * @param {string|null} [opts.fecha_vencimiento]
 * @param {'manual'|'importacion_masiva'} [opts.origen_carga]
 */
async function guardarDocumentoPersonal({
  funcionario,
  tipo_documental,
  buffer,
  originalname,
  cargado_por,
  fecha_vencimiento = null,
  origen_carga = 'manual',
}) {
  if (!isTipoDocumentalValido(tipo_documental)) {
    throw new Error('Tipo documental inválido');
  }
  const pdfErr = validatePersonalPdf(buffer, originalname, 'application/pdf');
  if (pdfErr) throw new Error(pdfErr);

  const fechaCarga = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const folder = cloudinaryFolder(funcionario.tipo_funcionario, funcionario.rut_normalizado, tipo_documental);
  const fname = cloudinaryFilename(funcionario.rut_normalizado, tipo_documental, fechaCarga);

  const uploaded = await uploadToCloudinary(buffer, fname, folder, {
    mimetype: 'application/pdf',
    originalname,
  });

  let reemplazo = false;
  if (!permiteMultiplesActivos(tipo_documental)) {
    const prev = await db.query(
      `SELECT id FROM personal_documentos WHERE funcionario_id = $1 AND tipo_documental = $2 AND es_activo = TRUE`,
      [funcionario.id, tipo_documental]
    );
    if (prev.rows.length) {
      reemplazo = true;
      await db.query(`UPDATE personal_documentos SET es_activo = FALSE WHERE id = $1`, [prev.rows[0].id]);
    }
  }

  const verRow = await db.query(
    `SELECT COALESCE(MAX(version_num), 0)::int AS mx FROM personal_documentos WHERE funcionario_id = $1 AND tipo_documental = $2`,
    [funcionario.id, tipo_documental]
  );
  const versionNum = (verRow.rows[0]?.mx || 0) + 1;
  const estado = fecha_vencimiento ? calcularEstadoDocumento(fecha_vencimiento) : 'vigente';
  const nombreArchivo = String(originalname || fname).trim() || fname;

  const result = await db.query(
    `INSERT INTO personal_documentos
      (funcionario_id, tipo_documental, version_num, es_activo, nombre_archivo, file_path, file_size,
       mime_type, cloudinary_public_id, fecha_vencimiento, estado, cargado_por, origen_carga)
     VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      funcionario.id,
      tipo_documental,
      versionNum,
      nombreArchivo,
      uploaded.secure_url,
      buffer.length,
      'application/pdf',
      uploaded.public_id || null,
      fecha_vencimiento,
      estado,
      cargado_por,
      origen_carga,
    ]
  );

  return {
    documento: result.rows[0],
    reemplazo,
  };
}

/** Importación masiva: todos los PDF van al consolidado antiguo, sin ocupar slots obligatorios. */
async function resolverTipoDocumentalImport() {
  return { tipo: TIPO_CONSOLIDADO_IMPORT };
}

module.exports = {
  guardarDocumentoPersonal,
  resolverTipoDocumentalImport,
  TIPO_CONSOLIDADO_IMPORT,
};
