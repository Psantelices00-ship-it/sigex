/**
 * Documentos obligatorios del proceso de compra (después de vincular solicitudes aprobadas).
 * Las solicitudes en sí quedan en la tabla `solicitudes` (no se exige un tipo "Memo" duplicado).
 * Mantener alineado con sigex-frontend `pages/expedientes/[id].js`.
 */
const REQUIRED_CLOSURE = [
  'Certificado de Disponibilidad Presupuestaria',
  'Cotización 1',
  'Cotización 2',
  'Cotización 3',
  'Resolución de Adjudicación',
  'Orden de Compra',
  'Recepción Conforme',
  'Factura',
  'Decreto de Pago',
  'Comprobante de Pago',
]

/** Estados que participan en el pipeline automático (Archivado queda fuera). */
const ESTADOS_PIPELINE = [
  'Ingresado',
  'En Revisión',
  'En Compras',
  'En Proceso de Pago',
  'Pagado',
  'En Rendición',
  'Finalizado',
]

function rankEstado(estado) {
  const i = ESTADOS_PIPELINE.indexOf(estado)
  if (i >= 0) return i
  return 0
}

function tiposSet(documentosRows) {
  const s = new Set()
  for (const d of documentosRows || []) {
    if (d && d.tipo) s.add(String(d.tipo).trim())
  }
  return s
}

function computeChecklist(documentosRows, opts = {}) {
  const nSol = typeof opts.solicitudesCount === 'number' ? opts.solicitudesCount : 0
  const set = tiposSet(documentosRows)
  const checklist = REQUIRED_CLOSURE.map((tipo) => ({ tipo, cargado: set.has(tipo) }))
  const faltantesDocs = checklist.filter((c) => !c.cargado).map((c) => c.tipo)
  const faltantes = []
  if (nSol < 1) faltantes.push('Al menos una solicitud derivada a Compras vinculada')
  faltantes.push(...faltantesDocs)
  const solicitudes_ok = nSol >= 1
  const puede_cerrar = solicitudes_ok && faltantesDocs.length === 0
  return {
    checklist,
    faltantes,
    solicitudes_ok,
    solicitudes_vinculadas: nSol,
    puede_cerrar,
    total_obligatorios: REQUIRED_CLOSURE.length,
    cargados: REQUIRED_CLOSURE.length - faltantesDocs.length,
  }
}

/**
 * Sugiere el nuevo estado según documentos cargados (solo avanza, nunca retrocede).
 */
function suggestEstadoFromDocumentos(documentosRows, currentEstado) {
  if (!currentEstado || currentEstado === 'Archivado') return null

  const has = (t) => tiposSet(documentosRows).has(t)
  let target = rankEstado(currentEstado)

  if (has('Cotización 1') && has('Cotización 2') && has('Cotización 3')) {
    target = Math.max(target, rankEstado('En Compras'))
  }

  if (
    has('Recepción Conforme') &&
    has('Cotización 1') &&
    has('Cotización 2') &&
    has('Cotización 3')
  ) {
    target = Math.max(target, rankEstado('En Proceso de Pago'))
  }

  if (has('Decreto de Pago') && has('Recepción Conforme')) {
    target = Math.max(target, rankEstado('Pagado'))
  }

  if (has('Comprobante de Pago')) {
    target = Math.max(target, rankEstado('En Rendición'))
  }

  if (REQUIRED_CLOSURE.every((t) => has(t))) {
    target = Math.max(target, rankEstado('Finalizado'))
  }

  const nuevo = ESTADOS_PIPELINE[target]
  if (!nuevo || nuevo === currentEstado) return null
  return nuevo
}

module.exports = {
  REQUIRED_CLOSURE,
  ESTADOS_PIPELINE,
  computeChecklist,
  suggestEstadoFromDocumentos,
}
