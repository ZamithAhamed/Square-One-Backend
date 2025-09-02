import { Router } from 'express';
import { pool } from '../db.js';
import { z } from 'zod';

const router = Router({ mergeParams: true }); // Ensure parent router uses '/patients/:id/notes'

/** GET /patients/:id/notes */
interface PatientParams {
  id: string;
}

router.get<PatientParams>('/', async (req, res, next) => {
  try {
    const pid = Number(req.params.id);
    const [rows] = await pool.query<any[]>(
      `SELECT n.* FROM patient_note n WHERE n.patient_id = ? ORDER BY n.created_at DESC`, [pid]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

const NoteBody = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  author_user_id: z.number().int().optional()
});

/** POST /patients/:id/notes */
router.post<PatientParams>('/', async (req, res, next) => {
  try {
    const pid = Number(req.params.id);
    const body = NoteBody.parse(req.body);
    const [result] = await pool.query<any>(
      `INSERT INTO patient_note (patient_id, title, content, author_user_id)
       VALUES (?,?,?,?)`,
      [pid, body.title, body.content || null, body.author_user_id || null]
    );
    const id = result.insertId;
    const [rows] = await pool.query<any[]>(`SELECT * FROM patient_note WHERE id=?`, [id]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/** PUT /patients/:id/notes/:noteId */
router.put('/:noteId', async (req, res, next) => {
  try {
    const pid = Number((req.params as any).id); // TypeScript workaround for missing type
    const nid = Number(req.params.noteId);
    const body = NoteBody.partial().parse(req.body);
    await pool.query(
      `UPDATE patient_note
       SET title=COALESCE(?,title), content=?, author_user_id=?
       WHERE id=? AND patient_id=?`,
      [body.title ?? null, body.content ?? null, body.author_user_id ?? null, nid, pid]
    );
    const [rows] = await pool.query<any[]>(`SELECT * FROM patient_note WHERE id=? AND patient_id=?`, [nid, pid]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/** DELETE /patients/:id/notes/:noteId */
router.delete<{ id: string; noteId: string }>('/:noteId', async (req, res, next) => {
  try {
    const pid = Number(req.params.id);
    const nid = Number(req.params.noteId);
    await pool.query(`DELETE FROM patient_note WHERE id=? AND patient_id=?`, [nid, pid]);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
