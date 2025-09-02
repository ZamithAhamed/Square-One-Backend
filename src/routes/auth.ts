import { Router } from 'express';
import { pool } from '../db';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  IS_PROD
} from '../config/env.js';

const router = Router();

const sameSite: 'lax'|'none' = IS_PROD ? 'none' : 'lax';

const ckAT = 'at';   // access token cookie
const ckRT = 'rt';   // refresh token cookie
const ckCS = 'csrf'; // csrf cookie

function signAccessToken(userId: number) {
  const options: SignOptions = { expiresIn: '15m' };
  return jwt.sign({ id: userId }, JWT_ACCESS_SECRET, options);
}
function signRefreshToken(userId: number) {
  const options: SignOptions = { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` };
  return jwt.sign({ id: userId }, JWT_REFRESH_SECRET, options);
}
function setAuthCookies(res: any, userId: number) {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  const csrf         = crypto.randomBytes(24).toString('hex');

  res.cookie(ckAT, accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite,
    maxAge: 15 * 60 * 1000, // match ACCESS_TTL if "15m"
    path: '/',
  });
  res.cookie(ckRT, refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
  res.cookie(ckCS, csrf, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** POST /api/auth/login { email, password } */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: { message: 'Email and password are required' } });

    const [rows] = await pool.query<any[]>(
      `SELECT id, name, email, role, password_hash, avatar_url
       FROM app_user WHERE email = ? LIMIT 1`, [email]
    );
    if (!rows.length) return res.status(401).json({ error: { message: 'Invalid credentials' } });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: { message: 'Invalid credentials' } });

    setAuthCookies(res, user.id);
    const { password_hash, ...publicUser } = user;
    res.json({ user: publicUser });
  } catch (e) { next(e); }
});

/** POST /api/auth/refresh -> rotates access token + csrf */
router.post('/refresh', async (req, res) => {
  try {
    const token = (req as any).cookies?.[ckRT];
    if (!token) return res.status(401).json({ error: { message: 'No refresh token' } });
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as { id: number };
    setAuthCookies(res, payload.id);
    res.status(204).end();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid refresh token' } });
  }
});

/** POST /api/auth/logout -> clears cookies */
router.post('/logout', (req, res) => {
  const opts = { httpOnly: true, secure: IS_PROD, sameSite, path: '/' as const };
  res.clearCookie(ckAT, opts);
  res.clearCookie(ckCS, { ...opts, httpOnly: false });
  res.clearCookie(ckRT, { ...opts, path: '/api/auth' });
  res.status(204).end();
});

export default router;
