import { proto } from '@whiskeysockets/baileys';
import db from './db.js';
import { sendTextMessage } from './whatsapp.js';
import { LLMGateway } from './llm.js';
import { handleFaqQuery } from './agents/faq.js';
import { handleBookingQuery, hasActiveBookingSession, clearBookingSession } from './agents/booking.js';
import { handleFollowUpResponse } from './agents/followUp.js';
import { syncPatientToGoogleSheet } from './sheets.js';

// In-memory registration session map
interface RegSession {
  stage: 'lang_select' | 'name' | 'age' | 'gender';
  name?: string;
  age?: number;
  gender?: string;
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

// Helper to check if a string contains Devanagari characters
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

export async function handleIncomingMessage(msg: proto.IWebMessageInfo) {
  const patientId = msg.key.remoteJid;
  if (!patientId) return;

  const text = msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || '';
  
  if (!text.trim()) return;

  const phone = patientId.split('@')[0];

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
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'patient', text, 'booking', patient.preferred_language);

    await handleBookingQuery(patientId, text, patient.preferred_language);
    return;
  }

  // 3. Registered patient routing
  // Insert incoming message into conversations table
  db.prepare(`
    INSERT INTO conversations (patient_id, role, message, agent_used, language)
    VALUES (?, ?, ?, ?, ?)
  `).run(patientId, 'patient', text, 'router', patient.preferred_language);

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

  try {
    const routingResultStr = await llmGateway.getChatCompletion('groq', {
      systemPrompt,
      userPrompt: text,
      responseFormatJson: true
    });

    const result = JSON.parse(routingResultStr) as {
      language: 'hi' | 'en' | 'hinglish';
      intent: 'booking' | 'faq' | 'followup' | 'small_talk';
    };

    // Update patient preferred language if it differs
    if (result.language && result.language !== patient.preferred_language) {
      db.prepare('UPDATE patients SET preferred_language = ? WHERE id = ?').run(result.language, patientId);
      patient.preferred_language = result.language;
    }

    // Routing Logic
    switch (result.intent) {
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
  } catch (err) {
    console.error('Routing failed, defaulting to FAQ agent:', err);
    // Fallback: Default to FAQ agent
    await handleFaqQuery(patientId, text, patient.preferred_language);
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
    
    // Save to database
    db.prepare(`
      INSERT INTO patients (id, name, phone, age, gender, preferred_language)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(patientId, session.name, phone, session.age, gender, lang);

    // Sync to Google Spreadsheet
    syncPatientToGoogleSheet({
      name: session.name!,
      phone,
      age: session.age!,
      gender,
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
