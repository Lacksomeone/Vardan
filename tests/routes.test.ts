import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import bcrypt from 'bcryptjs';

// Set environment to test
process.env.NODE_ENV = 'test';

import db from '../src/db.js';
import dashboardRouter from '../src/routes/dashboard.js';

describe('Dashboard Routes Tests', () => {
  let app: express.Express;
  let server: any;
  let port: number;
  let adminToken: string;

  before(() => {
    // Clean and seed admin credentials in correct foreign key order
    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM follow_up_jobs').run();
    db.prepare('DELETE FROM doctors').run();
    db.prepare('DELETE FROM admin_users').run();

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('hospital', salt);
    db.prepare(`
      INSERT INTO admin_users (name, username, role, password_hash)
      VALUES ('Vardan Test Owner', 'vardan', 'owner', ?)
    `).run(hash);

    // Setup Express App
    app = express();
    app.use(express.json());
    app.use('/api', dashboardRouter);

    // Start server on an ephemeral port
    server = app.listen(0);
    port = server.address().port;
  });

  after(() => {
    server.close();
  });

  it('should fail login with invalid credentials', async () => {
    const res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'vardan', password: 'wrongpassword' })
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json() as any;
    assert.strictEqual(data.error, 'Invalid username or password');
  });

  it('should login successfully and return JWT token', async () => {
    const res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'vardan', password: 'hospital' })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.token, 'Token should be returned');
    assert.strictEqual(data.user.username, 'vardan');
    assert.strictEqual(data.user.role, 'owner');
    adminToken = data.token;
  });

  it('should authenticate user and return /auth/me info', async () => {
    const res = await fetch(`http://localhost:${port}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json() as any;
    assert.strictEqual(data.user.username, 'vardan');
    assert.strictEqual(data.user.role, 'owner');
  });

  it('should retrieve doctors list', async () => {
    const res = await fetch(`http://localhost:${port}/api/doctors`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json() as any;
    assert.ok(Array.isArray(data), 'Result should be an array of doctors');
  });

  it('should add a new doctor', async () => {
    const newDoc = {
      name: 'Dr. Test Cardiology',
      department: 'Cardiology',
      phone: '+919999999999',
      weekly_schedule_json: '{}',
      fee: 600,
      details: 'Cardio expert',
      photo_url: '',
      services: 'BP care'
    };

    const res = await fetch(`http://localhost:${port}/api/doctors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(newDoc)
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json() as any;
    assert.ok(data.id, 'New doctor should have an ID');
    assert.strictEqual(data.name, 'Dr. Test Cardiology');

    // Verify in SQLite database
    const doc = db.prepare('SELECT * FROM doctors WHERE id = ?').get(data.id) as any;
    assert.ok(doc);
    assert.strictEqual(doc.name, 'Dr. Test Cardiology');
  });

  it('should bulk import doctors successfully', async () => {
    const bulkData = {
      doctors: [
        {
          name: 'Bulk Doc 1',
          department: 'Pediatrics',
          phone: '+918888888888',
          weekly_schedule_json: '{}',
          fee: 350
        },
        {
          name: 'Bulk Doc 2',
          department: 'Medicine',
          phone: '+917777777777',
          weekly_schedule_json: '{}',
          fee: 450
        }
      ]
    };

    const res = await fetch(`http://localhost:${port}/api/doctors/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(bulkData)
    });

    assert.strictEqual(res.status, 207);
    const data = await res.json() as any;
    assert.strictEqual(data.results.length, 2);
    assert.strictEqual(data.results[0].status, 'success');
    assert.strictEqual(data.results[1].status, 'success');

    // Verify both doctors are created in DB
    const count = db.prepare("SELECT COUNT(*) as count FROM doctors WHERE name LIKE 'Bulk%'").get() as { count: number };
    assert.strictEqual(count.count, 2);
  });
});
