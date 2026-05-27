/**
 * Meta acumulada de ejecución presupuestaria (% del presupuesto vigente).
 * Referencia: septiembre ~70 %, diciembre 100 % (curva anual educación pública).
 */
const META_ACUMULADA_POR_MES = {
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  7: 55,
  8: 63,
  9: 70,
  10: 72,
  11: 75,
  12: 100,
};

const TOLERANCIA_PPTS = 5;

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function metaAcumuladaPercent(mes) {
  const m = Math.max(1, Math.min(12, Math.round(Number(mes) || 1)));
  return META_ACUMULADA_POR_MES[m] ?? Math.round((m / 12) * 100);
}

/**
 * @param {{ presup_vigente: number, devengado: number, comprometido_sigex: number }} totales
 * @param {{ mes?: number, anio?: number, fechaReferencia?: string }} opts
 */
function calcularSeguimientoEjecucion(totales, opts = {}) {
  const vigente = Number(totales?.presup_vigente || 0);
  const devengado = Number(totales?.devengado || 0);
  const comprometido = Number(totales?.comprometido_sigex || 0);

  const ref = opts.fechaReferencia ? new Date(opts.fechaReferencia) : new Date();
  const mes = opts.mes != null ? Number(opts.mes) : ref.getMonth() + 1;
  const anio = opts.anio != null ? Number(opts.anio) : ref.getFullYear();

  const metaPct = metaAcumuladaPercent(mes);
  const metaMonto = vigente > 0 ? Math.round((vigente * metaPct) / 100) : 0;

  const pctDevengado = vigente > 0 ? Math.round((devengado / vigente) * 1000) / 10 : 0;
  const pctComprometidoSigex = vigente > 0 ? Math.round((comprometido / vigente) * 1000) / 10 : 0;
  const pctEjecutadoTotal = vigente > 0 ? Math.round(((devengado + comprometido) / vigente) * 1000) / 10 : 0;

  const diferenciaPpts = Math.round((pctEjecutadoTotal - metaPct) * 10) / 10;
  const diferenciaMonto = devengado + comprometido - metaMonto;

  let alerta = 'ok';
  let mensaje = `Ejecución acorde a la meta de ${MESES[mes - 1]} (${metaPct} %).`;

  if (diferenciaPpts < -TOLERANCIA_PPTS) {
    alerta = 'atrasado';
    mensaje = `Por debajo de la meta: llevas ${pctEjecutadoTotal} % y a ${MESES[mes - 1]} deberías ~${metaPct} %. Falta acelerar compras o revisar el presupuesto.`;
  } else if (diferenciaPpts > TOLERANCIA_PPTS) {
    alerta = 'adelantado';
    mensaje = `Por encima de la meta (${pctEjecutadoTotal} % vs ${metaPct} % esperado). Revisá modificaciones presupuestarias o redistribución.`;
  }

  return {
    mes,
    mes_nombre: MESES[mes - 1],
    anio,
    meta_acumulada_pct: metaPct,
    meta_acumulada_monto: metaMonto,
    pct_devengado_oficial: pctDevengado,
    pct_comprometido_sigex: pctComprometidoSigex,
    pct_ejecutado_total: pctEjecutadoTotal,
    monto_devengado: devengado,
    monto_comprometido_sigex: comprometido,
    monto_ejecutado_total: devengado + comprometido,
    diferencia_ppts: diferenciaPpts,
    diferencia_monto: diferenciaMonto,
    tolerancia_ppts: TOLERANCIA_PPTS,
    alerta,
    mensaje,
    nota_arranque:
      'El devengado viene del Excel al importar (ejecución ya iniciada). El comprometido SIGEX suma las compras registradas con cuenta y monto.',
  };
}

function enriquecerLineaConPct(linea) {
  const vigente = Number(linea.presup_vigente || 0);
  const devengado = Number(linea.devengado || 0);
  const comprometido = Number(linea.comprometido_sigex || 0);
  const total = devengado + comprometido;
  return {
    ...linea,
    pct_devengado: vigente > 0 ? Math.round((devengado / vigente) * 1000) / 10 : 0,
    pct_ejecutado_total: vigente > 0 ? Math.round((total / vigente) * 1000) / 10 : 0,
  };
}

module.exports = {
  calcularSeguimientoEjecucion,
  enriquecerLineaConPct,
  metaAcumuladaPercent,
  MESES,
};
