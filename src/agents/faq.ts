import db from '../db.js';
import { sendTextMessage } from '../whatsapp.js';
import { LLMGateway } from '../llm.js';

const MEDICAL_KEYWORDS = [
  'dawai', 'dawa', 'medicine', 'tablet', 'syrup', 'dose', 'dosage', 'treatment', 'cure', 'diagnose', 
  'diagnosis', 'disease', 'paracetamol', 'crocin', 'painkiller', 'antibiotic', 'symptom', 'ilaj', 
  'bimari', 'khurak', 'capsule', 'injection'
];

export async function handleFaqQuery(patientId: string, query: string, lang: 'hi' | 'en' | 'hinglish') {
  const queryLower = query.toLowerCase();

  // 1. Guard against medical advice
  const isMedicalQuery = MEDICAL_KEYWORDS.some(keyword => {
    // Check if keyword matches as a full word boundary
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(queryLower);
  });

  if (isMedicalQuery) {
    const medicalRedirect = {
      hi: 'कृपया सीधे डॉक्टर से परामर्श करें। मैं दवा या इलाज की सलाह नहीं दे सकता।',
      hinglish: 'Kripya seedhe doctor se consult karein. Main dawa ya ilaj ki advice nahi de sakta.',
      en: 'Please consult the doctor directly. I cannot give advice on medicine, dosage, or diagnosis.'
    };
    const reply = medicalRedirect[lang];
    
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'faq', lang);

    await sendTextMessage(patientId, reply);
    return;
  }

  // 2. Query Knowledge Base
  const kbEntries = db.prepare('SELECT * FROM knowledge_base').all() as any[];
  let matchedEntry: any = null;

  // Search for keyword matches in question variants
  for (const entry of kbEntries) {
    const variants = JSON.parse(entry.question_variants) as string[];
    const isMatched = variants.some(variant => {
      const vLower = variant.toLowerCase();
      return queryLower.includes(vLower) || vLower.includes(queryLower);
    });

    if (isMatched) {
      matchedEntry = entry;
      break;
    }
  }

  // 3. Handle Missing Knowledge Base (No Match) -> Escalation
  if (!matchedEntry) {
    // Log to pending_queries
    db.prepare(`
      INSERT INTO pending_queries (patient_id, question)
      VALUES (?, ?)
    `).run(patientId, query);

    const fallbackRedirect = {
      hi: 'मुझे यह जानकारी confirm करनी होगी, कृपया hospital reception पर संपर्क करें।',
      hinglish: 'Mujhe yeh jankari confirm karni hogi, kripya hospital reception par संपर्क karein.',
      en: 'I need to confirm this information, please contact the hospital reception.'
    };
    const reply = fallbackRedirect[lang];

    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'faq', lang);

    await sendTextMessage(patientId, reply);
    return;
  }

  // 4. Grounded RAG with LLM
  // Retrieve answer based on language
  let baseAnswer = '';
  if (lang === 'hi') {
    baseAnswer = matchedEntry.answer_hi;
  } else if (lang === 'hinglish') {
    baseAnswer = matchedEntry.answer_hinglish;
  } else {
    baseAnswer = matchedEntry.answer_en;
  }

  const systemPrompt = `You are the FAQ reception bot for Vardan Hospital (वरदान हॉस्पिटल) in Bahraich.
Your reply must be based strictly on the facts provided in the FACT block below.
Do not invent or add any information that is not in the FACT block. If the information is not in the FACT block, say you don't know.

FACT:
Category: ${matchedEntry.category}
Answer Details: ${baseAnswer}

INSTRUCTION:
- Rephrase the FACT naturally to answer the patient's query: "${query}"
- Write the reply in the script/language matching: "${lang}"
- If "hi", write ONLY in Devanagari script (Hindi).
- If "hinglish", write in Hinglish script (Roman characters with Hindi words).
- If "en", write in standard English.
- NEVER mix scripts or include markdown/HTML formatting.
- Keep the response short, clear, and direct.`;

  const llmGateway = LLMGateway.getInstance();
  try {
    const reply = await llmGateway.getChatCompletion('gemini', {
      systemPrompt,
      userPrompt: query
    });

    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'faq', lang);

    await sendTextMessage(patientId, reply);
  } catch (err) {
    console.error('FAQ Gemini call failed, sending raw DB answer:', err);
    // Fallback: Send raw DB answer if LLM fails
    db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', baseAnswer, 'faq', lang);

    await sendTextMessage(patientId, baseAnswer);
  }
}
