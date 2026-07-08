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

function validarRutChileno(rut) {
  return normalizeRutParts(rut) != null;
}

/**
 * Normaliza RUT para almacenamiento y búsqueda.
 * Prioriza el guión explícito (ej. maestro Excel: 10718635-2).
 * @returns {{ rut_normalizado: string, rut_numero: string, rut_dv: string } | null}
 */
function normalizeRutParts(input) {
  const hyphenated = rutPartsFromHyphenated(input);
  if (hyphenated) return hyphenated;

  const raw = rutQuitarFormato(input);
  if (!raw) return null;

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

  if (/^\d{7,8}$/.test(raw)) {
    const numero = raw;
    const dv = rutDvEsperado(numero);
    return {
      rut_normalizado: `${numero}${dv}`,
      rut_numero: numero,
      rut_dv: dv,
    };
  }

  return null;
}

function formatearRut(rut) {
  const parts =
    typeof rut === 'object' && rut?.rut_numero && rut?.rut_dv
      ? { rut_numero: String(rut.rut_numero), rut_dv: String(rut.rut_dv).toUpperCase() }
      : normalizeRutParts(rut);
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
  formatearRut,
  rutMatchesQuery,
};
