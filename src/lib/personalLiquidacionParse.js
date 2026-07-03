const pdf = require('pdf-parse');
const { normalizeRutParts, formatearRut } = require('./rutChileno');

const MESES_LABEL = {
  1: 'Enero',
  2: 'Febrero',
  3: 'Marzo',
  4: 'Abril',
  5: 'Mayo',
  6: 'Junio',
  7: 'Julio',
  8: 'Agosto',
  9: 'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre',
};

const MESES_NUM = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

function etiquetaPeriodo(mes, anio) {
  const m = Number(mes);
  const y = Number(anio);
  if (!m || !y) return null;
  return `${MESES_LABEL[m] || m} ${y}`;
}

function splitLiquidacionBlocks(text) {
  return String(text || '')
    .split(/(?=LIQUIDACIÓN DE REMUNERACIONES)/i)
    .filter((b) => /R\.U\.T/i.test(b));
}

function parseNameLine(line) {
  const parts = String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return { apellido_paterno: '', apellido_materno: '', nombres: '', nombre_completo: '' };
  }
  if (parts.length === 1) {
    return {
      apellido_paterno: parts[0],
      apellido_materno: '',
      nombres: '',
      nombre_completo: parts[0],
    };
  }
  if (parts.length === 2) {
    return {
      apellido_paterno: parts[0],
      apellido_materno: parts[1],
      nombres: '',
      nombre_completo: parts.join(' '),
    };
  }
  return {
    apellido_paterno: parts[0],
    apellido_materno: parts[1],
    nombres: parts.slice(2).join(' '),
    nombre_completo: parts.join(' '),
  };
}

function parseTopeImponible(text) {
  const idx = String(text || '').search(/Tope Imponible/i);
  if (idx < 0) return null;
  const chunk = String(text).slice(idx, idx + 140);
  const nums = chunk.match(/\d{1,3}(?:\.\d{3})+/g);
  if (!nums || nums.length < 2) return null;
  const raw = nums[1];
  const n = parseInt(String(raw).replace(/\./g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLiquidacionBlock(text, pagina) {
  const rutM = text.match(/(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/i);
  if (!rutM) return null;

  const rutParts = normalizeRutParts(rutM[1]);
  const idx = text.indexOf(rutM[0]);
  const before = text.slice(Math.max(0, idx - 140), idx);
  const nameM = before.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{4,})\s*$/);
  const nombre = parseNameLine(nameM ? nameM[1] : '');

  const mesM = text.match(/LIQUIDACIÓN DE REMUNERACIONES\s*([A-ZÁÉÍÓÚÑ]+)\s*-\s*(\d{4})/i);
  const mesLabel = mesM ? mesM[1].toUpperCase() : null;
  const mes = mesLabel ? MESES_NUM[mesLabel] || null : null;
  const anio = mesM ? Number(mesM[2]) : null;

  const estM =
    text.match(/LICEO[^\n]+/i) ||
    text.match(/ESCUELA[^\n]+/i) ||
    text.match(/COLEGIO[^\n]+/i) ||
    text.match(/JARD[IÍ]N[^\n]+/i);

  const cargoM = text.match(
    /Pactado Salud\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\/\(\)\.]{2,60}?)\s+U\.F\. Mes/i
  );
  let cargo = cargoM ? cargoM[1].replace(/\s+/g, ' ').trim() : null;
  if (!cargo) {
    const c2 = text.match(/\b(DOCENTE|ASISTENTE DE EDUCACIÓN|ASISTENTE|ADMINISTRATIVO|AUXILIAR)\b/i);
    if (c2) cargo = c2[1].toUpperCase();
  }

  return {
    pagina,
    rut_display: formatearRut(rutParts?.rut_normalizado || rutM[1]) || rutM[1],
    rut_normalizado: rutParts?.rut_normalizado || null,
    apellido_paterno: nombre.apellido_paterno,
    apellido_materno: nombre.apellido_materno,
    nombres: nombre.nombres,
    nombre_completo: nombre.nombre_completo,
    cargo,
    establecimiento: estM ? estM[0].replace(/\s+/g, ' ').trim() : null,
    mes,
    anio,
    monto_imponible: parseTopeImponible(text),
  };
}

/**
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ total_paginas: number, registros: object[], mes: number|null, anio: number|null, establecimiento: string|null, etiqueta: string|null }>}
 */
async function parseLiquidacionesPdf(pdfBuffer) {
  const data = await pdf(pdfBuffer);
  const blocks = splitLiquidacionBlocks(data.text);
  const registros = blocks
    .map((block, i) => parseLiquidacionBlock(block, i + 1))
    .filter(Boolean);

  const first = registros[0] || {};
  const mes = first.mes || null;
  const anio = first.anio || null;
  const establecimiento = first.establecimiento || null;

  return {
    total_paginas: data.numpages || blocks.length,
    registros,
    mes,
    anio,
    establecimiento,
    etiqueta: mes && anio ? etiquetaPeriodo(mes, anio) : null,
  };
}

module.exports = {
  MESES_LABEL,
  MESES_NUM,
  etiquetaPeriodo,
  parseLiquidacionesPdf,
  parseLiquidacionBlock,
  parseTopeImponible,
  splitLiquidacionBlocks,
};
