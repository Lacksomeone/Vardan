import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { connectToWhatsApp } from './whatsapp.js';
import { startScheduler } from './scheduler.js';
import { autoResolvePendingQueries } from './agents/faq.js';
import dashboardRouter from './routes/dashboard.js';

dotenv.config();

// 1. Initialize SQLite Database & Seeding
initDb();

// 2. Connect to WhatsApp client (Baileys)
connectToWhatsApp().catch(err => {
  console.error('Failed to connect to WhatsApp Baileys:', err);
});

// 3. Start Follow-Up Scheduler
startScheduler();

// 3.5 Auto-resolve pending queries using AI
setTimeout(() => {
  autoResolvePendingQueries().catch(err => console.error('[FAQ AutoResolver] Error:', err));
}, 30000);

// 4. Initialize Express Application
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static uploaded doctor images
app.use('/uploads', express.static(path.resolve('uploads')));

// API Routes
app.use('/api', dashboardRouter);

// Serve static React dashboard in production
const dashboardDist = path.resolve('dashboard/dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });
} else {
  // Fallback for development if build is not present yet
  app.get('/', (req, res) => {
    res.send('VardanAI Backend is running. Frontend dashboard dist folder not found - build React app in dashboard/ folder.');
  });
}

app.listen(PORT, () => {
  console.log(`VardanAI Server successfully running on port ${PORT}`);
});
