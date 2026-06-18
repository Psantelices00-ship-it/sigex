const ROLES_ACCESO_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
  'Jefe de Contabilidad',
  'Contabilidad',
];

const ROLES_GESTION_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
];

function puedeAccederPersonal(user) {
  return ROLES_ACCESO_PERSONAL.includes(String(user?.rol || '').trim());
}

function puedeGestionarPersonal(user) {
  return ROLES_GESTION_PERSONAL.includes(String(user?.rol || '').trim());
}

function requireAccesoPersonal(req, res) {
  if (!puedeAccederPersonal(req.user)) {
    res.status(403).json({ error: 'Sin permisos para acceder al módulo de Personal' });
    return false;
  }
  return true;
}

function requireGestionPersonal(req, res) {
  if (!puedeGestionarPersonal(req.user)) {
    res.status(403).json({ error: 'Sin permisos para gestionar Personal' });
    return false;
  }
  return true;
}

module.exports = {
  ROLES_ACCESO_PERSONAL,
  ROLES_GESTION_PERSONAL,
  puedeAccederPersonal,
  puedeGestionarPersonal,
  requireAccesoPersonal,
  requireGestionPersonal,
};
