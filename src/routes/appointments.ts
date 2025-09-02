import { Router } from 'express';
import { pool } from '../db';
import { z } from 'zod';
import { sendAppointmentConfirmationEmail } from '../utils/mailer';
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '../config/env';
import { toMinor, stripe } from '../integrations/stripe';


const router = Router();


/* ------------------------------- Helpers ------------------------------- */

const typeEnum = z.enum(['consultation','follow-up','checkup','urgent']);
const statusEnum = z.enum(['scheduled','completed','cancelled','no-show']);

// Coerce numbers that might arrive as strings
const zInt = z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int());
const zMoney = z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().nonnegative());

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

// Build start_time from either start_time, or (date + time); accepts ISO date (slices first 10 chars)
function buildStartTime(d: { start_time?: string; date?: string; time?: string }) {
  if (d.start_time && d.start_time.trim()) return d.start_time;
  if (d.date && d.time) {
    const dateOnly = d.date.includes('T') ? d.date.slice(0, 10) : d.date; // handle "2025-08-30T00:00:00.000Z"
    const hhmmss = /^\d{2}:\d{2}(:\d{2})?$/.test(d.time) ? (d.time.length === 5 ? `${d.time}:00` : d.time) : null;
    if (!hhmmss) return null;
    return `${dateOnly} ${hhmmss}`;
  }
  return null;
}

/* --------------------------------- GETs -------------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const from = String(req.query.from || '').trim(); // YYYY-MM-DD
    const to = String(req.query.to || '').trim();

    const where: string[] = [];
    const args: any[] = [];

    if (search) {
      where.push(`(p.name LIKE ? OR p.patient_code LIKE ? OR a.appt_code LIKE ?)`);
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push(`a.status = ?`);
      args.push(status);
    }
    if (from) { where.push(`a.start_time >= ?`); args.push(`${from} 00:00:00`); }
    if (to)   { where.push(`a.start_time <= ?`); args.push(`${to} 23:59:59`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query<any[]>(
      `SELECT a.*, p.name AS patient_name, p.patient_code
       FROM appointment a
       JOIN patient p ON p.id = a.patient_id
       ${whereSql}
       ORDER BY a.start_time DESC
       LIMIT 500`,
      args
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/unpaid', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();

    const where: string[] = [`a.status IN ('scheduled','completed')`];
    const args: any[] = [];
    if (q) {
      where.push(`(p.name LIKE ? OR p.patient_code LIKE ? OR a.appt_code LIKE ?)`);
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const sql = `
      SELECT 
        a.id,
        a.appt_code,
        a.start_time,
        a.duration_min,
        a.type,
        a.status,
        a.fee,
        a.notes,
        p.patient_code,
        p.name AS patient_name,
        COALESCE(SUM(CASE WHEN pay.status='paid' THEN pay.amount ELSE 0 END),0) AS paid_amount,
        (a.fee - COALESCE(SUM(CASE WHEN pay.status='paid' THEN pay.amount ELSE 0 END),0)) AS due
      FROM appointment a
      JOIN patient p ON p.id = a.patient_id
      LEFT JOIN payment pay ON pay.appointment_id = a.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY a.id
      HAVING due > 0
      ORDER BY a.start_time DESC
      LIMIT 500
    `;

    const [rows] = await pool.query<any[]>(sql, args);
    res.json(rows);
  } catch (e) { next(e); }
});


router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query<any[]>(
      `SELECT a.*, p.name AS patient_name, p.patient_code
       FROM appointment a
       JOIN patient p ON p.id=a.patient_id
       WHERE a.id=?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ----------------------------- CREATE (POST) ---------------------------- */

// Accept either {start_time} OR {date, time}; accept patient_id (number|string) or patient_code
const ApptCreateBody = z.object({
  patient_id: z.union([zInt, z.string()]).optional(),
  patient_code: z.string().trim().optional(),
  start_time: z.string().min(1).optional(),  // 'YYYY-MM-DD HH:MM:SS'
  date: z.string().optional(),               // 'YYYY-MM-DD'
  time: z.string().optional(),               // 'HH:MM'
  duration_min: zInt,
  type: typeEnum,
  status: statusEnum.optional(),
  notes: z.string().optional(),
  fee: zMoney.default(0),
});

router.post('/', async (req, res, next) => {
  try {
    const body = ApptCreateBody.parse(req.body);

    // normalize start_time
    const start_time = buildStartTime(body);
    if (!start_time) {
      return res.status(400).json({ error: { message: 'Invalid date/time' } });
    }

    // resolve numeric patient id
    const patientId = await resolvePatientId(body);
    if (!patientId) {
      return res.status(400).json({ error: { message: 'Invalid or missing patient identifier' } });
    }

    const [result] = await pool.query<any>(
      `INSERT INTO appointment (patient_id,start_time,duration_min,type,status,notes,fee,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        patientId,
        start_time,
        body.duration_min,
        body.type,
        body.status || 'scheduled',
        body.notes || null,
        body.fee ?? 0,
        (req as any).user?.id || null,
      ]
    );

    const id = result.insertId;

    // fetch full row with patient details needed for the email
    const [rows] = await pool.query<any[]>(
      `SELECT a.*,
              pat.name         AS patient_name,
              pat.patient_code AS patient_code,
              pat.email        AS patient_email,
              pat.phone        AS patient_phone
         FROM appointment a
         JOIN patient pat ON pat.id = a.patient_id
        WHERE a.id = ?`,
      [id]
    );

    const row = rows[0];

    type StripeItem = {
        price?: string;
        quantity?: number;
        amount?: number;
        currency?: string;
        description?: string;
    };

    const data = {
        amount: Number(row.fee ?? 0),
        description: `${row.type} - ${row.patient_name} (#APT-${String(row.id).padStart(6, '0')})`,
        clientEmail: row.patient_email,
        clientPhone: row.patient_phone,
        date: new Date(row.start_time).toISOString(),              // invoice date
        dueDate: new Date(new Date(row.start_time).getTime() + 24*60*60*1000).toISOString(), // +1 day
        stripe: {
            items: [] as StripeItem[],
            finalizeAndEmail: (process.env.STRIPE_AUTO_EMAIL ?? 'true').toLowerCase() !== 'false',
            daysUntilDue: undefined, // optional property added to fix type error
            // daysUntilDue: 1, // uncomment to force instead of deriving from dates
        },
    };

    // 2) Optionally create Stripe invoice, even with NO items in payload.
    let stripe_invoice_id: string | null = null;
    let stripe_status: string | null = null;
    let stripe_hosted_url: string | null = null;
    let stripe_pdf_url: string | null = null;
    let stripe_customer_id: string | null = null;

    const stripeEnabled = Boolean(stripe);
    const autoEmail = (process.env.STRIPE_AUTO_EMAIL ?? 'true').toLowerCase() !== 'false';
    const defaultCurrency = (process.env.STRIPE_DEFAULT_CURRENCY ?? 'lkr').toLowerCase();
    const finalizeAndEmail = data.stripe?.finalizeAndEmail ?? autoEmail;

    if (stripeEnabled && data.clientEmail) {
    // derive daysUntilDue from body or from date→dueDate
    const daysUntilDue =
        data.stripe?.daysUntilDue ??
        Math.max(
        1,
        Math.ceil(
            (new Date(data.dueDate).getTime() - new Date(data.date).getTime()) /
            (1000 * 60 * 60 * 24)
        )
        );

    // a) find/create stripe customer
    const existing = await stripe!.customers.list({ email: data.clientEmail, limit: 1 });
    let customer = existing.data[0];
    if (!customer) {
        customer = await stripe!.customers.create({
        email: data.clientEmail,
        name: row.patient_name || data.clientEmail.split('@')[0],
        phone: data.clientPhone || undefined,
        metadata: {
            patient_code: String(row.patient_code || ''),
            appointment_id: String(row.id),
        },
        });
    }
    stripe_customer_id = customer.id;

    // b) create draft invoice
    const draft = await stripe!.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',            // Stripe emails the invoice
        days_until_due: daysUntilDue,                 // needed for send_invoice
        auto_advance: false,                          // we finalize explicitly
        description: `Invoice #APT-${String(row.id).padStart(6, '0')}`,
        // currency can be omitted if you always attach items directly to this invoice.
        // When issuing multi-currency invoices, passing `currency` filters invoice items. :contentReference[oaicite:0]{index=0}
        currency: defaultCurrency,
        metadata: {
        appointment_id: String(row.id),
        patient_code: String(row.patient_code || ''),
        },
    }); // creates a DRAFT invoice. :contentReference[oaicite:1]{index=1}

    // c) add line items
    if (data.stripe?.items && data.stripe.items.length > 0) {
        for (const item of data.stripe.items) {
        if ('price' in item) {
            await stripe!.invoiceItems.create({
            customer: customer.id,
            // price: item.price,  // uncomment when you pass a price id
            quantity: item.quantity ?? 1,
            invoice: draft.id,
            });
        } else {
            const ccy = (item.currency || defaultCurrency).toLowerCase();
            const totalAmount =
            typeof item.quantity === 'number'
              ? (item.amount ?? 0) * item.quantity
              : (item.amount ?? 0);
            await stripe!.invoiceItems.create({
            customer: customer.id,
            amount: toMinor(totalAmount, ccy),
            currency: ccy,
            description: item.description ?? 'Item',
            invoice: draft.id,
            });
        }
        }
    } else if (data.amount && data.amount > 0) {
        // single ad-hoc item from `amount`
        const minor = toMinor(data.amount, defaultCurrency);
        await stripe!.invoiceItems.create({
        customer: customer.id,
        amount: minor,
        currency: defaultCurrency,
        description: data.description || `Invoice ${row.id}`,
        invoice: draft.id,
        });
    }

    // d) finalize (and email if configured)
    if (!draft.id) throw new Error('Stripe draft invoice ID is undefined');
    const finalized = await stripe!.invoices.finalizeInvoice(draft.id); // sets status=open :contentReference[oaicite:2]{index=2}
    if (finalizeAndEmail) {
        await stripe!.invoices.sendInvoice(finalized.id!); // emails customer + hosted page link :contentReference[oaicite:3]{index=3}
    }

    stripe_invoice_id = finalized.id ?? null;
    stripe_status = finalized.status ?? null;
    stripe_hosted_url = finalized.hosted_invoice_url ?? null;
    stripe_pdf_url = finalized.invoice_pdf ?? null;
    }


    let email_sent = false;

    try {
      if (row?.patient_email) {
        await sendAppointmentConfirmationEmail({
          to: row.patient_email,
          patientName: row.patient_name,
          patientCode: row.patient_code,
          start: new Date(row.start_time),
          durationMin: Number(row.duration_min ?? 30),
          type: row.type,
          notes: row.notes,
          appointmentId: row.id,
          invoiceId: stripe_hosted_url ?? undefined
          // location: row.location || null, // include if you have it
        });
        email_sent = true;
      } else {
        console.warn(`No email on file for patient ${row?.patient_name} (${row?.patient_code})`);
      }
    } catch (mailErr) {
      console.error('Failed to send appointment confirmation email:', mailErr);
    }

    res.status(201).json({ ...row, email_sent });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ UPDATE (PUT) ---------------------------- */

// No .partial() — define an explicit update schema
const ApptUpdateBody = z.object({
  patient_id: z.union([zInt, z.string()]).optional(),
  patient_code: z.string().trim().optional(),
  start_time: z.string().min(1).optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  duration_min: zInt.optional(),
  type: typeEnum.optional(),
  status: statusEnum.optional(),
  notes: z.string().optional(),
  fee: zMoney.optional(),
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = ApptUpdateBody.parse(req.body);

    // normalize fields
    const start_time = buildStartTime(body);
    if (!start_time) return res.status(400).json({ error: { message: 'Invalid date/time' } });

    const patientId = body.patient_id !== undefined || body.patient_code
      ? await resolvePatientId(body)
      : null;

    // Build dynamic SQL
    const fields: string[] = [];
    const vals: any[] = [];

    if (patientId !== null) { fields.push('patient_id=?'); vals.push(patientId); }
    if (start_time)         { fields.push('start_time=?'); vals.push(start_time); }
    if (body.duration_min !== undefined) { fields.push('duration_min=?'); vals.push(body.duration_min); }
    if (body.type !== undefined)         { fields.push('type=?'); vals.push(body.type); }
    if (body.status !== undefined)       { fields.push('status=?'); vals.push(body.status); }
    if (body.notes !== undefined)        { fields.push('notes=?'); vals.push(body.notes || null); }
    if (body.fee !== undefined)          { fields.push('fee=?'); vals.push(body.fee); }

    if (!fields.length) {
      return res.status(400).json({ error: { message: 'No updatable fields supplied' } });
    }

    vals.push(id);

    await pool.query(`UPDATE appointment SET ${fields.join(', ')} WHERE id=?`, vals);

    const [rows] = await pool.query<any[]>(`SELECT * FROM appointment WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' }});
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* --------------------------- STATUS PATCH ONLY -------------------------- */

router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ status: statusEnum }).parse(req.body);
    await pool.query(`UPDATE appointment SET status=? WHERE id=?`, [body.status, id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

/* -------------------------------- DELETE -------------------------------- */

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM appointment WHERE id=?`, [id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
