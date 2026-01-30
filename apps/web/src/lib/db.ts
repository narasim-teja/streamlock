/**
 * Database connection
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../drizzle/schema';

const sqlite = new Database(process.env.DATABASE_URL?.replace('file:', '') || './db.sqlite');
export const db = drizzle(sqlite, { schema });

export { schema };
