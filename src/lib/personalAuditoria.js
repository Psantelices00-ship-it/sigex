const db = require('../db');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

async function registrarAuditoriaPersonal(req, payload) {
  const user = req?.user || req || {};
  const {
    accion,
    entidad,
    entidad_id,
    funcionario_id,
    documento_id,
    detalle_json,
  } = payload || {};

  await db.query(
    `INSERT INTO personal_auditoria
      (usuario_login, usuario_nombre, ip, accion, entidad, entidad_id, funcionario_id, documento_id, detalle_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      user.login || 'desconocido',
      user.nombre || null,
      clientIp(req),
      accion,
      entidad || null,
      entidad_id != null ? String(entidad_id) : null,
      funcionario_id || null,
      documento_id || null,
      detalle_json ? JSON.stringify(detalle_json) : '{}',
    ]
  );
}

module.exports = { registrarAuditoriaPersonal, clientIp };
