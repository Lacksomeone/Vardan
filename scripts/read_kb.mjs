import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '../data/vardan.db'));

const rows = db.prepare('SELECT id, category, question_variants, answer_hi, answer_hinglish, answer_en FROM knowledge_base').all();
console.log(JSON.stringify(rows, null, 2));
