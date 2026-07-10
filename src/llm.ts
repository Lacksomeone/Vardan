import db from './db.js';
import { LLMKeyRecord } from './types.js';

interface LLMCallParams {
  systemPrompt: string;
  userPrompt: string;
  responseFormatJson?: boolean;
}

export class LLMGateway {
  private static instance: LLMGateway;
  private keys: LLMKeyRecord[] = [];

  private constructor() {
    this.reloadKeys();
  }

  public static getInstance(): LLMGateway {
    if (!LLMGateway.instance) {
      LLMGateway.instance = new LLMGateway();
    }
    return LLMGateway.instance;
  }

  // Reload keys from SQLite DB
  public reloadKeys(): void {
    const records = db.prepare('SELECT * FROM llm_keys WHERE active = 1').all() as LLMKeyRecord[];
    this.keys = records;
    console.log(`Loaded ${this.keys.length} active LLM keys from database.`);
  }

  // Pick a batch of N available keys, sorted by usage (least used first)
  private pickKeysBatch(count: number): LLMKeyRecord[] {
    const now = Date.now();
    const availableKeys = this.keys.filter(
      (k) => k.cooldown_until < now && k.active === 1
    );

    if (availableKeys.length === 0) {
      return [];
    }

    // Sort by usage count ascending to get least recently used keys
    availableKeys.sort((a, b) => a.usage_count - b.usage_count);
    return availableKeys.slice(0, count);
  }

  // Put a key on cooldown in memory and SQLite DB
  private setCooldown(keyId: number, durationMs: number = 60000): void {
    const cooldownTime = Date.now() + durationMs;
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.cooldown_until = cooldownTime;
    }
    db.prepare('UPDATE llm_keys SET cooldown_until = ? WHERE id = ?').run(cooldownTime, keyId);
  }

  // Increment usage count of a key
  private incrementUsage(keyId: number): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.usage_count += 1;
    }
    db.prepare('UPDATE llm_keys SET usage_count = usage_count + 1 WHERE id = ?').run(keyId);
  }

  // Log LLM call outcome in DB
  private logCall(provider: string, keyIndex: number, latencyMs: number, success: boolean, error?: string): void {
    db.prepare(`
      INSERT INTO llm_call_logs (provider, key_index, latency_ms, success, error)
      VALUES (?, ?, ?, ?, ?)
    `).run(provider, keyIndex, latencyMs, success ? 1 : 0, error || null);
  }

  // Primary method: Race multiple keys/providers in parallel to respond in under 1 second
  public async getChatCompletion(
    preferredProvider: 'groq' | 'gemini' | 'openrouter',
    params: LLMCallParams
  ): Promise<string> {
    this.reloadKeys(); // Refresh latest cooldowns
    
    // Pick the top 3 available keys to race
    const keysBatch = this.pickKeysBatch(3);
    
    if (keysBatch.length === 0) {
      throw new Error('All LLM keys are currently in cooldown.');
    }

    if (keysBatch.length === 1) {
      return this.runSingleKeyWithRetry(keysBatch[0], params);
    }

    const controllers = keysBatch.map(() => new AbortController());
    
    const promises = keysBatch.map(async (keyRecord, index) => {
      const controller = controllers[index];
      const start = Date.now();
      try {
        const response = await this.executeCallWithController(
          keyRecord.provider,
          keyRecord.key_val,
          params,
          controller
        );
        const latency = Date.now() - start;

        // Success: log usage & latency
        this.incrementUsage(keyRecord.id);
        this.logCall(keyRecord.provider, keyRecord.id, latency, true);
        
        // Abort all other active requests in the race
        controllers.forEach((c, idx) => {
          if (idx !== index) c.abort();
        });

        return response;
      } catch (err: any) {
        // If it was aborted by another winner, ignore
        if (err.name === 'AbortError' || err.message?.includes('aborted')) {
          throw err;
        }

        const latency = Date.now() - start;
        const errorMsg = err.message || String(err);
        
        // Key failed (rate limit/timeout) -> Cooldown key
        this.setCooldown(keyRecord.id, 60000);
        this.logCall(keyRecord.provider, keyRecord.id, latency, false, errorMsg);
        throw err;
      }
    });

    try {
      // Promise.any resolves as soon as the first successful response is returned
      const result = await Promise.any(promises);
      return result;
    } catch (err) {
      console.warn('All keys in the parallel batch failed. Retrying with backup key...');
      
      // Fallback: Pick next available key sequentially
      this.reloadKeys();
      const fallbackKeys = this.pickKeysBatch(1);
      if (fallbackKeys.length > 0) {
        return this.runSingleKeyWithRetry(fallbackKeys[0], params);
      }
      throw new Error('All primary and backup LLM keys failed or are cooling down.');
    }
  }

  // Run a single key with standard retry fallback
  private async runSingleKeyWithRetry(
    keyRecord: LLMKeyRecord,
    params: LLMCallParams
  ): Promise<string> {
    const start = Date.now();
    const controller = new AbortController();
    try {
      const response = await this.executeCallWithController(
        keyRecord.provider,
        keyRecord.key_val,
        params,
        controller
      );
      const latency = Date.now() - start;
      this.incrementUsage(keyRecord.id);
      this.logCall(keyRecord.provider, keyRecord.id, latency, true);
      return response;
    } catch (err: any) {
      const latency = Date.now() - start;
      const errorMsg = err.message || String(err);
      this.setCooldown(keyRecord.id, 60000);
      this.logCall(keyRecord.provider, keyRecord.id, latency, false, errorMsg);
      throw err;
    }
  }

  // Execute the REST API call with abort signal
  private async executeCallWithController(
    provider: 'groq' | 'gemini' | 'openrouter',
    apiKey: string,
    params: LLMCallParams,
    controller: AbortController
  ): Promise<string> {
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      if (provider === 'groq') {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: params.userPrompt }
            ],
            response_format: params.responseFormatJson ? { type: 'json_object' } : undefined,
            temperature: 0.1
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Groq HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json() as any;
        return data.choices[0].message.content || '';

      } else if (provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: params.userPrompt }]
                }
              ],
              systemInstruction: {
                parts: [{ text: params.systemPrompt }]
              },
              generationConfig: {
                responseMimeType: params.responseFormatJson ? 'application/json' : 'text/plain',
                temperature: 0.1
              }
            }),
            signal: controller.signal
          }
        );

        clearTimeout(timeoutId);
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json() as any;
        return data.candidates[0].content.parts[0].text || '';

      } else {
        // OpenRouter
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://vardan.ai',
            'X-Title': 'VardanAI'
          },
          body: JSON.stringify({
            model: 'meta-llama/llama-3-8b-instruct:free',
            messages: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: params.userPrompt }
            ],
            response_format: params.responseFormatJson ? { type: 'json_object' } : undefined,
            temperature: 0.1
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json() as any;
        return data.choices[0].message.content || '';
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('LLM call was aborted');
      }
      throw error;
    }
  }
}
