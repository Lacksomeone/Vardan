import db from './db.js';
import { AuthenticationCreds, AuthenticationState, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

/**
 * Custom auth state for Baileys using the database.
 * Uses an in-memory cache for ultra-fast reads and batches writes
 * asynchronously to Turso to prevent Baileys from dropping connections.
 */
export const useDatabaseAuthState = async (): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  const memoryAuth = new Map<string, string>();
  const writeQueue = new Map<string, string | null>(); // null means delete

  console.log('[WhatsAppAuth] Loading auth state from Turso into memory...');
  try {
    const rows = (await db.prepare('SELECT id, value FROM whatsapp_auth').all()) as any[];
    for (const row of rows) {
      if (row && row.id && row.value) {
        memoryAuth.set(row.id, row.value);
      }
    }
    console.log(`[WhatsAppAuth] Loaded ${memoryAuth.size} auth keys into memory.`);
  } catch (err) {
    console.error('[WhatsAppAuth] Error loading initial auth state:', err);
  }

  // Background worker to flush writeQueue to Turso every 5 seconds
  setInterval(async () => {
    if (writeQueue.size === 0) return;
    
    // Copy and clear the queue
    const currentBatch = new Map(writeQueue);
    writeQueue.clear();

    const stmts: any[] = [];
    for (const [key, val] of currentBatch.entries()) {
      if (val !== null) {
        stmts.push({
          sql: 'INSERT INTO whatsapp_auth (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
          args: [key, val]
        });
      } else {
        stmts.push({
          sql: 'DELETE FROM whatsapp_auth WHERE id = ?',
          args: [key]
        });
      }
    }

    try {
      // Execute as a single batch transaction to Turso
      if (db.batch) {
        await db.batch(stmts);
      } else {
        // Fallback if batch isn't strictly available
        for (const stmt of stmts) {
           await db.prepare(stmt.sql).run(...stmt.args);
        }
      }
    } catch (err) {
      console.error(`[WhatsAppAuth] Error syncing ${stmts.length} keys to Turso in background:`, err);
    }
  }, 5000);

  const credsStr = memoryAuth.get('creds');
  const creds: AuthenticationCreds = credsStr ? JSON.parse(credsStr, BufferJSON.reviver) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [key: string]: any } = {};
          for (const id of ids) {
            const key = `${type}-${id}`;
            const valueStr = memoryAuth.get(key);
            if (valueStr) {
              try {
                data[id] = JSON.parse(valueStr, BufferJSON.reviver);
              } catch (e) {
                console.error(`[WhatsAppAuth] Error parsing key ${key} from memory`);
              }
            }
          }
          return data;
        },
        set: async (data: any) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                memoryAuth.set(key, serialized);
                writeQueue.set(key, serialized);
              } else {
                memoryAuth.delete(key);
                writeQueue.set(key, null);
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      memoryAuth.set('creds', serialized);
      writeQueue.set('creds', serialized);
    }
  };
};
