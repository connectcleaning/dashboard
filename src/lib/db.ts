import postgres from 'postgres';
import { env } from './env.js';

export const sql = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,  // required for Supabase transaction pooler
});
