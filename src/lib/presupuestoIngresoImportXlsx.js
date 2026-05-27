const { parseEjecucionPresupuestoXlsx } = require('./presupuestoImportXlsx');

/** Subtítulos típicos de ingresos en contabilidad pública (ajustable al importar). */
const SUBTITULOS_INGRESO_DEFAULT = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];

/**
 * Importa líneas de ingreso desde el mismo Excel DAEM (una o más subtítulos).
 * ingreso_oficial = columna devengado/recaudado al corte; ingreso_real inicia igual y se puede corregir.
 */
function parseIngresosPresupuestoXlsx(buffer, opts = {}) {
  const raw = opts.subtitulos != null ? String(opts.subtitulos).trim() : '';
  const subtitulos = raw
    ? raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    : SUBTITULOS_INGRESO_DEFAULT;

  const lineas = [];
  let fecha_corte = null;
  let anio = new Date().getFullYear();

  for (const sub of subtitulos) {
    const parsed = parseEjecucionPresupuestoXlsx(buffer, { subtitulo: sub });
    if (!fecha_corte && parsed.fecha_corte) fecha_corte = parsed.fecha_corte;
    if (parsed.anio) anio = parsed.anio;
    for (const l of parsed.lineas) {
      lineas.push({
        ...l,
        ingreso_oficial: l.devengado,
        ingreso_real: l.devengado,
      });
    }
  }

  return {
    anio,
    fecha_corte: fecha_corte || new Date().toISOString().slice(0, 10),
    subtitulos_filtro: subtitulos.join(','),
    lineas,
    total_lineas: lineas.length,
    imputables: lineas.filter((l) => l.es_imputable).length,
  };
}

module.exports = {
  parseIngresosPresupuestoXlsx,
  SUBTITULOS_INGRESO_DEFAULT,
};
