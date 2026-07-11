import db from './db.js';
import { sendTextMessage } from './whatsapp.js';

let disconnectedSince: number | null = null;

async function sendAlertToAdmin(message: string) {
  const adminPhone = process.env.ADMIN_ALERT_PHONE;
  if (!adminPhone) {
    console.warn('[Monitor] ADMIN_ALERT_PHONE not configured in .env. Skipping WhatsApp alert.');
    return;
  }
  try {
    await sendTextMessage(adminPhone, message);
    console.log('[Monitor] WhatsApp alert sent successfully.');
  } catch (err) {
    console.error('[Monitor] Failed to send WhatsApp alert to admin:', err);
  }
}

// AI Diagnostic Run using the new Programming Agent Keys
async function runAIDiagnostics(errorDetails: string) {
  const apiKey = process.env.AGENT_PROGRAMMING_KEY_1 || process.env.AGENT_PROGRAMMING_KEY_2;
  if (!apiKey) {
    console.log('[Programming Agent] Skipping AI diagnostics: AGENT_PROGRAMMING_KEY not configured.');
    return;
  }

  try {
    console.log('[Programming Agent] Running AI diagnostic check on recent failures...');

    const systemPrompt = `You are the self-healing Programming Agent for Vardan Hospital.
Analyze the following recent system/LLM errors:
${errorDetails}

Choose the best corrective action:
1. "RESET_KEYS": If errors are due to rate limits (429), token limits, or key cooldowns.
2. "RESTART_WHATSAPP": If errors are related to WhatsApp connection drops or network timeouts.
3. "WARN_ADMIN": If it is a persistent database issue, authentication error, or server crash.

Format response as strict JSON:
{"action": "RESET_KEYS" | "RESTART_WHATSAPP" | "WARN_ADMIN", "reason": "Explanation of diagnostic decision"}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://vardan.ai',
        'X-Title': 'VardanAI Monitor'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-r1:free',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Diagnose the errors and choose an action.' }],
        temperature: 0.1
      })
    });

    if (response.ok) {
      const data = await response.json() as any;
      let content = data.choices?.[0]?.message?.content || '';
      // Strip think tags
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const parsed = JSON.parse(content) as { action: string, reason: string };

      console.log(`[Programming Agent] Diagnostic Action chosen: ${parsed.action}. Reason: ${parsed.reason}`);

      if (parsed.action === 'RESET_KEYS') {
        db.prepare('UPDATE llm_keys SET cooldown_until = 0 WHERE active = 1').run();
        await sendAlertToAdmin(`🔧 *Self-Healing Action (AI Diagnosed):* Resetting LLM key cooldowns. Reason: ${parsed.reason}`);
      } else if (parsed.action === 'RESTART_WHATSAPP') {
        const { restartWhatsApp } = await import('./whatsapp.js');
        await restartWhatsApp();
        await sendAlertToAdmin(`🔧 *Self-Healing Action (AI Diagnosed):* Triggered WhatsApp restart. Reason: ${parsed.reason}`);
      } else {
        await sendAlertToAdmin(`🚨 *Programming Agent Warning:* Manual intervention required.\n\n*Diagnostic:* ${parsed.reason}\n\n*Recent Errors:* \`\`\`\n${errorDetails}\n\`\`\``);
      }
    } else {
      console.error('[Programming Agent] OpenRouter Diagnostic call failed:', await response.text());
    }
  } catch (diagErr) {
    console.error('[Programming Agent] Diagnostic run failed:', diagErr);
  }
}

// Background Self-Healing Check Loop
async function runSelfHealingAgent() {
  console.log('[Programming Agent] Checking system health...');

  try {
    // 1. Check if all LLM keys are in cooldown
    const totalKeys = db.prepare('SELECT COUNT(*) as count FROM llm_keys WHERE active = 1').get() as { count: number };
    const cooldownKeys = db.prepare('SELECT COUNT(*) as count FROM llm_keys WHERE active = 1 AND cooldown_until > ?').get(Date.now()) as { count: number };

    if (totalKeys.count > 0 && totalKeys.count === cooldownKeys.count) {
      console.log('[Programming Agent] All LLM keys in cooldown. Force resetting cooldowns...');
      db.prepare('UPDATE llm_keys SET cooldown_until = 0 WHERE active = 1').run();
      await sendAlertToAdmin('🔧 *Self-Healing Action:* All LLM keys were in cooldown. Cooldowns have been reset to restore service.');
    }

    // 2. Check WhatsApp Connection Status
    const { connectionStatus, restartWhatsApp } = await import('./whatsapp.js');
    if (connectionStatus === 'disconnected') {
      disconnectedSince = disconnectedSince || Date.now();
      const minutesDisconnected = (Date.now() - disconnectedSince) / (60 * 1000);
      if (minutesDisconnected >= 5) {
        console.log('[Programming Agent] WhatsApp disconnected for 5+ minutes. Restarting session...');
        disconnectedSince = null;
        await sendAlertToAdmin('🔧 *Self-Healing Action:* WhatsApp disconnected for 5+ minutes. Triggering automatic reconnect...');
        await restartWhatsApp().catch(err => console.error('[Programming Agent] Reconnect failed:', err));
      }
    } else {
      disconnectedSince = null;
    }

    // 3. Check SQLite Database Locks
    try {
      db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (dbErr: any) {
      if (dbErr.message?.includes('database is locked') || dbErr.message?.includes('busy')) {
        console.log('[Programming Agent] Database locked state detected. Running checkpoint...');
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
          await sendAlertToAdmin('🔧 *Self-Healing Action:* Database locked state detected. Force checkpointed WAL file.');
        } catch (checkErr) {
          console.error('[Programming Agent] Checkpoint failed:', checkErr);
        }
      }
    }

    // 4. Scan recent LLM call logs for errors
    const logs = db.prepare(`
      SELECT error, provider, timestamp 
      FROM llm_call_logs 
      WHERE success = 0 AND timestamp >= datetime('now', '-30 minutes')
      ORDER BY timestamp DESC LIMIT 5
    `).all() as any[];

    if (logs.length >= 3) {
      const errorDetails = logs.map(f => `[${f.timestamp}] ${f.provider}: ${f.error}`).join('\n');
      console.log('[Programming Agent] Recurring errors detected. Prompting AI Diagnostic...');
      await runAIDiagnostics(errorDetails);
    }

  } catch (err) {
    console.error('[Programming Agent] Monitor error in self-healing loop:', err);
  }
}

export function initializeMonitor() {
  process.on('uncaughtException', async (error) => {
    console.error('[Monitor] Uncaught exception caught:', error);
    
    const stack = error.stack || '';
    const lines = stack.split('\n').slice(0, 5).join('\n');
    
    const alertMsg = `🚨 *VardanAI Server Crash Alert!* 🚨\n\n*Error:* \`${error.message}\`\n\n*Trace:*\n\`\`\`\n${lines}\n\`\`\`\n\nServer is restarting. Please check Render/PM2 logs.`;
    
    try {
      await sendAlertToAdmin(alertMsg);
    } catch (err) {
      console.error('[Monitor] Failed to notify admin:', err);
    }
    
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[Monitor] Unhandled rejection caught:', reason);
    const error = reason instanceof Error ? reason : new Error(String(reason));
    
    const stack = error.stack || '';
    const lines = stack.split('\n').slice(0, 5).join('\n');
    
    const alertMsg = `🚨 *VardanAI Unhandled Rejection Alert!* 🚨\n\n*Error:* \`${error.message}\`\n\n*Trace:*\n\`\`\`\n${lines}\n\`\`\`\n\nServer is restarting.`;
    
    try {
      await sendAlertToAdmin(alertMsg);
    } catch (err) {
      console.error('[Monitor] Failed to notify admin:', err);
    }
    
    process.exit(1);
  });

  // Start background self-healing monitor check loop (every 2 minutes)
  setInterval(() => {
    runSelfHealingAgent().catch(err => console.error('[Programming Agent] Background run failed:', err));
  }, 2 * 60 * 1000);

  console.log('[Monitor] ✅ Active and monitoring for runtime crashes.');
  console.log('[Programming Agent] ✅ Active and running self-healing checks in background.');
}
