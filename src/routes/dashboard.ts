import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { connectionStatus, qrCodeStr, pairingCode, lastError, restartWhatsApp } from '../whatsapp.js';
import { LLMGateway } from '../llm.js';
import { syncAppointmentToGoogleSheet } from '../sheets.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'vardan_secret_key_super_secure_9876';

// Middleware: Authenticate Admin JWT
export function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Access token missing' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// 1. Authentication
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '24h'
  });

  return res.json({ token, user: { name: user.name, username: user.username, role: user.role } });
});

router.get('/auth/me', authMiddleware, (req: any, res) => {
  return res.json({ user: req.user });
});

// 2. Doctor Management
router.get('/doctors', authMiddleware, (req, res) => {
  const doctors = db.prepare('SELECT * FROM doctors ORDER BY name ASC').all();
  return res.json(doctors);
});

router.post('/doctors', authMiddleware, (req: any, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only Owner can add doctors' });

  const { name, department, phone, weekly_schedule_json, fee } = req.body;
  if (!name || !department || !phone || !weekly_schedule_json || !fee) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO doctors (name, department, phone, weekly_schedule_json, fee)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, department, phone, weekly_schedule_json, fee);
    return res.status(201).json({ id: info.lastInsertRowid, name, department, phone, fee });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/doctors/:id', authMiddleware, (req: any, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only Owner can modify doctors' });

  const { id } = req.params;
  const { name, department, phone, weekly_schedule_json, fee, active } = req.body;

  try {
    db.prepare(`
      UPDATE doctors 
      SET name = ?, department = ?, phone = ?, weekly_schedule_json = ?, fee = ?, active = ?
      WHERE id = ?
    `).run(name, department, phone, weekly_schedule_json, fee, active, id);
    return res.json({ message: 'Doctor details updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/doctors/:id', authMiddleware, (req: any, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only Owner can remove doctors' });
  const { id } = req.params;

  try {
    // Soft delete / deactivate
    db.prepare('UPDATE doctors SET active = 0 WHERE id = ?').run(id);
    return res.json({ message: 'Doctor deactivated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Appointments Management
router.get('/appointments', authMiddleware, (req, res) => {
  const { doctor_id, date, status } = req.query;
  let query = `
    SELECT a.*, p.name as patient_name, p.phone as patient_phone, d.name as doctor_name, d.department 
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (doctor_id) {
    query += ' AND a.doctor_id = ?';
    params.push(doctor_id);
  }
  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  }
  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY a.date DESC, a.time_slot ASC';
  const appointments = db.prepare(query).all(...params);
  return res.json(appointments);
});

router.post('/appointments', authMiddleware, (req, res) => {
  const { patient_phone, doctor_id, date, time_slot } = req.body;
  if (!patient_phone || !doctor_id || !date || !time_slot) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Format patient phone to WhatsApp format
  const formattedJid = `${patient_phone.replace('+', '')}@s.whatsapp.net`;
  
  // Verify patient exists
  const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(formattedJid);
  if (!patient) {
    return res.status(404).json({ error: 'Patient with this phone number not registered on WhatsApp system' });
  }

  try {
    // Direct conflict double-check
    const conflict = db.prepare(`
      SELECT id FROM appointments 
      WHERE doctor_id = ? AND date = ? AND time_slot = ? AND status IN ('pending', 'confirmed', 'rescheduled')
    `).get(doctor_id, date, time_slot);

    if (conflict) {
      return res.status(409).json({ error: 'Time slot is already booked for this doctor' });
    }

    const info = db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, date, time_slot, status)
      VALUES (?, ?, ?, ?, 'confirmed')
    `).run(formattedJid, doctor_id, date, time_slot);

    // Sync to Google Spreadsheet in background
    const pRecord = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(formattedJid) as any;
    const dRecord = db.prepare('SELECT name FROM doctors WHERE id = ?').get(doctor_id) as any;
    syncAppointmentToGoogleSheet({
      patientName: pRecord.name,
      patientPhone: pRecord.phone,
      doctorName: dRecord.name,
      date,
      timeSlot: time_slot,
      status: 'confirmed'
    }).catch(err => console.error('Failed to sync manual appointment row:', err));

    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/appointments/:id/cancel', authMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
    return res.json({ message: 'Appointment cancelled' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. Patients View
router.get('/patients', authMiddleware, (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY name ASC').all();
  return res.json(patients);
});

router.get('/patients/:id/history', authMiddleware, (req, res) => {
  const { id } = req.params;
  const history = db.prepare(`
    SELECT * FROM conversations 
    WHERE patient_id = ? 
    ORDER BY timestamp ASC
  `).all(id);
  return res.json(history);
});

// 5. Knowledge Base Editor
router.get('/kb', authMiddleware, (req, res) => {
  const entries = db.prepare('SELECT * FROM knowledge_base ORDER BY category ASC').all();
  return res.json(entries);
});

router.post('/kb', authMiddleware, (req, res) => {
  const { category, question_variants, answer_hi, answer_en, answer_hinglish } = req.body;
  
  try {
    const info = db.prepare(`
      INSERT INTO knowledge_base (category, question_variants, answer_hi, answer_en, answer_hinglish)
      VALUES (?, ?, ?, ?, ?)
    `).run(category, JSON.stringify(question_variants), answer_hi, answer_en, answer_hinglish);
    
    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/kb/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { category, question_variants, answer_hi, answer_en, answer_hinglish } = req.body;

  try {
    db.prepare(`
      UPDATE knowledge_base 
      SET category = ?, question_variants = ?, answer_hi = ?, answer_en = ?, answer_hinglish = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(category, JSON.stringify(question_variants), answer_hi, answer_en, answer_hinglish, id);
    return res.json({ message: 'Knowledge base entry updated' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. Pending Queries
router.get('/pending-queries', authMiddleware, (req, res) => {
  const queries = db.prepare(`
    SELECT pq.*, p.name as patient_name, p.phone as patient_phone 
    FROM pending_queries pq
    JOIN patients p ON pq.patient_id = p.id
    WHERE pq.status = 'pending'
    ORDER BY pq.created_at DESC
  `).all();
  return res.json(queries);
});

router.post('/pending-queries/:id/resolve', authMiddleware, (req: any, res) => {
  const { id } = req.params;
  const { answer, addToKb, category, question_variants } = req.body;

  try {
    db.transaction(() => {
      // Mark resolved
      db.prepare(`
        UPDATE pending_queries 
        SET status = 'resolved', answered_by = ?, answer = ? 
        WHERE id = ?
      `).run(req.user.username, answer, id);

      // Optionally add to KB
      if (addToKb && category && question_variants) {
        db.prepare(`
          INSERT INTO knowledge_base (category, question_variants, answer_hi, answer_en, answer_hinglish)
          VALUES (?, ?, ?, ?, ?)
        `).run(category, JSON.stringify(question_variants), answer, answer, answer);
      }
    })();
    return res.json({ message: 'Query resolved successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Live Monitoring
router.get('/monitor/status', authMiddleware, (req, res) => {
  const keys = db.prepare('SELECT id, provider, cooldown_until, usage_count, active FROM llm_keys').all() as any[];
  
  // Format cooldowns to Boolean
  const formattedKeys = keys.map(k => ({
    id: k.id,
    provider: k.provider,
    usage: k.usage_count,
    active: k.active,
    coolingDown: k.cooldown_until > Date.now()
  }));

  // Fetch average latency and success rates from logs
  const logs = db.prepare(`
    SELECT provider, AVG(latency_ms) as avg_latency, 
           SUM(success) * 100.0 / COUNT(*) as success_rate 
    FROM llm_call_logs 
    WHERE timestamp >= datetime('now', '-24 hours')
    GROUP BY provider
  `).all() as any[];

  return res.json({
    whatsapp: {
      status: connectionStatus,
      qrAvailable: !!qrCodeStr,
      qrString: qrCodeStr,
      pairingCode: pairingCode,
      lastError: lastError
    },
    keys: formattedKeys,
    telemetry: logs
  });
});

// WhatsApp: Restart with optional phone number for pairing code
router.post('/whatsapp/restart', authMiddleware, async (req: any, res) => {
  try {
    const { phone } = req.body;
    restartWhatsApp(phone).catch(err => console.error('[Restart]', err));
    return res.json({ message: 'Restarting WhatsApp. Pairing code will appear in ~10 seconds.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 8. Analytics Stats
router.get('/monitor/stats', authMiddleware, (req, res) => {
  const patientsCount = (db.prepare('SELECT COUNT(*) as count FROM patients').get() as any).count;
  const appointmentsCount = (db.prepare('SELECT COUNT(*) as count FROM appointments').get() as any).count;
  const pendingQueriesCount = (db.prepare("SELECT COUNT(*) as count FROM pending_queries WHERE status = 'pending'").get() as any).count;

  // Follow-ups completion rates
  const followUps = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM follow_up_jobs 
    GROUP BY status
  `).all() as { status: string, count: number }[];

  // Daily API calls in last 7 days
  const callChart = db.prepare(`
    SELECT date(timestamp) as day, COUNT(*) as calls, SUM(success) as success 
    FROM llm_call_logs 
    WHERE timestamp >= datetime('now', '-7 days')
    GROUP BY day 
    ORDER BY day ASC
  `).all();

  return res.json({
    summary: {
      patients: patientsCount,
      appointments: appointmentsCount,
      pendingQueries: pendingQueriesCount
    },
    followUps,
    callChart
  });
});

export default router;

// ─── Follow-Up Jobs API ───────────────────────────────────────────────────────

// GET all follow-up jobs with patient + doctor info
router.get('/followups', authMiddleware, (req, res) => {
  const jobs = db.prepare(`
    SELECT f.id, f.patient_id, f.trigger_date, f.status, f.created_at,
           p.name as patient_name, p.phone as patient_phone,
           d.name as doctor_name
    FROM follow_up_jobs f
    JOIN patients p ON f.patient_id = p.id
    JOIN doctors d ON f.doctor_id = d.id
    ORDER BY f.trigger_date DESC
  `).all();
  return res.json(jobs);
});

// POST create a new follow-up job manually
router.post('/followups', authMiddleware, (req: any, res) => {
  const { patientId, doctorId, triggerDate } = req.body;
  if (!patientId || !doctorId || !triggerDate) {
    return res.status(400).json({ error: 'patientId, doctorId, triggerDate required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status)
      VALUES (?, ?, ?, 'medicine_reminder', 'pending')
    `).run(patientId, doctorId, triggerDate);
    return res.json({ id: result.lastInsertRowid, message: 'Follow-up scheduled' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
