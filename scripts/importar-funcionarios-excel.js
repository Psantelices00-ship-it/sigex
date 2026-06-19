#!/usr/bin/env node
/**
 * Importa funcionarios desde Excel (misma lógica que POST /importaciones/funcionarios-excel).
 * Uso:
 *   node scripts/importar-funcionarios-excel.js "/ruta/BASE DE DATOS FUNCIONARIOS.xlsx"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { parseFuncionariosExcel } = require('../src/lib/personalFuncionariosExcel');

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Uso: node scripts/importar-funcionarios-excel.js <archivo.xlsx>');
  process.exit(1);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error('No existe:', filePath);
  process.exit(1);
}

async function main() {
  const inicio = Date.now();
  console.log('SIGEX — importación Excel funcionarios');
  console.log('Archivo:', filePath);
  console.log('');

  const buffer = fs.readFileSync(filePath);
  const { rows, errores: erroresParseo } = parseFuncionariosExcel(buffer);
  console.log(`Filas válidas: ${rows.length} · Errores parseo: ${erroresParseo.length}`);

  const imp = await db.query(
    `INSERT INTO personal_importaciones (tipo, estado, usuario_login) VALUES ('funcionarios_excel', 'procesando', 'script_cli') RETURNING id`
  );
  const importId = imp.rows[0].id;

  let creados = 0;
  let actualizados = 0;
  const errores = [...erroresParseo];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const exist = await db.query('SELECT id FROM personal_funcionarios WHERE rut_normalizado = $1', [
        row.rut_normalizado,
      ]);
      if (exist.rows.length) {
        await db.query(
          `UPDATE personal_funcionarios SET
            nombre_completo = $1, tipo_funcionario = $2, planta = $3, ubicacion = $4,
            fecha_ingreso = COALESCE($5, fecha_ingreso), fecha_nacimiento = COALESCE($6, fecha_nacimiento),
            profesion = COALESCE($7, profesion), tipo_contrato = COALESCE($8, tipo_contrato),
            updated_at = NOW(), updated_by = 'script_cli'
           WHERE id = $9`,
          [
            row.nombre_completo,
            row.tipo_funcionario,
            row.planta,
            row.ubicacion,
            row.fecha_ingreso,
            row.fecha_nacimiento,
            row.profesion,
            row.tipo_contrato,
            exist.rows[0].id,
          ]
        );
        actualizados++;
      } else {
        await db.query(
          `INSERT INTO personal_funcionarios
            (rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
             planta, ubicacion, fecha_ingreso, fecha_nacimiento, profesion, tipo_contrato, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'script_cli','script_cli')`,
          [
            row.rut_normalizado,
            row.rut_numero,
            row.rut_dv,
            row.nombre_completo,
            row.tipo_funcionario,
            row.planta,
            row.ubicacion,
            row.fecha_ingreso,
            row.fecha_nacimiento,
            row.profesion,
            row.tipo_contrato,
          ]
        );
        creados++;
      }
    } catch (e) {
      errores.push({ linea: row.linea, rut: row.rut_normalizado, error: e.message });
    }

    if ((i + 1) % 100 === 0 || i === rows.length - 1) {
      process.stdout.write(`\rProgreso: ${i + 1}/${rows.length} (+${creados} / ~${actualizados} act.)`);
    }
  }

  const resumen = {
    filas_leidas: rows.length + erroresParseo.length,
    filas_validas: rows.length,
    funcionarios_creados: creados,
    funcionarios_actualizados: actualizados,
    errores: errores.length,
    detalle_errores: errores.slice(0, 50),
    tiempo_ms: Date.now() - inicio,
    archivo: path.basename(filePath),
  };

  await db.query(
    `UPDATE personal_importaciones SET estado = 'completado', fin = NOW(), resumen_json = $2 WHERE id = $1`,
    [importId, JSON.stringify(resumen)]
  );

  const total = await db.query('SELECT COUNT(*)::int AS n FROM personal_funcionarios');
  console.log('\n\n--- Resumen ---');
  console.log(JSON.stringify(resumen, null, 2));
  console.log('\nTotal funcionarios en BD:', total.rows[0].n);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nError:', e.message || e);
  process.exit(1);
});
