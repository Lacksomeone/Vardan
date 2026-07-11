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
  stage: 'lang_select' | 'name' | 'age' | 'gender' | 'phone';
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

  const imageMsg = msg.message?.imageMessage;
  const audioMsg = msg.message?.audioMessage;
  let text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || '';
  let isVoice = false;

  // ─── Voice / Audio Transcription Flow ───
  if (audioMsg) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
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
      // Prompt unregistered patient to register first
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
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
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

  // 2.5 Bypass Orchestrator if there is an active booking session
  if (hasActiveBookingSession(patientId)) {
    // Log incoming message to conversations
    const loggedMessage = isVoice ? `🎤 [Voice Note]: ${text}` : text;
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'patient', loggedMessage, 'booking', patient.preferred_language);

    await handleBookingQuery(patientId, text, patient.preferred_language);
    return;
  }

  // 3. Registered patient routing
  // Insert incoming message into conversations table
  const loggedMessage = isVoice ? `🎤 [Voice Note]: ${text}` : text;
  db.prepare(`
    INSERT INTO conversations (patient_id, role, message, agent_used, language)
    VALUES (?, ?, ?, ?, ?)
  `).run(patientId, 'patient', loggedMessage, 'router', patient.preferred_language);

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
    const routingResultStr = await llmGateway.getChatCompletion('openrouter', {
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
    session.stage = 'name';
    
    const welcomeMsgs = {
      hi: '✅ बढ़िया! आप हमारे नए मरीज लग रहे हैं।\n\nरजिस्ट्रेशन के लिए कृपया अपना *पूरा नाम* लिखकर भेजें।',
      hinglish: '✅ Great! Aap hamare naye patient lag rahe hain.\n\nRegistration ke liye kripya apna *full name* likhkar bhejein.',
      en: '✅ Great! You appear to be a new patient.\n\nPlease reply with your *full name* to start registration.'
    };
    await sendTextMessage(patientId, welcomeMsgs[selectedLang]);
    return;
  }

  const lang = session.lang;

  if (session.stage === 'name') {
    session.name = text.trim();
    session.stage = 'age';

    const ageMsgs = {
      hi: 'धन्यवाद। अब कृपया अपनी उम्र (Age) लिखकर भेजें (उदाहरण: 25)।',
      hinglish: 'Thank you. Ab kripya apni age (umra) likhkar bhejein (e.g. 25).',
      en: 'Thank you. Now please reply with your age (e.g. 25).'
    };

    await sendTextMessage(patientId, ageMsgs[lang]);
    return;
  }

  if (session.stage === 'age') {
    const age = parseInt(text.trim(), 10);
    if (isNaN(age) || age <= 0 || age > 120) {
      const invalidAgeMsgs = {
        hi: 'कृपया एक सही उम्र (संख्या में) लिखकर भेजें।',
        hinglish: 'Kripya ek sahi age (numbers me) likhkar bhejein.',
        en: 'Please enter a valid age (as a number).'
      };
      await sendTextMessage(patientId, invalidAgeMsgs[lang]);
      return;
    }

    session.age = age;
    session.stage = 'gender';

    const genderMsgs = {
      hi: 'धन्यवाद। अब कृपया अपना लिंग (Gender) लिखकर भेजें: पुरुष (Male), महिला (Female), या अन्य (Other)।',
      hinglish: 'Thank you. Ab kripya apna gender likhkar bhejein: Male, Female, ya Other.',
      en: 'Thank you. Now please enter your gender: Male, Female, or Other.'
    };

    await sendTextMessage(patientId, genderMsgs[lang]);
    return;
  }

  if (session.stage === 'gender') {
    const gender = text.trim();
    session.gender = gender;
    session.stage = 'phone';

    const phoneMsgs = {
      hi: 'धन्यवाद। अब कृपया अपना संपर्क फ़ोन नंबर (Phone Number) लिखकर भेजें (उदाहरण: 9876543210)।',
      hinglish: 'Thank you. Ab kripya apna contact phone number likhkar bhejein (e.g. 9876543210).',
      en: 'Thank you. Now please reply with your contact phone number (e.g., 9876543210).'
    };

    await sendTextMessage(patientId, phoneMsgs[lang]);
    return;
  }

  if (session.stage === 'phone') {
    const inputPhone = text.trim().replace(/\D/g, ''); // Extract digits only

    if (inputPhone.length < 10 || inputPhone.length > 15) {
      const invalidPhoneMsgs = {
        hi: 'कृपया एक सही 10-अंकों का फ़ोन नंबर लिखकर भेजें (जैसे: 9876543210)।',
        hinglish: 'Kripya ek sahi 10-digit phone number likhkar bhejein (e.g. 9876543210).',
        en: 'Please enter a valid 10-digit phone number (e.g., 9876543210).'
      };
      await sendTextMessage(patientId, invalidPhoneMsgs[lang]);
      return;
    }

    // Check if phone number already exists
    const exists = db.prepare('SELECT id FROM patients WHERE phone = ?').get(inputPhone);
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
    `).run(patientId, session.name, inputPhone, session.age, session.gender, lang);

    // Sync to Google Spreadsheet
    syncPatientToGoogleSheet({
      name: session.name!,
      phone: inputPhone,
      age: session.age!,
      gender: session.gender!,
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
