const ISAPRE_KEYWORDS = [
  'BANMEDICA',
  'COLMENA',
  'CONSALUD',
  'CRUZ',
  'VIDA TRES',
  'VIDATRES',
  'ESENCIAL',
  'NUEVA MASVIDA',
  'MASVIDA',
  'ISAPRE',
];

const INP_KEYWORDS = ['INP', 'DIPRECA', 'CAPREDENA', 'CAJA DE PREVISION'];

const CCAF_KEYWORDS = ['C.C.A.F', 'CCAF', 'CAJA DE COMPENSACION', 'COMPENSACION'];

const INDEFINIDO_KEYWORDS = ['TITULAR', 'INDEFINIDO', 'PLANTA', 'C.T.', 'CT.'];

function limpiarTexto(v) {
  return String(v || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function numeroPositivo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clasificarRegimenPrevisional(fondoRaw) {
  const fondo = limpiarTexto(fondoRaw);
  if (!fondo) {
    return { codigo: null, valor: null, detalle: null, etiqueta: 'Sin datos' };
  }
  const esInp = INP_KEYWORDS.some((k) => fondo.includes(k));
  if (esInp) {
    return { codigo: 1, valor: 'INP', detalle: fondoRaw?.trim() || fondo, etiqueta: 'INP (código 1)' };
  }
  return { codigo: 2, valor: 'AFP', detalle: fondoRaw?.trim() || fondo, etiqueta: 'AFP (código 2)' };
}

function clasificarSeguroDesempleo(segCesantia, override) {
  if (override === true) {
    return { codigo: 1, valor: 'Sí', etiqueta: 'Trabajador afiliado a AFC (código 1)' };
  }
  if (override === false) {
    return { codigo: 2, valor: 'No', etiqueta: 'No afiliado a AFC (código 2)' };
  }
  const tiene = numeroPositivo(segCesantia) > 0;
  return tiene
    ? { codigo: 1, valor: 'Sí', etiqueta: 'Trabajador afiliado a AFC (código 1)' }
    : { codigo: 2, valor: 'No', etiqueta: 'No afiliado a AFC (código 2)' };
}

function clasificarContratoIndefinido(tipoContratoRaw) {
  const t = limpiarTexto(tipoContratoRaw);
  if (!t) {
    return { codigo: null, valor: null, tipo_contrato: null, etiqueta: 'Sin datos' };
  }
  const indefinido = INDEFINIDO_KEYWORDS.some((k) => t.includes(k));
  return indefinido
    ? { codigo: 1, valor: 'Sí', tipo_contrato: tipoContratoRaw?.trim() || t, etiqueta: 'Indefinido (código 1)' }
    : { codigo: 2, valor: 'No', tipo_contrato: tipoContratoRaw?.trim() || t, etiqueta: 'No indefinido (código 2)' };
}

function clasificarSubsidioLicencia(saludRaw) {
  const salud = limpiarTexto(saludRaw);
  if (!salud) {
    return {
      letra: null,
      institucion: null,
      detalle: null,
      etiqueta: 'Sin datos',
    };
  }

  if (CCAF_KEYWORDS.some((k) => salud.includes(k))) {
    return {
      letra: 'C',
      institucion: 'C.C.A.F.',
      detalle: saludRaw?.trim() || salud,
      etiqueta: 'C — C.C.A.F.',
    };
  }

  if (salud.includes('EMPLEADOR')) {
    return {
      letra: 'D',
      institucion: 'Empleador',
      detalle: saludRaw?.trim() || salud,
      etiqueta: 'D — Empleador',
    };
  }

  if (ISAPRE_KEYWORDS.some((k) => salud.includes(k))) {
    return {
      letra: 'B',
      institucion: 'ISAPRE',
      detalle: saludRaw?.trim() || salud,
      etiqueta: 'B — ISAPRE',
    };
  }

  if (salud.includes('FONASA') || salud.includes('DIPRECA') || salud.includes('SERVICIO')) {
    return {
      letra: 'A',
      institucion: 'Servicios de Salud',
      detalle: saludRaw?.trim() || salud,
      etiqueta: 'A — Servicios de Salud',
    };
  }

  return {
    letra: 'B',
    institucion: 'ISAPRE',
    detalle: saludRaw?.trim() || salud,
    etiqueta: 'B — ISAPRE',
  };
}

function armarDatosFormularioLicencia({ fondo, salud, tipo_contrato, seg_cesantia_emp, afc_override }) {
  return {
    regimen_previsional: clasificarRegimenPrevisional(fondo),
    seguro_desempleo_afc: clasificarSeguroDesempleo(seg_cesantia_emp, afc_override),
    contrato_indefinido: clasificarContratoIndefinido(tipo_contrato),
    subsidio_licencia: clasificarSubsidioLicencia(salud),
  };
}

function diasEntreFechas(inicio, termino) {
  if (!inicio || !termino) return null;
  const a = new Date(inicio);
  const b = new Date(termino);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : null;
}

module.exports = {
  armarDatosFormularioLicencia,
  clasificarRegimenPrevisional,
  clasificarSeguroDesempleo,
  clasificarContratoIndefinido,
  clasificarSubsidioLicencia,
  diasEntreFechas,
};
