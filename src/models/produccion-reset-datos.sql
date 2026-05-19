-- Borra TODOS los datos operativos y usuarios. No elimina tablas ni esquema.
-- Ejecutar solo en producción cuando quieras empezar limpio (Opción A).

TRUNCATE TABLE
  solicitudes_historial,
  solicitudes_documentos,
  solicitudes,
  historial,
  documentos,
  expedientes,
  contratos_pagos_docs,
  contratos_historial,
  contratos_pagos,
  contratos_documentos,
  contratos,
  correspondencia,
  usuarios
RESTART IDENTITY CASCADE;
