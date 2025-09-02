import { Router } from 'express';
import { pool } from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  }
});

const router = Router();

/** GET /me */
router.get('/', async (req, res, next) => {
  try {
    const uid = (req as any).user.id;
    const [rows] = await pool.query<any[]>(`SELECT id,name,email,role,avatar_url FROM app_user WHERE id=?`, [uid]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/** PUT /me */
router.put('/', async (req, res, next) => {
  try {
    const uid = (req as any).user.id;
    const body = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      newPassword: z.string().min(6).optional()
    }).parse(req.body);

    let hash: string | undefined;
    if (body.newPassword) {
      hash = await bcrypt.hash(body.newPassword, 10);
    }

    await pool.query(
      `UPDATE app_user SET
         name=COALESCE(?,name),
         email=COALESCE(?,email),
         password_hash=COALESCE(?,password_hash)
       WHERE id=?`,
      [body.name ?? null, body.email ?? null, hash ?? null, uid]
    );
    const [rows] = await pool.query<any[]>(`SELECT id,name,email,role,avatar_url FROM app_user WHERE id=?`, [uid]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/** POST /me/avatar */
router.post('/avatar', upload.single('avatar'), async (req, res, next) => {
  try {
    const uid = (req as any).user.id;
    const urlPath = `/${uploadDir}/${req.file!.filename}`;
    await pool.query(`UPDATE app_user SET avatar_url=? WHERE id=?`, [urlPath, uid]);
    res.json({ avatar_url: urlPath });
  } catch (e) { next(e); }
});

export default router;
