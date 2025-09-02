import { Router } from 'express';
import { pool } from '../db.js';
import { z } from 'zod';

const router = Router();

/** GET /patients?query=&page=1&limit=20 */
router.get('/', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;

    const where =
      query
        ? `WHERE p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ? OR p.patient_code LIKE ?`
        : '';
    const args = query ? Array(4).fill(`%${query}%`) : [];

    const [rows] = await pool.query<any[]>(
      `SELECT SQL_CALC_FOUND_ROWS
         p.id, p.patient_code, p.name, p.email, p.phone, p.gender, p.dob,
         p.blood_type, p.allergies, p.medical_info, p.active, p.last_visit_at,
         p.created_at, p.updated_at
       FROM patient p
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [countRows] = await pool.query<any[]>('SELECT FOUND_ROWS() as total');
    res.json({ data: rows, page, limit, total: countRows[0].total });
  } catch (e) { next(e); }
});

/** GET /patients/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query<any[]>(`SELECT * FROM patient WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

const PatientBody = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  gender: z.enum(['male','female','other']).optional(),
  dob: z.string().optional(), // YYYY-MM-DD
  blood_type: z.enum(['A+','A-','B+','B-','AB+','AB-','O+','O-']).optional(),
  allergies: z.string().optional(),
  medical_info: z.string().optional(),
  active: z.boolean().optional()
});

/** POST /patients */
router.post('/', async (req, res, next) => {
  try {
    const body = PatientBody.parse(req.body);
    const [result] = await pool.query<any>(
      `INSERT INTO patient (name,email,phone,gender,dob,blood_type,allergies,medical_info,active)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        body.name, body.email || null, body.phone || null, body.gender || null,
        body.dob || null, body.blood_type || null, body.allergies || null,
        body.medical_info || null, body.active ?? 1
      ]
    );
    const id = result.insertId;
    const [rows] = await pool.query<any[]>(`SELECT * FROM patient WHERE id=?`, [id]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/** PUT /patients/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = PatientBody.partial().parse(req.body);
    await pool.query(
      `UPDATE patient SET
         name=COALESCE(?,name),
         email=?,
         phone=?,
         gender=?,
         dob=?,
         blood_type=?,
         allergies=?,
         medical_info=?,
         active=COALESCE(?,active)
       WHERE id=?`,
      [
        body.name ?? null,
        body.email ?? null,
        body.phone ?? null,
        body.gender ?? null,
        body.dob ?? null,
        body.blood_type ?? null,
        body.allergies ?? null,
        body.medical_info ?? null,
        body.active ?? null,
        id
      ]
    );
    const [rows] = await pool.query<any[]>(`SELECT * FROM patient WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/** DELETE /patients/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM patient WHERE id=?`, [id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
