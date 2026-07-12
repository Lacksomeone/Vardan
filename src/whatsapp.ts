import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { handleIncomingMessage } from './router.js';
import db from './db.js';

const logger = pino({ level: 'silent' });

export let sock: WASocket | null = null;
export let qrCodeStr: string | null = null;
export let pairingCode: string | null = null;
export let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
export let lastError: string | null = null;
const processedMessageIds = new Set<string>();

// Phone number to pair with (set via dashboard)
let pairingPhone: string | null = process.env.WA_PHONE_NUMBER || null;

export function setPairingPhone(phone: string) {
  // Store normalized phone: digits only, no +
  pairingPhone = phone.replace(/\D/g, '');
  console.log('[WhatsApp] Pairing phone set to:', pairingPhone);
}

// ─── Message Queue ───────────────────────────────────────────────────────────
class MessageQueue {
  private queue: { message: proto.IWebMessageInfo; fn: (msg: proto.IWebMessageInfo) => Promise<void> }[] = [];
  private running = false;

  push(message: proto.IWebMessageInfo, fn: (msg: proto.IWebMessageInfo) => Promise<void>) {
    this.queue.push({ message, fn });
    this.run();
  }

  private async run() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const task = this.queue.shift()!;
    let timeoutId: any;
    try {
      // Race the handler task against a 25-second watchdog timer
      const watchdog = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('WhatsApp message handler timed out after 25s')), 25000);
      });
      await Promise.race([task.fn(task.message), watchdog]);
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      console.error('[Queue]', e);
    }
    this.running = false;
    this.run();
  }
}

const msgQueue = new MessageQueue();

// ─── Main Connect Function ────────────────────────────────────────────────────
export async function connectToWhatsApp() {
  try {
    // 1. Ensure auth directory exists
    const authDir = path.resolve('data/auth_info_baileys');
    fs.mkdirSync(authDir, { recursive: true });

    // 2. Get latest Baileys version
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[WhatsApp] Using Baileys v${version.join('.')}`);

    // 3. Load auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    connectionStatus = 'connecting';
    lastError = null;
    qrCodeStr = null;
    pairingCode = null;

    // 4. Create socket — use macOS Chrome browser fingerprint (less suspicious)
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      browser: Browsers.macOS('Chrome'),
    });

    // 5. Request pairing code if phone is set (works on cloud IPs!)
    // Do this AFTER socket is created but BEFORE connection.update fires
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // If QR arrives AND we have a phone number → request pairing code instead
      if (qr && pairingPhone) {
        qrCodeStr = qr; // keep as fallback
        try {
          console.log('[WhatsApp] Requesting pairing code for:', pairingPhone);
          const code = await sock!.requestPairingCode(pairingPhone);
          pairingCode = code;
          lastError = null;
          console.log('[WhatsApp] ✅ Pairing Code:', code);
        } catch (err: any) {
          console.error('[WhatsApp] Pairing code request failed:', err?.message);
          lastError = `Pairing code failed: ${err?.message}`;
          // Fall back to QR
          pairingCode = null;
        }
      } else if (qr && !pairingPhone) {
        // No phone number set — use QR code
        qrCodeStr = qr;
        pairingCode = null;
        console.log('[WhatsApp] QR code generated (no phone number set for pairing code)');
      }

      if (connection === 'close') {
        qrCodeStr = null;
        pairingCode = null;
        connectionStatus = 'disconnected';
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        console.log('[WhatsApp] Connection closed, status:', statusCode);

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[WhatsApp] Logged out — clearing auth...');
          lastError = 'Logged out. Please reconnect.';
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
          setTimeout(connectToWhatsApp, 3000);
        } else {
          setTimeout(connectToWhatsApp, 5000);
        }
      }

      if (connection === 'open') {
        qrCodeStr = null;
        pairingCode = null;
        connectionStatus = 'connected';
        lastError = null;
        console.log('[WhatsApp] ✅ Connected!');
      }
    });

    // 6. Save creds
    sock.ev.on('creds.update', saveCreds);

    // 7. Incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      console.log(`[WhatsApp] 📨 messages.upsert fired — type: ${m.type}, count: ${m.messages.length}`);
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        console.log(`[WhatsApp] 📩 Msg from: ${msg.key.remoteJid} | fromMe: ${msg.key.fromMe} | hasContent: ${!!msg.message}`);
        if (msg.key.fromMe || !msg.message) continue;

        // Deduplicate incoming messages using their unique message ID
        const msgId = msg.key.id;
        if (msgId) {
          if (processedMessageIds.has(msgId)) {
            console.log(`[WhatsApp] Ignoring duplicate message upsert: ${msgId}`);
            continue;
          }
          processedMessageIds.add(msgId);
          // Limit cache size to 500
          if (processedMessageIds.size > 500) {
            const first = processedMessageIds.values().next().value;
            if (first) processedMessageIds.delete(first);
          }
        }

        console.log(`[WhatsApp] ✅ Queuing message from ${msg.key.remoteJid} for processing...`);
        msgQueue.push(msg, (qMsg) => handleIncomingMessage(qMsg));
      }
    });


  } catch (err: any) {
    console.error('[WhatsApp] Fatal error:', err?.message);
    lastError = err?.message || 'Unknown error';
    connectionStatus = 'disconnected';
    setTimeout(connectToWhatsApp, 10000);
  }
}

// ─── Send Message ─────────────────────────────────────────────────────────────
export async function sendTextMessage(toJid: string, text: string) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`   [TEST MOCK SEND] to: ${toJid} Message: ${text.replace(/\n/g, ' ')}`);
    return;
  }
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  
  let jid = toJid;
  
  // Convert @lid (WhatsApp Multi-Device internal format) to @s.whatsapp.net
  if (jid.endsWith('@lid')) {
    const numericPart = jid.replace('@lid', '');
    jid = `${numericPart}@s.whatsapp.net`;
    console.log(`[WhatsApp] Converted @lid JID: ${toJid} → ${jid}`);
  }
  
  // Append @s.whatsapp.net if no domain suffix
  if (!jid.includes('@')) {
    jid = `${jid}@s.whatsapp.net`;
  }
  
  // Strip leading + (e.g., +919451183429)
  if (jid.startsWith('+')) {
    jid = jid.substring(1);
  }

  console.log(`[WhatsApp] 📤 Sending message to: ${jid}`);
  try {
    await sock.sendMessage(jid, { text });
    console.log(`[WhatsApp] ✅ Message sent successfully to: ${jid}`);
  } catch (err: any) {
    console.error(`[WhatsApp] ❌ sendMessage FAILED to ${jid}:`, err?.message || err);
    throw err;
  }

  // Log outgoing message to conversations table if recipient is a patient
  try {
    const patient = db.prepare('SELECT preferred_language FROM patients WHERE id = ?').get(jid) as { preferred_language: string } | undefined;
    if (patient) {
      // Check if this exact message was logged in the last 2 seconds to avoid duplicates from other agents
      const recent = db.prepare(`
        SELECT id FROM conversations 
        WHERE patient_id = ? AND role = 'bot' AND message = ? AND timestamp >= datetime('now', '-2 seconds')
      `).get(jid, text);
      
      if (!recent) {
        db.prepare(`
          INSERT INTO conversations (patient_id, role, message, agent_used, language)
          VALUES (?, 'bot', ?, 'booking', ?)
        `).run(jid, text, patient.preferred_language);
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to log outgoing message to database:', err);
  }
}

// ─── Force Restart ────────────────────────────────────────────────────────────
export async function restartWhatsApp(phone?: string) {
  console.log('[WhatsApp] Restart requested...');
  if (phone) {
    pairingPhone = phone.replace(/\D/g, '');
    console.log('[WhatsApp] New pairing phone:', pairingPhone);
  }
  if (sock) { try { sock.end(undefined); } catch (_) {} sock = null; }
  qrCodeStr = null;
  pairingCode = null;
  connectionStatus = 'disconnected';
  // Clear old auth to get fresh QR/pairing code
  const authDir = path.resolve('data/auth_info_baileys');
  try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
  await connectToWhatsApp();
}

// ─── Send Image Message ───────────────────────────────────────────────────────
export async function sendImageMessage(toJid: string, imageUrl: string, caption?: string) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`   [TEST MOCK SEND IMAGE] to: ${toJid} Image: ${imageUrl} Caption: ${caption || ''}`);
    return;
  }
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  let jid = toJid.includes('@') ? toJid : `${toJid}@s.whatsapp.net`;
  if (jid.startsWith('+')) {
    jid = jid.substring(1);
  }

  // Handle local uploaded files (if imageUrl starts with /uploads/ or uploads/)
  let imageSource: any;
  if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('uploads/')) {
    const localPath = path.resolve(imageUrl.replace(/^\//, ''));
    if (fs.existsSync(localPath)) {
      imageSource = fs.readFileSync(localPath);
    } else {
      imageSource = { url: imageUrl };
    }
  } else {
    // remote URL or other format
    imageSource = { url: imageUrl };
  }

  await sock.sendMessage(jid, { 
    image: imageSource, 
    caption: caption || '' 
  });

  // Log outgoing message to conversations table if recipient is a patient
  try {
    const patient = db.prepare('SELECT preferred_language FROM patients WHERE id = ?').get(jid) as { preferred_language: string } | undefined;
    if (patient) {
      const logText = caption ? `[Photo Sent] ${caption}` : '[Photo Sent]';
      db.prepare(`
        INSERT INTO conversations (patient_id, role, message, agent_used, language)
        VALUES (?, 'bot', ?, 'bulk_sender', ?)
      `).run(jid, logText, patient.preferred_language);
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to log outgoing image message to database:', err);
  }
}

