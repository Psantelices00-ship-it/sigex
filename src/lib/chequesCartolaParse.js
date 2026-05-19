/**
 * Parser heurístico para texto extraído de cartolas tipo Banco de Chile.
 */

function isMontoChileno(tok) {
  return typeof tok === 'string' && /^\d{1,3}(\.\d{3})*$/.test(tok);
}

function isNroDocLikely(tok) {
  return typeof tok === 'string' && /^\d{6,9}$/.test(tok);
}

function ignoraCabeceraPie(linea) {
  const s = linea.trim();
  if (!s) return true;
  if (/^infórmese sobre la garantía/i.test(s)) return true;
  if (/©\s*\d{4}\s*banco de chile/i.test(s)) return true;
  if (/^movimientos al\s+/i.test(s)) return true;
  if (/^fecha\s+descripción/i.test(s)) return true;
  if (/saldo disponible|^total cargos|^total abonos|^nombre empresa:|^cuenta n°|^rut:/i.test(s)) return true;
  if (/--\s*\d+\s+of\s+\d+\s+--/.test(s)) return true;
  return false;
}

function bloquesPorMovimiento(texto) {
  const lineas = texto.split(/\n/).map((l) => l.replace(/\u00a0/g, ' ').trim());
  const bloques = [];
  let actual = [];
  const arrancaFecha = (x) => /^\d{2}\/\d{2}\/\d{4}\b/.test(x);
  for (const ln of lineas) {
    if (ignoraCabeceraPie(ln)) continue;
    if (arrancaFecha(ln)) {
      if (actual.length) bloques.push(actual.join('\n'));
      actual = [ln];
    } else if (actual.length) {
      actual.push(ln);
    }
  }
  if (actual.length) bloques.push(actual.join('\n'));
  return bloques;
}

function parseRestoLinea(prefijoRestoUnaLinea) {
  let tokens = prefijoRestoUnaLinea.trim().replace(/\s+/g, ' ').split(' ');
  if (tokens.length < 2) return null;
  const saldo = tokens.pop();
  if (!isMontoChileno(saldo)) return null;
  let abono = null;
  let cargo = null;
  if (tokens.length && isMontoChileno(tokens[tokens.length - 1])) {
    cargo = tokens.pop();
    if (tokens.length && isMontoChileno(tokens[tokens.length - 1])) {
      abono = cargo;
      cargo = tokens.pop();
    }
  }
  let nro_documento = null;
  if (tokens.length && isNroDocLikely(tokens[tokens.length - 1])) {
    nro_documento = tokens.pop();
  }
  const descripcion = tokens.join(' ').trim();
  return { descripcion, nro_documento, cargo, abono, saldo };
}

function parseUnBloque(bloque) {
  const m = bloque.match(/^(\d{2}\/\d{2}\/\d{4})\s+([\s\S]+)$/);
  if (!m) return null;
  const fecha = m[1];
  const restMultiline = m[2];
  const restoUnaLinea = restMultiline
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const alt = parseRestoLinea(restoUnaLinea);
  if (!alt || !alt.descripcion) return null;
  const es_cheque = /cheque/i.test(alt.descripcion) || /cheque/i.test(restMultiline);
  const cargoNum = alt.cargo ? parseInt(String(alt.cargo).replace(/\./g, ''), 10) : null;
  return {
    fecha,
    descripcion: alt.descripcion.slice(0, 500),
    nro_documento: alt.nro_documento,
    cargo_fmt: alt.cargo,
    abono_fmt: alt.abono,
    saldo_fmt: alt.saldo,
    cargo_aprox: Number.isFinite(cargoNum) ? cargoNum : null,
    es_cheque,
  };
}

function parsearMovimientosCartolaPdfTexto(textoPlanoPdf) {
  const bloques = bloquesPorMovimiento(textoPlanoPdf);
  const out = [];
  for (const b of bloques) {
    const mov = parseUnBloque(b);
    if (mov) out.push(mov);
  }
  return out;
}

function movimientosChequeDeCartola(movs) {
  return (movs || []).filter((m) => m.es_cheque && m.nro_documento);
}

module.exports = {
  parsearMovimientosCartolaPdfTexto,
  movimientosChequeDeCartola,
};
