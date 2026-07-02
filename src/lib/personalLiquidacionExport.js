const axios = require('axios');
const { PDFDocument } = require('pdf-lib');

async function fetchPdfBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });
  const buf = Buffer.from(res.data);
  if (buf.length < 5 || buf[0] !== 0x25) {
    throw new Error('El archivo remoto no es un PDF válido');
  }
  return buf;
}

/**
 * Arma un PDF con las páginas indicadas de uno o más archivos mensuales.
 * @param {Array<{ file_path: string, pagina: number, etiqueta?: string }>} items ordenados cronológicamente
 */
async function buildLiquidacionesExportPdf(items) {
  if (!items?.length) {
    throw new Error('No hay liquidaciones para exportar en el período indicado');
  }

  const out = await PDFDocument.create();
  const cache = new Map();

  for (const item of items) {
    const url = String(item.file_path || '').trim();
    const pagina = Number(item.pagina);
    if (!url || !Number.isFinite(pagina) || pagina < 1) continue;

    let srcDoc = cache.get(url);
    if (!srcDoc) {
      const buf = await fetchPdfBuffer(url);
      srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      cache.set(url, srcDoc);
    }

    const pageIndex = pagina - 1;
    if (pageIndex >= srcDoc.getPageCount()) {
      throw new Error(`La página ${pagina} no existe en el PDF del período ${item.etiqueta || ''}`.trim());
    }

    const [copied] = await out.copyPages(srcDoc, [pageIndex]);
    out.addPage(copied);
  }

  if (out.getPageCount() === 0) {
    throw new Error('No se pudo armar el PDF de liquidaciones');
  }

  return Buffer.from(await out.save());
}

/**
 * Extrae una sola página de un PDF mensual.
 */
async function extractSinglePagePdf(filePath, pagina) {
  const buf = await fetchPdfBuffer(filePath);
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const pageIndex = Number(pagina) - 1;
  if (pageIndex < 0 || pageIndex >= src.getPageCount()) {
    throw new Error('Página no encontrada en el PDF mensual');
  }
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageIndex]);
  out.addPage(copied);
  return Buffer.from(await out.save());
}

module.exports = {
  buildLiquidacionesExportPdf,
  extractSinglePagePdf,
};
