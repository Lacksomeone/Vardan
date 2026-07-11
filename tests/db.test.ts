import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

// Set environment to test before importing DB module
process.env.NODE_ENV = 'test';

import db, { initDb } from '../src/db.js';

describe('Database Module Tests', () => {
  before(() => {
    // Drop all tables to ensure a clean start for the seeding test
    db.exec('PRAGMA foreign_keys = OFF');
    const tables = [
      'patients', 'doctors', 'doctor_documents', 'appointments', 
      'conversations', 'follow_up_jobs', 'knowledge_base', 
      'pending_queries', 'llm_call_logs', 'llm_keys', 'admin_users'
    ];
    for (const table of tables) {
      try {
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      } catch (e) {}
    }
    db.exec('PRAGMA foreign_keys = ON');
  });

  it('should initialize database tables and seed default data', () => {
    // Run initDb
    initDb();

    // Verify admin_users table is seeded
    const admin = db.prepare("SELECT * FROM admin_users WHERE username = 'vardan'").get() as any;
    assert.ok(admin, 'Admin user should be seeded');
    assert.strictEqual(admin.role, 'owner', 'Admin role should be owner');

    // Verify doctors are seeded
    const doctors = db.prepare("SELECT * FROM doctors").all() as any[];
    assert.strictEqual(doctors.length, 3, 'There should be 3 seeded doctors');
    assert.strictEqual(doctors[0].name, 'Dr. Nitin Singh');
    assert.strictEqual(doctors[1].name, 'Dr. Ankit Sharma');
    assert.strictEqual(doctors[2].name, 'Dr. Om Shukla');

    // Verify knowledge base is seeded
    const kbEntries = db.prepare("SELECT * FROM knowledge_base").all() as any[];
    assert.ok(kbEntries.length >= 4, 'Knowledge base should contain at least 4 items');
    
    const timings = db.prepare("SELECT * FROM knowledge_base WHERE category = 'timings'").get() as any;
    assert.ok(timings, 'Timings category should be seeded');
    assert.ok(timings.answer_en.includes("24/7"), 'Timings answer should contain 24/7');
  });
});
