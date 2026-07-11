import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Set environment to test before importing DB and LLM
process.env.NODE_ENV = 'test';

import db from '../src/db.js';
import { LLMGateway } from '../src/llm.js';

describe('LLM Gateway Tests', () => {
  let originalFetch: any;

  before(() => {
    originalFetch = globalThis.fetch;
    
    // Clear and seed keys specifically for the test
    db.prepare('DELETE FROM llm_keys').run();
    db.prepare("INSERT INTO llm_keys (provider, key_val, active, usage_count, cooldown_until) VALUES ('groq', 'mock-groq-key', 1, 0, 0)").run();
    db.prepare("INSERT INTO llm_keys (provider, key_val, active, usage_count, cooldown_until) VALUES ('gemini', 'mock-gemini-key', 1, 0, 0)").run();
    db.prepare("INSERT INTO llm_keys (provider, key_val, active, usage_count, cooldown_until) VALUES ('openrouter', 'mock-openrouter-key', 1, 0, 0)").run();
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('should be a singleton', () => {
    const gateway1 = LLMGateway.getInstance();
    const gateway2 = LLMGateway.getInstance();
    assert.strictEqual(gateway1, gateway2);
  });

  it('should call fetch and return completion successfully in parallel race', async () => {
    const gateway = LLMGateway.getInstance();

    // Mock global fetch to respond successfully for all providers
    globalThis.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Mocked Groq Response' } }]
          })
        } as any;
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Mocked Gemini Response' }] } }]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Mocked OpenRouter Response' } }]
        })
      } as any;
    };

    const completion = await gateway.getChatCompletion('groq', {
      systemPrompt: 'sys',
      userPrompt: 'user'
    });

    assert.ok(completion, 'Should receive a completion response');
    const validResponses = ['Mocked Groq Response', 'Mocked Gemini Response', 'Mocked OpenRouter Response'];
    assert.ok(validResponses.includes(completion), `Got unexpected response: ${completion}`);
  });

  it('should handle API failure, put key on cooldown, and succeed via other provider in race', async () => {
    // Reset keys state
    db.prepare('UPDATE llm_keys SET cooldown_until = 0, active = 1, usage_count = 0').run();
    
    const gateway = LLMGateway.getInstance();

    // Mock fetch: Groq fails, Gemini succeeds
    globalThis.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        // Wait briefly to allow Gemini to win or return failure
        return {
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded'
        } as any;
      }
      
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Gemini Success Response' }] } }]
        })
      } as any;
    };

    const completion = await gateway.getChatCompletion('groq', {
      systemPrompt: 'sys',
      userPrompt: 'user'
    });

    assert.strictEqual(completion, 'Gemini Success Response', 'Completion should fallback to winning Gemini response');

    // Verify Groq key is put on cooldown in DB
    const groqKey = db.prepare("SELECT * FROM llm_keys WHERE provider = 'groq'").get() as any;
    assert.ok(groqKey.cooldown_until > Date.now(), 'Failed key should be put on cooldown');
    
    // Verify call logs contain the error
    const logs = db.prepare("SELECT * FROM llm_call_logs WHERE provider = 'groq' AND success = 0").all() as any[];
    assert.ok(logs.length > 0, 'Should log a failed LLM call record');
    assert.ok(logs[0].error.includes('Groq HTTP 429'), 'Error message should be logged');
  });

  it('should analyze document via Gemini correctly', async () => {
    // Ensure gemini is active and not cooling down
    db.prepare("UPDATE llm_keys SET cooldown_until = 0, active = 1 WHERE provider = 'gemini'").run();

    const gateway = LLMGateway.getInstance();

    globalThis.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        // Verify request payload contains inlineData
        const body = JSON.parse(options.body);
        const parts = body.contents[0].parts;
        assert.ok(parts[0].inlineData, 'Should send base64 document data');
        assert.strictEqual(parts[0].inlineData.mimeType, 'application/pdf');
        assert.strictEqual(parts[0].inlineData.data, 'dGVzdCBkYXRh'); // base64 for 'test data'
        
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"prescription_analysis": "good"}' }] } }]
          })
        } as any;
      }
      throw new Error('Unexpected URL: ' + urlStr);
    };

    const analysis = await gateway.analyzeDocument(
      'data:application/pdf;base64,dGVzdCBkYXRh',
      'application/pdf',
      'system prompt',
      'user prompt'
    );

    assert.strictEqual(analysis, '{"prescription_analysis": "good"}');
  });
});
