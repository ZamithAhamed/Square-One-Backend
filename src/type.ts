export type Gender = 'male' | 'female' | 'other';
export type ApptType = 'consultation' | 'follow-up' | 'checkup' | 'urgent';
export type ApptStatus = 'scheduled' | 'completed' | 'cancelled' | 'no-show';
export type PayMethod = 'cash' | 'card' | 'online' | 'bank-transfer';
export type PayStatus = 'paid' | 'pending' | 'failed' | 'refunded';

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}
