import { db } from './db.js';

interface ProviderKeys {
  groq: string[];
  gemini: string[];
  openrouter: string[];
}

export class LLMGateway {
  private keys: ProviderKeys = { groq: [], gemini: [], openrouter: [] };

  constructor() {}

  public async reloadKeys() {
    const rows = await db.all('SELECT provider, key_val FROM llm_keys WHERE active = 1');
    this.keys = { groq: [], gemini: [], openrouter: [] };
    
    for (const row of rows) {
      if (row.provider === 'groq') this.keys.groq.push(row.key_val as string);
      if (row.provider === 'gemini') this.keys.gemini.push(row.key_val as string);
      if (row.provider === 'openrouter') this.keys.openrouter.push(row.key_val as string);
    }
    console.log(`[LLM] Loaded keys - Groq: ${this.keys.groq.length}, Gemini: ${this.keys.gemini.length}, OpenRouter: ${this.keys.openrouter.length}`);
  }

  // A very simple function that tries to classify intent using whichever API has keys
  public async classifyIntent(message: string): Promise<{ intent: string, params: any }> {
    if (this.keys.gemini.length > 0) {
      return this.callGemini(message, this.keys.gemini[0]);
    } else if (this.keys.groq.length > 0) {
      return this.callGroq(message, this.keys.groq[0]);
    }
    
    // Fallback heuristic if no keys or API fails
    return this.heuristicFallback(message);
  }

  public async generateResponse(message: string, context: string): Promise<string> {
    const prompt = `Context: ${context}\n\nUser: ${message}\n\nYou are Vardan Hospital's AI Assistant. Respond in Hinglish or Hindi. Be helpful.`;
    
    if (this.keys.gemini.length > 0) {
      return this.callGeminiText(prompt, this.keys.gemini[0]);
    } else if (this.keys.groq.length > 0) {
      return this.callGroqText(prompt, this.keys.groq[0]);
    }

    return "Maaf kijiye, abhi system busy hai. Kripya thodi der baad message karein.";
  }

  private async callGemini(msg: string, key: string) {
    const prompt = `Classify this message into one of these intents: "book_appointment", "faq", "small_talk", "talk_to_human".
    Return ONLY JSON with this format: {"intent": "the_intent", "params": {}}.
    Message: "${msg}"`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await res.json() as any;
      const text = data.candidates[0].content.parts[0].text;
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      console.error("[LLM] Gemini classification error:", e);
      return this.heuristicFallback(msg);
    }
  }

  private async callGeminiText(prompt: string, key: string) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await res.json() as any;
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      return "Main thodi der mein jawab deta hoon. Error aaya.";
    }
  }

  private async callGroq(msg: string, key: string) {
    const prompt = `Classify this message into one of these intents: "book_appointment", "faq", "small_talk", "talk_to_human". Return ONLY JSON. Message: "${msg}"`;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json() as any;
      const text = data.choices[0].message.content;
      return JSON.parse(text);
    } catch (e) {
      return this.heuristicFallback(msg);
    }
  }

  private async callGroqText(prompt: string, key: string) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json() as any;
      return data.choices[0].message.content;
    } catch (e) {
      return "Maaf kijiye, abhi system busy hai.";
    }
  }

  private heuristicFallback(msg: string) {
    const l = msg.toLowerCase();
    if (l.includes('appointment') || l.includes('book') || l.includes('doctor') || l.includes('dikha')) {
      return { intent: 'book_appointment', params: {} };
    }
    if (l.includes('time') || l.includes('kab') || l.includes('address') || l.includes('kahan') || l.includes('fee')) {
      return { intent: 'faq', params: {} };
    }
    return { intent: 'small_talk', params: {} };
  }
}

export const llmGateway = new LLMGateway();
