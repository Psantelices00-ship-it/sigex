/**
 * Fase madre del contrato: desde solicitud hasta contrato firmado (misma nomenclatura que expedientes de compra).
 */
const MOTHER_DOC_ORDER = [
  'Solicitud / Memo Inicial',
  'Certificado de Disponibilidad Presupuestaria',
  'Cotización 1',
  'Cotización 2',
  'Cotización 3',
  'Resolución de Adjudicación',
  'Orden de Compra',
  'Contrato firmado',
]

/**
 * Expediente mensual (pago): decreto primero en el volumen, luego recepción, factura y comprobante.
 */
const MONTHLY_PAGO_DOC_ORDER = ['Decreto de Pago', 'Recepción Conforme', 'Factura', 'Comprobante de Pago']

function tiposSet(rows) {
  const s = new Set()
  for (const d of rows || []) {
    if (d && d.tipo) s.add(String(d.tipo).trim())
  }
  return s
}

function computeChecklistFromOrder(documentosRows, orderedTipos) {
  const set = tiposSet(documentosRows)
  const checklist = orderedTipos.map((tipo) => ({ tipo, cargado: set.has(tipo) }))
  const faltantes = checklist.filter((c) => !c.cargado).map((c) => c.tipo)
  return {
    checklist,
    faltantes,
    puede_cerrar: faltantes.length === 0,
    total_obligatorios: orderedTipos.length,
    cargados: orderedTipos.length - faltantes.length,
  }
}

function computeMotherChecklist(contratosDocumentosRows) {
  return computeChecklistFromOrder(contratosDocumentosRows, MOTHER_DOC_ORDER)
}

function computeMonthlyPagoChecklist(pagosDocsRows) {
  return computeChecklistFromOrder(pagosDocsRows, MONTHLY_PAGO_DOC_ORDER)
}

module.exports = {
  MOTHER_DOC_ORDER,
  MONTHLY_PAGO_DOC_ORDER,
  computeMotherChecklist,
  computeMonthlyPagoChecklist,
}
