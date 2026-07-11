// Set environment to test at the very beginning to isolate the DB
process.env.NODE_ENV = 'test';

// Import all test suites to run them sequentially in a single process
import './db.test.js';
import './llm.test.js';
import './whatsapp.test.js';
import './sheets.test.js';
import './scheduler.test.js';
import './agents.test.js';
import './routes.test.js';
