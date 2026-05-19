const cloudinary = require('../cloudinary');
const streamifier = require('streamifier');

/**
 * Sube un buffer a Cloudinary bajo sigex/{folder}.
 * @param {Buffer} buffer
 * @param {string} filename nombre con extensión (ej. informe.pdf)
 * @param {string} folder ruta relativa sin prefijo sigex/ (ej. expedientes/uuid/consolidados)
 */
function uploadBuffer(buffer, filename, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `sigex/${folder}`,
        resource_type: options.resource_type || 'raw',
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

module.exports = { uploadBuffer };
