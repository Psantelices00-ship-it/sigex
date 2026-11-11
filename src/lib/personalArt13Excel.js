const XLSX = require('xlsx');
const {
  HABERES_DEFAULT,
  roundExcel,
  toNumber,
  parseJornada,
  parseDias,
  esPlantaDocente,
  letraAIndice,
  calcularBono,
  motivoNoCorresponde,
  normalizarParams,
} = require('./personalArt13Calc');

function normHeader(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function findHeaderIndex(headerRow, predicates) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(headerRow[i])
    if (predicates.some((p) => p(h))) return i
  }
  return -1
}

/** Índice de columna por código Hxxx (H001, H011, …), sin usar letra/posición Excel. */
function findHaberIndex(headerRow, haber) {
  const codigo = String(haber.codigo || '')
    .toUpperCase()
    .replace(/[^H0-9]/g, '')
  if (codigo) {
    const byCodigo = findHeaderIndex(headerRow, [
      (h) => h === codigo.toLowerCase(),
      (h) => h.startsWith(codigo.toLowerCase() + ' '),
      (h) => new RegExp(`(^|\\b)${codigo.toLowerCase()}(\\b|\\s|$)`).test(h),
    ])
    if (byCodigo >= 0) return byCodigo
  }

  const etiqueta = normHeader(haber.etiqueta)
  if (etiqueta) {
    const byEtiqueta = findHeaderIndex(headerRow, [(h) => h === etiqueta || h.includes(etiqueta)])
    if (byEtiqueta >= 0) return byEtiqueta
  }

  const aliases = Array.isArray(haber.alias) ? haber.alias : []
  for (const alias of aliases) {
    const a = normHeader(alias)
    if (!a) continue
    // Alias exacto o encabezado que termina/es igual al alias (evitar "movilizacion especial" ≠ "movilizacion")
    const byAlias = findHeaderIndex(headerRow, [
      (h) => h === a,
      (h) => h.endsWith(' ' + a) || h.endsWith(a),
      (h) => h === a || h.replace(/^h\d{3}\s+/, '') === a,
    ])
    if (byAlias >= 0) return byAlias
  }

  return -1
}

function buildIndexMap(headerRow) {
  const byLetter = (letra) => letraAIndice(letra)
  const idx = {
    nombre: byLetter('A'),
    rut: byLetter('B'),
    planta: byLetter('D'),
    establecimiento: byLetter('G'),
    jornada: byLetter('AE'),
    dias: byLetter('AW'),
  }

  const foundNombre = findHeaderIndex(headerRow, [(h) => h === 'nombre', (h) => h.includes('nombre_funcionario')])
  const foundRut = findHeaderIndex(headerRow, [(h) => h === 'rut'])
  const foundPlanta = findHeaderIndex(headerRow, [(h) => h === 'planta'])
  const foundJornada = findHeaderIndex(headerRow, [(h) => h === 'jornada', (h) => h.startsWith('jornada')])
  const foundEst = findHeaderIndex(headerRow, [(h) => h.startsWith('ubicaci'), (h) => h.includes('establec')])
  const foundDias = findHeaderIndex(headerRow, [
    (h) => h === 'dias_trab',
    (h) => h.includes('dias_trab'),
    (h) => h.includes('dias trab'),
  ])

  if (foundNombre >= 0) idx.nombre = foundNombre
  if (foundRut >= 0) idx.rut = foundRut
  if (foundPlanta >= 0) idx.planta = foundPlanta
  if (foundJornada >= 0) idx.jornada = foundJornada
  if (foundEst >= 0) idx.establecimiento = foundEst
  if (foundDias >= 0) idx.dias = foundDias

  idx.haberes = HABERES_DEFAULT.map((h) => ({
    codigo: h.codigo,
    clave: h.clave,
    etiqueta: h.etiqueta,
    // -1 si no está en este maestro (monto 0). Nunca fallback a letra Excel.
    index: findHaberIndex(headerRow, h),
  }))

  return idx
}

function procesarMaestro(buffer, paramsInput) {
  const params = normalizarParams(paramsInput);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (!data.length) throw new Error('El archivo no tiene filas');

  const header = data[0] || [];
  const idx = buildIndexMap(header);
  const filas = [];
  const plantasCount = {};

  for (let r = 1; r < data.length; r++) {
    const raw = data[r] || [];
    const nombre = raw[idx.nombre];
    if (nombre == null || String(nombre).trim() === '') continue;

    const planta = String(raw[idx.planta] == null ? '' : raw[idx.planta]).trim();
    const plantaKey = planta || '(sin planta)';
    plantasCount[plantaKey] = (plantasCount[plantaKey] || 0) + 1;

    const haberes = {}
    let bruto = 0
    idx.haberes.forEach((h) => {
      const monto = h.index >= 0 ? roundExcel(toNumber(raw[h.index]), 0) : 0
      haberes[h.clave] = monto
      bruto += monto
    })

    const jornada = parseJornada(raw[idx.jornada]);
    const dias = parseDias(raw[idx.dias], params.diasMes);
    const calc = calcularBono(jornada, bruto, { ...params, dias });

    filas.push({
      nombre: String(nombre).trim(),
      rut: raw[idx.rut] == null ? '' : String(raw[idx.rut]).trim(),
      planta,
      establecimiento: raw[idx.establecimiento] == null ? '' : String(raw[idx.establecimiento]).trim(),
      jornada,
      dias,
      haberes,
      bruto,
      esDocente: esPlantaDocente(planta),
      calc,
    });
  }

  const plantas = Object.keys(plantasCount)
    .sort((a, b) => plantasCount[b] - plantasCount[a])
    .map((planta) => ({
      planta,
      cantidad: plantasCount[planta],
      docente: esPlantaDocente(planta),
    }));

  return {
    archivo_hoja: sheetName,
    total_leidos: filas.length,
    parametros: params,
    plantas,
    filas,
  };
}

function exportarArt13Xlsx(filas) {
  const rows = Array.isArray(filas) ? filas : [];
  const conBono = rows.filter((r) => r.calc && Number(r.calc.bono) > 0);
  const sinBono = rows.filter((r) => !(r.calc && Number(r.calc.bono) > 0));

  const hojaCon = [['Nombre', 'RUT', 'Jornada', 'Días', 'Bono']].concat(
    conBono.map((r) => [r.nombre, r.rut, r.jornada, r.dias, r.calc.bono])
  );
  const hojaSin = [['Nombre', 'RUT', 'Jornada', 'Días', 'Motivo']].concat(
    sinBono.map((r) => [r.nombre, r.rut, r.jornada, r.dias, motivoNoCorresponde(r.calc)])
  );

  const wsCon = XLSX.utils.aoa_to_sheet(hojaCon);
  const wsSin = XLSX.utils.aoa_to_sheet(hojaSin);
  wsCon['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 14 }];
  wsSin['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsCon, 'Con bono');
  XLSX.utils.book_append_sheet(wb, wsSin, 'Sin bono');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { procesarMaestro, exportarArt13Xlsx };
