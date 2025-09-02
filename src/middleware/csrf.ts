import { NextFunction, Request, Response } from 'express';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const header = req.headers['x-csrf-token'];
  const cookie = (req as any).cookies?.csrf;
  if (!header || !cookie || header !== cookie) {
    return res.status(403).json({ error: { message: 'Invalid CSRF token' } });
  }
  next();
}
