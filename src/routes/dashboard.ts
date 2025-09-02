import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/** GET /dashboard/stats?from=&to= */
router.get('/stats', async (req, res, next) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const dateWhere = (col: string) => {
      const parts: string[] = [];
      const args: any[] = [];
      if (from) { parts.push(`${col} >= ?`); args.push(`${from} 00:00:00`); }
      if (to)   { parts.push(`${col} <= ?`); args.push(`${to} 23:59:59`); }
      return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
    };

    const { sql: pSql, args: pArgs } = dateWhere('p.created_at');
    const [pRows] = await pool.query<any[]>(`SELECT COUNT(*) as c FROM patient p ${pSql}`, pArgs);
    const patientsToday = pRows[0].c;

    const { sql: aSql, args: aArgs } = dateWhere('a.start_time');
    const [aRows] = await pool.query<any[]>(`SELECT COUNT(*) as c FROM appointment a ${aSql}`, aArgs);
    const totalAppointments = aRows[0].c;

    const { sql: paySql, args: payArgs } = dateWhere('pm.created_at');
    const [sumRows] = await pool.query<any[]>(
      `SELECT
         SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as revenue,
         AVG(amount) as avg_amount
       FROM payment pm ${paySql}`, payArgs
    );
    const revenueToday = Number(sumRows[0].revenue || 0);
    const averagePayment = Number(sumRows[0].avg_amount || 0);

    const [totalRows] = await pool.query<any[]>(
      `SELECT SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as total FROM payment`
    );
    const totalRevenue = Number(totalRows[0].total || 0);

    const [mRows] = await pool.query<any[]>(
      `SELECT SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as m
       FROM payment
       WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())`
    );
    const monthlyRevenue = Number(mRows[0].m || 0);

    res.json({
      patientsToday,
      totalAppointments,
      revenueToday,
      totalRevenue,
      averagePayment,
      monthlyRevenue
    });
  } catch (e) { next(e); }
});

export default router;
