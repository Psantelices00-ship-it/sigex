const ROL_ROBOT_LME = 'Robot LME';

const ROLES_ACCESO_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
  'Jefe de Contabilidad',
  'Contabilidad',
  ROL_ROBOT_LME, // mismo acceso Personal que RH, con atribución LME
];

/** Igual que RH: puede cargar/editar en Personal. El robot además usa el panel LME. */
const ROLES_GESTION_PERSONAL = [
  'Super Admin',
  'Administrador',
  'Secretaria de Administración',
  'Recursos Humanos',
  ROL_ROBOT_LME,
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

/** Alias: Robot LME ya está en ROLES_GESTION_PERSONAL. */
function puedeCargarDatosLicencias(user) {
  return puedeGestionarPersonal(user);
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
  return requireGestionPersonal(req, res);
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
