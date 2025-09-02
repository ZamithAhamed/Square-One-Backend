import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '../config/env.js';

export const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

// helper for amounts in minor units (Stripe requires this)
const ZERO_DECIMAL = new Set(['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf']);
export const toMinor = (amt: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(Number(amt)) : Math.round(Number(amt) * 100);
