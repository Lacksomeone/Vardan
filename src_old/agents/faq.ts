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
    
    await db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'faq', lang);

    await sendTextMessage(patientId, reply);
    return;
  }

  // 2. Query Knowledge Base
  const kbEntries = await db.prepare('SELECT * FROM knowledge_base').all() as any[];
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

  // 3. Smart LLM RAG Fallback
  if (!matchedEntry) {
    const kbText = kbEntries.map(e => `Category: ${e.category}\nFAQ Hindi: ${e.answer_hi}\nFAQ Hinglish: ${e.answer_hinglish}\nFAQ English: ${e.answer_en}`).join('\n\n');

    const fallbackSystemPrompt = `You are the FAQ reception bot for Vardan Hospital.
Below is the entire Vardan Hospital Knowledge Base (Facts):
--------------------------------------------------
${kbText}
--------------------------------------------------

INSTRUCTIONS:
1. Analyze the patient's query: "${query}"
2. If the query can be answered using the facts provided above, answer it naturally.
3. Write the reply in the requested language/script: "${lang}"
   - If "hi", write ONLY in Devanagari script (Hindi).
   - If "hinglish", write in Hinglish script (Roman characters with Hindi words).
   - If "en", write in standard English.
4. If the query CANNOT be answered using the facts provided, respond exactly with this JSON:
   {"can_answer": false}
5. If you CAN answer it, respond with this JSON format:
   {"can_answer": true, "answer": "<your natural reply here>"}

You must return a valid JSON object matching one of the two formats. Do not include markdown wraps (like \`\`\`json).`;

    const llmGateway = LLMGateway.getInstance();
    let parsedResult: { can_answer: boolean; answer?: string } = { can_answer: false };
    try {
      const responseStr = await llmGateway.getChatCompletion('groq', {
        systemPrompt: fallbackSystemPrompt,
        userPrompt: query,
        responseFormatJson: true
      });
      parsedResult = JSON.parse(responseStr);
    } catch (err) {
      console.error('Smart FAQ RAG fallback LLM call failed:', err);
    }

    if (parsedResult.can_answer && parsedResult.answer) {
      const reply = parsedResult.answer;
      await db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'faq', ?)
      `).run(patientId, reply, lang);

      await sendTextMessage(patientId, reply);
      return;
    }

    // Otherwise, escalate to pending_queries
    await db.prepare(`
      INSERT INTO pending_queries (patient_id, question)
      VALUES (?, ?)
    `).run(patientId, query);

    const fallbackRedirect = {
      hi: 'मुझे यह जानकारी confirm करनी होगी, कृपया hospital reception पर संपर्क करें।',
      hinglish: 'Mujhe yeh jankari confirm karni hogi, kripya hospital reception par संपर्क karein.',
      en: 'I need to confirm this information, please contact the hospital reception.'
    };
    const reply = fallbackRedirect[lang];

    await db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, 'bot', ?, 'faq', ?)
    `).run(patientId, reply, lang);

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

    await db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', reply, 'faq', lang);

    await sendTextMessage(patientId, reply);
  } catch (err) {
    console.error('FAQ Gemini call failed, sending raw DB answer:', err);
    // Fallback: Send raw DB answer if LLM fails
    await db.prepare(`
      INSERT INTO conversations (patient_id, role, message, agent_used, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(patientId, 'bot', baseAnswer, 'faq', lang);

    await sendTextMessage(patientId, baseAnswer);
  }
}

// Auto-resolve pending queries using AI
export async function autoResolvePendingQueries() {
  const pending = await db.prepare("SELECT * FROM pending_queries WHERE status = 'pending'").all() as any[];
  if (pending.length === 0) return;

  console.log(`[FAQ] Found ${pending.length} pending queries to auto-resolve...`);

  const kbEntries = await db.prepare('SELECT * FROM knowledge_base').all() as any[];
  const kbText = kbEntries.map(e => `Category: ${e.category}\nFAQ Hindi: ${e.answer_hi}\nFAQ Hinglish: ${e.answer_hinglish}\nFAQ English: ${e.answer_en}`).join('\n\n');

  const llmGateway = LLMGateway.getInstance();

  for (const q of pending) {
    // Get patient language
    const patient = await db.prepare('SELECT preferred_language FROM patients WHERE id = ?').get(q.patient_id) as any;
    const lang = patient?.preferred_language || 'hinglish';

    const fallbackSystemPrompt = `You are the FAQ reception bot for Vardan Hospital.
Below is the entire Vardan Hospital Knowledge Base (Facts):
--------------------------------------------------
${kbText}
--------------------------------------------------

INSTRUCTIONS:
1. Analyze the patient's pending query: "${q.question}"
2. If the query can be answered using the facts provided above, answer it naturally.
3. Write the reply in the script matching: "${lang}"
   - If "hi", write ONLY in Devanagari script (Hindi).
   - If "hinglish", write in Hinglish script (Roman characters with Hindi words).
   - If "en", write in standard English.
4. If the query CANNOT be answered using the facts provided, respond exactly with this JSON:
   {"can_answer": false}
5. If you CAN answer it, respond with this JSON format:
   {"can_answer": true, "answer": "<your natural reply here>"}

You must return a valid JSON object matching one of the two formats. Do not include markdown wraps (like \`\`\`json).`;

    try {
      const responseStr = await llmGateway.getChatCompletion('groq', {
        systemPrompt: fallbackSystemPrompt,
        userPrompt: q.question,
        responseFormatJson: true
      });
      const parsed = JSON.parse(responseStr) as { can_answer: boolean; answer?: string };
      
      if (parsed.can_answer && parsed.answer) {
        const reply = parsed.answer;
        
        // Manual transaction to mark resolved
        db.exec('BEGIN TRANSACTION');
        try {
          await db.prepare(`
            UPDATE pending_queries 
            SET status = 'resolved', answered_by = 'ai_auto_resolver', answer = ? 
            WHERE id = ?
          `).run(reply, q.id);

          await db.prepare(`
            INSERT INTO conversations (patient_id, role, message, agent_used, language)
            VALUES (?, 'bot', ?, 'faq_auto_resolver', ?)
          `).run(q.patient_id, reply, lang);
          db.exec('COMMIT');
        } catch (txErr) {
          try { db.exec('ROLLBACK'); } catch (_) {}
          throw txErr;
        }

        // Send message over WhatsApp
        await sendTextMessage(q.patient_id, reply);
        console.log(`[FAQ] ✅ Auto-resolved pending query id ${q.id} for patient ${q.patient_id}`);
      }
    } catch (err) {
      console.error(`[FAQ] Failed to auto-resolve query id ${q.id}:`, err);
    }
  }
}
