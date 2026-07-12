import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const url = process.env.TURSO_DATABASE_URL || 'file:data/vardan.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({ url, authToken });

export const db = {
  execute: (sql: string, args: any[] = []) => client.execute({ sql, args }),
  get: async (sql: string, args: any[] = []) => {
    const res = await client.execute({ sql, args });
    return res.rows[0];
  },
  all: async (sql: string, args: any[] = []) => {
    const res = await client.execute({ sql, args });
    return res.rows;
  },
  run: async (sql: string, args: any[] = []) => {
    const res = await client.execute({ sql, args });
    return { lastInsertRowid: res.lastInsertRowid, changes: res.rowsAffected };
  }
};

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      preferred_language TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      phone TEXT NOT NULL,
      weekly_schedule_json TEXT NOT NULL,
      fee INTEGER NOT NULL,
      details TEXT,
      photo_url TEXT,
      services TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS llm_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      key_val TEXT UNIQUE NOT NULL,
      cooldown_until INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      question_variants TEXT NOT NULL,
      answer_hi TEXT NOT NULL,
      answer_en TEXT NOT NULL,
      answer_hinglish TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // NEW: Table for storing our compressed Baileys Auth State Backup
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_backup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      zip_data BLOB NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure default admin user
  const hash = bcrypt.hashSync('hospital', 10);
  await db.run(`INSERT OR IGNORE INTO admin_users (name, username, role, password_hash) VALUES (?, ?, ?, ?)`, ['Vardan Owner', 'vardan', 'owner', hash]);
}
