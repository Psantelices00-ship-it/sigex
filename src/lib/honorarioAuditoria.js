const ROLES_EDITAR = ['Super Admin', 'Administrador', 'Secretaria de Administración'];

function puedeEditarHonorario(user) {
  return ROLES_EDITAR.includes(String(user?.rol || '').trim());
}

function diffHonorario(prev, next, fields) {
  const cambios = {};
  for (const f of fields) {
    const a = prev[f];
    const b = next[f];
    const sa = a == null ? '' : String(a);
    const sb = b == null ? '' : String(b);
    if (sa !== sb) {
      cambios[f] = { antes: a ?? null, despues: b ?? null };
    }
  }
  return cambios;
}

async function registrarAuditoriaHonorario(db, honorarioId, usuario, cambios) {
  if (!cambios || !Object.keys(cambios).length) return;
  try {
    await db.query(
      `INSERT INTO honorarios_auditoria (honorario_id, usuario, cambios)
       VALUES ($1, $2, $3)`,
      [honorarioId, usuario || null, JSON.stringify(cambios)]
    );
  } catch (err) {
    console.warn('[honorarios] auditoría no registrada:', err.message);
  }
}

module.exports = {
  ROLES_EDITAR,
  puedeEditarHonorario,
  diffHonorario,
  registrarAuditoriaHonorario,
};
