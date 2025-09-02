import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST!,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER!,
  password: process.env.MYSQL_PASSWORD!,
  database: process.env.MYSQL_DATABASE!,
  connectionLimit: 10,
  dateStrings: false
});

// Optional transaction helper
export async function withTx<T>(fn: (conn: mysql.PoolConnection) => Promise<T>) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
