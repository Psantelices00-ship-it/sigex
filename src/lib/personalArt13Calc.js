/**
 * Cálculo del bono mensual — Ley N° 21.806, Artículo 13.
 * Proporcional a jornada/44 y a días trabajados/30.
 */
const PARAMETROS_2026 = {
  jornadaCompleta: 44,
  umbralBruto: 673687,
  limiteBruto: 761741,
  aporteMaximo: 62903,
  tasaAfectoPct: 71.437,
  meses: 1,
  diasMes: 30,
};

const HABERES_DEFAULT = [
  { letra: 'CE', clave: 'sueldos', etiqueta: 'H001 SUELDOS' },
  { letra: 'CK', clave: 'movilizacion', etiqueta: 'H011 MOVILIZACION' },
  { letra: 'CL', clave: 'colacion', etiqueta: 'H012 COLACION' },
  { letra: 'CP', clave: 'respFuncion', etiqueta: 'H016 A.RESP.FUNCION(A.E.)' },
  { letra: 'CT', clave: 'art7', etiqueta: 'H038 ART.7 L/19464' },
  { letra: 'DE', clave: 'dificil', etiqueta: 'H073 D.DIFICIL (A.E.)' },
  { letra: 'DK', clave: 'riesgo', etiqueta: 'H090 ASIG.DE RIESGO (A.E.)' },
];

const PLANTAS_DOCENTE = [
  'DOCENTE',
  'DOCENTE-DIRECTIVO',
  'DOCENTE BRP',
  'DIRECTOR(A) ENCARGAD',
  'JEFE U.T.P.',
  'INSPECTOR GENERAL',
  'ENCARGADO CONVIVENCI',
];

function roundExcel(value, digits) {
  digits = digits == null ? 0 : digits;
  const factor = 10 ** digits;
  const n = Number(value) * factor;
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(n) + 0.5)) / factor;
}

function toNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s) return 0;
  const normalized = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseJornada(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const s = String(value).trim().replace(',', '.');
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDias(value, diasMes) {
  const base = Number(diasMes) || 30;
  if (value == null || value === '') return base;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return base;
    return value;
  }
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0) return base;
  return n;
}

function normalizaPlanta(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function esPlantaDocente(planta, excluidas) {
  const p = normalizaPlanta(planta);
  if (!p) return false;
  if (p.includes('PARADOCENTE')) return false;
  const list = excluidas || PLANTAS_DOCENTE;
  return list.some((ex) => {
    const e = normalizaPlanta(ex);
    return p === e || p.startsWith(e) || e.startsWith(p);
  });
}

function letraAIndice(letra) {
  let n = 0;
  const s = String(letra).toUpperCase().replace(/[^A-Z]/g, '');
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function clp(value) {
  const n = roundExcel(value, 0);
  const sign = n < 0 ? '-' : '';
  const abs = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${abs}`;
}

function calcularBono(jornada, bruto, params) {
  params = params || PARAMETROS_2026;
  const jornadaCompleta = Number(params.jornadaCompleta) || 44;
  const umbralBase = Number(params.umbralBruto) || 0;
  const limiteBase = Number(params.limiteBruto) || 0;
  const aporteBase = Number(params.aporteMaximo) || 0;
  const tasa = Number(params.tasaAfectoPct) / 100;
  const meses = Number(params.meses) || 1;
  const diasMes = Number(params.diasMes) || 30;
  const hrs = Number(jornada);
  const renta = roundExcel(bruto, 0);
  let dias = parseDias(params.dias, diasMes);
  if (dias > diasMes) dias = diasMes;

  const vacio = {
    factor: 0,
    factorJornada: 0,
    factorDias: 0,
    umbral: 0,
    limite: 0,
    aporteMax: 0,
    exceso: 0,
    valorAfecto: 0,
    bono: 0,
    costo: 0,
    meses,
    dias,
    diasMes,
    renta,
  };

  if (dias <= 0) {
    return {
      ...vacio,
      ok: false,
      estado: 'SIN DIAS',
      criterio: 'No registra días trabajados en el mes.',
    };
  }

  if (!hrs || hrs <= 0) {
    return {
      ...vacio,
      ok: false,
      estado: 'SIN JORNADA',
      criterio: 'No hay jornada semanal válida.',
    };
  }

  const factorJornada = hrs / jornadaCompleta;
  const umbralJ = roundExcel(umbralBase * factorJornada, 0);
  const limiteJ = roundExcel(limiteBase * factorJornada, 0);
  const aporteJ = roundExcel(aporteBase * factorJornada, 0);
  const factorDias = dias / diasMes;
  const umbral = roundExcel(umbralJ * factorDias, 0);
  const limite = roundExcel(limiteJ * factorDias, 0);
  const aporteMax = roundExcel(aporteJ * factorDias, 0);
  const factor = factorJornada * factorDias;

  if (renta >= limite) {
    return {
      ok: true,
      estado: 'SIN DERECHO',
      factor,
      factorJornada,
      factorDias,
      umbral,
      limite,
      aporteMax,
      exceso: Math.max(0, renta - umbral),
      valorAfecto: 0,
      bono: 0,
      costo: 0,
      meses,
      dias,
      diasMes,
      renta,
      criterio: 'La remuneración bruta iguala o supera el límite proporcional (jornada y días).',
    };
  }

  const exceso = Math.max(0, renta - umbral);
  const valorAfecto = roundExcel(tasa * exceso, 0);
  const bono = Math.max(0, aporteMax - valorAfecto);

  return {
    ok: true,
    estado: bono > 0 ? 'CON DERECHO' : 'SIN DERECHO',
    factor,
    factorJornada,
    factorDias,
    umbral,
    limite,
    aporteMax,
    exceso,
    valorAfecto,
    bono,
    costo: bono * meses,
    meses,
    dias,
    diasMes,
    renta,
    criterio:
      exceso === 0
        ? 'Renta igual o inferior al umbral proporcional a jornada y días: corresponde el aporte máximo prorrateado.'
        : 'Tramo decreciente sobre umbral proporcional a jornada y días: se descuenta el 71,437% del exceso.',
  };
}

function motivoNoCorresponde(calc) {
  if (!calc) return 'Sin cálculo';
  if (calc.estado === 'SIN DIAS') return 'No registra días trabajados en el mes';
  if (!calc.ok || calc.estado === 'SIN JORNADA') return 'Sin jornada semanal válida';
  if (calc.renta >= calc.limite) {
    const tramoDias =
      calc.dias != null && calc.diasMes && calc.dias < calc.diasMes
        ? ` de ${calc.dias}/${calc.diasMes} días`
        : '';
    return `La remuneración bruta (${clp(calc.renta)}) iguala o supera el límite proporcional${tramoDias} (${clp(calc.limite)})`;
  }
  if (calc.bono <= 0) return 'El exceso sobre el umbral deja el bono en $0';
  return calc.criterio || 'No corresponde bono';
}

function normalizarParams(body) {
  const b = body || {};
  return {
    jornadaCompleta: Number(b.jornadaCompleta ?? b.jornada_completa) || PARAMETROS_2026.jornadaCompleta,
    umbralBruto: Number(b.umbralBruto ?? b.umbral_bruto) || PARAMETROS_2026.umbralBruto,
    limiteBruto: Number(b.limiteBruto ?? b.limite_bruto) || PARAMETROS_2026.limiteBruto,
    aporteMaximo: Number(b.aporteMaximo ?? b.aporte_maximo) || PARAMETROS_2026.aporteMaximo,
    tasaAfectoPct: Number(b.tasaAfectoPct ?? b.tasa_afecto_pct) || PARAMETROS_2026.tasaAfectoPct,
    meses: Number(b.meses) || PARAMETROS_2026.meses,
    diasMes: Number(b.diasMes ?? b.dias_mes) || PARAMETROS_2026.diasMes,
  };
}

module.exports = {
  PARAMETROS_2026,
  HABERES_DEFAULT,
  PLANTAS_DOCENTE,
  roundExcel,
  toNumber,
  parseJornada,
  parseDias,
  normalizaPlanta,
  esPlantaDocente,
  letraAIndice,
  clp,
  calcularBono,
  motivoNoCorresponde,
  normalizarParams,
};
