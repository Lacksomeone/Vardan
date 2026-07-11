import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import db from '../src/db.js';
import { runSchedulerCheck } from '../src/scheduler.js';

describe('Scheduler Module Tests', () => {
  before(() => {
    // Clear and seed clean testing tables
    db.prepare('DELETE FROM follow_up_jobs').run();
    db.prepare('DELETE FROM patients').run();
    db.prepare('DELETE FROM doctors').run();
    db.prepare('DELETE FROM conversations').run();

    // Seed dummy doctor
    db.prepare(`
      INSERT INTO doctors (id, name, department, phone, weekly_schedule_json, fee)
      VALUES (1, 'Dr. Nitin Singh', 'Cardiology', '+919415577651', '{}', 500)
    `).run();

    // Seed dummy patient
    db.prepare(`
      INSERT INTO patients (id, name, phone, age, gender, preferred_language)
      VALUES ('919876543210@s.whatsapp.net', 'Test Patient', '919876543210', 30, 'Male', 'en')
    `).run();
  });

  it('should process pending follow-up jobs and send alerts', async () => {
    // Insert a pending follow-up job scheduled for today/past
    db.prepare(`
      INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status)
      VALUES ('919876543210@s.whatsapp.net', 1, '2026-07-10', 'hi template', 'pending')
    `).run();

    await runSchedulerCheck();

    // Check that job status updated to 'sent'
    const job = db.prepare('SELECT * FROM follow_up_jobs WHERE patient_id = ?').get('919876543210@s.whatsapp.net') as any;
    assert.strictEqual(job.status, 'sent', 'Pending job should be marked as sent');

    // Check that conversation record is created
    const conversation = db.prepare("SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot' AND agent_used = 'follow_up_scheduler'").get('919876543210@s.whatsapp.net') as any;
    assert.ok(conversation, 'Should insert bot message in conversations table');
    assert.ok(conversation.message.includes('Dr. Nitin Singh'), 'Message should contain doctor name');
  });

  it('should escalate sent jobs with no reply after 24 hours to the doctor', async () => {
    // Clear jobs
    db.prepare('DELETE FROM follow_up_jobs').run();
    db.prepare('DELETE FROM conversations').run();

    // Insert a sent follow-up job created 25 hours ago
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status, created_at)
      VALUES ('919876543210@s.whatsapp.net', 1, '2026-07-10', 'hi template', 'sent', ?)
    `).run(twentyFiveHoursAgo);

    await runSchedulerCheck();

    // Should be escalated since there is no reply
    const job = db.prepare('SELECT * FROM follow_up_jobs WHERE patient_id = ?').get('919876543210@s.whatsapp.net') as any;
    assert.strictEqual(job.status, 'escalated', 'Should escalate job when no response is received');
  });

  it('should mark job as responded if patient replied after trigger', async () => {
    // Clear jobs
    db.prepare('DELETE FROM follow_up_jobs').run();
    db.prepare('DELETE FROM conversations').run();

    // Insert a sent follow-up job created 25 hours ago
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status, created_at)
      VALUES ('919876543210@s.whatsapp.net', 1, '2026-07-10', 'hi template', 'sent', ?)
    `).run(twentyFiveHoursAgo);

    // Insert patient reply after that job was created (e.g. 5 minutes ago)
    const patientReplyTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language, timestamp)
      VALUES ('919876543210@s.whatsapp.net', 'patient', 'Yes, please', 'booking', 'en', ?)
    `).run(patientReplyTime);

    await runSchedulerCheck();

    // Should be marked responded, not escalated
    const job = db.prepare('SELECT * FROM follow_up_jobs WHERE patient_id = ?').get('919876543210@s.whatsapp.net') as any;
    assert.strictEqual(job.status, 'responded', 'Should mark as responded if user sent a reply');
  });
});
