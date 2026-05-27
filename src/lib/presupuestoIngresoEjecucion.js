const { metaAcumuladaPercent, MESES } = require('./presupuestoEjecucion');

const TOLERANCIA_PPTS = 5;

/**
 * Seguimiento de recaudación / ingresos vs meta mensual acumulada.
 */
function calcularSeguimientoIngresos(totales, opts = {}) {
  const vigente = Number(totales?.presup_vigente || 0);
  const ingresoReal = Number(totales?.ingreso_real || 0);
  const ingresoOficial = Number(totales?.ingreso_oficial || 0);

  const ref = opts.fechaReferencia ? new Date(opts.fechaReferencia) : new Date();
  const mes = opts.mes != null ? Number(opts.mes) : ref.getMonth() + 1;
  const anio = opts.anio != null ? Number(opts.anio) : ref.getFullYear();

  const metaPct = metaAcumuladaPercent(mes);
  const metaMonto = vigente > 0 ? Math.round((vigente * metaPct) / 100) : 0;

  const pctIngresoReal = vigente > 0 ? Math.round((ingresoReal / vigente) * 1000) / 10 : 0;
  const pctOficial = vigente > 0 ? Math.round((ingresoOficial / vigente) * 1000) / 10 : 0;
  const diferenciaPpts = Math.round((pctIngresoReal - metaPct) * 10) / 10;
  const diferenciaMonto = ingresoReal - metaMonto;
  const porRecaudar = vigente - ingresoReal;

  let alerta = 'ok';
  let mensaje = `Ingresos en línea con la meta de ${MESES[mes - 1]} (${metaPct} % del presupuesto).`;

  if (diferenciaPpts < -TOLERANCIA_PPTS) {
    alerta = 'atrasado';
    mensaje = `Ingresos por debajo de la meta: llevas ${pctIngresoReal} % recaudado y a ${MESES[mes - 1]} se esperaba ~${metaPct} %. Revisá recaudación o proyección.`;
  } else if (diferenciaPpts > TOLERANCIA_PPTS) {
    alerta = 'adelantado';
    mensaje = `Ingresos por sobre la meta (${pctIngresoReal} % vs ${metaPct} % esperado). Buen cumplimiento o revisá cifras cargadas.`;
  }

  return {
    mes,
    mes_nombre: MESES[mes - 1],
    anio,
    meta_acumulada_pct: metaPct,
    meta_acumulada_monto: metaMonto,
    pct_ingreso_oficial: pctOficial,
    pct_ingreso_real: pctIngresoReal,
    monto_ingreso_oficial: ingresoOficial,
    monto_ingreso_real: ingresoReal,
    monto_por_recaudar: porRecaudar,
    diferencia_ppts: diferenciaPpts,
    diferencia_monto: diferenciaMonto,
    tolerancia_ppts: TOLERANCIA_PPTS,
    alerta,
    mensaje,
    nota:
      'Ingreso oficial = recaudado al corte del Excel. Ingreso real = cifra que registrás en SIGEX (editable por línea).',
  };
}

function enriquecerLineaIngreso(linea) {
  const vigente = Number(linea.presup_vigente || 0);
  const real = Number(linea.ingreso_real || 0);
  return {
    ...linea,
    pct_ingreso_real: vigente > 0 ? Math.round((real / vigente) * 1000) / 10 : 0,
    por_recaudar: vigente - real,
  };
}

function totalesIngresos(lineas) {
  return lineas.reduce(
    (acc, l) => {
      acc.presup_vigente += Number(l.presup_vigente || 0);
      acc.ingreso_oficial += Number(l.ingreso_oficial || 0);
      acc.ingreso_real += Number(l.ingreso_real || 0);
      return acc;
    },
    { presup_vigente: 0, ingreso_oficial: 0, ingreso_real: 0 }
  );
}

module.exports = {
  calcularSeguimientoIngresos,
  enriquecerLineaIngreso,
  totalesIngresos,
};
