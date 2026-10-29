const ROL_ROBOT_LME = 'Robot LME';

const ROLES_ACCESO_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
  'Jefe de Contabilidad',
  'Contabilidad',
  ROL_ROBOT_LME, // consulta LME + carga de maestro/historial
];

const ROLES_GESTION_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
];

function esRolRobotLme(user) {
  return String(user?.rol || '').trim() === ROL_ROBOT_LME;
}

function puedeAccederPersonal(user) {
  return ROLES_ACCESO_PERSONAL.includes(String(user?.rol || '').trim());
}

function puedeGestionarPersonal(user) {
  return ROLES_GESTION_PERSONAL.includes(String(user?.rol || '').trim());
}

/** Maestro e historial de licencias: gestión RH/admin o el usuario Robot LME. */
function puedeCargarDatosLicencias(user) {
  return puedeGestionarPersonal(user) || esRolRobotLme(user);
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

function requireCargarDatosLicencias(req, res) {
  if (!puedeCargarDatosLicencias(req.user)) {
    res.status(403).json({ error: 'Sin permisos para cargar maestro o historial de licencias' });
    return false;
  }
  return true;
}

module.exports = {
  ROL_ROBOT_LME,
  ROLES_ACCESO_PERSONAL,
  ROLES_GESTION_PERSONAL,
  esRolRobotLme,
  puedeAccederPersonal,
  puedeGestionarPersonal,
  puedeCargarDatosLicencias,
  requireAccesoPersonal,
  requireGestionPersonal,
  requireCargarDatosLicencias,
};
