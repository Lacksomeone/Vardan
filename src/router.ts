import { proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import db from './db.js';
import { sendTextMessage } from './whatsapp.js';
import { LLMGateway } from './llm.js';
import { handleFaqQuery } from './agents/faq.js';
import { handleBookingQuery, hasActiveBookingSession, clearBookingSession } from './agents/booking.js';
import { handleFollowUpResponse } from './agents/followUp.js';
import { syncPatientToGoogleSheet, syncAppointmentToGoogleSheet } from './sheets.js';

// In-memory registration session map
interface RegSession {
  stage: 'lang_select' | 'details_input';
  name?: string;
  age?: number;
  gender?: string;
  phone?: string;
  lang: 'hi' | 'en' | 'hinglish';
}

const regSessions: Record<string, RegSession> = {};

export function clearRegSession(patientId: string) {
  if (regSessions[patientId]) {
    delete regSessions[patientId];
    return true;
  }
  return false;
}

async function downloadMessageBuffer(msg: proto.IWebMessageInfo): Promise<Buffer | null> {
  if (process.env.NODE_ENV === 'test') {
    return Buffer.from('mock-media-buffer');
  }
  try {
    return await downloadMediaMessage(msg, 'buffer', {});
  } catch (err) {
    console.error('Failed to download media message:', err);
    return null;
  }
}

const langChangeSessions = new Set<string>();

function isLanguageChangeRequest(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const keywords = [
    'change language', 'switch language', 'choose language', 'select language', 'language change',
    'bhasha badlo', 'bhasha badlein', 'language badlo', 'language change karo', 'bhasha change',
    'change bhasha', 'change language please', 'language settings', 'bhasha setting'
  ];
  return keywords.some(k => lower.includes(k));
}

function getDirectLanguageSwitch(text: string): 'hi' | 'en' | 'hinglish' | null {
  const lower = text.toLowerCase().trim();
  
  // Hindi triggers
  if (
    lower === 'hindi' || lower === 'हिंदी' || 
    lower.includes('hindi me baat') || lower.includes('hindi please') || 
    lower.includes('hindi bhasha') || lower.includes('talk in hindi') ||
    lower.includes('use hindi')
  ) {
    return 'hi';
  }
  
  // English triggers
  if (
    lower === 'english' || 
    lower.includes('english me baat') || lower.includes('english please') || 
    lower.includes('talk in english') || lower.includes('use english')
  ) {
    return 'en';
  }
  
  // Hinglish triggers
  if (
    lower === 'hinglish' || 
    lower.includes('hinglish me baat') || lower.includes('hinglish please') || 
    lower.includes('talk in hinglish') || lower.includes('use hinglish')
  ) {
    return 'hinglish';
  }
  
  return null;
}

function isHindiScript(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

// Helper to classify language script
function detectInitialLanguage(text: string): 'hi' | 'en' | 'hinglish' {
  if (isHindiScript(text)) return 'hi';
  // Check basic English vs Hinglish indicators
  const lower = text.toLowerCase();
  const hinglishWords = ['hai', 'kab', 'kaha', 'ko', 'se', 'baje', 'dikhana', 'dawa', 'mera', 'umra', 'naam'];
  const hasHinglish = hinglishWords.some(w => lower.split(/\s+/).includes(w));
  return hasHinglish ? 'hinglish' : 'en';
}


function classifyHeuristically(text: string): 'booking' | 'faq' | 'followup' | 'small_talk' {
  const lower = text.toLowerCase();
  
  // Booking keywords
  if (
    lower.includes('book') || lower.includes('appointment') || lower.includes('slot') || 
    lower.includes('cancel') || lower.includes('reschedule') || lower.includes('doctor') ||
    lower.includes('time') || lower.includes('date') || lower.includes('appoint') ||
    lower.includes('radd') || lower.includes('badal') || lower.includes('milan') || 
    lower.includes('dikhana') || lower.includes('fees') || lower.includes('rupay') || 
    lower.includes('paisa')
  ) {
    return 'booking';
  }
  
  // Followup keywords
  if (
    lower.includes('recovery') || lower.includes('feeling better') || lower.includes('improved') || 
    lower.includes('worse') || lower.includes('pain') || lower.includes('side effect') ||
    lower.includes('aaram') || lower.includes('dard') || lower.includes('theek') ||
    lower.includes('better')
  ) {
    return 'followup';
  }
  
  // FAQ keywords
  if (
    lower.includes('timing') || lower.includes('address') || lower.includes('insurance') || 
    lower.includes('where') || lower.includes('pata') || lower.includes('location') || 
    lower.includes('kab') || lower.includes('kaha') || lower.includes('emergency') || 
    lower.includes('icu')
  ) {
    return 'faq';
  }
  
  return 'small_talk';
}

export async function handleIncomingMessage(msg: proto.IWebMessageInfo) {
  const patientId = msg.key.remoteJid;
  if (!patientId) return;

  console.log(`[Router] 🔄 Processing message from: ${patientId}`);

  const imageMsg = msg.message?.imageMessage;
  const audioMsg = msg.message?.audioMessage;
  let text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || '';
  let isVoice = false;

  // ─── Voice / Audio Transcription Flow ───
  if (audioMsg) {
    try {
      const buffer = await downloadMessageBuffer(msg);
      if (buffer) {
        const base64Data = buffer.toString('base64');
        const mimeType = audioMsg.mimetype || 'audio/ogg';
        const transcript = await LLMGateway.getInstance().transcribeAudio(base64Data, mimeType);
        if (transcript && transcript.trim()) {
          console.log(`[WhatsApp Voice Transcribe] Transcribed audio to: "${transcript}"`);
          text = transcript;
          isVoice = true;
        } else {
          console.log(`[WhatsApp Voice Transcribe] Empty transcript returned for audio message`);
          const patient = db.prepare('SELECT preferred_language FROM patients WHERE id = ?').get(patientId) as any;
          const lang = patient ? patient.preferred_language : 'hi';
          const cantUnderstand = {
            hi: '🎤 क्षमा करें, मैं आपके वॉयस मैसेज की आवाज़ नहीं समझ सका। कृपया टाइप करके भेजें या फिर से स्पष्ट वॉयस मैसेज भेजें।',
            hinglish: '🎤 Sorry, main aapke voice message ki aawaz nahi samajh saka. Kripya type karke bhejein ya clear voice message send karein.',
            en: '🎤 Sorry, I could not understand your voice message. Please reply with text or send a clearer voice message.'
          };
          await sendTextMessage(patientId, cantUnderstand[lang as 'hi' | 'en' | 'hinglish'] || cantUnderstand.en);
          return;
        }
      }
    } catch (err) {
      console.error('[WhatsApp Voice Transcribe] Transcription error:', err);
      return;
    }
  }
  
  if (!imageMsg && !text.trim()) return;

  const phone = patientId.split('@')[0];

  // ─── Image / Prescription Analysis Flow ───
  if (imageMsg) {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as any;
    if (!patient) {
      // Try to automatically register patient via OCR
      try {
        const buffer = await downloadMessageBuffer(msg);
        if (buffer) {
          const base64Data = buffer.toString('base64');
          const mimeType = imageMsg.mimetype || 'image/jpeg';

          const systemPrompt = `You are a medical registration assistant at Vardan Hospital, Bahraich.
Analyze the provided image (which could be a doctor's prescription, hospital slip, registration form, or old card).
Extract the patient's registration details:
1. "name": The full name of the patient.
2. "age": The age of the patient as an integer number.
3. "gender": The gender of the patient (must be "Male", "Female", or "Other").
4. "phone": The contact phone number of the patient (digits only).

If any detail is not mentioned or cannot be inferred, set it to null.
Format the output strictly as a JSON object.

JSON Schema:
{
  "name": string | null,
  "age": number | null,
  "gender": "Male" | "Female" | "Other" | null,
  "phone": string | null
}`;

          const userPrompt = `Extract the patient's registration details from this image.`;

          const rawResult = await LLMGateway.getInstance().analyzeDocument(
            base64Data,
            mimeType,
            systemPrompt,
            userPrompt
          );

          let cleaned = rawResult.trim();
          if (cleaned.includes('```')) {
            const match = cleaned.match(/```(?:json)?([\s\S]*?)```/);
            if (match && match[1]) {
              cleaned = match[1].trim();
            }
          }

          let parsedJson: any = { name: null, age: null, gender: null, phone: null };
          try {
            parsedJson = JSON.parse(cleaned);
          } catch (e) {
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              parsedJson = JSON.parse(cleaned.substring(start, end + 1));
            }
          }

          const finalName = parsedJson.name ? parsedJson.name.trim() : null;
          const finalAge = parsedJson.age ? Number(parsedJson.age) : null;
          const finalGender = parsedJson.gender || 'Other';
          const finalPhone = parsedJson.phone ? parsedJson.phone.replace(/\D/g, '') : phone;

          // If we successfully got Name and Age, we do auto-registration!
          if (finalName && finalAge && !isNaN(finalAge) && finalAge > 0 && finalAge <= 120) {
            const lang = 'hinglish'; // Default language for auto-registration

            // Check if phone number already exists
            const exists = db.prepare('SELECT id FROM patients WHERE phone = ?').get(finalPhone);
            if (!exists) {
              db.prepare(`
                INSERT INTO patients (id, name, phone, age, gender, preferred_language)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(patientId, finalName, finalPhone, finalAge, finalGender, lang);

              syncPatientToGoogleSheet({
                name: finalName,
                phone: finalPhone,
                age: finalAge,
                gender: finalGender,
                lang
              });

              const successMsg = `🏥 *Vardan Hospital, Bahraich*
              
✅ *Auto-Registration Successful!*
We extracted your details from the uploaded document:
- *Name*: ${finalName}
- *Age*: ${finalAge}
- *Gender*: ${finalGender}
- *Phone*: ${finalPhone}

How can Vardan Hospital help you today? (You can ask about doctors, timings, or book an appointment.)`;
              await sendTextMessage(patientId, successMsg);
              return;
            }
          }
        }
      } catch (err) {
        console.error('[WhatsApp Image Auto-Registration] OCR failed:', err);
      }

      // Fallback: Prompt unregistered patient to register manually
      const registerFirst = 
`🏥 *Vardan Hospital, Bahraich*

वरदान हॉस्पिटल में आपका स्वागत है!
प्रिस्क्रिप्शन भेजने से पहले कृपया अपना रजिस्ट्रेशन पूरा करें।

Please choose your language / भाषा चुनें:
1️⃣  हिंदी (Hindi)
2️⃣  English
3️⃣  Hinglish (Roman Hindi)

Reply with 1, 2, or 3`;
      regSessions[patientId] = { stage: 'lang_select', lang: 'hi' };
      await sendTextMessage(patientId, registerFirst);
      return;
    }

    const lang = patient.preferred_language as 'hi' | 'en' | 'hinglish';

    const processingMsgs = {
      hi: '📷 आपका फोटो मिल गया है। मैं प्रिस्क्रिप्शन (पर्चा) को पढ़ रहा हूँ, कृपया एक क्षण प्रतीक्षा करें... 🔍',
      hinglish: '📷 Aapka photo mil gaya hai. Main prescription (parcha) ko read kar raha hu, kripya ek moment wait karein... 🔍',
      en: '📷 We received your photo. I am analyzing the prescription slip, please wait a moment... 🔍'
    };
    await sendTextMessage(patientId, processingMsgs[lang]);

    try {
      // Download the image
      const buffer = await downloadMessageBuffer(msg);
      if (!buffer) throw new Error('Failed to download image message');

      const base64Data = buffer.toString('base64');
      const mimeType = imageMsg.mimetype || 'image/jpeg';

      const systemPrompt = `You are an expert medical administration assistant for Vardan Hospital, Bahraich.
Analyze the provided image, which should be a doctor's prescription slip, medicine bill, or treatment parcha.
Extract details in strict JSON format.

If the image is NOT a medical prescription, treatment note, or medicine prescription parcha, set "is_prescription" to false.

JSON Schema:
{
  "is_prescription": true | false,
  "doctor_name": "Name of the doctor (e.g. Dr. Nitin Singh, Dr. Ankit Sharma, Dr. Om Shukla) if visible, else null",
  "medicine_days": 5 // The maximum duration of the prescribed medicine course in days (e.g. 3, 5, 7, 10, 15). Look for text indicating days of dosage like "5 days", "3 din", "1 week" (7 days), "10 din", "bid x 5d". If a prescription is found but days are not specified, default to 5.
}`;

      const userPrompt = `Analyze this image and extract the prescription details matching the strict schema.`;
      
      const rawResult = await LLMGateway.getInstance().analyzeDocument(
        base64Data,
        mimeType,
        systemPrompt,
        userPrompt
      );

      let cleaned = rawResult.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
      }

      const parsed = JSON.parse(cleaned);

      if (!parsed.is_prescription) {
        const notPrescription = {
          hi: '❌ क्षमा करें, यह फोटो डॉक्टर का पर्चा (prescription) नहीं लग रहा है। कृपया पर्चे का साफ फोटो दोबारा भेजें।',
          hinglish: '❌ Sorry, yeh photo doctor ka parcha (prescription) nahi lag raha hai. Kripya parchi ka clear photo dobara bhejein.',
          en: '❌ Sorry, this image does not appear to be a doctor\'s prescription slip. Please send a clear photo of the prescription.'
        };
        await sendTextMessage(patientId, notPrescription[lang]);
        return;
      }

      const medicine_days = Number(parsed.medicine_days) || 5;

      // Log conversation message
      const logMsg = `[Sent Prescription Image] (AI Detected: ${medicine_days} days medicine course)`;
      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'patient', ?, 'router', ?)
      `).run(patientId, logMsg, lang);

      // Match doctor
      let doctorId = 1;
      if (parsed.doctor_name) {
        const docNameClean = parsed.doctor_name.toLowerCase().replace('dr.', '').trim();
        const matchedDoc = db.prepare('SELECT id FROM doctors WHERE name LIKE ?').get(`%${docNameClean}%`) as any;
        if (matchedDoc) doctorId = matchedDoc.id;
      }

      // Check for active appointment to mark completed
      const activeAppt = db.prepare(`
        SELECT * FROM appointments 
        WHERE patient_id = ? AND status IN ('confirmed', 'rescheduled', 'pending') 
        ORDER BY date DESC LIMIT 1
      `).get(patientId) as any;

      const apptDateStr = activeAppt ? activeAppt.date : new Date().toISOString().split('T')[0];

      if (activeAppt) {
        db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(activeAppt.id);
        
        try {
          const docRecord = db.prepare('SELECT name FROM doctors WHERE id = ?').get(activeAppt.doctor_id) as any;
          syncAppointmentToGoogleSheet({
            patientName: patient.name,
            patientPhone: patient.phone,
            doctorName: docRecord.name,
            date: activeAppt.date,
            timeSlot: activeAppt.time_slot,
            status: 'completed'
          }).catch(err => console.error('Failed to sync completed appointment row from image upload:', err));
        } catch (sheetErr) {
          console.error('Sheet sync failed on image completion:', sheetErr);
        }
      }

      // Delete existing pending follow-ups
      db.prepare("DELETE FROM follow_up_jobs WHERE patient_id = ? AND doctor_id = ? AND status = 'pending'").run(patientId, doctorId);

      // Compute trigger date: apptDateStr + (medicine_days - 1)
      const triggerDate = new Date(apptDateStr);
      triggerDate.setDate(triggerDate.getDate() + (medicine_days - 1));
      const followUpDateStr = triggerDate.toISOString().split('T')[0];

      // Schedule follow-up at 10:00 AM
      db.prepare(`
        INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status)
        VALUES (?, ?, ?, 'medicine_reminder', 'pending')
      `).run(patientId, doctorId, followUpDateStr + ' 10:00');

      const successMsgs = {
        hi: `🏥 *प्रिस्क्रिप्शन स्वीकृत!*\n\nनमस्ते ${patient.name} जी, हमें आपका पर्चा मिल गया है।\n\n📌 *दवा कोर्स*: ${medicine_days} दिन\n📅 *फॉलो-अप रिमाइंडर*: ${followUpDateStr}\n\nहमने आपके लिए follow-up रिमाइंडर सेट कर दिया है। दवा खत्म होने से 1 दिन पहले आपको मेसेज मिल जाएगा।`,
        hinglish: `🏥 *Prescription Accepted!*\n\nNamaste ${patient.name} ji, hume aapka parcha mil gaya hai.\n\n📌 *Medicine Course*: ${medicine_days} days\n📅 *Follow-up Reminder*: ${followUpDateStr}\n\nHumne aapke liye follow-up reminder set kar diya hai. Dawa khatam hone se 1 day pehle aapko message mil jayega.`,
        en: `🏥 *Prescription Approved!*\n\nHello ${patient.name}, we have received your prescription slip.\n\n📌 *Medicine Course*: ${medicine_days} days\n📅 *Follow-up Reminder*: ${followUpDateStr}\n\nWe have scheduled your follow-up reminder. You will receive a notification 1 day before your medicine runs out.`
      };
      
      const botResponse = successMsgs[lang];
      await sendTextMessage(patientId, botResponse);

      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'router', ?)
      `).run(patientId, botResponse, lang);

    } catch (err: any) {
      console.error('[WhatsApp Image Analysis] Error:', err);
      const errorMsg = {
        hi: '❌ क्षमा करें, आपका प्रिस्क्रिप्शन प्रोसेस करने में समस्या आई। कृपया फ़ोटो की क्वालिटी चेक करें या दोबारा भेजें।',
        hinglish: '❌ Sorry, aapka prescription process karne me problem aayi. Kripya photo ki quality check karein ya dobara bhejein.',
        en: '❌ Sorry, we had trouble processing your prescription image. Please ensure the photo is clear and try again.'
      };
      await sendTextMessage(patientId, errorMsg[lang]);
    }
    return;
  }



  // ─── Global Reset / Restart Check ───
  const cleanText = text.trim().toLowerCase();
  const resetKeywords = ['restart', 'reset', 'clear', 'shuru', 'phirse', 'shuru karein', 'menu', 'main menu', 'start again', 'start', 'exit', 'cancel'];
  const isReset = resetKeywords.includes(cleanText) || cleanText === '/restart' || cleanText === '/reset';

  if (isReset) {
    // Clear sessions
    delete regSessions[patientId];
    clearBookingSession(patientId);

    // Send reset message depending on registration status
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as any;
    if (!patient) {
      // Start registration flow again
      await handleRegistration(patientId, phone, '');
      return;
    } else {
      const resetMsgs = {
        hi: 'चैट को रीस्टार्ट कर दिया गया है। वरदान हॉस्पिटल आपकी क्या मदद कर सकता है? (आप डॉक्टरों की टाइमिंग के बारे में पूछ सकते हैं या अपॉइंटमेंट बुक कर सकते हैं।)',
        hinglish: 'Chat ko restart kar diya gaya hai. Vardan Hospital aapki kya help kar sakta hai? (Aap doctors, timings ke baare me pooch sakte hain ya appointment book kar sakte hain.)',
        en: 'The chat has been restarted. How can Vardan Hospital help you today? (You can ask about doctors, timings, or book an appointment.)'
      };
      await sendTextMessage(patientId, resetMsgs[patient.preferred_language as 'hi' | 'en' | 'hinglish'] || resetMsgs.en);
      return;
    }
  }

  // 1. Check if patient exists in DB
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as any;

  // 2. Handle Registration Flow
  if (!patient) {
    await handleRegistration(patientId, phone, text);
    return;
  }

  // 2.1 Handle Explicit/Direct Language Switch Requests
  const cleanInput = text.trim();
  if (langChangeSessions.has(patientId)) {
    let newLang: 'hi' | 'en' | 'hinglish' | null = null;
    if (cleanInput === '1') newLang = 'hi';
    else if (cleanInput === '2') newLang = 'en';
    else if (cleanInput === '3') newLang = 'hinglish';
    else {
      newLang = getDirectLanguageSwitch(text);
    }
    
    if (newLang) {
      try {
        db.prepare('UPDATE patients SET preferred_language = ? WHERE id = ?').run(newLang, patientId);
        patient.preferred_language = newLang;
        langChangeSessions.delete(patientId);
        
        const confirmMsgs = {
          hi: '🏥 भाषा को सफलतापूर्वक *हिंदी* में बदल दिया गया है। मैं अब आपसे हिंदी में बात करूँगा। आप अपनी समस्या बता सकते हैं।',
          en: '🏥 Language has been successfully switched to *English*. I will now communicate with you in English. Please tell me how I can help you.',
          hinglish: '🏥 Language successfully *Hinglish* me change ho gayi hai. Ab se main aapki hinglish me help karunga. Aap apni problem bata sakte hain.'
        };
        await sendTextMessage(patientId, confirmMsgs[newLang]);
        
        db.prepare(`
          INSERT INTO conversations (patient_id, role, message, agent_used, language)
          VALUES (?, 'bot', ?, 'router', ?)
        `).run(patientId, confirmMsgs[newLang], newLang);
        return;
      } catch (err) {
        console.error('Failed to update language from session:', err);
      }
    } else {
      langChangeSessions.delete(patientId);
    }
  }

  if (isLanguageChangeRequest(text)) {
    langChangeSessions.add(patientId);
    const langMenu = 
`🏥 *Vardan Hospital, Bahraich*

Please choose your language / भाषा चुनें:
1️⃣  हिंदी (Hindi)
2️⃣  English
3️⃣  Hinglish (Roman Hindi)

Reply with 1, 2, or 3`;
    await sendTextMessage(patientId, langMenu);
    return;
  }

  const directLang = getDirectLanguageSwitch(text);
  if (directLang) {
    try {
      db.prepare('UPDATE patients SET preferred_language = ? WHERE id = ?').run(directLang, patientId);
      patient.preferred_language = directLang;
      
      const confirmMsgs = {
        hi: '🏥 भाषा को सफलतापूर्वक *हिंदी* में बदल दिया गया है। मैं अब आपसे हिंदी में बात करूँगा। आप अपनी समस्या बता सकते हैं।',
        en: '🏥 Language has been successfully switched to *English*. I will now communicate with you in English. Please tell me how I can help you.',
        hinglish: '🏥 Language successfully *Hinglish* me change ho gayi hai. Ab se main aapki hinglish me help karunga. Aap apni problem bata sakte hain.'
      };
      await sendTextMessage(patientId, confirmMsgs[directLang]);
      
      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'router', ?)
      `).run(patientId, confirmMsgs[directLang], directLang);
      return;
    } catch (err) {
      console.error('Failed to update direct language:', err);
    }
  }

  // 3. Registered patient routing
  // Insert incoming message into conversations table
  const loggedMessage = isVoice ? `🎤 [Voice Note]: ${text}` : text;
  const agentUsedForLog = hasActiveBookingSession(patientId) ? 'booking' : 'router';
  db.prepare(`
    INSERT INTO conversations (patient_id, role, message, agent_used, language)
    VALUES (?, ?, ?, ?, ?)
  `).run(patientId, 'patient', loggedMessage, agentUsedForLog, patient.preferred_language);

  // Call LLM Router for intent classification and language check
  const llmGateway = LLMGateway.getInstance();
  const systemPrompt = `You are the Orchestrator for Vardan Hospital (वरदान हॉस्पिटल) in Bahraich.
Analyze the user's incoming message and return a JSON object with:
1. "language": "hi" (Devanagari script), "en" (standard English), or "hinglish" (Hindi phrase in Latin/Roman script).
2. "intent": "booking" (appointment scheduling/cancellation/reschedule), "faq" (hospital questions about timings, doctors, departments, fees, address, policies), "followup" (responses regarding recovery/medication/follow-up reminders), or "small_talk" (greetings/thanks/pleasantries).

Format the output strictly as JSON. Do not include any markups or markdown outside the JSON block.

JSON Schema:
{
  "language": "hi" | "en" | "hinglish",
  "intent": "booking" | "faq" | "followup" | "small_talk"
}`;

  let classifiedIntent: 'booking' | 'faq' | 'followup' | 'small_talk' = 'small_talk';
  let detectedLang = patient.preferred_language || 'en';

  try {
    const routingResultStr = await llmGateway.getChatCompletion('gemini', {
      systemPrompt,
      userPrompt: text,
      responseFormatJson: true
    });

    const result = JSON.parse(routingResultStr) as {
      language: 'hi' | 'en' | 'hinglish';
      intent: 'booking' | 'faq' | 'followup' | 'small_talk';
    };

    if (result.intent) {
      classifiedIntent = result.intent;
    } else {
      classifiedIntent = classifyHeuristically(text);
    }

    if (result.language) {
      detectedLang = result.language;
    }
  } catch (err) {
    console.error('LLM Intent classification failed, using heuristic classification:', err);
    classifiedIntent = classifyHeuristically(text);
    detectedLang = detectInitialLanguage(text);
  }

  // Update patient preferred language if it differs
  if (detectedLang !== patient.preferred_language) {
    try {
      db.prepare('UPDATE patients SET preferred_language = ? WHERE id = ?').run(detectedLang, patientId);
      patient.preferred_language = detectedLang;
    } catch (e) {
      console.error('Failed to update patient language:', e);
    }
  }

  // Bypass Orchestrator intent routing if there is an active booking session
  if (hasActiveBookingSession(patientId)) {
    await handleBookingQuery(patientId, text, patient.preferred_language);
    return;
  }

  // Route to the selected agent with isolated try-catch
  try {
    switch (classifiedIntent) {
      case 'booking':
        await handleBookingQuery(patientId, text, patient.preferred_language);
        break;
      case 'faq':
        await handleFaqQuery(patientId, text, patient.preferred_language);
        break;
      case 'followup':
        await handleFollowUpResponse(patientId, text, patient.preferred_language);
        break;
      case 'small_talk':
      default:
        await handleSmallTalk(patientId, text, patient.preferred_language);
        break;
    }
  } catch (agentErr) {
    console.error(`Agent execution failed for intent "${classifiedIntent}":`, agentErr);
    // Send a polite user-facing error message instead of cascading to FAQ fallback
    const errorMsgs = {
      hi: 'क्षमा करें, आपके अनुरोध को प्रोसेस करने में कुछ तकनीकी समस्या आई है। कृपया दोबारा प्रयास करें या सीधे अस्पताल रिसेप्शन से संपर्क करें।',
      hinglish: 'Sorry, aapke request ko process karne me kuch technical error aayi hai. Kripya dobara try karein ya seedhe hospital reception se contact karein.',
      en: 'Sorry, we encountered a technical issue while processing your request. Please try again or contact the hospital reception directly.'
    };
    await sendTextMessage(patientId, errorMsgs[patient.preferred_language as 'hi' | 'en' | 'hinglish'] || errorMsgs.en);
  }
}


// Registration state machine
// Registration state machine
async function handleRegistration(patientId: string, phone: string, text: string) {
  let session = regSessions[patientId];

  if (!session) {
    // First message — show language selection menu
    regSessions[patientId] = { stage: 'lang_select', lang: 'hi' };
    
    const langMenu = 
`🏥 *Vardan Hospital, Bahraich*
वरदान हॉस्पिटल, बहराइच में आपका स्वागत है!

Please choose your language / भाषा चुनें:

1️⃣  हिंदी (Hindi)
2️⃣  English
3️⃣  Hinglish (Roman Hindi)

Reply with 1, 2, or 3`;
    
    await sendTextMessage(patientId, langMenu);
    return;
  }

  // Language selection stage
  if (session.stage === 'lang_select') {
    const choice = text.trim();
    let selectedLang: 'hi' | 'en' | 'hinglish' = 'hinglish';
    
    if (choice === '1' || choice.toLowerCase().includes('hindi') || choice.includes('हिंदी')) {
      selectedLang = 'hi';
    } else if (choice === '2' || choice.toLowerCase().includes('english')) {
      selectedLang = 'en';
    } else if (choice === '3' || choice.toLowerCase().includes('hinglish')) {
      selectedLang = 'hinglish';
    } else {
      // Auto-detect from text if not a valid choice
      selectedLang = detectInitialLanguage(text);
    }
    
    session.lang = selectedLang;
    session.stage = 'details_input';
    
    const welcomeMsgs = {
      hi: '✅ बढ़िया! आप हमारे नए मरीज लग रहे हैं।\n\nरजिस्ट्रेशन पूरा करने के लिए कृपया अपनी निम्नलिखित जानकारी एक ही मेसेज में भेजें:\n- *पूरा नाम* (Full Name)\n- *उम्र* (Age)\n- *लिंग* (Gender)\n- *फ़ोन नंबर* (Phone Number - वैकल्पिक)\n\n(उदाहरण: Nitin Kumar, 25, Male, 9876543210)',
      hinglish: '✅ Great! Aap hamare naye patient lag rahe hain.\n\nRegistration complete karne ke liye kripya apni details ek hi message me send karein:\n- *Full Name* (पूरा नाम)\n- *Age* (उम्र)\n- *Gender* (लिंग)\n- *Phone Number* (फ़ोन नंबर - Optional)\n\n(e.g., Nitin Kumar, 25, Male, 9876543210)',
      en: '✅ Great! You appear to be a new patient.\n\nTo complete registration, please reply with your details in a single message:\n- *Full Name*\n- *Age*\n- *Gender*\n- *Phone Number* (Optional)\n\n(e.g., Alice Smith, 25, Female, 9876543210)'
    };
    await sendTextMessage(patientId, welcomeMsgs[selectedLang]);
    return;
  }

  const lang = session.lang;

  if (session.stage === 'details_input') {
    const llmGateway = LLMGateway.getInstance();
    const systemPrompt = `You are a medical registration assistant at Vardan Hospital.
Extract the patient's registration details from their message.
Analyze the message and extract:
1. "name": The full name of the patient.
2. "age": The age of the patient as a integer number.
3. "gender": The gender of the patient (must be "Male", "Female", or "Other").
4. "phone": The contact phone number of the patient (digits only).

If any detail is not mentioned or cannot be inferred, set it to null.
Format the output strictly as a JSON object. Do not include markdown wraps.

JSON Schema:
{
  "name": string | null,
  "age": number | null,
  "gender": "Male" | "Female" | "Other" | null,
  "phone": string | null
}`;

    let parsed: {
      name: string | null;
      age: number | null;
      gender: 'Male' | 'Female' | 'Other' | null;
      phone: string | null;
    } = { name: null, age: null, gender: null, phone: null };

    try {
      const parsedStr = await llmGateway.getChatCompletion('groq', {
        systemPrompt,
        userPrompt: text,
        responseFormatJson: true
      });

      let cleaned = parsedStr.trim();
      if (cleaned.includes('```')) {
        const match = cleaned.match(/```(?:json)?([\s\S]*?)```/);
        if (match && match[1]) {
          cleaned = match[1].trim();
        }
      }
      
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(cleaned.substring(start, end + 1));
        } else {
          throw e;
        }
      }
    } catch (err: any) {
      console.warn(`[Registration LLM Parse] JSON parse failed (${err.message || err}). Falling back to heuristics.`);
    }

    // Heuristics Fallbacks for robust parsing:
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Phone fallback
    let phoneFallback: string | null = null;
    const possiblePhoneMatch = text.match(/\b\d[\d\s-]{8,14}\d\b/);
    if (possiblePhoneMatch) {
      const cleanedPhone = possiblePhoneMatch[0].replace(/\D/g, '');
      if (cleanedPhone.length >= 10 && cleanedPhone.length <= 15) {
        phoneFallback = cleanedPhone;
      }
    }

    // 2. Age fallback
    let ageFallback: number | null = null;
    const ageRegex = /\b(age\s*is?\s*)?(\d{1,3})\s*(years?|yrs?|yr|old|y\/o|साल|वर्ष)\b/i;
    const ageMatch = text.match(ageRegex);
    if (ageMatch) {
      const val = Number(ageMatch[2]);
      if (val > 0 && val <= 120) {
        ageFallback = val;
      }
    } else {
      // Find a standalone number in the lines or any 1-3 digit number that is not part of phone
      for (const line of lines) {
        const lineNum = Number(line.replace(/\D/g, ''));
        if (!isNaN(lineNum) && lineNum > 0 && lineNum <= 120 && line.length <= 3) {
          ageFallback = lineNum;
          break;
        }
      }
      if (!ageFallback) {
        const numbers = text.match(/\b\d{1,3}\b/g);
        if (numbers) {
          for (const numStr of numbers) {
            const val = Number(numStr);
            if (val > 0 && val <= 120) {
              if (phoneFallback && phoneFallback.includes(numStr)) continue;
              if (phone && phone.includes(numStr)) continue;
              ageFallback = val;
              break;
            }
          }
        }
      }
    }

    // 3. Gender fallback
    let genderFallback: 'Male' | 'Female' | 'Other' | null = null;
    const lowerText = text.toLowerCase();
    if (/\b(male|man|boy|m|पुरुष|आदमी|लड़का)\b/i.test(lowerText)) {
      genderFallback = 'Male';
    } else if (/\b(female|woman|girl|f|महिला|स्त्री|औरत|लड़की)\b/i.test(lowerText)) {
      genderFallback = 'Female';
    } else if (/\b(other|others|trans|transgender|तीसरा)\b/i.test(lowerText)) {
      genderFallback = 'Other';
    }

    // 4. Name fallback
    let nameFallback: string | null = null;
    for (const line of lines) {
      const hasDigits = /\d/.test(line);
      const isGenderWord = /^(male|female|other|m|f|boy|girl|man|woman|पुरुष|महिला|अन्य|ok|yes|no)$/i.test(line);
      if (!hasDigits && !isGenderWord && line.length > 2) {
        nameFallback = line;
        break;
      }
    }
    if (!nameFallback) {
      const parts = text.split(/[,，|;\-\n]/).map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        const hasDigits = /\d/.test(part);
        const isGenderWord = /^(male|female|other|m|f|boy|girl|man|woman|पुरुष|महिला|अन्य|ok|yes|no)$/i.test(part);
        if (!hasDigits && !isGenderWord && part.length > 2) {
          nameFallback = part;
          break;
        }
      }
    }

    const finalName = (parsed.name && parsed.name.trim()) ? parsed.name.trim() : (nameFallback ? nameFallback.trim() : null);
    const finalAge = (parsed.age && !isNaN(Number(parsed.age))) ? Number(parsed.age) : ageFallback;
    const finalGender = parsed.gender || genderFallback || 'Other';
    const finalPhone = (parsed.phone && parsed.phone.replace(/\D/g, '')) ? parsed.phone.replace(/\D/g, '') : (phoneFallback || phone);

    if (!finalName || !finalAge || isNaN(finalAge) || finalAge <= 0 || finalAge > 120) {
      const invalidMsgs = {
        hi: '❌ कृपया अपना विवरण सही प्रारूप में भेजें।\nसुनिश्चित करें कि नाम और उम्र (संख्या में) स्पष्ट रूप से लिखे हों।\n(जैसे: Nitin Kumar, 25, Male)',
        hinglish: '❌ Kripya apna details sahi format me send karein.\nMake sure name aur age (numbers me) clear likha ho.\n(e.g. Nitin Kumar, 25, Male)',
        en: '❌ Please provide your details in a valid format.\nMake sure your name and age (as a number) are clearly specified.\n(e.g. Alice Smith, 25, Female)'
      };
      await sendTextMessage(patientId, invalidMsgs[lang]);
      return;
    }

    // Skip phone length validation for @lid JIDs (LID number != standard phone number)
    const isLidJid = patientId.endsWith('@lid');
    if (!isLidJid && (finalPhone.length < 10 || finalPhone.length > 15)) {
      const invalidPhoneMsgs = {
        hi: 'कृपया एक सही 10-अंकों का फ़ोन नंबर लिखकर भेजें (जैसे: 9876543210)।',
        hinglish: 'Kripya ek sahi 10-digit phone number likhkar bhejein (e.g. 9876543210).',
        en: 'Please enter a valid 10-digit phone number (e.g., 9876543210).'
      };
      await sendTextMessage(patientId, invalidPhoneMsgs[lang]);
      return;
    }

    // Check if phone number already exists
    const exists = db.prepare('SELECT id FROM patients WHERE phone = ?').get(finalPhone);
    if (exists) {
      const existsMsgs = {
        hi: 'यह फ़ोन नंबर पहले से ही किसी अन्य मरीज के साथ रजिस्टर्ड है। कृपया दूसरा नंबर लिखकर भेजें।',
        hinglish: 'Yeh phone number pehle se kisi aur patient ke sath registered hai. Kripya doosra number likhein.',
        en: 'This phone number is already registered with another patient. Please enter a different number.'
      };
      await sendTextMessage(patientId, existsMsgs[lang]);
      return;
    }

    // Save to database
    db.prepare(`
      INSERT INTO patients (id, name, phone, age, gender, preferred_language)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(patientId, finalName, finalPhone, finalAge, finalGender, lang);

    // Sync to Google Spreadsheet
    syncPatientToGoogleSheet({
      name: finalName,
      phone: finalPhone,
      age: finalAge,
      gender: finalGender,
      lang
    }).catch(err => console.error('Failed to sync to Google Sheets:', err));

    delete regSessions[patientId];

    const completeMsgs = {
      hi: `आपका रजिस्ट्रेशन सफल रहा! वरदान हॉस्पिटल आपकी क्या मदद कर सकता है? (आप डॉक्टरों की टाइमिंग के बारे में पूछ सकते हैं या अपॉइंटमेंट बुक कर सकते हैं।)`,
      hinglish: `Aapka registration complete ho gaya hai! Vardan Hospital aapki kya help kar sakta hai? (Aap doctors, timings ke baare me pooch sakte hain ya appointment book kar sakte hain.)`,
      en: `Your registration is complete! How can Vardan Hospital help you today? (You can ask about doctors, timings, or book an appointment.)`
    };

    await sendTextMessage(patientId, completeMsgs[lang]);
  }
}

// Small talk responder
async function handleSmallTalk(patientId: string, text: string, lang: 'hi' | 'en' | 'hinglish') {
  const systemPrompt = `You are a helpful and polite reception assistant at Vardan Hospital (वरदान हॉस्पिटल), Bahraich.
The patient says: "${text}"
The patient's preferred language/script is: "${lang}"

Respond appropriately (e.g. thank them, say hello, or guide them on what they can ask). Keep your response concise (1-2 sentences max).
Write the response in the script of the patient's language:
- If "hi", write only in Hindi script (Devanagari).
- If "hinglish", write in Hinglish script (Roman characters with Hindi words).
- If "en", write in normal English.

Do not mix scripts in the response. Do not give any medical advice.`;

  const llmGateway = LLMGateway.getInstance();
  try {
    const reply = await llmGateway.getChatCompletion('groq', {
      systemPrompt,
      userPrompt: text
    });

    // Write outgoing message to DB
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'router', lang);

    await sendTextMessage(patientId, reply);
  } catch (err) {
    console.error('Small talk failed, sending hardcoded greeting:', err);
    const fallback = {
      hi: 'नमस्ते, वरदान हॉस्पिटल में आपका स्वागत है। मैं आपकी क्या मदद कर सकता हूँ?',
      hinglish: 'Namaste, Vardan Hospital me aapka swagat hai. Main aapki kya help kar sakta hu?',
      en: 'Hello, welcome to Vardan Hospital. How can I assist you today?'
    };
    await sendTextMessage(patientId, fallback[lang]);
  }
}
