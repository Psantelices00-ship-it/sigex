const cloudinary = require('./cloudinary');
const streamifier = require('streamifier');

/** PDF y binarios no deben ir a `image/upload` (Safari no los muestra); usamos `raw`. */
function resourceTypeForUpload(mimetype, originalname) {
  const m = (mimetype || '').toLowerCase();
  if (m.includes('pdf')) return 'raw';
  if (/\.pdf$/i.test(String(originalname || ''))) return 'raw';
  return 'auto';
}

/**
 * @param {Buffer} buffer
 * @param {string} filename destino en Cloudinary
 * @param {string} folder subcarpeta bajo sigex/
 * @param {{ mimetype?: string, originalname?: string }} [fileMeta] para elegir resource_type
 */
function uploadToCloudinary(buffer, filename, folder, fileMeta = {}) {
  const resource_type = resourceTypeForUpload(fileMeta.mimetype, fileMeta.originalname);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `sigex/${folder}`,
        resource_type,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

module.exports = uploadToCloudinary;
