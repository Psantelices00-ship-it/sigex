const XLSX = require('xlsx');
const { normalizeRutParts, formatearRut } = require('./rutChileno');

/** Catálogo mínimo AFP / salud para validar carga (normalizado, sin acentos). */
const AFP_VALIDAS = new Set(
  [
    'AFP CAPITAL',
    'AFP HABITAT',
    'AFP PROVIDA',
    'AFP CUPRUM',
    'AFP PLANVITAL',
    'AFP MODELO',
    'AFP UNO',
    'IPS',
    'INP',
    'IPS / INP',
  ].map(normTexto)
);

const SALUD_VALIDAS = new Set(
  [
    'FONASA',
    'ISAPRE BANMEDICA',
    'BANMEDICA',
    'ISAPRE COLMENA',
    'COLMENA',
    'ISAPRE CONSALUD',
    'CONSALUD',
    'ISAPRE CRUZ BLANCA',
    'CRUZ BLANCA',
    'NUEVA MASVIDA',
    'ISAPRE NUEVA MASVIDA',
    'ISAPRE VIDA TRES',
    'VIDA TRES',
  ].map(normTexto)
);

function normTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function numeroCelda(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Monto: acepta número de Excel o texto "641.239" / "641239". */
function montoCelda(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return numeroCelda(v);
}

function enteroCelda(v) {
  const n = montoCelda(v);
  return n == null ? null : Math.round(n);
}

function siNoCelda(v) {
  const s = normTexto(v);
  if (!s) return null;
  if (['SI', 'S', 'TRUE', '1'].includes(s)) return true;
  if (['NO', 'N', 'FALSE', '0'].includes(s)) return false;
  return null;
}

/** Fecha a ISO (YYYY-MM-DD): acepta Date de Excel o texto dd/mm/aaaa. */
function fechaCelda(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 1 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** Haberes del mes distintos de 0: columnas "H001 SUELDOS", "H123 Art 13 ...", etc. */
function haberesDeFila(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const m = String(k).trim().match(/^(H\d{3})\s+(.*)$/);
    if (!m) continue;
    const monto = montoCelda(v);
    if (monto == null || monto === 0) continue;
    out[m[1]] = { glosa: m[2].trim(), monto };
  }
  return Object.keys(out).length ? out : null;
}

function pickCol(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return row[k];
    }
  }
  // Encabezados con encoding raro (Ubicaci?n) o espacios
  const keyList = Object.keys(row);
  for (const want of keys) {
    const found = keyList.find((k) => normTexto(k) === normTexto(want));
    if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== '') {
      return row[found];
    }
  }
  return null;
}

function pareceRutONumero(v) {
  const s = String(v || '').replace(/\./g, '').trim();
  return /^\d{6,8}(-[\dkK])?$/.test(s) || /^\d{6,9}$/.test(s);
}

function esAfpValida(v) {
  if (!v || pareceRutONumero(v)) return false;
  const n = normTexto(v);
  if (AFP_VALIDAS.has(n)) return true;
  return n.startsWith('AFP ') || n.includes('IPS') || n.includes('INP');
}

function esSaludValida(v) {
  if (!v || pareceRutONumero(v)) return false;
  const n = normTexto(v);
  if (SALUD_VALIDAS.has(n)) return true;
  return n.includes('FONASA') || n.includes('ISAPRE') || n.includes('COLMENA') || n.includes('BANMEDICA');
}

/**
 * Parsea maestro de remuneraciones (Excel).
 * AFP ← nombreafp (NUNCA __EMPTY: esa columna vacía trae el RUT sin DV).
 * Salud ← salud (texto FONASA/Isapre).
 * Sueldos / seg. cesantía: acepta nombres clásicos y prefijo H0xx (sep/2026+).
 *
 * @param {Buffer} buffer
 * @returns {{ rows: object[], errores: object[], total: number, duplicados_omitidos: number, advertencias: object[] }}
 */
function parseMaestroRemuneracionesExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Algunos archivos (ej. MAESTRO_ AGOSTO) traen una fila de títulos antes del header real.
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  let headerRow = 0;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i].map((c) => String(c || '').toLowerCase());
    if (row.includes('nombre') && row.includes('rut')) {
      headerRow = i;
      break;
    }
  }
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow });
  const rows = [];
  const errores = [];
  const advertencias = [];
  const porRut = new Map();

  raw.forEach((row, idx) => {
    const linea = headerRow + idx + 2;
    const rutRaw = pickCol(row, 'rut', 'RUT', 'Rut');
    const parts = normalizeRutParts(rutRaw);
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw || ''), error: 'RUT inválido' });
      return;
    }

    // Columnas correctas del maestro (mayo OK / sep+ con H0xx en haberes).
    const fondoRaw = pickCol(row, 'nombreafp', 'AFP', 'afp', 'Fondo_AFP', 'Fondo', 'fondo');
    const saludRaw = pickCol(row, 'salud', 'Institucion_Salud', 'institucion_salud', 'Salud');
    // Nunca usar __EMPTY / __EMPTY_1: en este layout es el RUT numérico tras "horatraso".

    const fondo = fondoRaw != null ? String(fondoRaw).trim() : null;
    const salud = saludRaw != null ? String(saludRaw).trim() : null;

    const filaErrores = [];
    if (!fondo || !esAfpValida(fondo)) {
      filaErrores.push(
        `AFP/fondo inválido o no está en catálogo: ${JSON.stringify(fondo || '')} (¿se leyó RUT u otra columna?)`
      );
    }
    if (!salud || !esSaludValida(salud)) {
      filaErrores.push(
        `Salud inválida o no está en catálogo: ${JSON.stringify(salud || '')} (¿se leyó RUT u otra columna?)`
      );
    }

    if (filaErrores.length) {
      for (const error of filaErrores) {
        errores.push({
          linea,
          rut: formatearRut(parts.rut_normalizado),
          error,
          fondo_leido: fondo,
          salud_leida: salud,
        });
      }
      // No insertar fila con AFP/salud corruptos
      return;
    }

    const sueldos = numeroCelda(
      pickCol(row, 'SUELDOS', 'sueldos', 'H001 SUELDOS', 'H001SUELDOS')
    );
    const segCesantia = numeroCelda(
      pickCol(
        row,
        'SEG.CESANTIA EMP.',
        'SEG.CESANTIA EMP',
        'seg_cesantia_emp',
        'H099 SEG.CESANTIA EMP.',
        'H099 SEG.CESANTIA EMP'
      )
    );
    const imposiciones = numeroCelda(
      pickCol(row, 'Imposiciones', 'imposiciones', '  IMPOSICIONES', 'IMPOSICIONES')
    );

    if (sueldos == null) {
      advertencias.push({
        linea,
        rut: formatearRut(parts.rut_normalizado),
        advertencia: 'Sin monto SUELDOS / H001 SUELDOS',
      });
    }

    porRut.set(parts.rut_normalizado, {
      linea,
      rut_normalizado: parts.rut_normalizado,
      rut_display: formatearRut(parts.rut_normalizado),
      nombre: String(pickCol(row, 'nombre', 'NOMBRE') || '').trim(),
      fondo,
      salud,
      tipo_contrato:
        String(pickCol(row, 'Tipo_de_Contrato', 'tipocontrato', 'tipo_contrato') || '').trim() || null,
      planta: String(pickCol(row, 'planta', 'Planta') || '').trim() || null,
      cargo_especifico: String(pickCol(row, 'Cargo_Especifico', 'cargo') || '').trim() || null,
      ubicacion:
        String(pickCol(row, 'Ubicación', 'Ubicacion', 'Ubicaci?n', 'ubicacion') || '').trim() || null,
      imposiciones,
      seg_cesantia_emp: segCesantia,
      sueldos,
      // --- Campos adicionales para el paquete LME (migración 028) ---
      fecha_ingreso: fechaCelda(pickCol(row, 'fechaing', 'Fecha_Ingreso', 'fecha_ingreso')),
      // Migración 029
      fecha_documento: fechaCelda(pickCol(row, 'Fecha_Documento', 'fecha_documento')),
      fecha_fin: fechaCelda(pickCol(row, 'fechafin', 'Fecha_Fin', 'fecha_fin')),
      jubilado: siNoCelda(pickCol(row, 'Jubilado', 'jubilado')),
      cotiza_desahucio: siNoCelda(pickCol(row, 'cotizadesahucio', 'Cotiza_Desahucio')),
      dias_trabajados: enteroCelda(pickCol(row, 'Dias_Trab', 'dias_trab', 'Dias_Trabajados')),
      monto_imponible: montoCelda(pickCol(row, 'MONTO IMPONIBLE', 'Monto_Imponible', 'monto_imponible')),
      monto_imp_desahucio: montoCelda(
        pickCol(row, 'MONTO IMP.DESAHUCIO', 'Monto_Imp_Desahucio', 'monto_imp_desahucio')
      ),
      total_haberes: montoCelda(pickCol(row, 'TOTAL HABERES', 'Total_Haberes', 'total_haberes')),
      haberes: haberesDeFila(row),
    });
  });

  rows.push(...porRut.values());

  return {
    rows,
    errores,
    advertencias,
    total: raw.length,
    duplicados_omitidos: Math.max(0, raw.length - rows.length - errores.length),
  };
}

module.exports = {
  parseMaestroRemuneracionesExcel,
  esAfpValida,
  esSaludValida,
  normTexto,
};
