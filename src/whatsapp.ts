import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { handleIncomingMessage } from './router.js';

// Pino logger - warn level so errors show but not verbose
const logger = pino({ level: 'warn' });

export let sock: WASocket | null = null;
export let qrCodeStr: string | null = null;
export let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
export let lastError: string | null = null;

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
    try { await task.fn(task.message); } catch (e) { console.error('[Queue]', e); }
    this.running = false;
    this.run();
  }
}

const msgQueue = new MessageQueue();

// ─── Main Connect Function ────────────────────────────────────────────────────
export async function connectToWhatsApp() {
  try {
    // 1. Ensure auth directory exists (critical for Render)
    const authDir = path.resolve('data/auth_info_baileys');
    fs.mkdirSync(authDir, { recursive: true });
    console.log('[WhatsApp] Auth directory ready:', authDir);

    // 2. Get latest Baileys version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[WhatsApp] Using Baileys v${version.join('.')} (latest: ${isLatest})`);

    // 3. Load auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    console.log('[WhatsApp] Auth state loaded, starting socket...');

    connectionStatus = 'connecting';
    lastError = null;

    // 4. Create socket
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: true,   // Also print in Render logs for backup
      logger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      // Browser identity to look like a normal WhatsApp Web session
      browser: ['VardanAI', 'Chrome', '121.0.0'],
    });

    // 5. Connection update handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeStr = qr;
        console.log('[WhatsApp] ✅ QR code generated — check dashboard or scan from logs above');
      }

      if (connection === 'close') {
        qrCodeStr = null;
        connectionStatus = 'disconnected';

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reason = DisconnectReason;
        console.log('[WhatsApp] Connection closed. Status code:', statusCode);

        if (statusCode === reason.loggedOut) {
          // Logged out — clear creds and reconnect fresh
          console.log('[WhatsApp] Logged out! Clearing auth and reconnecting...');
          lastError = 'Logged out. Reconnecting fresh...';
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
          setTimeout(connectToWhatsApp, 3000);
        } else if (statusCode === reason.restartRequired) {
          console.log('[WhatsApp] Restart required, reconnecting...');
          setTimeout(connectToWhatsApp, 2000);
        } else if (statusCode !== reason.timedOut) {
          console.log('[WhatsApp] Reconnecting in 5s...');
          setTimeout(connectToWhatsApp, 5000);
        } else {
          console.log('[WhatsApp] Timed out, reconnecting in 10s...');
          setTimeout(connectToWhatsApp, 10000);
        }
      }

      if (connection === 'open') {
        qrCodeStr = null;
        connectionStatus = 'connected';
        lastError = null;
        console.log('[WhatsApp] ✅ Successfully connected to WhatsApp!');
      }
    });

    // 6. Save creds on update
    sock.ev.on('creds.update', saveCreds);

    // 7. Incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (msg.key.fromMe || !msg.message) continue;
        msgQueue.push(msg, async (qMsg) => {
          await handleIncomingMessage(qMsg);
        });
      }
    });

  } catch (err: any) {
    console.error('[WhatsApp] Fatal error in connectToWhatsApp:', err);
    lastError = err?.message || 'Unknown error';
    connectionStatus = 'disconnected';
    // Retry after 10 seconds
    console.log('[WhatsApp] Retrying in 10 seconds...');
    setTimeout(connectToWhatsApp, 10000);
  }
}

// ─── Send Message ─────────────────────────────────────────────────────────────
export async function sendTextMessage(toJid: string, text: string) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected.');
  }
  const jid = toJid.includes('@') ? toJid : `${toJid}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

// ─── Force Restart (called from dashboard API) ────────────────────────────────
export async function restartWhatsApp() {
  console.log('[WhatsApp] Manual restart requested from dashboard...');
  if (sock) {
    try { sock.end(undefined); } catch (_) {}
    sock = null;
  }
  qrCodeStr = null;
  connectionStatus = 'disconnected';
  // Clear old auth to force fresh QR
  const authDir = path.resolve('data/auth_info_baileys');
  try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
  await connectToWhatsApp();
}
