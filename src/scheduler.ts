import db from './db.js';
import { sendTextMessage } from './whatsapp.js';

// Hourly poll function for follow-up alerts and doctor escalations
export async function runSchedulerCheck() {
  console.log('Running scheduled follow-up check...');

  const todayStr = new Date().toISOString().split('T')[0];
  
  // 1. Process PENDING jobs that are scheduled for today or earlier
  const pendingJobs = db.prepare(`
    SELECT f.*, p.name as patient_name, p.phone as patient_phone, p.preferred_language, d.name as doctor_name
    FROM follow_up_jobs f
    JOIN patients p ON f.patient_id = p.id
    JOIN doctors d ON f.doctor_id = d.id
    WHERE f.status = 'pending' AND f.trigger_date <= ?
  `).all(todayStr) as any[];

  for (const job of pendingJobs) {
    try {
      const name = job.patient_name;
      const lang = job.preferred_language;

      const templates = {
        hi: `नमस्ते ${name} जी, कल आपकी दवा खत्म हो रही है। कृपया डॉक्टर से दोबारा मिलकर दवा कंटिन्यू करवाएं या फॉलो-अप अपॉइंटमेंट बुक कराएं।`,
        hinglish: `Namaste ${name} ji, kal aapki dawa khatam ho rahi hai. Kripya doctor se dobara milkar dawa continue karwayein ya follow-up appointment book karayein.`,
        en: `Namaste ${name} ji, your medicine course ends tomorrow. Please consult your doctor to continue your medicine or book a follow-up appointment.`
      };

      const message = templates[lang as 'hi' | 'en' | 'hinglish'] || templates.hinglish;

      // Send via WhatsApp
      await sendTextMessage(job.patient_id, message);

      // Log in conversations
      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'follow_up', ?)
      `).run(job.patient_id, message, lang);

      // Update status to sent
      db.prepare("UPDATE follow_up_jobs SET status = 'sent' WHERE id = ?").run(job.id);
      console.log(`Follow-up sent to patient: ${name} (${job.patient_id})`);
    } catch (err) {
      console.error(`Failed to send follow-up for job ${job.id}:`, err);
    }
  }

  // 2. Escalation Check: Process SENT jobs that are > 24 hours old
  // Check if patient hasn't responded to follow-up message
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const sentJobs = db.prepare(`
    SELECT f.*, p.name as patient_name, p.phone as patient_phone, p.age as patient_age, d.name as doctor_name, d.phone as doctor_phone
    FROM follow_up_jobs f
    JOIN patients p ON f.patient_id = p.id
    JOIN doctors d ON f.doctor_id = d.id
    WHERE f.status = 'sent' AND f.created_at <= ?
  `).all(twentyFourHoursAgo) as any[];

  for (const job of sentJobs) {
    try {
      // Check if there was any patient message after the job was sent
      const patientReply = db.prepare(`
        SELECT COUNT(*) as count FROM conversations 
        WHERE patient_id = ? AND role = 'patient' AND timestamp > ?
      `).get(job.patient_id, job.created_at) as { count: number };

      if (patientReply.count > 0) {
        // Patient did reply, mark job responded
        db.prepare("UPDATE follow_up_jobs SET status = 'responded' WHERE id = ?").run(job.id);
        console.log(`Job ${job.id} marked responded because patient message was found.`);
        continue;
      }

      // No response - Escalate to Doctor's WhatsApp
      const doctorMsg = `Namaste Dr. ${job.doctor_name}, follow-up alert: Patient ${job.patient_name} (Age: ${job.patient_age}, Phone: ${job.patient_phone}) did not respond to their medicine course completion reminder sent 24 hours ago. Please check.`;
      
      await sendTextMessage(job.doctor_phone, doctorMsg);
      
      // Update job status to escalated
      db.prepare("UPDATE follow_up_jobs SET status = 'escalated' WHERE id = ?").run(job.id);
      console.log(`Follow-up escalated to Dr. ${job.doctor_name} for patient ${job.patient_name}`);
    } catch (err) {
      console.error(`Failed to escalate follow-up job ${job.id} to doctor:`, err);
    }
  }
}

// Start persistent scheduler loop
export function startScheduler() {
  // Run on startup after short delay
  setTimeout(() => {
    runSchedulerCheck().catch(console.error);
  }, 10000);

  // Poll every hour (3600000 ms)
  setInterval(() => {
    runSchedulerCheck().catch(console.error);
  }, 60 * 60 * 1000);
}
