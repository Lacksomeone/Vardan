import db from './db.js';
import { sendTextMessage } from './whatsapp.js';

// Hourly poll function for follow-up alerts and doctor escalations
export async function runSchedulerCheck() {
  console.log('[Scheduler] Running follow-up check...');

  const todayStr = new Date().toISOString().split('T')[0];
  
  // 1. Process PENDING jobs scheduled for today or earlier
  const pendingJobs = db.prepare(`
    SELECT f.*, 
           p.name as patient_name, p.phone as patient_phone, p.preferred_language,
           d.name as doctor_name, d.phone as doctor_phone, d.department as doctor_dept
    FROM follow_up_jobs f
    JOIN patients p ON f.patient_id = p.id
    JOIN doctors d ON f.doctor_id = d.id
    WHERE f.status = 'pending' AND f.trigger_date <= ?
  `).all(todayStr) as any[];

  for (const job of pendingJobs) {
    try {
      const name    = job.patient_name;
      const doctor  = job.doctor_name;
      const lang    = job.preferred_language as 'hi' | 'en' | 'hinglish';

      // Rich reminder message with doctor name + booking prompt
      const templates = {
        hi: `🏥 *वरदान हॉस्पिटल - फॉलो-अप रिमाइंडर*\n\nनमस्ते ${name} जी! 🙏\n\nआपकी दवाइयाँ कल खत्म हो रही हैं। कृपया कल *Dr. ${doctor}* से दोबारा मिलें या नई दवा लें।\n\n📅 क्या आप अभी अपॉइंटमेंट बुक करना चाहते हैं?\n👉 *"हाँ"* लिखें — हम तुरंत बुक करेंगे\n👉 *"ठीक हूँ"* लिखें — अगर आप ठीक हैं`,
        hinglish: `🏥 *Vardan Hospital - Follow-Up Reminder*\n\nNamaste ${name} ji! 🙏\n\nAapki dawaiyan kal khatam ho rahi hain. Kripya kal *Dr. ${doctor}* se dobara milein ya nai dawa lein.\n\n📅 Kya aap abhi appointment book karna chahte hain?\n👉 *"Haan"* likhein — hum turant book karenge\n👉 *"Theek hoon"* likhein — agar aap better hain`,
        en: `🏥 *Vardan Hospital - Follow-Up Reminder*\n\nHello ${name}! 🙏\n\nYour medicine course ends tomorrow. Please visit *Dr. ${doctor}* tomorrow for a follow-up or to renew your prescription.\n\n📅 Would you like to book an appointment now?\n👉 Reply *"Yes"* — we'll book it right away\n👉 Reply *"I'm fine"* — if you have recovered`
      };

      const message = templates[lang] || templates.hinglish;

      // Send via WhatsApp
      await sendTextMessage(job.patient_id, message);

      // Log in conversations
      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'follow_up_scheduler', ?)
      `).run(job.patient_id, message, lang);

      // Mark as sent
      db.prepare("UPDATE follow_up_jobs SET status = 'sent' WHERE id = ?").run(job.id);
      console.log(`[Scheduler] ✅ Follow-up sent to: ${name} (${job.patient_id})`);

    } catch (err) {
      console.error(`[Scheduler] Failed to send follow-up for job ${job.id}:`, err);
    }
  }

  // 2. Escalation: SENT jobs with no patient reply after 24 hours → alert doctor
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const sentJobs = db.prepare(`
    SELECT f.*, 
           p.name as patient_name, p.phone as patient_phone, p.age as patient_age,
           d.name as doctor_name, d.phone as doctor_phone
    FROM follow_up_jobs f
    JOIN patients p ON f.patient_id = p.id
    JOIN doctors d ON f.doctor_id = d.id
    WHERE f.status = 'sent' AND f.created_at <= ?
  `).all(twentyFourHoursAgo) as any[];

  for (const job of sentJobs) {
    try {
      // Check if patient replied after reminder was sent
      const patientReply = db.prepare(`
        SELECT COUNT(*) as count FROM conversations 
        WHERE patient_id = ? AND role = 'patient' AND timestamp > ?
      `).get(job.patient_id, job.created_at) as { count: number };

      if (patientReply.count > 0) {
        db.prepare("UPDATE follow_up_jobs SET status = 'responded' WHERE id = ?").run(job.id);
        console.log(`[Scheduler] Job ${job.id} marked responded.`);
        continue;
      }

      // No response — alert doctor on WhatsApp
      const doctorAlert = 
`⚠️ *Patient Follow-Up Alert*

Dr. ${job.doctor_name}, patient *${job.patient_name}* (Age: ${job.patient_age}, 📞 ${job.patient_phone}) ne kal ka follow-up reminder pakar bhi koi jawab nahi diya.

Please check on this patient at the earliest.

— Vardan Hospital Bot`;
      
      await sendTextMessage(job.doctor_phone, doctorAlert);
      db.prepare("UPDATE follow_up_jobs SET status = 'escalated' WHERE id = ?").run(job.id);
      console.log(`[Scheduler] ⚠️ Escalated to Dr. ${job.doctor_name} for patient ${job.patient_name}`);

    } catch (err) {
      console.error(`[Scheduler] Escalation failed for job ${job.id}:`, err);
    }
  }

  console.log(`[Scheduler] Check complete. Pending: ${pendingJobs.length}, Escalated: ${sentJobs.length}`);
}

// Start scheduler — runs every hour
export function startScheduler() {
  // First run after 15 seconds (let server fully start)
  setTimeout(() => {
    runSchedulerCheck().catch(console.error);
  }, 15000);

  // Then every hour
  setInterval(() => {
    runSchedulerCheck().catch(console.error);
  }, 60 * 60 * 1000);

  console.log('[Scheduler] ✅ Started — checking every hour for follow-up reminders');
}
