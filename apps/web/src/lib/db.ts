/**
 * Database connection using PostgreSQL (Supabase)
 * Uses lazy initialization to avoid build-time errors on Vercel
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../drizzle/schema';

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

// Export a proxy that lazily initializes the db connection
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    return getDb()[prop as keyof NodePgDatabase<typeof schema>];
  },
});

export { schema };
