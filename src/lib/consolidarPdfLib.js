const axios = require('axios');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');

function sortDocsByTipoOrder(rows, mergeOrderTipos) {
  function rank(tipo) {
    const i = mergeOrderTipos.indexOf(tipo);
    if (i >= 0) return i;
    return 800;
  }
  return [...rows]
    .filter((r) => r.file_path && String(r.file_path).trim())
    .sort((a, b) => {
      const rt = rank(a.tipo) - rank(b.tipo);
      if (rt !== 0) return rt;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
}

async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });
  return Buffer.from(res.data);
}

function isPdfBuffer(buf) {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

function imageKind(row) {
  const m = (row.mime_type || '').toLowerCase();
  const f = (row.formato || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg') || f === 'jpg' || f === 'jpeg') return 'jpg';
  if (m.includes('png') || f === 'png') return 'png';
  return null;
}

async function addPlaceholderPage(pdf, row, message) {
  const page = pdf.addPage(PageSizes.A4);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  const lines = [
    'Anexo no incorporado al PDF',
    `Tipo: ${row.tipo}`,
    `Nombre: ${row.nombre}`,
    message,
  ];
  let y = height - 72;
  for (const line of lines) {
    page.drawText(line.slice(0, 120), { x: 48, y, size: 11, font, color: rgb(0.15, 0.2, 0.28) });
    y -= 22;
  }
}

/**
 * @param {Array<Record<string, unknown>>} documentosRows filas con tipo, nombre, file_path, formato, mime_type, created_at
 * @param {string[]} mergeOrderTipos orden de fusión (índice menor = más al inicio del PDF)
 * @returns {Promise<Buffer>}
 */
async function buildMergedPdf(documentosRows, mergeOrderTipos) {
  const sorted = sortDocsByTipoOrder(documentosRows, mergeOrderTipos);
  if (!sorted.length) {
    throw new Error('No hay archivos para consolidar');
  }

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  for (const row of sorted) {
    let buf;
    try {
      buf = await fetchBuffer(row.file_path);
    } catch (e) {
      await addPlaceholderPage(out, row, `Error al descargar: ${e.message || 'desconocido'}`);
      continue;
    }

    if (isPdfBuffer(buf)) {
      try {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const indices = src.getPageIndices();
        const pages = await out.copyPages(src, indices);
        pages.forEach((p) => out.addPage(p));
      } catch (e) {
        await addPlaceholderPage(out, row, `PDF no se pudo leer: ${e.message || 'error'}`);
      }
      continue;
    }

    const kind = imageKind(row);
    if (kind === 'jpg') {
      try {
        const img = await out.embedJpg(buf);
        const page = out.addPage(PageSizes.A4);
        const { width, height } = page.getSize();
        const margin = 40;
        const maxW = width - 2 * margin;
        const maxH = height - 2 * margin - 28;
        let w = img.width;
        let h = img.height;
        const scale = Math.min(maxW / w, maxH / h, 1);
        w *= scale;
        h *= scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        page.drawImage(img, { x, y, width: w, height: h });
        page.drawText(`${row.tipo} — ${row.nombre}`.slice(0, 100), {
          x: margin,
          y: 24,
          size: 9,
          font,
          color: rgb(0.3, 0.35, 0.4),
        });
      } catch {
        await addPlaceholderPage(out, row, 'No se pudo embeber como JPG (¿formato real?)');
      }
      continue;
    }

    if (kind === 'png') {
      try {
        const img = await out.embedPng(buf);
        const page = out.addPage(PageSizes.A4);
        const { width, height } = page.getSize();
        const margin = 40;
        const maxW = width - 2 * margin;
        const maxH = height - 2 * margin - 28;
        let w = img.width;
        let h = img.height;
        const scale = Math.min(maxW / w, maxH / h, 1);
        w *= scale;
        h *= scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        page.drawImage(img, { x, y, width: w, height: h });
        page.drawText(`${row.tipo} — ${row.nombre}`.slice(0, 100), {
          x: margin,
          y: 24,
          size: 9,
          font,
          color: rgb(0.3, 0.35, 0.4),
        });
      } catch {
        await addPlaceholderPage(out, row, 'No se pudo embeber como PNG (¿formato real?)');
      }
      continue;
    }

    await addPlaceholderPage(
      out,
      row,
      `Formato ${row.formato || row.mime_type || 'desconocido'}: conservar anexo en SIGEX.`
    );
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}

module.exports = { buildMergedPdf, sortDocsByTipoOrder };
