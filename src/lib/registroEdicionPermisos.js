const ROLES_EDITAR_REGISTRO = ['Super Admin', 'Administrador', 'Secretaria de Administración'];

function puedeEditarRegistro(user) {
  return ROLES_EDITAR_REGISTRO.includes(String(user?.rol || '').trim());
}

function requireEditarRegistro(req, res) {
  if (!puedeEditarRegistro(req.user)) {
    res.status(403).json({ error: 'Sin permisos para editar este registro' });
    return false;
  }
  return true;
}

module.exports = {
  ROLES_EDITAR_REGISTRO,
  puedeEditarRegistro,
  requireEditarRegistro,
};
