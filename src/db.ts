// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Ensure data directory exists
const dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vardan.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for performance
db.exec('PRAGMA journal_mode = WAL');

export function initDb() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      preferred_language TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

  // Migrate existing databases to add columns if they do not exist
  try {
    db.exec('ALTER TABLE doctors ADD COLUMN details TEXT;');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE doctors ADD COLUMN photo_url TEXT;');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE doctors ADD COLUMN services TEXT;');
  } catch (e) {}

  // Doctor documents table for categorized file uploads
  db.exec(`
    CREATE TABLE IF NOT EXISTS doctor_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );
  `);

  // Index for fast doctor document lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_doctor_documents_doctor ON doctor_documents(doctor_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      agent_used TEXT NOT NULL,
      language TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS follow_up_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      trigger_date TEXT NOT NULL,
      message_template TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      question_variants TEXT NOT NULL, -- JSON array of variants
      answer_hi TEXT NOT NULL,
      answer_en TEXT NOT NULL,
      answer_hinglish TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pending_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      answered_by TEXT,
      answer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS llm_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      key_index INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS llm_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      key_val TEXT UNIQUE NOT NULL,
      cooldown_until INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_patient ON conversations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, date);
    CREATE INDEX IF NOT EXISTS idx_follow_up_jobs_status_trigger ON follow_up_jobs(status, trigger_date);
  `);

  // Seed / update default admin user credentials (username: vardan, password: hospital)
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync('hospital', salt);
  const vardanUser = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('vardan');
  if (!vardanUser) {
    const oldAdmin = db.prepare("SELECT * FROM admin_users WHERE username = 'admin'").get();
    if (oldAdmin) {
      db.prepare(`
        UPDATE admin_users
        SET username = ?, password_hash = ?
        WHERE username = 'admin'
      `).run('vardan', hash);
      console.log("Updated existing admin user credentials to username: 'vardan', password: 'hospital'");
    } else {
      db.prepare(`
        INSERT INTO admin_users (name, username, role, password_hash)
        VALUES (?, ?, ?, ?)
      `).run('Vardan Owner', 'vardan', 'owner', hash);
      console.log("Created default admin user credentials with username: 'vardan', password: 'hospital'");
    }
  } else {
    db.prepare(`
      UPDATE admin_users
      SET password_hash = ?
      WHERE username = 'vardan'
    `).run(hash);
    console.log("Enforced password 'hospital' for username 'vardan'");
  }

  // Seed default doctors if empty
  const docCount = db.prepare('SELECT COUNT(*) as count FROM doctors').get() as { count: number };
  if (docCount.count === 0) {
    const doctors = [
      {
        name: 'Dr. Nitin Singh',
        department: 'Cardiology',
        phone: '+919415577651',
        fee: 500,
        weekly_schedule: JSON.stringify({
          Monday: ['10:00-14:00', '16:00-20:00'],
          Tuesday: ['10:00-14:00', '16:00-20:00'],
          Wednesday: ['10:00-14:00', '16:00-20:00'],
          Thursday: ['10:00-14:00', '16:00-20:00'],
          Friday: ['10:00-14:00', '16:00-20:00'],
          Saturday: ['10:00-14:00', '16:00-20:00']
        }),
        details: 'Specialist Cardiologist with 10+ years experience in heart surgeries, cardiovascular health, and pacemaker implantation.',
        photo_url: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=250&h=250&fit=crop',
        services: 'ECG, Echo, Angiography, BP Management, Heart Checkup'
      },
      {
        name: 'Dr. Ankit Sharma',
        department: 'General Medicine',
        phone: '+919415577652',
        fee: 300,
        weekly_schedule: JSON.stringify({
          Monday: ['09:00-13:00', '15:00-18:00'],
          Tuesday: ['09:00-13:00', '15:00-18:00'],
          Wednesday: ['09:00-13:00', '15:00-18:00'],
          Thursday: ['09:00-13:00', '15:00-18:00'],
          Friday: ['09:00-13:00', '15:00-18:00'],
          Saturday: ['09:00-13:00', '15:00-18:00']
        }),
        details: 'General Physician with expertise in family medicine, treating viral fevers, chronic illnesses, diabetes, and general health consultation.',
        photo_url: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=250&h=250&fit=crop',
        services: 'General OPD, Diabetes Care, Hypertension Management, Vaccination'
      },
      {
        name: 'Dr. Om Shukla',
        department: 'Pediatrics',
        phone: '+919415577653',
        fee: 400,
        weekly_schedule: JSON.stringify({
          Monday: ['10:00-15:00'],
          Tuesday: ['10:00-15:00'],
          Wednesday: ['10:00-15:00'],
          Thursday: ['10:00-15:00'],
          Friday: ['10:00-15:00'],
          Saturday: ['10:00-15:00']
        }),
        details: 'Dedicated Pediatrician specializing in newborn care, childhood nutrition, child development, vaccinations, and pediatric illnesses.',
        photo_url: 'https://images.unsplash.com/photo-1594824813573-246434de83fb?w=250&h=250&fit=crop',
        services: 'Newborn Checkup, Child Vaccination, Growth Monitoring, Pediatric OPD'
      }
    ];

    const stmt = db.prepare(`
      INSERT INTO doctors (name, department, phone, weekly_schedule_json, fee, details, photo_url, services)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const doc of doctors) {
      stmt.run(doc.name, doc.department, doc.phone, doc.weekly_schedule, doc.fee, doc.details, doc.photo_url, doc.services);
    }
    console.log('Seeded default doctors list');
  } else {
    // Populate details, photo_url, services if they are currently null in existing DB
    try {
      db.prepare(`UPDATE doctors SET details = ?, photo_url = ?, services = ? WHERE name = ? AND details IS NULL`).run(
        'Specialist Cardiologist with 10+ years experience in heart surgeries, cardiovascular health, and pacemaker implantation.',
        'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=250&h=250&fit=crop',
        'ECG, Echo, Angiography, BP Management, Heart Checkup',
        'Dr. Nitin Singh'
      );
      db.prepare(`UPDATE doctors SET details = ?, photo_url = ?, services = ? WHERE name = ? AND details IS NULL`).run(
        'General Physician with expertise in family medicine, treating viral fevers, chronic illnesses, diabetes, and general health consultation.',
        'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=250&h=250&fit=crop',
        'General OPD, Diabetes Care, Hypertension Management, Vaccination',
        'Dr. Ankit Sharma'
      );
      db.prepare(`UPDATE doctors SET details = ?, photo_url = ?, services = ? WHERE name = ? AND details IS NULL`).run(
        'Dedicated Pediatrician specializing in newborn care, childhood nutrition, child development, vaccinations, and pediatric illnesses.',
        'https://images.unsplash.com/photo-1594824813573-246434de83fb?w=250&h=250&fit=crop',
        'Newborn Checkup, Child Vaccination, Growth Monitoring, Pediatric OPD',
        'Dr. Om Shukla'
      );
      console.log('Updated existing doctors list with details, photo and services.');
    } catch (e) {
      console.error('Failed to update existing doctors columns:', e);
    }
  }


  // Seed LLM Keys from Env to DB (both comma-separated and individual formats supported!)
  const providers = ['groq', 'gemini', 'openrouter'];
  for (const prov of providers) {
    // 1. Check comma-separated variable first, e.g. GROQ_KEYS
    const csvKeys = process.env[`${prov.toUpperCase()}_KEYS`];
    if (csvKeys) {
      const keysList = csvKeys.split(',').map(k => k.trim()).filter(Boolean);
      for (const val of keysList) {
        db.prepare(`
          INSERT INTO llm_keys (provider, key_val)
          VALUES (?, ?)
          ON CONFLICT(key_val) DO UPDATE SET active = 1
        `).run(prov, val);
      }
      console.log(`Seeded ${keysList.length} ${prov} keys from comma-separated list`);
    } else {
      // 2. Fallback to individual variables, e.g. GROQ_KEY_1 ... GROQ_KEY_8
      for (let i = 1; i <= 8; i++) {
        const keyName = `${prov.toUpperCase()}_KEY_${i}`;
        const keyVal = process.env[keyName];
        if (keyVal) {
          db.prepare(`
            INSERT INTO llm_keys (provider, key_val)
            VALUES (?, ?)
            ON CONFLICT(key_val) DO UPDATE SET active = 1
          `).run(prov, keyVal);
        }
      }
    }
  }

  // Seed default knowledge base entries
  const kbCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get() as { count: number };
  if (kbCount.count === 0) {
    const kbEntries = [
      {
        category: 'timings',
        question_variants: JSON.stringify([
          'hospital timing', 'opening hours', 'what time does it open', 'kab khulta hai', 'timing kya hai',
          'samay', 'opd timing', 'hospital open time'
        ]),
        answer_hi: 'वरदान हॉस्पिटल 24 घंटे और सातों दिन (24/7) खुला रहता है। बस डॉक्टरों की शिफ्ट समय-समय पर बदलती रहती है। आपातकालीन सेवाएं हमेशा उपलब्ध हैं।',
        answer_en: 'Vardan Hospital is open 24/7. Only the doctors\' shifts change dynamically throughout the day. Emergency services are available round the clock.',
        answer_hinglish: 'Vardan Hospital 24/7 (24 ghante aur 7 din) khula rehta hai. Bas doctors ki shift change hoti rehti hai. Emergency services hamesha chalu hain.'
      },
      {
        category: 'location',
        question_variants: JSON.stringify([
          'location', 'address', 'where is it', 'kahan hai', 'pata kya hai', 'route', 'map', 'direction',
          'bahraich location', 'hospital address'
        ]),
        answer_hi: 'वरदान हॉस्पिटल का पता है: बहराइच, उत्तर प्रदेश। आप गूगल मैप्स पर "वरदान हॉस्पिटल बहराइच" खोजकर आ सकते हैं।',
        answer_en: 'Vardan Hospital is located in Bahraich, Uttar Pradesh. You can search for "Vardan Hospital Bahraich" on Google Maps for exact navigation.',
        answer_hinglish: 'Vardan Hospital ka address Bahraich, Uttar Pradesh hai. Google Maps par "Vardan Hospital Bahraich" search karke aap exact direction dekh sakte hain.'
      },
      {
        category: 'emergency',
        question_variants: JSON.stringify([
          'emergency', 'icu', 'accident', 'serious patient', 'ambulance', '24 hours', 'aapatkalin', 'urgency'
        ]),
        answer_hi: 'जी हाँ, वरदान हॉस्पिटल में 24 घंटे आपातकालीन सेवाएं, आईसीयू (ICU) और एम्बुलेंस सुविधा उपलब्ध है। आपातकाल में आप +91-9415577651 पर तुरंत कॉल कर सकते हैं।',
        answer_en: 'Yes, Vardan Hospital offers 24/7 emergency services, ICU support, and ambulance facility. In case of emergency, contact us at +91-9415577651.',
        answer_hinglish: 'Haan, Vardan Hospital me 24 ghante emergency services, ICU support aur ambulance facilities available hain. Emergency ke liye aap +91-9415577651 par contact karein.'
      },
      {
        category: 'insurance',
        question_variants: JSON.stringify([
          'insurance', 'ayushman card', 'cashless', 'tpa', 'health insurance', 'ayushman bharat', 'claim'
        ]),
        answer_hi: 'वरदान हॉस्पिटल आयुष्मान भारत योजना (Ayushman Bharat) और कई प्रमुख स्वास्थ्य बीमा (Health Insurance) कंपनियों के साथ कैशलेस इलाज की सुविधा प्रदान करता है। कृपया रिसेप्शन पर अपना कार्ड दिखाएं।',
        answer_en: 'Vardan Hospital supports Ayushman Bharat scheme and offers cashless treatments with major health insurance / TPA providers. Please verify at the reception desk.',
        answer_hinglish: 'Vardan Hospital me Ayushman Bharat scheme aur major health insurance companies ke sath cashless treatment ki facility available hai. Reception par cards verify karwa sakte hain.'
      }
    ];

    const kbStmt = db.prepare(`
      INSERT INTO knowledge_base (category, question_variants, answer_hi, answer_en, answer_hinglish)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const kb of kbEntries) {
      kbStmt.run(kb.category, kb.question_variants, kb.answer_hi, kb.answer_en, kb.answer_hinglish);
    }
    console.log('Seeded default knowledge base (RAG)');
  }

  // Force-update existing timings knowledge base row to make sure 24/7 timing is active
  db.prepare(`
    UPDATE knowledge_base 
    SET answer_hi = ?, answer_en = ?, answer_hinglish = ?
    WHERE category = 'timings'
  `).run(
    'वरदान हॉस्पिटल 24 घंटे और सातों दिन (24/7) खुला रहता है। बस डॉक्टरों की शिफ्ट समय-समय पर बदलती रहती है। आपातकालीन सेवाएं हमेशा उपलब्ध हैं।',
    'Vardan Hospital is open 24/7. Only the doctors\' shifts change dynamically throughout the day. Emergency services are available round the clock.',
    'Vardan Hospital 24/7 (24 ghante aur 7 din) khula rehta hai. Bas doctors ki shift change hoti rehti hai. Emergency services hamesha chalu hain.'
  );
  console.log('Updated existing timings knowledge base row to 24/7.');
}

export default db;
