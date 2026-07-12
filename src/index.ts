import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { llmGateway } from './llm.js';
import { connectToWhatsApp } from './whatsapp.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

async function startServer() {
  console.log('[System] Initializing Vardan Hospital AI...');
  
  await initDb();
  console.log('[System] Database Initialized.');

  await llmGateway.reloadKeys();
  console.log('[System] LLM Gateway Ready.');

  await connectToWhatsApp();
  console.log('[System] WhatsApp Connection Initiated.');

  app.listen(PORT, () => {
    console.log(`[System] Express Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[System] Fatal Error:', err);
});
