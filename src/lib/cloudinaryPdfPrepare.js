const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

/** Límite plan gratuito Cloudinary (bytes). */
const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024;

function esPdf(buffer, fileMeta = {}) {
  const m = String(fileMeta.mimetype || '').toLowerCase();
  if (m.includes('pdf')) return true;
  if (/\.pdf$/i.test(String(fileMeta.originalname || ''))) return true;
  return buffer?.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

function ghostscriptDisponible() {
  try {
    execSync('gs --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function comprimirPdfBuffer(buffer, profile = '/ebook') {
  const inPath = path.join(os.tmpdir(), `sigex-pdf-in-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const outPath = path.join(os.tmpdir(), `sigex-pdf-out-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    fs.writeFileSync(inPath, buffer);
    execSync(
      `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${profile} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outPath}" "${inPath}"`,
      { stdio: 'pipe' }
    );
    return fs.readFileSync(outPath);
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
 * Comprime PDFs que superan el límite de Cloudinary antes de subirlos.
 * @param {Buffer} buffer
 * @param {{ mimetype?: string, originalname?: string }} [fileMeta]
 * @returns {Promise<Buffer>}
 */
async function prepararBufferParaCloudinary(buffer, fileMeta = {}) {
  if (!buffer?.length || !esPdf(buffer, fileMeta)) return buffer;
  if (buffer.length <= CLOUDINARY_MAX_BYTES) return buffer;

  const mb = (buffer.length / (1024 * 1024)).toFixed(2);
  if (!ghostscriptDisponible()) {
    throw new Error(
      `El PDF pesa ${mb} MB y Cloudinary acepta máximo 10 MB. El servidor no tiene Ghostscript para comprimirlo automáticamente.`
    );
  }

  let compressed = comprimirPdfBuffer(buffer, '/ebook');
  if (compressed.length <= CLOUDINARY_MAX_BYTES) return compressed;

  compressed = comprimirPdfBuffer(buffer, '/screen');
  if (compressed.length <= CLOUDINARY_MAX_BYTES) return compressed;

  const mbFinal = (compressed.length / (1024 * 1024)).toFixed(2);
  throw new Error(
    `Tras comprimir el PDF sigue pesando ${mbFinal} MB (máx. 10 MB en Cloudinary). Subilo manualmente desde «Subir documento» o reducí adjuntos en el consolidado.`
  );
}

module.exports = {
  CLOUDINARY_MAX_BYTES,
  prepararBufferParaCloudinary,
  comprimirPdfBuffer,
  esPdf,
};
