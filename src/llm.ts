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

  // Pick the best key for each active provider to race in parallel
  private pickMultiProviderBatch(): LLMKeyRecord[] {
    const now = Date.now();
    const availableKeys = this.keys.filter(
      (k) => k.cooldown_until < now && k.active === 1
    );

    if (availableKeys.length === 0) {
      return [];
    }

    // Group keys by provider
    const providerKeys: Record<string, LLMKeyRecord[]> = {};
    for (const key of availableKeys) {
      if (!providerKeys[key.provider]) {
        providerKeys[key.provider] = [];
      }
      providerKeys[key.provider].push(key);
    }

    const batch: LLMKeyRecord[] = [];
    // From each provider group, select the one with the lowest usage count (least used)
    for (const provider of Object.keys(providerKeys)) {
      const keysForProvider = providerKeys[provider];
      keysForProvider.sort((a, b) => a.usage_count - b.usage_count);
      batch.push(keysForProvider[0]);
    }

    return batch;
  }

  // Backup fallback key picker (least used single key)
  private pickSingleBackupKey(): LLMKeyRecord[] {
    const now = Date.now();
    const availableKeys = this.keys.filter(
      (k) => k.cooldown_until < now && k.active === 1
    );
    if (availableKeys.length === 0) return [];
    availableKeys.sort((a, b) => a.usage_count - b.usage_count);
    return [availableKeys[0]];
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

  // Primary method: Hybrid race in parallel to favor preferred accurate/reasoning provider
  public async getChatCompletion(
    preferredProvider: 'groq' | 'gemini' | 'openrouter',
    params: LLMCallParams
  ): Promise<string> {
    this.reloadKeys(); // Refresh latest cooldowns
    
    // Pick the best key from each active provider to race in parallel (no rotation, simultaneous fetch)
    const keysBatch = this.pickMultiProviderBatch();
    
    if (keysBatch.length === 0) {
      throw new Error('All LLM keys are currently in cooldown.');
    }

    if (keysBatch.length === 1) {
      return this.runSingleKeyWithRetry(keysBatch[0], params);
    }

    interface RaceResult {
      provider: string;
      content: string;
      latency: number;
    }

    const controllers = keysBatch.map(() => new AbortController());
    
    const executionPromises = keysBatch.map(async (keyRecord, index) => {
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
        return { provider: keyRecord.provider, content: response, latency } as RaceResult;
      } catch (err: any) {
        if (controller.signal.aborted || err.name === 'AbortError' || err.message?.includes('aborted')) {
          // Resolve silently to prevent UnhandledPromiseRejection when calls are aborted in the background
          return { provider: keyRecord.provider, content: '', latency: 0 } as any;
        }

        const latency = Date.now() - start;
        const errorMsg = err.message || String(err);
        
        // Key failed (rate limit/timeout) -> Cooldown key
        this.setCooldown(keyRecord.id, 60000);
        this.logCall(keyRecord.provider, keyRecord.id, latency, false, errorMsg);
        throw err;
      }
    });

    // Prevent unhandled promise rejections for background / losing promises in the race
    executionPromises.forEach(p => p.catch(() => {}));

    const preferredIndex = keysBatch.findIndex(k => k.provider === preferredProvider);
    
    if (preferredIndex !== -1) {
      const preferredPromise = executionPromises[preferredIndex];
      
      // Let the preferred reasoning provider run for up to 2.5 seconds
      let timeoutId: any;
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 2500);
      });

      try {
        const preferredResult = await Promise.race([preferredPromise, timeoutPromise]);
        
        if (preferredResult) {
          clearTimeout(timeoutId);
          // Abort all other runs since the preferred accurate model won!
          controllers.forEach((c, idx) => {
            if (idx !== preferredIndex) c.abort();
          });
          return preferredResult.content;
        } else {
          console.log(`[LLM Race] Preferred provider "${preferredProvider}" took more than 2.5s. Falling back to the fastest completed response.`);
        }
      } catch (err) {
        console.log(`[LLM Race] Preferred provider "${preferredProvider}" failed. Falling back to other active responses.`);
      }
    }

    try {
      // Return the fastest completed alternative response
      const winner = await Promise.any(executionPromises);
      
      // Abort other remaining controllers
      controllers.forEach((c, idx) => {
        if (keysBatch[idx].provider !== winner.provider) {
          c.abort();
        }
      });
      return winner.content;
    } catch (err) {
      console.warn('All keys in the parallel batch failed. Retrying with backup key...');
      
      // Fallback: Pick next available key sequentially
      this.reloadKeys();
      const fallbackKeys = this.pickSingleBackupKey();
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

  private cleanThinkTags(content: string): string {
    if (!content) return '';
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
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
        return this.cleanThinkTags(data.choices[0].message.content || '');

      } else if (provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
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
        return this.cleanThinkTags(data.candidates[0].content.parts[0].text || '');

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
            model: 'deepseek/deepseek-r1:free',
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
        return this.cleanThinkTags(data.choices[0].message.content || '');
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('LLM call was aborted');
      }
      throw error;
    }
  }

  // Analyze a document (PDF, Image, Text) using Gemini 1.5 Flash
  public async analyzeDocument(
    base64Data: string,
    mimeType: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    this.reloadKeys();
    const geminiKeys = this.keys.filter(
      (k) => k.provider === 'gemini' && k.active === 1 && k.cooldown_until < Date.now()
    );
    if (geminiKeys.length === 0) {
      throw new Error('No active Gemini API keys are available (all might be in cooldown).');
    }
    // Sort by usage count
    geminiKeys.sort((a, b) => a.usage_count - b.usage_count);
    const keyRecord = geminiKeys[0];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for document analysis

    const start = Date.now();
    try {
      // Strip any data URI prefix if present
      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${keyRecord.key_val}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: cleanBase64
                    }
                  },
                  {
                    text: userPrompt
                  }
                ]
              }
            ],
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              responseMimeType: 'application/json',
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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      this.incrementUsage(keyRecord.id);
      this.logCall(keyRecord.provider, keyRecord.id, Date.now() - start, true);
      return text;
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.setCooldown(keyRecord.id, 60000);
      this.logCall(keyRecord.provider, keyRecord.id, Date.now() - start, false, err.message || String(err));
      throw err;
    }
  }

  // Transcribe an audio file buffer (base64) using Gemini 1.5/3.5 Flash
  public async transcribeAudio(
    base64Data: string,
    mimeType: string
  ): Promise<string> {
    this.reloadKeys();
    const geminiKeys = this.keys.filter(
      (k) => k.provider === 'gemini' && k.active === 1 && k.cooldown_until < Date.now()
    );
    if (geminiKeys.length === 0) {
      throw new Error('No active Gemini API keys are available for audio transcription.');
    }
    // Sort by usage count
    geminiKeys.sort((a, b) => a.usage_count - b.usage_count);
    const keyRecord = geminiKeys[0];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const start = Date.now();
    try {
      // Strip any data URI prefix if present
      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');

      // Clean mimeType to ensure no parameters like ;codecs=opus are sent
      let cleanMimeType = mimeType.split(';')[0].trim();
      if (!cleanMimeType.startsWith('audio/')) {
        cleanMimeType = 'audio/ogg'; // fallback
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${keyRecord.key_val}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: cleanMimeType,
                      data: cleanBase64
                    }
                  },
                  {
                    text: "You are a speech-to-text transcriber for Vardan Hospital. Transcribe this audio exactly. Do not add any introductory or explanatory text. Respond with ONLY the text of the speech. If there is no speech, respond with an empty string."
                  }
                ]
              }
            ],
            generationConfig: {
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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      this.incrementUsage(keyRecord.id);
      this.logCall(keyRecord.provider, keyRecord.id, Date.now() - start, true);
      return text.trim();
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.setCooldown(keyRecord.id, 60000);
      this.logCall(keyRecord.provider, keyRecord.id, Date.now() - start, false, err.message || String(err));
      throw err;
    }
  }
}

