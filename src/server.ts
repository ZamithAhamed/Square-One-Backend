import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
dotenv.config();

import { requireAuth } from './middleware/auth';
import { csrfProtect } from './middleware/csrf';
import { errorHandler } from './middleware/error';

import authRouter from './routes/auth';
import patientsRouter from './routes/patients.js';
import notesRouter from './routes/notes.js';
import apptsRouter from './routes/appointments.js';
import paymentsRouter from './routes/payments.js';
import lookupsRouter from './routes/lookups.js';
import meRouter from './routes/profile.js';
import dashboardRouter from './routes/dashboard.js';

const app = express();

const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(`/${process.env.UPLOAD_DIR || 'uploads'}`, express.static(process.env.UPLOAD_DIR || 'uploads'));

// Public
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

// Protected + CSRF for mutating
app.use(requireAuth);
// app.use(csrfProtect);

app.use('/api/patients', patientsRouter);
app.use('/api/patients/:id/notes', (req, res, next) => next(), notesRouter);
app.use('/api/appointments', apptsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/lookups', lookupsRouter);
app.use('/api/me', meRouter);
app.use('/api/dashboard', dashboardRouter);

// Errors
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`API listening on http://localhost:${port} (CORS: ${origin})`));
