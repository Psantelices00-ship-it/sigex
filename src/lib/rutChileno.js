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

function validarRutChileno(rut) {
  const limpio = rutQuitarFormato(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const dv = limpio.slice(-1);
  const cuerpo = limpio.slice(0, -1);
  return rutDvEsperado(cuerpo) === dv;
}

/**
 * Normaliza RUT para almacenamiento y búsqueda.
 * Acepta con/sin puntos, guion y con/sin DV.
 * @returns {{ rut_normalizado: string, rut_numero: string, rut_dv: string } | null}
 */
function normalizeRutParts(input) {
  const raw = rutQuitarFormato(input);
  if (!raw) return null;

  let numero;
  let dv;

  if (/^\d{7,8}$/.test(raw)) {
    numero = raw;
    dv = rutDvEsperado(numero);
  } else if (/^\d{7,8}[0-9K]$/.test(raw)) {
    numero = raw.slice(0, -1);
    dv = raw.slice(-1);
    if (rutDvEsperado(numero) !== dv) return null;
  } else {
    return null;
  }

  return {
    rut_normalizado: `${numero}${dv}`,
    rut_numero: numero,
    rut_dv: dv,
  };
}

function formatearRut(rut) {
  const parts = normalizeRutParts(rut);
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
