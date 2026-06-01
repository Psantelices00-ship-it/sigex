const ROLES_GESTION_SOLICITUD = new Set(['Super Admin', 'Secretaria de Administración'])

function solicitudAsociadaACompra(row) {
  return !!(row && row.expediente_id)
}

function puedeEliminarSolicitud(rol) {
  return rol != null && ROLES_GESTION_SOLICITUD.has(rol)
}

function puedeEditarSolicitud(rol) {
  return puedeEliminarSolicitud(rol)
}

module.exports = {
  puedeEliminarSolicitud,
  puedeEditarSolicitud,
  solicitudAsociadaACompra,
  ROLES_GESTION_SOLICITUD,
}
