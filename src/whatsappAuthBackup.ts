import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { db } from './db.js';

const AUTH_FOLDER = path.resolve('auth_info_baileys');

export async function restoreAuthFromDB() {
  try {
    const row = await db.get('SELECT zip_data FROM auth_backup WHERE id = 1');
    if (row && row.zip_data) {
      console.log('[AuthBackup] Found auth backup in Turso DB. Restoring to local folder...');
      
      // Clear current folder if exists
      if (fs.existsSync(AUTH_FOLDER)) {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      }
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });

      // Write zip to temp file
      const tempZip = path.resolve('temp_auth.zip');
      
      // If it's stored as ArrayBuffer/Buffer (Turso BLOB)
      const buffer = Buffer.isBuffer(row.zip_data) ? row.zip_data : Buffer.from(row.zip_data as any);
      fs.writeFileSync(tempZip, buffer);

      // Extract
      const zip = new AdmZip(tempZip);
      zip.extractAllTo(AUTH_FOLDER, true);

      // Cleanup temp
      fs.unlinkSync(tempZip);
      console.log('[AuthBackup] Restore successful.');
    } else {
      console.log('[AuthBackup] No backup found in DB. Starting fresh.');
    }
  } catch (err) {
    console.error('[AuthBackup] Failed to restore from DB:', err);
  }
}

export async function backupAuthToDB() {
  if (!fs.existsSync(AUTH_FOLDER)) return;

  try {
    const zip = new AdmZip();
    zip.addLocalFolder(AUTH_FOLDER);
    const buffer = zip.toBuffer();

    await db.run('INSERT INTO auth_backup (id, zip_data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET zip_data = excluded.zip_data', [buffer]);
  } catch (err) {
    console.error('[AuthBackup] Failed to backup to DB:', err);
  }
}
