import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/** GET /lookups/patients?query=  -> for dropdowns */
router.get('/patients', async (req, res, next) => {
  try {
    const q = String(req.query.query || '').trim();
    const where = q ? `WHERE name LIKE ? OR patient_code LIKE ?` : '';
    const args = q ? [`%${q}%`, `%${q}%`] : [];
    const [rows] = await pool.query<any[]>(
      `SELECT id, patient_code, name FROM patient ${where} ORDER BY name ASC LIMIT 200`, args
    );
    res.json(rows.map(r => ({ id: r.id, label: `${r.name} (${r.patient_code})` })));
  } catch (e) { next(e); }
});

export default router;
