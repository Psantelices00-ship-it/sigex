const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const db = require('../db');
const uploadToCloudinary = require('../cloudinary_upload');
const { validatePersonalPdf } = require('./personalPdfValidate');
const { parseLiquidacionesPdf, etiquetaPeriodo } = require('./personalLiquidacionParse');

const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024;

async function insertRegistrosBatch(periodoId, registros) {
  const ruts = [...new Set(registros.map((r) => r.rut_normalizado).filter(Boolean))];
  const funcMap = new Map();
  if (ruts.length) {
    const fr = await db.query(
      `SELECT id, rut_normalizado FROM personal_funcionarios WHERE rut_normalizado = ANY($1::text[])`,
      [ruts]
    );
    for (const row of fr.rows) funcMap.set(row.rut_normalizado, row.id);
  }

  const CHUNK = 80;
  for (let i = 0; i < registros.length; i += CHUNK) {
    const slice = registros.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const reg of slice) {
      const funcionarioId = funcMap.get(reg.rut_normalizado) || null;
      values.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      params.push(
        periodoId,
        reg.pagina,
        reg.rut_normalizado,
        reg.rut_display,
        reg.apellido_paterno,
        reg.apellido_materno,
        reg.nombres,
        reg.nombre_completo,
        reg.cargo,
        reg.establecimiento,
        funcionarioId
      );
    }
    await db.query(
      `INSERT INTO personal_liquidaciones_registros
        (periodo_id, pagina, rut_normalizado, rut_display, apellido_paterno, apellido_materno,
         nombres, nombre_completo, cargo, establecimiento, funcionario_id)
       VALUES ${values.join(', ')}`,
      params
    );
  }
}

function comprimirPdfParaCloudinary(buffer) {
  const inPath = path.join(os.tmpdir(), `sigex-liq-in-${Date.now()}.pdf`);
  const outPath = path.join(os.tmpdir(), `sigex-liq-out-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(inPath, buffer);
    execSync(
      `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outPath}" "${inPath}"`,
      { stdio: 'pipe' }
    );
    const out = fs.readFileSync(outPath);
    if (out.length > CLOUDINARY_MAX_BYTES) {
      throw new Error(
        `Tras comprimir sigue pesando ${(out.length / (1024 * 1024)).toFixed(2)} MB (máx. 10 MB en Cloudinary)`
      );
    }
    return out;
  } finally {
    try {
      fs.unlinkSync(inPath);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} opts
 * @param {Buffer} opts.buffer PDF a subir (o original si <=10 MB)
 * @param {Buffer} [opts.parseBuffer] PDF para indexar (si difiere del subido)
 * @param {string} opts.originalname
 * @param {string} opts.usuarioLogin
 * @param {number} [opts.mes]
 * @param {number} [opts.anio]
 * @param {string} [opts.establecimiento]
 * @param {boolean} [opts.reemplazar]
 */
async function cargarLiquidacionesPdf({
  buffer,
  parseBuffer: parseBufferIn,
  originalname,
  usuarioLogin,
  mes: mesIn,
  anio: anioIn,
  establecimiento: estIn,
  reemplazar = false,
}) {
  const parseBuffer = parseBufferIn || buffer;
  const pdfErr = validatePersonalPdf(parseBuffer, originalname, 'application/pdf');
  if (pdfErr) throw new Error(pdfErr);

  const parsed = await parseLiquidacionesPdf(parseBuffer);
  if (!parsed.registros.length) {
    throw new Error('No se detectaron liquidaciones en el PDF (formato DEIS).');
  }

  let uploadBuffer = buffer;
  if (uploadBuffer.length > CLOUDINARY_MAX_BYTES) {
    uploadBuffer = comprimirPdfParaCloudinary(buffer);
  }
  const uploadErr = validatePersonalPdf(uploadBuffer, originalname, 'application/pdf');
  if (uploadErr) throw new Error(uploadErr);

  const mes = Number(mesIn) || parsed.mes;
  const anio = Number(anioIn) || parsed.anio;
  if (!mes || !anio) {
    throw new Error('No se pudo detectar mes/año del PDF.');
  }

  const establecimiento = String(estIn || parsed.establecimiento || '').trim() || null;
  const etiqueta = etiquetaPeriodo(mes, anio);

  const dup = await db.query(
    `SELECT id FROM personal_liquidaciones_periodos
     WHERE mes = $1 AND anio = $2 AND COALESCE(establecimiento, '') = COALESCE($3, '')`,
    [mes, anio, establecimiento]
  );

  if (dup.rows.length) {
    if (!reemplazar) {
      const err = new Error(
        `Ya existe carga para ${etiqueta}${establecimiento ? ` (${establecimiento})` : ''}`
      );
      err.code = 'DUPLICATE_PERIODO';
      err.periodo_id = dup.rows[0].id;
      throw err;
    }
    await db.query('DELETE FROM personal_liquidaciones_periodos WHERE id = $1', [dup.rows[0].id]);
  }

  let periodoId = null;
  try {
    const ins = await db.query(
      `INSERT INTO personal_liquidaciones_periodos
        (mes, anio, etiqueta, establecimiento, nombre_archivo, file_path, file_size,
         total_paginas, total_registros, estado, cargado_por)
       VALUES ($1,$2,$3,$4,$5,'', $6, $7, 0, 'procesando', $8)
       RETURNING *`,
      [mes, anio, etiqueta, establecimiento, originalname, buffer.length, parsed.total_paginas, usuarioLogin]
    );
    periodoId = ins.rows[0].id;

    const folder = `personal/liquidaciones/${periodoId}`;
    const fname = `liquidaciones_${anio}_${String(mes).padStart(2, '0')}.pdf`;
    const uploaded = await uploadToCloudinary(uploadBuffer, fname, folder, {
      mimetype: 'application/pdf',
      originalname,
    });

    await db.query(
      `UPDATE personal_liquidaciones_periodos SET file_path = $1, cloudinary_public_id = $2 WHERE id = $3`,
      [uploaded.secure_url, uploaded.public_id, periodoId]
    );

    await insertRegistrosBatch(periodoId, parsed.registros);

    const upd = await db.query(
      `UPDATE personal_liquidaciones_periodos
       SET total_registros = $1, estado = 'completo', error_mensaje = NULL
       WHERE id = $2 RETURNING *`,
      [parsed.registros.length, periodoId]
    );

    return {
      periodo: upd.rows[0],
      total_registros: parsed.registros.length,
      mes,
      anio,
      establecimiento,
    };
  } catch (e) {
    if (periodoId) {
      await db
        .query(
          `UPDATE personal_liquidaciones_periodos SET estado = 'error', error_mensaje = $1 WHERE id = $2`,
          [String(e.message || e).slice(0, 500), periodoId]
        )
        .catch(() => {});
    }
    throw e;
  }
}

function listarPdfsCarpeta(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((n) => !n.startsWith('._') && /\.pdf$/i.test(n))
    .map((n) => path.join(dirPath, n))
    .sort((a, b) => a.localeCompare(b, 'es'));
}

module.exports = {
  cargarLiquidacionesPdf,
  listarPdfsCarpeta,
};
