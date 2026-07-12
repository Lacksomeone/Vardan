import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import db from '../src/db.js';
import { handleFaqQuery, autoResolvePendingQueries } from '../src/agents/faq.js';
import { LLMGateway } from '../src/llm.js';
import { handleBookingQuery, hasActiveBookingSession, clearBookingSession } from '../src/agents/booking.js';
import { handleFollowUpResponse } from '../src/agents/followUp.js';
import { handleIncomingMessage, clearRegSession } from '../src/router.js';

describe('Agent and Router Tests', () => {
  let originalGetChatCompletion: any;
  let originalAnalyzeDocument: any;
  let llmMockResponse: string = '';
  let llmDocMockResponse: string = '';

  before(() => {
    originalGetChatCompletion = LLMGateway.prototype.getChatCompletion;
    originalAnalyzeDocument = LLMGateway.prototype.analyzeDocument;
    
    // Stub the LLM completion methods
    LLMGateway.prototype.getChatCompletion = async function (provider: string, params: any): Promise<string> {
      return llmMockResponse;
    };

    LLMGateway.prototype.analyzeDocument = async function (
      base64Data: string,
      mimeType: string,
      systemPrompt: string,
      userPrompt: string
    ): Promise<string> {
      return llmDocMockResponse;
    };

    // Initialize tables and clean up in correct foreign key order
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM conversations').run();
    db.prepare('DELETE FROM pending_queries').run();
    db.prepare('DELETE FROM follow_up_jobs').run();
    db.prepare('DELETE FROM patients').run();
    db.prepare('DELETE FROM doctors').run();
    db.prepare('DELETE FROM knowledge_base').run();
    db.exec('PRAGMA foreign_keys = ON');

    // Seed test doctor (id = 1)
    db.prepare(`
      INSERT INTO doctors (id, name, department, phone, weekly_schedule_json, fee, active)
      VALUES (1, 'Dr. Nitin Singh', 'Cardiology', '+919415577651', '{"Monday": ["10:00-10:30", "11:00-11:30"]}', 500, 1)
    `).run();

    // Seed test patient
    db.prepare(`
      INSERT INTO patients (id, name, phone, age, gender, preferred_language)
      VALUES ('919876543210@s.whatsapp.net', 'Test Patient', '919876543210', 30, 'Male', 'en')
    `).run();

    // Seed test knowledge base
    db.prepare(`
      INSERT INTO knowledge_base (id, category, question_variants, answer_hi, answer_en, answer_hinglish)
      VALUES (1, 'timings', '["hours", "open", "timing"]', '24 घंटे', 'Open 24/7', '24 hours')
    `).run();
  });

  after(() => {
    LLMGateway.prototype.getChatCompletion = originalGetChatCompletion;
    LLMGateway.prototype.analyzeDocument = originalAnalyzeDocument;
  });

  // ─── FAQ Agent Tests ───────────────────────────────────────────────────────
  describe('FAQ Agent', () => {
    it('should block medical query and send redirection', async () => {
      const patientId = '919876543210@s.whatsapp.net';
      db.prepare('DELETE FROM conversations').run();

      await handleFaqQuery(patientId, 'Give me paracetamol dosage', 'en');

      const logged = db.prepare("SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot'").get(patientId) as any;
      assert.ok(logged, 'Should log redirection');
      assert.ok(logged.message.includes('consult the doctor directly'), 'Message should redirect patient');
      assert.strictEqual(logged.agent_used, 'faq');
    });

    it('should answer exact matches using Knowledge Base', async () => {
      const patientId = '919876543210@s.whatsapp.net';
      db.prepare('DELETE FROM conversations').run();
      llmMockResponse = 'Open 24/7';

      await handleFaqQuery(patientId, 'What are the opening hours?', 'en');

      const logged = db.prepare("SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot'").get(patientId) as any;
      assert.ok(logged, 'Should log KB match');
      assert.strictEqual(logged.message, 'Open 24/7');
    });

    it('should call LLM and answer using fallback facts if available', async () => {
      const patientId = '919876543210@s.whatsapp.net';
      db.prepare('DELETE FROM conversations').run();

      // Mock LLM RAG success response
      llmMockResponse = JSON.stringify({
        can_answer: true,
        answer: 'Yes, we are open 24/7.'
      });

      // Use a query that does NOT match timings KB variants (hours, open, timing)
      await handleFaqQuery(patientId, 'Is there a pharmacy inside?', 'en');

      const logged = db.prepare("SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot'").get(patientId) as any;
      assert.ok(logged, 'Should log LLM answer');
      assert.strictEqual(logged.message, 'Yes, we are open 24/7.');
    });

    it('should create a pending query if LLM cannot answer', async () => {
      const patientId = '919876543210@s.whatsapp.net';
      db.prepare('DELETE FROM conversations').run();
      db.prepare('DELETE FROM pending_queries').run();

      // Mock LLM RAG negative response
      llmMockResponse = JSON.stringify({
        can_answer: false
      });

      await handleFaqQuery(patientId, 'Do you serve pizza?', 'en');

      // Verify pending query entry is created
      const pending = db.prepare('SELECT * FROM pending_queries WHERE patient_id = ?').get(patientId) as any;
      assert.ok(pending, 'Should create pending query record');
      assert.strictEqual(pending.question, 'Do you serve pizza?');
      assert.strictEqual(pending.status, 'pending');
    });
  });

  // ─── Booking Agent Tests ───────────────────────────────────────────────────
  describe('Booking Agent', () => {
    const patientId = '919876543210@s.whatsapp.net';

    before(() => {
      clearBookingSession(patientId);
    });

    it('should initialize booking session when user wants to book', async () => {
      await handleBookingQuery(patientId, 'book appointment', 'en');
      assert.ok(hasActiveBookingSession(patientId), 'Should activate booking session');
    });

    it('should transition to date selection when doctor is selected', async () => {
      // Current session stage should be 'doctor_or_symptom'. Send doctor name.
      await handleBookingQuery(patientId, 'Dr. Nitin Singh', 'en');
      assert.ok(hasActiveBookingSession(patientId), 'Should remain in booking session');
    });

    it('should complete booking flow and create appointment', async () => {
      // Re-initialize to doctor selection
      clearBookingSession(patientId);
      db.prepare('DELETE FROM appointments').run();
      await handleBookingQuery(patientId, 'book appointment', 'en');
      
      // Select doctor
      await handleBookingQuery(patientId, 'Dr. Nitin Singh', 'en');
      
      // Select date (13-07-2026 is Monday)
      await handleBookingQuery(patientId, '13-07-2026', 'en');
      
      // Select slot (should auto-book immediately!)
      await handleBookingQuery(patientId, '10:00-10:30', 'en');

      // Verify appointment is created in DB (status should be 'confirmed' because of auto-book)
      const appointment = db.prepare('SELECT * FROM appointments WHERE patient_id = ?').get(patientId) as any;
      assert.ok(appointment, 'Appointment should be saved');
      assert.strictEqual(appointment.doctor_id, 1);
      assert.strictEqual(appointment.date, '2026-07-13');
      assert.strictEqual(appointment.time_slot, '10:00-10:30');
      assert.strictEqual(appointment.status, 'confirmed');

      // Booking session should be cleared after auto-booking
      assert.strictEqual(hasActiveBookingSession(patientId), false, 'Session should be cleared after auto-booking');
    });
  });

  // ─── Follow-Up Agent Tests ─────────────────────────────────────────────────
  describe('Follow-Up Agent', () => {
    const patientId = '919876543210@s.whatsapp.net';

    it('should handle recovered status correctly', async () => {
      db.prepare('DELETE FROM follow_up_jobs').run();
      db.prepare('DELETE FROM conversations').run();

      // Seed sent follow-up job
      db.prepare(`
        INSERT INTO follow_up_jobs (id, patient_id, doctor_id, trigger_date, message_template, status)
        VALUES (10, ?, 1, '2026-07-10', 'reminder', 'sent')
      `).run(patientId);

      // Mock LLM recovery classification: recovered
      llmMockResponse = JSON.stringify({ status: 'recovered' });

      await handleFollowUpResponse(patientId, 'I feel great now, thank you doctor!', 'en');

      // Verify job status updated
      const job = db.prepare('SELECT status FROM follow_up_jobs WHERE id = 10').get() as any;
      assert.strictEqual(job.status, 'responded');

      // Verify bot well-wishes response logged
      const logged = db.prepare("SELECT * FROM conversations WHERE patient_id = ? AND role = 'bot' AND agent_used = 'follow_up'").get(patientId) as any;
      assert.ok(logged);
      assert.ok(logged.message.includes('Great to hear that you are feeling better'));
    });
  });

  // ─── Message Router & Registration Tests ───────────────────────────────────
  describe('Router & Registration', () => {
    const newPatientId = '917777777777@s.whatsapp.net';

    before(() => {
      clearRegSession(newPatientId);
      db.prepare('DELETE FROM patients WHERE id = ?').run(newPatientId);
    });

    it('should guide unregistered user through registration stages', async () => {
      // 1. Initial message starts registration (stage: lang_select)
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'msg1' },
        message: { conversation: 'Hello' }
      });

      // 2. Select Language (English -> stage: details_input)
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'msg2' },
        message: { conversation: '2' } // 2 is English
      });

      // Mock LLM response to parse patient details from free-form text
      llmMockResponse = JSON.stringify({
        name: 'Alice Smith',
        age: 25,
        gender: 'Female',
        phone: '917777777777'
      });

      // 3. Send all details in a single message
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'msg3' },
        message: { conversation: 'My name is Alice Smith, I am 25 years old, Female, and my phone is 917777777777' }
      });

      // Verify patient record exists in database
      const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(newPatientId) as any;
      assert.ok(patient, 'Patient should be registered in database');
      assert.strictEqual(patient.name, 'Alice Smith');
      assert.strictEqual(patient.age, 25);
      assert.strictEqual(patient.preferred_language, 'en');
    });

    it('should allow changing language in middle of chats', async () => {
      // Setup patient as English preferred first
      db.prepare("UPDATE patients SET preferred_language = 'en' WHERE id = ?").run(newPatientId);

      // 1. Explicit request to change language
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'lang1' },
        message: { conversation: 'change language' }
      });

      // 2. Select Hindi (1)
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'lang2' },
        message: { conversation: '1' }
      });

      // Verify language is now Hindi (hi)
      let patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(newPatientId) as any;
      assert.strictEqual(patient.preferred_language, 'hi');

      // 3. Direct language switch to English
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'lang3' },
        message: { conversation: 'english please' }
      });

      // Verify language is now English (en)
      patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(newPatientId) as any;
      assert.strictEqual(patient.preferred_language, 'en');

      // 4. Direct language switch to Hinglish
      await handleIncomingMessage({
        key: { remoteJid: newPatientId, id: 'lang4' },
        message: { conversation: 'Hinglish' }
      });

      // Verify language is now Hinglish
      patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(newPatientId) as any;
      assert.strictEqual(patient.preferred_language, 'hinglish');
    });

    it('should parse multiline details format (like Nitin Singh: davis\\n12\\nmale\\n9451183429) using LLM or heuristics fallback', async () => {
      const multilinePatientId = '919451183429@s.whatsapp.net';
      clearRegSession(multilinePatientId);
      db.prepare('DELETE FROM patients WHERE id = ?').run(multilinePatientId);

      // Start registration
      await handleIncomingMessage({
        key: { remoteJid: multilinePatientId, id: 'm1' },
        message: { conversation: 'hi' }
      });

      // Select Language (English)
      await handleIncomingMessage({
        key: { remoteJid: multilinePatientId, id: 'm2' },
        message: { conversation: '2' }
      });

      // Mock LLM to return empty to force the heuristics fallback
      llmMockResponse = '';

      // Send multiline message
      await handleIncomingMessage({
        key: { remoteJid: multilinePatientId, id: 'm3' },
        message: { conversation: 'davis\n12\nmale\n9451183429' }
      });

      // Verify registration succeeded via fallback heuristics
      const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(multilinePatientId) as any;
      assert.ok(patient, 'Patient should be registered in database');
      assert.strictEqual(patient.name, 'davis');
      assert.strictEqual(patient.age, 12);
      assert.strictEqual(patient.gender, 'Male');
      assert.strictEqual(patient.phone, '9451183429');
    });

    it('should parse comma-separated details format on a single line', async () => {
      const commaPatientId = '919451183428@s.whatsapp.net';
      clearRegSession(commaPatientId);
      db.prepare('DELETE FROM patients WHERE id = ?').run(commaPatientId);

      // Start registration
      await handleIncomingMessage({
        key: { remoteJid: commaPatientId, id: 'c1' },
        message: { conversation: 'hi' }
      });

      // Select Language (English)
      await handleIncomingMessage({
        key: { remoteJid: commaPatientId, id: 'c2' },
        message: { conversation: '2' }
      });

      // Mock LLM to fail
      llmMockResponse = 'Failed completely';

      // Send comma-separated single-line message
      await handleIncomingMessage({
        key: { remoteJid: commaPatientId, id: 'c3' },
        message: { conversation: 'davis, 12, male, 9451183428' }
      });

      // Verify registration succeeded
      const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(commaPatientId) as any;
      assert.ok(patient, 'Patient should be registered in database');
      assert.strictEqual(patient.name, 'davis');
      assert.strictEqual(patient.age, 12);
      assert.strictEqual(patient.gender, 'Male');
      assert.strictEqual(patient.phone, '9451183428');
    });

    it('should automatically register an unregistered patient from an uploaded image via OCR', async () => {
      const ocrPatientId = '919451183427@s.whatsapp.net';
      clearRegSession(ocrPatientId);
      db.prepare('DELETE FROM patients WHERE id = ?').run(ocrPatientId);

      // Mock OCR document analysis output
      llmDocMockResponse = JSON.stringify({
        name: 'John Doe',
        age: 35,
        gender: 'Male',
        phone: '9451183427'
      });

      // Send image message
      await handleIncomingMessage({
        key: { remoteJid: ocrPatientId, id: 'img1' },
        message: { 
          imageMessage: { 
            mimetype: 'image/jpeg'
          }
        }
      });

      // Verify patient is automatically registered
      const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(ocrPatientId) as any;
      assert.ok(patient, 'Patient should be automatically registered');
      assert.strictEqual(patient.name, 'John Doe');
      assert.strictEqual(patient.age, 35);
      assert.strictEqual(patient.gender, 'Male');
      assert.strictEqual(patient.phone, '9451183427');
    });

    it('should fallback to manual language selection if OCR registration fails to extract details', async () => {
      const fallbackPatientId = '919451183426@s.whatsapp.net';
      clearRegSession(fallbackPatientId);
      db.prepare('DELETE FROM patients WHERE id = ?').run(fallbackPatientId);

      // Mock OCR document analysis to fail to extract name/age
      llmDocMockResponse = JSON.stringify({
        name: null,
        age: null,
        gender: null,
        phone: null
      });

      // Send image message
      await handleIncomingMessage({
        key: { remoteJid: fallbackPatientId, id: 'img2' },
        message: { 
          imageMessage: { 
            mimetype: 'image/jpeg'
          }
        }
      });

      // Verify patient is NOT registered yet
      let patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(fallbackPatientId) as any;
      assert.ok(!patient, 'Patient should not be registered');

      // Send '2' to select English language, which is only possible if we fell back to lang_select stage
      await handleIncomingMessage({
        key: { remoteJid: fallbackPatientId, id: 'c2' },
        message: { conversation: '2' }
      });

      // Send details to complete registration manually
      llmMockResponse = JSON.stringify({
        name: 'Manual Jane',
        age: 28,
        gender: 'Female',
        phone: '9451183426'
      });

      await handleIncomingMessage({
        key: { remoteJid: fallbackPatientId, id: 'c3' },
        message: { conversation: 'My name is Manual Jane, 28, Female' }
      });

      // Now verify patient is registered manually!
      patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(fallbackPatientId) as any;
      assert.ok(patient, 'Patient should be registered manually');
      assert.strictEqual(patient.name, 'Manual Jane');
      assert.strictEqual(patient.age, 28);
    });
  });

  // ─── Booking Cancel Tests ─────────────────────────────────────────────────
  describe('Booking Cancel Flow', () => {
    const patientId = '919876543210@s.whatsapp.net';

    beforeEach(() => {
      clearBookingSession(patientId);
      db.prepare('DELETE FROM appointments').run();
      // Pre-seed a confirmed appointment to cancel
      db.prepare(`
        INSERT INTO appointments (id, patient_id, doctor_id, date, time_slot, status)
        VALUES (100, ?, 1, '2026-07-20', '10:00-10:30', 'pending')
      `).run(patientId);
    });

    it('should prompt for cancellation confirmation when cancel keyword used', async () => {
      await handleBookingQuery(patientId, 'cancel my appointment', 'en');
      // Session should be active at confirm stage
      assert.ok(hasActiveBookingSession(patientId), 'Should open cancel confirm session');
    });

    it('should cancel appointment and mark it cancelled in DB when user says yes', async () => {
      // Start cancel flow
      await handleBookingQuery(patientId, 'cancel appointment', 'en');
      // Confirm with yes
      await handleBookingQuery(patientId, 'yes', 'en');

      // Appointment should be marked cancelled
      const appt = db.prepare('SELECT * FROM appointments WHERE id = 100').get() as any;
      assert.strictEqual(appt.status, 'cancelled', 'Appointment should be cancelled');
      // Session should be cleared
      assert.strictEqual(hasActiveBookingSession(patientId), false, 'Session should be cleared');
    });

    it('should NOT cancel and abort session when user says no', async () => {
      await handleBookingQuery(patientId, 'cancel appointment', 'en');
      await handleBookingQuery(patientId, 'no', 'en');

      // Appointment should still be pending
      const appt = db.prepare('SELECT * FROM appointments WHERE id = 100').get() as any;
      assert.strictEqual(appt.status, 'pending', 'Appointment should remain pending on no');
      assert.strictEqual(hasActiveBookingSession(patientId), false, 'Session should be cleared after abort');
    });
  });

  // ─── Booking Reschedule Tests ──────────────────────────────────────────────
  describe('Booking Reschedule Flow', () => {
    const patientId = '919876543210@s.whatsapp.net';

    beforeEach(() => {
      clearBookingSession(patientId);
      db.prepare('DELETE FROM appointments').run();
      // Pre-seed a confirmed appointment to reschedule
      db.prepare(`
        INSERT INTO appointments (id, patient_id, doctor_id, date, time_slot, status)
        VALUES (200, ?, 1, '2026-07-20', '10:00-10:30', 'confirmed')
      `).run(patientId);
    });

    it('should reschedule appointment: old cancelled, new confirmed in DB', async () => {
      // Start reschedule flow — triggers date prompt
      await handleBookingQuery(patientId, 'reschedule my appointment', 'en');
      assert.ok(hasActiveBookingSession(patientId), 'Reschedule session should be active');

      // Pick new date — mock LLM to return a Monday in the future
      llmMockResponse = '2026-07-13'; // Monday
      await handleBookingQuery(patientId, '13 July 2026', 'en');

      // Pick new slot — auto-books immediately
      await handleBookingQuery(patientId, '10:00-10:30', 'en');

      // Old appointment should be cancelled
      const oldAppt = db.prepare('SELECT status FROM appointments WHERE id = 200').get() as any;
      assert.strictEqual(oldAppt.status, 'cancelled', 'Old appointment should be cancelled');

      // New appointment should be confirmed
      const newAppt = db.prepare(
        "SELECT * FROM appointments WHERE patient_id = ? AND status = 'confirmed' AND id != 200"
      ).get(patientId) as any;
      assert.ok(newAppt, 'New rescheduled appointment should exist');
      assert.strictEqual(newAppt.date, '2026-07-13');
      assert.strictEqual(newAppt.time_slot, '10:00-10:30');

      // Session cleared
      assert.strictEqual(hasActiveBookingSession(patientId), false);
    });
  });

  // ─── autoResolvePendingQueries Tests ──────────────────────────────────────
  describe('autoResolvePendingQueries (FAQ)', () => {
    const patientId = '919876543210@s.whatsapp.net';

    before(() => {
      db.prepare('DELETE FROM pending_queries').run();
      db.prepare('DELETE FROM conversations').run();
    });

    it('should resolve pending query and log answer when LLM can answer', async () => {
      // Seed a pending query
      db.prepare(`
        INSERT INTO pending_queries (id, patient_id, question, status)
        VALUES (50, ?, 'Is there a canteen in hospital?', 'pending')
      `).run(patientId);

      llmMockResponse = JSON.stringify({
        can_answer: true,
        answer: 'Yes, Vardan Hospital has a canteen on the ground floor.'
      });

      await autoResolvePendingQueries();

      // Pending query should be resolved
      const q = db.prepare('SELECT * FROM pending_queries WHERE id = 50').get() as any;
      assert.strictEqual(q.status, 'resolved');
      assert.strictEqual(q.answered_by, 'ai_auto_resolver');
      assert.strictEqual(q.answer, 'Yes, Vardan Hospital has a canteen on the ground floor.');

      // Conversation should be logged with agent_used = 'faq_auto_resolver'
      const convo = db.prepare(
        "SELECT * FROM conversations WHERE patient_id = ? AND agent_used = 'faq_auto_resolver'"
      ).get(patientId) as any;
      assert.ok(convo, 'Should log auto-resolved answer in conversations');
      assert.strictEqual(convo.message, 'Yes, Vardan Hospital has a canteen on the ground floor.');
    });

    it('should leave pending query unresolved when LLM cannot answer', async () => {
      db.prepare('DELETE FROM pending_queries').run();
      db.prepare('DELETE FROM conversations').run();

      db.prepare(`
        INSERT INTO pending_queries (id, patient_id, question, status)
        VALUES (51, ?, 'What is the WiFi password?', 'pending')
      `).run(patientId);

      // LLM says it cannot answer
      llmMockResponse = JSON.stringify({ can_answer: false });

      await autoResolvePendingQueries();

      // Status should remain pending (not changed)
      const q = db.prepare('SELECT * FROM pending_queries WHERE id = 51').get() as any;
      assert.strictEqual(q.status, 'pending', 'Unresolvable query should stay pending');

      // No conversation log
      const convo = db.prepare(
        "SELECT * FROM conversations WHERE patient_id = ? AND agent_used = 'faq_auto_resolver'"
      ).get(patientId) as any;
      assert.strictEqual(convo, undefined, 'No conversation should be logged for unresolved query');
    });
  });
});
