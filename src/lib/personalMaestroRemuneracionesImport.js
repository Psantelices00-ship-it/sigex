const db = require('../db');

/** Columnas base (siempre existen). */
const COLS_BASE = [
  'periodo_id',
  'funcionario_id',
  'rut_normalizado',
  'fondo',
  'salud',
  'tipo_contrato',
  'imposiciones',
  'seg_cesantia_emp',
  'sueldos',
];

/**
 * Columnas opcionales por migración. Cada grupo se guarda solo si su migración ya se aplicó;
 * si no, se importa como antes, sin romper nada.
 */
const GRUPOS_EXT = [
  {
    migracion: '028',
    cols: [
      'nombre',
      'planta',
      'cargo_especifico',
      'ubicacion',
      'fecha_ingreso',
      'jubilado',
      'cotiza_desahucio',
      'dias_trabajados',
      'monto_imponible',
      'monto_imp_desahucio',
      'total_haberes',
      'haberes',
    ],
  },
  { migracion: '029', cols: ['fecha_documento', 'fecha_fin'] },
];

function valorColumna(col, row) {
  if (col === 'haberes') return row.haberes ? JSON.stringify(row.haberes) : null;
  if (col === 'nombre') return row.nombre || null;
  return row[col] ?? null;
}

/** Columnas extendidas que existen hoy en la tabla (por grupos completos). */
async function columnasExtendidasDisponibles() {
  const todas = GRUPOS_EXT.flatMap((g) => g.cols);
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'personal_maestro_remuneraciones' AND column_name = ANY($1)`,
    [todas]
  );
  const existentes = new Set(r.rows.map((x) => x.column_name));
  const cols = [];
  const migraciones = [];
  for (const g of GRUPOS_EXT) {
    if (g.cols.every((c) => existentes.has(c))) {
      cols.push(...g.cols);
      migraciones.push(g.migracion);
    }
  }
  return { cols, migraciones };
}

/**
 * @param {object} opts
 * @param {object[]} opts.rows parsed rows from parseMaestroRemuneracionesExcel
 * @param {number} opts.mes
 * @param {number} opts.anio
 * @param {string} opts.nombreArchivo
 * @param {string} opts.usuarioLogin
 */
async function importarMaestro(opts) {
  const { rows, mes, anio, nombreArchivo, usuarioLogin } = opts;
  if (!rows?.length) throw new Error('Sin filas para importar');

  const ext = await columnasExtendidasDisponibles();
  const columnas = [...COLS_BASE, ...ext.cols];

  const funcRows = await db.query('SELECT id, rut_normalizado FROM personal_funcionarios');
  const funcByRut = new Map(funcRows.rows.map((r) => [r.rut_normalizado, r.id]));

  const ex = await db.query(
    'SELECT id FROM personal_maestro_remuneraciones_periodos WHERE mes = $1 AND anio = $2',
    [mes, anio]
  );

  let periodoId;
  if (ex.rows.length) {
    periodoId = ex.rows[0].id;
    await db.query('DELETE FROM personal_maestro_remuneraciones WHERE periodo_id = $1', [periodoId]);
    await db.query(
      `UPDATE personal_maestro_remuneraciones_periodos
       SET nombre_archivo = $1, cargado_por = $2, total_registros = 0 WHERE id = $3`,
      [nombreArchivo, usuarioLogin, periodoId]
    );
  } else {
    const ins = await db.query(
      `INSERT INTO personal_maestro_remuneraciones_periodos (mes, anio, nombre_archivo, cargado_por)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [mes, anio, nombreArchivo, usuarioLogin]
    );
    periodoId = ins.rows[0].id;
  }

  const CHUNK = 200;
  let registros = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      const vals = [
        periodoId,
        funcByRut.get(row.rut_normalizado) || null,
        row.rut_normalizado,
        row.fondo,
        row.salud,
        row.tipo_contrato,
        row.imposiciones,
        row.seg_cesantia_emp,
        row.sueldos,
        ...ext.cols.map((c) => valorColumna(c, row)),
      ];
      values.push(`(${vals.map(() => `$${p++}`).join(', ')})`);
      params.push(...vals);
    }
    await db.query(
      `INSERT INTO personal_maestro_remuneraciones (${columnas.join(', ')})
       VALUES ${values.join(', ')}`,
      params
    );
    registros += chunk.length;
  }

  await db.query(
    'UPDATE personal_maestro_remuneraciones_periodos SET total_registros = $1 WHERE id = $2',
    [registros, periodoId]
  );

  return {
    periodo_id: periodoId,
    registros,
    maestro_completo: ext.migraciones.includes('028'),
    migraciones_aplicadas: ext.migraciones,
  };
}

module.exports = { importarMaestro };
