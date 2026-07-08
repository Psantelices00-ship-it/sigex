/** Normalización y validación de RUT chileno (backend). */

function rutQuitarFormato(rut) {
  return String(rut || '')
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/\s/g, '')
    .trim()
    .toUpperCase();
}

function rutDvEsperado(cuerpo) {
  let suma = 0;
  let mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function rutPartsFromHyphenated(input) {
  const s = String(input ?? '').trim().toUpperCase();
  if (!s.includes('-')) return null;

  const dash = s.lastIndexOf('-');
  const numero = s
    .slice(0, dash)
    .replace(/\./g, '')
    .replace(/\s/g, '');
  const dv = s
    .slice(dash + 1)
    .replace(/\s/g, '')
    .replace(/[^0-9K]/g, '')
    .slice(-1);

  if (!/^\d{7,8}$/.test(numero) || !/^[0-9K]$/.test(dv)) return null;
  if (rutDvEsperado(numero) !== dv) return null;

  return {
    rut_normalizado: `${numero}${dv}`,
    rut_numero: numero,
    rut_dv: dv,
  };
}

/**
 * Repara el error clásico "9.144.200-0" → cuerpo 91442000 + DV calculado 8.
 * Ocurre cuando se quitan puntos y guión sin respetar el separador del DV.
 */
function tryRepairRutAbsorbedDv(numero, dv) {
  if (numero.length !== 8 || !numero.endsWith('0') || dv !== rutDvEsperado(numero)) return null;

  const fixedNumero = numero.slice(0, -1);
  const fixedDv = numero.slice(-1);
  if (rutDvEsperado(fixedNumero) !== fixedDv) return null;

  return {
    rut_normalizado: `${fixedNumero}${fixedDv}`,
    rut_numero: fixedNumero,
    rut_dv: fixedDv,
  };
}

function validarRutChileno(rut) {
  return normalizeRutParts(rut) != null;
}

/**
 * Normaliza RUT para almacenamiento y búsqueda.
 * Acepta con/sin puntos, guion y con/sin DV.
 * @returns {{ rut_normalizado: string, rut_numero: string, rut_dv: string } | null}
 */
function normalizeRutParts(input) {
  const hyphenated = rutPartsFromHyphenated(input);
  if (hyphenated) return hyphenated;

  const raw = rutQuitarFormato(input);
  if (!raw) return null;

  if (/^\d{7,8}$/.test(raw)) {
    const numero = raw;
    const dv = rutDvEsperado(numero);
    return {
      rut_normalizado: `${numero}${dv}`,
      rut_numero: numero,
      rut_dv: dv,
    };
  }

  if (/^\d{7,8}[0-9K]$/.test(raw)) {
    const numero = raw.slice(0, -1);
    const dv = raw.slice(-1);
    if (rutDvEsperado(numero) !== dv) return null;
    return {
      rut_normalizado: `${numero}${dv}`,
      rut_numero: numero,
      rut_dv: dv,
    };
  }

  return null;
}

/** Intenta corregir un RUT ya almacenado con el dígito verificador absorbido en el cuerpo. */
function repairStoredRutParts(numero, dv) {
  const current = normalizeRutParts(`${numero}${dv}`);
  const repaired = tryRepairRutAbsorbedDv(String(numero || ''), String(dv || '').toUpperCase());
  if (!repaired) return current;
  if (current && current.rut_normalizado === repaired.rut_normalizado) return current;
  return repaired;
}

function formatearRut(rut) {
  const stored =
    typeof rut === 'object' && rut?.rut_numero && rut?.rut_dv
      ? repairStoredRutParts(rut.rut_numero, rut.rut_dv)
      : null;
  let parts = stored || normalizeRutParts(rut);
  if (parts) {
    const repaired = tryRepairRutAbsorbedDv(parts.rut_numero, parts.rut_dv);
    if (repaired) parts = repaired;
  }
  if (!parts) return '';
  const { rut_numero: num, rut_dv: dv } = parts;
  let n = num;
  let out = '';
  while (n.length > 3) {
    out = `.${n.slice(-3)}${out}`;
    n = n.slice(0, -3);
  }
  return `${n}${out}-${dv}`;
}

/** Coincide por RUT completo o solo número base. */
function rutMatchesQuery(rutNumero, rutNormalizado, query) {
  const parts = normalizeRutParts(query);
  if (!parts) {
    const digits = String(query || '').replace(/\D/g, '');
    if (!digits) return false;
    return rutNumero.startsWith(digits) || rutNormalizado.startsWith(digits);
  }
  return rutNormalizado === parts.rut_normalizado || rutNumero === parts.rut_numero;
}

module.exports = {
  rutQuitarFormato,
  rutDvEsperado,
  validarRutChileno,
  normalizeRutParts,
  repairStoredRutParts,
  tryRepairRutAbsorbedDv,
  formatearRut,
  rutMatchesQuery,
};
