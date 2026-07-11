import { sendTextMessage } from './whatsapp.js';

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

  console.log('[Monitor] ✅ Active and monitoring for runtime crashes.');
}

