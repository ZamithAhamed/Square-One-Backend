import dotenv from 'dotenv';
dotenv.config();

function must(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} missing`);
  return v;
}

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';

export const PORT = Number(process.env.PORT || 4000);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
export const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

export const JWT_ACCESS_SECRET  = must('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = must('JWT_REFRESH_SECRET');
export const ACCESS_TOKEN_TTL   = process.env.ACCESS_TOKEN_TTL || '15m';
export const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7);
