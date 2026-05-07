const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Listar todos
router.get('/', auth, async (req, res) => {
  try {
    const { estado, area, prioridad, q } = req.query;
    let query = `SELECT e.*, 
      (SELECT COUNT(*) FROM documentos d WHERE d.expediente_id = e.id) as total_docs
      FROM expedientes e WHERE 1=1`;
    const params = [];
    let i = 1;
    if (estado) { query += ` AND e.estado = $${i++}`; params.push(estado); }
    if (area)   { query += ` AND e.area = $${i++}`;   params.push(area); }
    if (prioridad) { query += ` AND e.prioridad = $${i++}`; params.push(prioridad); }
    if (q) { query += ` AND (e.numero ILIKE $${i} OR e.descripcion ILIKE $${i} OR e.solicitante ILIKE $${i})`; params.push(`%${q}%`); i++; }
    query += ' ORDER BY e.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener uno
router.get('/:id', auth, async (req, res) => {
  try {
    const exp = await db.query('SELECT * FROM expedientes WHERE id = $1', [req.params.id]);
    if (!exp.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query('SELECT * FROM documentos WHERE expediente_id = $1 ORDER BY created_at', [req.params.id]);
    const hist = await db.query('SELECT * FROM historial WHERE expediente_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ...exp.rows[0], documentos: docs.rows, historial: hist.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear
router.post('/', auth, async (req, res) => {
  try {
    const { descripcion, solicitante, area, tipo_gasto, monto, prioridad, fecha_ingreso, observaciones } = req.body;
    const year = new Date().getFullYear();
    const count = await db.query("SELECT COUNT(*) FROM expedientes WHERE EXTRACT(YEAR FROM created_at) = $1", [year]);
    const numero = `EXP-${year}-${String(parseInt(count.rows[0].count) + 1).padStart(5, '0')}`;
    const result = await db.query(
      `INSERT INTO expedientes (numero, descripcion, solicitante, area, tipo_gasto, monto, prioridad, estado, fecha_ingreso, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Ingresado',$8,$9,$10) RETURNING *`,
      [numero, descripcion, solicitante, area, tipo_gasto, monto || 0, prioridad || 'Normal', fecha_ingreso || new Date(), observaciones, req.user.login]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [result.rows[0].id, req.user.login, 'Expediente creado', 'Estado inicial: Ingresado', 'creacion']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cambiar estado
router.patch('/:id/estado', auth, async (req, res) => {
  try {
    const { estado, comentario } = req.body;
    const prev = await db.query('SELECT estado FROM expedientes WHERE id = $1', [req.params.id]);
    await db.query('UPDATE expedientes SET estado = $1, updated_at = NOW() WHERE id = $2', [estado, req.params.id]);
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Cambio de estado', `${prev.rows[0].estado} → ${estado}${comentario ? ' · ' + comentario : ''}`, 'estado']
    );
    res.json({ ok: true, estado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registrar archivo físico
router.patch('/:id/archivo', auth, async (req, res) => {
  try {
    const { caja, estante, posicion, sala, fecha_archivo, obs_archivo } = req.body;
    await db.query(
      'UPDATE expedientes SET caja=$1, estante=$2, posicion=$3, sala=$4, fecha_archivo=$5, obs_archivo=$6, archivado_por=$7, updated_at=NOW() WHERE id=$8',
      [caja, estante, posicion, sala, fecha_archivo, obs_archivo, req.user.login, req.params.id]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Archivo físico registrado', `Caja ${caja} · Estante ${estante}${sala ? ' · ' + sala : ''}`, 'archivo']
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    await db.query('DELETE FROM documentos WHERE expediente_id = $1', [req.params.id]);
    await db.query('DELETE FROM historial WHERE expediente_id = $1', [req.params.id]);
    await db.query('DELETE FROM expedientes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
