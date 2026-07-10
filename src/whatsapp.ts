import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
// @ts-ignore
import qrcode from 'qrcode-terminal';
import path from 'path';
import pino from 'pino';
import { handleIncomingMessage } from './router.js';

// Setup logging level to silent to keep terminal clean unless debugging
const logger = pino({ level: 'silent' });

export let sock: WASocket | null = null;
export let qrCodeStr: string | null = null;
export let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

// Message Queue to handle concurrent incoming messages sequentially
class MessageQueue {
  private queue: { message: proto.IWebMessageInfo; processFn: (msg: proto.IWebMessageInfo) => Promise<void> }[] = [];
  private processing = false;

  public push(message: proto.IWebMessageInfo, processFn: (msg: proto.IWebMessageInfo) => Promise<void>) {
    this.queue.push({ message, processFn });
    this.processNext();
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const task = this.queue.shift();
    if (task) {
      try {
        await task.processFn(task.message);
      } catch (err) {
        console.error('Queue error processing message:', err);
      }
    }
    this.processing = false;
    this.processNext();
  }
}

const msgQueue = new MessageQueue();

export async function connectToWhatsApp() {
  const authDir = path.resolve('data/auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  connectionStatus = 'connecting';
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Custom printing for dashboard + terminal status integration
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false
  });

  // Listen to connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeStr = qr;
      console.log('\n--- WhatsApp Pair QR Code ---');
      qrcode.generate(qr, { small: true });
      console.log('Scan the QR code above using WhatsApp Linked Devices.\n');
    }

    if (connection === 'close') {
      qrCodeStr = null;
      connectionStatus = 'disconnected';
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('WhatsApp connection closed due to:', lastDisconnect?.error, '. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      qrCodeStr = null;
      connectionStatus = 'connected';
      console.log('WhatsApp connection successfully opened!');
    }
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Listen to incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        // Skip messages sent by the bot itself or empty/status messages
        if (msg.key.fromMe || !msg.message) continue;
        
        // Push message to queue for sequential processing
        msgQueue.push(msg, async (queuedMsg) => {
          await handleIncomingMessage(queuedMsg);
        });
      }
    }
  });
}

// Function to send a text message
export async function sendTextMessage(toJid: string, text: string) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected.');
  }
  
  // Format message to ensure correct JID layout
  const formattedJid = toJid.includes('@') ? toJid : `${toJid}@s.whatsapp.net`;
  await sock.sendMessage(formattedJid, { text });
}
