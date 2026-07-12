import db from '../db.js';
import { sendTextMessage } from '../whatsapp.js';
import { LLMGateway } from '../llm.js';
import { handleBookingQuery } from './booking.js';

export async function handleFollowUpResponse(patientId: string, text: string, lang: 'hi' | 'en' | 'hinglish') {
  // 1. Find the latest sent/pending follow-up job for this patient
  const job = db.prepare(`
    SELECT * FROM follow_up_jobs 
    WHERE patient_id = ? AND status IN ('sent', 'pending')
    ORDER BY created_at DESC LIMIT 1
  `).get(patientId) as any;

  if (job) {
    // Update status to responded
    db.prepare("UPDATE follow_up_jobs SET status = 'responded' WHERE id = ?").run(job.id);
  }

  // 2. Classify response using LLM:
  // Is the patient feeling better (no appointment needed) OR do they still have symptoms / want to see the doctor?
  const systemPrompt = `You are the Follow-Up analysis assistant for Vardan Hospital.
Analyze the patient's recovery/health response: "${text}"
And decide if they:
1. "need_booking": Still have symptoms, feel worse, are in pain, or explicitly ask to book an appointment/see the doctor.
   Examples of "need_booking": 
   - "sar me dard hai", "dard ho raha hai", "bukhar hai", "relief nahi mila", "not feeling well", "still sick".
   - "appointment book kardo", "doctor se milna hai", "dikhaana hai".
2. "recovered": Feel better, recovery is complete, say they are fine, or thank the doctor, with no immediate medical visit required.
   Examples of "recovered":
   - "theek hu ab", "thik hu", "better now", "recovery complete", "ab dard nahi hai", "recovery ho gayi".
   - "thank you doctor", "dhanyawad", "shukriya".

Format output as strict JSON:
{"status": "need_booking" | "recovered"}`;

  const llmGateway = LLMGateway.getInstance();
  let status = 'recovered';
  try {
    const resultStr = await llmGateway.getChatCompletion('gemini', {
      systemPrompt,
      userPrompt: text,
      responseFormatJson: true
    });
    const parsed = JSON.parse(resultStr) as { status: 'need_booking' | 'recovered' };
    status = parsed.status;
  } catch (err) {
    console.error('Follow-up classification failed, defaulting to recovered:', err);
  }

  if (status === 'need_booking') {
    // Direct them to booking agent
    const bookingInvite = {
      hi: 'हम आपके स्वास्थ्य के बारे में चिंतित हैं। ऐसा लगता है कि आपको डॉक्टर से परामर्श लेने की आवश्यकता है। आइए आपके लिए एक अपॉइंटमेंट बुक करते हैं।',
      hinglish: 'Hum aapke health ke baare me concerned hain. Aisa lagta hai ki aapko doctor se consult karne ki zaroorat hai. Aaiye aapka appointment book karte hain.',
      en: 'We are concerned about your health. It seems you need to consult the doctor. Let us book an appointment for you.'
    };
    
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', bookingInvite[lang], 'follow_up', lang);

    await sendTextMessage(patientId, bookingInvite[lang]);
    
    // Switch to booking flow by calling booking query agent immediately
    await handleBookingQuery(patientId, 'book appointment', lang);
  } else {
    // Wish them well
    const wellWishes = {
      hi: 'यह सुनकर बहुत खुशी हुई कि आप बेहतर महसूस कर रहे हैं! वरदान हॉस्पिटल आपके अच्छे स्वास्थ्य की कामना करता है। यदि आपको भविष्य में किसी सहायता की आवश्यकता हो, तो कृपया संपर्क करें।',
      hinglish: 'Yeh sunkar bohot khushi hui ki aap better feel kar rahe hain! Vardan Hospital aapke acche health ki kamna karta hai. Agar future me koi zaroorat ho to connect karein.',
      en: 'Great to hear that you are feeling better! Vardan Hospital wishes you excellent health. If you need any assistance in the future, please feel free to reach out.'
    };

    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', wellWishes[lang], 'follow_up', lang);

    await sendTextMessage(patientId, wellWishes[lang]);
  }
}
