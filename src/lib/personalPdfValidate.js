/** Validación de PDF para carpeta funcionaria. */

function personalDocMaxBytes() {
  const raw = process.env.PERSONAL_DOC_MAX_MB || '25';
  const mb = parseFloat(String(raw).trim());
  if (!Number.isFinite(mb) || mb <= 0) return 25 * 1024 * 1024;
  return Math.min(100, mb) * 1024 * 1024;
}

/**
 * @param {Buffer} buffer
 * @param {string} originalname
 * @param {string} [mimetype]
 * @returns {string|null} mensaje de error o null si OK
 */
function validatePersonalPdf(buffer, originalname, mimetype) {
  const max = personalDocMaxBytes();
  if (!buffer || !buffer.length) return 'El archivo está vacío';
  if (buffer.length > max) {
    return `El archivo supera el máximo de ${Math.round(max / (1024 * 1024))} MB`;
  }
  const name = String(originalname || '').trim();
  if (!/\.pdf$/i.test(name)) return 'Solo se aceptan archivos con extensión .pdf';
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim();
  if (mime && mime !== 'application/pdf') return 'Solo se aceptan archivos PDF (application/pdf)';
  const head = buffer.slice(0, Math.min(buffer.length, 8)).toString('latin1');
  if (!head.startsWith('%PDF-')) return 'El archivo no tiene formato PDF válido';
  return null;
}

module.exports = { validatePersonalPdf, personalDocMaxBytes };
