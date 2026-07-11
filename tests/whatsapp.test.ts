import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// Set environment to test before importing DB and WhatsApp
process.env.NODE_ENV = 'test';

import db from '../src/db.js';
import { setPairingPhone, sendTextMessage } from '../src/whatsapp.js';

describe('WhatsApp Module Tests', () => {
  before(() => {
    // Clear relevant tables under PRAGMA foreign_keys = OFF to ensure deterministic test runs
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM conversations').run();
    db.prepare('DELETE FROM patients').run();
    db.exec('PRAGMA foreign_keys = ON');

    // Seed a dummy patient for testing
    db.prepare(`
      INSERT INTO patients (id, name, phone, age, gender, preferred_language)
      VALUES ('919876543210@s.whatsapp.net', 'Test Patient', '919876543210', 30, 'Male', 'en')
    `).run();
  });

  it('should normalize and set pairing phone number', () => {
    // setPairingPhone modifies internal pairingPhone. Verify it executes without error.
    setPairingPhone('+91 (987) 654-3210');
  });

  it('should bypass real socket and complete silently in test mode (no DB write)', async () => {
    const toJid = '919876543210@s.whatsapp.net';
    const messageText = 'Hello Test Patient! This is a test message.';

    // In test mode sendTextMessage returns immediately without connecting to WhatsApp
    // and without writing to the DB. It must NOT throw.
    await assert.doesNotReject(
      () => sendTextMessage(toJid, messageText),
      'sendTextMessage should not throw in test mode even without a socket'
    );

    // Confirm the test-mode stub does NOT write to conversations (returns early before DB code)
    const logged = db.prepare(
      "SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot' ORDER BY timestamp DESC LIMIT 1"
    ).get(toJid) as any;
    assert.strictEqual(
      logged,
      undefined,
      'sendTextMessage in test mode should NOT write to conversations (returns early before DB code)'
    );
  });

  it('should NOT log anything for unregistered numbers in test mode either', async () => {
    const toJid = '910000000000@s.whatsapp.net';
    const messageText = 'Hello Unregistered!';

    await assert.doesNotReject(() => sendTextMessage(toJid, messageText));

    const logged = db.prepare('SELECT * FROM conversations WHERE patient_id = ?').get(toJid) as any;
    assert.strictEqual(logged, undefined, 'Unregistered numbers should never be logged in test mode');
  });
});
