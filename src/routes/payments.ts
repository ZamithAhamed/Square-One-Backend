import { Router } from 'express';
import { pool } from '../db.js';
import { z } from 'zod';
import { toCSV } from '../util/csv.js';
import { sendPaymentReceiptEmail } from '../utils/mailer';

const router = Router();

async function resolvePatientId(payload: any): Promise<number | null> {
  const toNum = (v: unknown) =>
    typeof v === 'number'
      ? v
      : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);

  const numeric =
    toNum(payload.patient_id) ??
    toNum(payload.patientId);

  if (typeof numeric === 'number' && Number.isInteger(numeric)) {
    return numeric;
  }

  // accept code in patient_code/patientCode OR accidental code placed in patient_id/patientId
  const code =
    payload.patient_code ??
    payload.patientCode ??
    (typeof payload.patient_id === 'string' && !/^\d+$/.test(payload.patient_id) ? payload.patient_id : undefined) ??
    (typeof payload.patientId === 'string' && !/^\d+$/.test(payload.patientId) ? payload.patientId : undefined);

  if (typeof code === 'string') {
    const [rows] = await pool.query<any[]>(
      'SELECT id FROM patient WHERE patient_code = ? LIMIT 1',
      [code]
    );
    if (rows.length) return rows[0].id as number;
    return null;
  }

  return null;
}

/** GET /payments?search=&method=&from=&to= */
router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const method = String(req.query.method || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const where: string[] = [];
    const args: any[] = [];

    if (search) {
      where.push(`(pmt.payment_code LIKE ? OR pat.name LIKE ? OR pat.patient_code LIKE ?)`);
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (method) { where.push(`pmt.method = ?`); args.push(method); }
    if (from) { where.push(`pmt.created_at >= ?`); args.push(`${from} 00:00:00`); }
    if (to)   { where.push(`pmt.created_at <= ?`); args.push(`${to} 23:59:59`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query<any[]>(
      `SELECT pmt.*, pat.name AS patient_name, pat.patient_code, ap.appt_code
       FROM payment pmt
       JOIN patient pat ON pat.id = pmt.patient_id
       LEFT JOIN appointment ap ON ap.id = pmt.appointment_id
       ${whereSql}
       ORDER BY pmt.created_at DESC
       LIMIT 1000`,
      args
    );
    res.json(rows);
  } catch (e) { next(e); }
});

/** GET /payments/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query<any[]>(
      `SELECT pmt.*, pat.name AS patient_name, pat.patient_code, ap.appt_code
       FROM payment pmt
       JOIN patient pat ON pat.id = pmt.patient_id
       LEFT JOIN appointment ap ON ap.id = pmt.appointment_id
       WHERE pmt.id=?`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

const PaymentBody = z.object({
  patient_id: z.string().optional(),
  appointment_id: z.number().int().nullable().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3).default('COP'),
  method: z.enum(['cash','card','online','bank-transfer']),
  status: z.enum(['paid','pending','failed','refunded']),
  description: z.string().optional(),
  transaction_ref: z.string().optional(),
  last4: z.string().length(4).optional()
});

/** POST /payments */

router.post('/', async (req, res, next) => {
  try {
    const body = PaymentBody.parse(req.body);

    const patientId = await resolvePatientId(body);
    if (!patientId) {
      return res.status(400).json({ error: { message: 'Invalid or missing patient identifier' } });
    }

    const [result] = await pool.query<any>(
      `INSERT INTO payment (patient_id,appointment_id,amount,currency,method,status,description,transaction_ref,last4)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        patientId,
        body.appointment_id ?? null,
        body.amount,
        body.currency,
        body.method,
        body.status,
        body.description || null,
        body.transaction_ref || null, // make sure your frontend sends `transaction_ref`
        body.last4 || null,
      ]
    );

    const id = result.insertId;

    // Get the just-created payment + patient details (including email)
    const [rows] = await pool.query<any[]>(
      `SELECT p.*,
              pat.name  AS patient_name,
              pat.patient_code,
              pat.email AS patient_email
         FROM payment p
         JOIN patient pat ON pat.id = p.patient_id
        WHERE p.id = ?`,
      [id]
    );

    const row = rows[0];

    // Try to send the email, but don't block the response if it fails
    let email_sent = false;
    try {
      if (row?.patient_email) {
        await sendPaymentReceiptEmail({
          to: row.patient_email,
          clinicName: process.env.CLINIC_NAME,
          paymentId: row.id,
          patientName: row.patient_name,
          patientCode: row.patient_code,
          amount: row.amount,
          currency: row.currency,
          method: row.method,
          last4: row.last4,
          transactionRef: row.transaction_ref,
          createdAt: row.created_at ?? Date.now(),
          appointmentId: row.appointment_id ?? null,
        });
        email_sent = true;
      }
    } catch (mailErr) {
      console.error('Failed to send payment receipt email:', mailErr);
    }

    res.status(201).json({ ...row, email_sent });
  } catch (e) {
    next(e);
  }
});


/** PUT /payments/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = PaymentBody.partial().parse(req.body);
    await pool.query(
      `UPDATE payment SET
         patient_id=COALESCE(?,patient_id),
         appointment_id=?,
         amount=COALESCE(?,amount),
         currency=COALESCE(?,currency),
         method=COALESCE(?,method),
         status=COALESCE(?,status),
         description=?,
         transaction_ref=?,
         last4=?
       WHERE id=?`,
      [
        body.patient_id ?? null,
        body.appointment_id ?? null,
        body.amount ?? null,
        body.currency ?? null,
        body.method ?? null,
        body.status ?? null,
        body.description ?? null,
        body.transaction_ref ?? null,
        body.last4 ?? null,
        id
      ]
    );
    const [rows] = await pool.query<any[]>(`SELECT * FROM payment WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/** PATCH /payments/:id/refund */
router.patch('/:id/refund', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`UPDATE payment SET status='refunded' WHERE id=?`, [id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

/** DELETE /payments/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM payment WHERE id=?`, [id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

/** GET /payments/export/csv */
router.get('/export/csv', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const method = String(req.query.method || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const where: string[] = [];
    const args: any[] = [];

    if (search) { where.push(`(pmt.payment_code LIKE ? OR pat.name LIKE ? OR pat.patient_code LIKE ?)`); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (method) { where.push(`pmt.method = ?`); args.push(method); }
    if (from) { where.push(`pmt.created_at >= ?`); args.push(`${from} 00:00:00`); }
    if (to)   { where.push(`pmt.created_at <= ?`); args.push(`${to} 23:59:59`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query<any[]>(
      `SELECT pmt.*, pat.name AS patient_name, pat.patient_code, ap.appt_code
       FROM payment pmt
       JOIN patient pat ON pat.id = pmt.patient_id
       LEFT JOIN appointment ap ON ap.id = pmt.appointment_id
       ${whereSql}
       ORDER BY pmt.created_at DESC`,
      args
    );

    const headers = ['Payment Code','Patient','Patient Code','Appointment Code','Date','Amount','Currency','Method','Status','Description'];
    const data = rows.map(r => [
      r.payment_code,
      r.patient_name,
      r.patient_code,
      r.appt_code || '',
      r.created_at.toISOString?.() || r.created_at,
      Number(r.amount).toFixed(2),
      r.currency,
      r.method,
      r.status,
      r.description || ''
    ]);

    const csv = toCSV(headers, data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
