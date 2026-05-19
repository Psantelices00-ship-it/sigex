const axios = require('axios');
const cloudinary = require('./cloudinary');

const EXT_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain; charset=utf-8',
};

function resolveContentType(mimeType, filename, upstreamCtype) {
  const fromDb = (mimeType || '').trim();
  if (fromDb && fromDb !== 'application/octet-stream') return fromDb;

  const ext = String(filename || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext];

  const up = (upstreamCtype || '').split(';')[0].trim();
  if (up && up !== 'application/octet-stream') return up;

  return 'application/octet-stream';
}

function isCloudinaryDeliveryUrl(url) {
  return /res\.cloudinary\.com/i.test(String(url || ''));
}

/** @returns {{ resourceType: string, publicId: string, format: string|null } | null} */
function parseCloudinaryDeliveryUrl(url) {
  const u = String(url || '').trim();
  const m = u.match(
    /res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:s--[^/]+--\/)?(?:v\d+\/)?(.+)$/i
  );
  if (!m) return null;
  const resourceType = m[1].toLowerCase();
  let tail = m[2];
  let format = null;
  const dot = tail.lastIndexOf('.');
  if (dot > 0 && /^[a-z0-9]{1,8}$/i.test(tail.slice(dot + 1))) {
    format = tail.slice(dot + 1).toLowerCase();
    tail = tail.slice(0, dot);
  }
  return { resourceType, publicId: tail, format };
}

function cloudinaryPrivateDownloadUrl(parsed) {
  if (!parsed?.publicId || !process.env.CLOUDINARY_API_SECRET) return null;
  try {
    return cloudinary.utils.private_download_url(parsed.publicId, parsed.format || '', {
      resource_type: parsed.resourceType,
      type: 'upload',
    });
  } catch {
    return null;
  }
}

function pipeAxiosStream(upstream, res, { mimeType, filename }) {
  const upstreamCtype = upstream.headers['content-type'];
  const ctype = resolveContentType(mimeType, filename, upstreamCtype);
  res.setHeader('Content-Type', ctype);
  const safe = String(filename || 'documento')
    .replace(/"/g, "'")
    .replace(/[\r\n]/g, ' ')
    .slice(0, 200);
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  upstream.data.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  upstream.data.pipe(res);
}

function fetchStream(url) {
  return axios.get(url, {
    responseType: 'stream',
    maxRedirects: 5,
    timeout: 120000,
    validateStatus: (status) => status === 200,
    headers: { Accept: '*/*' },
  });
}

/**
 * Reenvía un archivo remoto (p. ej. Cloudinary) al cliente con cabeceras para ver en navegador.
 * Si la URL pública de Cloudinary está restringida (401), usa descarga firmada por API.
 */
async function streamRemoteFileToResponse(remoteUrl, res, { mimeType, filename } = {}) {
  const urls = [remoteUrl];
  if (isCloudinaryDeliveryUrl(remoteUrl)) {
    const parsed = parseCloudinaryDeliveryUrl(remoteUrl);
    const priv = parsed ? cloudinaryPrivateDownloadUrl(parsed) : null;
    if (priv) urls.push(priv);
    if (parsed?.format === 'pdf' && parsed.resourceType === 'image') {
      const asRaw = cloudinaryPrivateDownloadUrl({ ...parsed, resourceType: 'raw' });
      if (asRaw) urls.push(asRaw);
    }
  }

  let lastErr;
  for (const url of [...new Set(urls.filter(Boolean))]) {
    try {
      const upstream = await fetchStream(url);
      pipeAxiosStream(upstream, res, { mimeType, filename });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No se pudo obtener el archivo');
}

module.exports = { streamRemoteFileToResponse };
