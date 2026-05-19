const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

/** Listado unificado de ubicaciones de archivo físico (expedientes/compras archivados). */
router.get('/', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let query = `SELECT
      id,
      numero AS numero_expediente,
      descripcion,
      caja AS numero_caja,
      estante,
      posicion,
      sala AS sala_bodega,
      fecha_archivo,
      archivado_por AS registrado_por,
      created_at AS creado_en,
      'expediente' AS modulo_origen
      FROM expedientes
      WHERE caja IS NOT NULL AND trim(caja) <> ''`;
    const params = [];
    if (q) {
      query += ` AND (
        numero ILIKE $1 OR descripcion ILIKE $1 OR caja ILIKE $1
        OR estante ILIKE $1 OR COALESCE(sala,'') ILIKE $1
      )`;
      params.push(`%${q}%`);
    }
    query += ' ORDER BY fecha_archivo DESC NULLS LAST, created_at DESC';
    const exps = await db.query(query, params);

    let rem = { rows: [] };
    try {
      rem = await db.query(
        `SELECT
          id,
          periodo AS numero_expediente,
          descripcion,
          caja AS numero_caja,
          estante,
          posicion,
          sala AS sala_bodega,
          fecha_archivo,
          archivado_por AS registrado_por,
          created_at AS creado_en,
          'remuneraciones' AS modulo_origen
         FROM remuneraciones_periodos
         WHERE caja IS NOT NULL AND trim(caja) <> ''
         ORDER BY fecha_archivo DESC NULLS LAST`
      );
    } catch {
      rem = { rows: [] };
    }

    let tabla = { rows: [] };
    try {
      tabla = await db.query('SELECT * FROM archivo_fisico ORDER BY created_at DESC LIMIT 500');
    } catch {
      tabla = { rows: [] };
    }

    res.json({
      expedientes: exps.rows,
      remuneraciones: rem.rows,
      registros: tabla.rows,
      total: exps.rows.length + rem.rows.length + tabla.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const row = await db.query('SELECT * FROM archivo_fisico WHERE id=$1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(row.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const {
      numero_expediente,
      descripcion,
      numero_caja,
      estante,
      posicion,
      sala_bodega,
      fecha_archivo,
      modulo_origen,
      referencia_id,
    } = req.body;
    if (!numero_expediente || !numero_caja) {
      return res.status(400).json({ error: 'Número de expediente y caja son obligatorios' });
    }
    const result = await db.query(
      `INSERT INTO archivo_fisico (numero_expediente, descripcion, numero_caja, estante, posicion, sala_bodega, fecha_archivo, registrado_por, modulo_origen, referencia_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        String(numero_expediente).trim(),
        descripcion || null,
        String(numero_caja).trim(),
        estante || null,
        posicion || null,
        sala_bodega || null,
        fecha_archivo || null,
        req.user.login,
        modulo_origen || null,
        referencia_id || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const fields = ['numero_expediente', 'descripcion', 'numero_caja', 'estante', 'posicion', 'sala_bodega', 'fecha_archivo'];
    const updates = [];
    const params = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        params.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const result = await db.query(
      `UPDATE archivo_fisico SET ${updates.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    await db.query('DELETE FROM archivo_fisico WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
