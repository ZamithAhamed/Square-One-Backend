import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config/env.js';


type JwtUser = { id: number };

const ACCESS_SECRET = JWT_ACCESS_SECRET!;
if (!ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET missing');

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const hdr = req.headers.authorization || '';
    const token =
      hdr.startsWith('Bearer ') ? hdr.slice(7) :
      (req as any).cookies?.at || null;

    if (!token) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const payload = jwt.verify(token, ACCESS_SECRET) as JwtUser;
    (req as any).user = { id: payload.id };
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const hdr = req.headers.authorization || '';
    const token =
      hdr.startsWith('Bearer ') ? hdr.slice(7) :
      (req as any).cookies?.at || null;
    if (token) {
      const payload = jwt.verify(token, ACCESS_SECRET) as JwtUser;
      (req as any).user = { id: payload.id };
    }
  } catch {}
  next();
}
