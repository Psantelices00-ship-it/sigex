/** Normaliza código de cuenta contable (ej. 22.1.1.1 → 22.01.001.001). */
function normalizeCodigoCuenta(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().replace(/\s+/g, '')
  if (!s) return null
  const parts = s.split(/[.\-/]/).filter(Boolean)
  if (!parts.length) return null
  const out = [String(parts[0]).replace(/\D/g, '').padStart(2, '0').slice(-2)]
  for (let i = 1; i < parts.length; i++) {
    const digits = String(parts[i]).replace(/\D/g, '')
    if (!digits) continue
    if (i === 1) out.push(digits.padStart(2, '0').slice(-2))
    else out.push(digits.padStart(3, '0').slice(-3))
  }
  return out.join('.')
}

function buildCodigoCuenta(subtitulo, item, asig, sasig, subasig) {
  const parts = []
  const sub = String(subtitulo || '').trim()
  if (!sub) return null
  parts.push(sub.padStart(2, '0').slice(-2))
  const seg = [
    [item, 2],
    [asig, 3],
    [sasig, 3],
    [subasig, 3],
  ]
  for (const [val, width] of seg) {
    const t = String(val ?? '').trim()
    if (!t) break
    const digits = t.replace(/\D/g, '')
    if (!digits) break
    parts.push(digits.padStart(width, '0').slice(-width))
  }
  return parts.join('.')
}

/** Cuenta imputable en compras: al menos subtítulo + ítem + asignación. */
function esCuentaImputable(item, asig) {
  return !!String(item ?? '').trim() && !!String(asig ?? '').trim()
}

/** Valores del Excel vienen en miles de pesos (M$). */
function milesAPesos(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1000)
}

module.exports = {
  normalizeCodigoCuenta,
  buildCodigoCuenta,
  esCuentaImputable,
  milesAPesos,
}
