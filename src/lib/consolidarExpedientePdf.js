const { REQUIRED_CLOSURE } = require('./expedienteWorkflow');
const { buildMergedPdf, sortDocsByTipoOrder } = require('./consolidarPdfLib');

/** Orden de fusión expediente compra (mismo orden que tramitación). */
const MERGE_ORDER = [...REQUIRED_CLOSURE];

async function buildConsolidatedPdfBuffer(documentosRows) {
  return buildMergedPdf(documentosRows, MERGE_ORDER);
}

function sortDocsForMerge(rows) {
  return sortDocsByTipoOrder(rows, MERGE_ORDER);
}

module.exports = { buildConsolidatedPdfBuffer, sortDocsForMerge, MERGE_ORDER };
