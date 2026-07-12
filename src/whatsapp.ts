import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { restoreAuthFromDB, backupAuthToDB } from './whatsappAuthBackup.js';
import { llmGateway } from './llm.js';
import path from 'path';
import { db } from './db.js';

let sock: any = null;

export async function connectToWhatsApp() {
  console.log('[WhatsApp] Restoring Auth from Turso...');
  await restoreAuthFromDB();

  const { state, saveCreds } = await useMultiFileAuthState(path.resolve('auth_info_baileys'));

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['VardanAI', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await backupAuthToDB();
  });

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[WhatsApp] Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      console.log('[WhatsApp] Connection completely open & ready!');
    }
  });

  sock.ev.on('messages.upsert', async (m: any) => {
    if (m.type !== 'notify') return;
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!text) return;
    console.log(`[WhatsApp] Incoming from ${jid}: ${text}`);

    // AI routing
    try {
      const { intent } = await llmGateway.classifyIntent(text);
      console.log(`[WhatsApp] Intent classified as: ${intent}`);

      let responseText = "";

      if (intent === 'faq') {
        const faqs = await db.all('SELECT * FROM knowledge_base');
        let context = faqs.map((f: any) => f.answer_hinglish).join(' ');
        responseText = await llmGateway.generateResponse(text, context);
      } 
      else if (intent === 'book_appointment') {
        responseText = "Appointment book karne ke liye kripya apna naam, age, aur doctor ka naam batayein.";
      }
      else {
        responseText = await llmGateway.generateResponse(text, "You are a friendly receptionist at Vardan Hospital.");
      }

      await sock.sendMessage(jid, { text: responseText });
    } catch (err) {
      console.error("[WhatsApp] Error processing message:", err);
    }
  });
}
