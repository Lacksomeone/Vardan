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

  // Pick the best key for a given provider
  private pickKey(provider: 'groq' | 'gemini' | 'openrouter'): LLMKeyRecord | null {
    const now = Date.now();
    const availableKeys = this.keys.filter(
      (k) => k.provider === provider && k.cooldown_until < now && k.active === 1
    );

    if (availableKeys.length === 0) {
      return null;
    }

    // Sort by usage count ascending to get least recently used key
    availableKeys.sort((a, b) => a.usage_count - b.usage_count);
    return availableKeys[0];
  }

  // Put a key on cooldown in memory and SQLite DB
  private setCooldown(keyId: number, durationMs: number = 60000): void {
    const cooldownTime = Date.now() + durationMs;
    // Update in-memory
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.cooldown_until = cooldownTime;
    }
    // Update DB
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

  // Primary method to get chat completion
  public async getChatCompletion(
    preferredProvider: 'groq' | 'gemini' | 'openrouter',
    params: LLMCallParams
  ): Promise<string> {
    const providersPriority: ('groq' | 'gemini' | 'openrouter')[] = [
      preferredProvider,
      preferredProvider === 'groq' ? 'gemini' : 'groq',
      'openrouter'
    ];

    // Remove duplicates
    const finalPriority = Array.from(new Set(providersPriority));

    for (const provider of finalPriority) {
      const attempts = 3;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const keyRecord = this.pickKey(provider);
        if (!keyRecord) {
          console.warn(`No keys available for provider: ${provider}, checking next provider.`);
          break; // Break out of attempts, try next provider
        }

        const start = Date.now();
        try {
          const response = await this.executeCall(provider, keyRecord.key_val, params);
          const latency = Date.now() - start;

          this.incrementUsage(keyRecord.id);
          this.logCall(provider, keyRecord.id, latency, true);
          return response;
        } catch (err: any) {
          const latency = Date.now() - start;
          const errorMsg = err.message || String(err);
          console.error(`LLM Call Failed (Provider: ${provider}, KeyID: ${keyRecord.id}): ${errorMsg}`);
          
          this.setCooldown(keyRecord.id, 60000); // 1 minute cooldown on failure
          this.logCall(provider, keyRecord.id, latency, false, errorMsg);

          // If this was a timeout or rate limit, rotate immediately
          continue;
        }
      }
    }

    throw new Error('All LLM providers and keys failed or are currently in cooldown.');
  }

  // Execute the REST fetch API call with timeout
  private async executeCall(
    provider: 'groq' | 'gemini' | 'openrouter',
    apiKey: string,
    params: LLMCallParams
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds hard timeout

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
        throw new Error('LLM call timed out after 8 seconds');
      }
      throw error;
    }
  }
}
