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

// Self-healing check triggers are now logged and handled without AI API calls to OpenRouter.

// Background Self-Healing Check Loop
async function runSelfHealingAgent() {
  console.log('[System Monitor] Checking system health...');

  try {
    // 1. Check if all LLM keys are in cooldown
    const totalKeys = db.prepare('SELECT COUNT(*) as count FROM llm_keys WHERE active = 1').get() as { count: number };
    const cooldownKeys = db.prepare('SELECT COUNT(*) as count FROM llm_keys WHERE active = 1 AND cooldown_until > ?').get(Date.now()) as { count: number };

    if (totalKeys.count > 0 && totalKeys.count === cooldownKeys.count) {
      console.log('[System Monitor] All LLM keys in cooldown. Force resetting cooldowns...');
      db.prepare('UPDATE llm_keys SET cooldown_until = 0 WHERE active = 1').run();
      await sendAlertToAdmin('🔧 *Self-Healing Action:* All LLM keys were in cooldown. Cooldowns have been reset to restore service.');
    }

    // 2. Check WhatsApp Connection Status
    const { connectionStatus, restartWhatsApp } = await import('./whatsapp.js');
    if (connectionStatus === 'disconnected') {
      disconnectedSince = disconnectedSince || Date.now();
      const minutesDisconnected = (Date.now() - disconnectedSince) / (60 * 1000);
      if (minutesDisconnected >= 5) {
        console.log('[System Monitor] WhatsApp disconnected for 5+ minutes. Restarting session...');
        disconnectedSince = null;
        await sendAlertToAdmin('🔧 *Self-Healing Action:* WhatsApp disconnected for 5+ minutes. Triggering automatic reconnect...');
        await restartWhatsApp().catch(err => console.error('[System Monitor] Reconnect failed:', err));
      }
    } else {
      disconnectedSince = null;
    }

    // 3. Check SQLite Database Locks
    try {
      db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (dbErr: any) {
      if (dbErr.message?.includes('database is locked') || dbErr.message?.includes('busy')) {
        console.log('[System Monitor] Database locked state detected. Running checkpoint...');
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
          await sendAlertToAdmin('🔧 *Self-Healing Action:* Database locked state detected. Force checkpointed WAL file.');
        } catch (checkErr) {
          console.error('[System Monitor] Checkpoint failed:', checkErr);
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
      console.log('[System Monitor] Recurring errors detected. Notifying admin...');
      await sendAlertToAdmin(`🚨 *VardanAI Error Warning:* Multiple recent failures detected in the last 30 minutes.\n\n*Recent Errors:*\n\`\`\`\n${errorDetails}\n\`\`\``);
    }

  } catch (err) {
    console.error('[System Monitor] Monitor error in self-healing loop:', err);
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
    runSelfHealingAgent().catch(err => console.error('[System Monitor] Background run failed:', err));
  }, 2 * 60 * 1000);

  console.log('[Monitor] ✅ Active and monitoring for runtime crashes.');
  console.log('[System Monitor] ✅ Active and running self-healing checks in background.');
}
