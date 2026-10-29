/**
 * SOLO LECTURA: verifica que el maestro completo (migración 028) quedó guardado.
 * Uso: node scripts/verificar-maestro-lme.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

async function main() {
  const r = await db.query(`
    SELECT p.anio, p.mes, p.nombre_archivo,
           COUNT(*)::int AS registros,
           COUNT(mr.monto_imponible)::int AS con_monto_imponible,
           COUNT(mr.haberes)::int AS con_haberes,
           COUNT(mr.dias_trabajados)::int AS con_dias,
           COUNT(mr.fecha_ingreso)::int AS con_fecha_ingreso,
           COUNT(*) FILTER (WHERE mr.jubilado)::int AS jubilados,
           COUNT(mr.ubicacion)::int AS con_ubicacion
    FROM personal_maestro_remuneraciones mr
    JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
    WHERE p.anio = 2026 AND p.mes BETWEEN 7 AND 9
    GROUP BY p.anio, p.mes, p.nombre_archivo
    ORDER BY p.mes`);
  console.table(r.rows);

  const t = await db.query(`
    SELECT p.mes, mr.monto_imponible, mr.dias_trabajados, mr.fecha_ingreso::text AS fecha_ingreso,
           mr.jubilado, mr.ubicacion,
           (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(mr.haberes) k) AS codigos_haber
    FROM personal_maestro_remuneraciones mr
    JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
    WHERE mr.rut_normalizado = '160358866' AND p.anio = 2026 AND p.mes BETWEEN 7 AND 9
    ORDER BY p.mes`);
  console.log('\nRUT de prueba 16.035.886-6:');
  console.table(t.rows);
  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
