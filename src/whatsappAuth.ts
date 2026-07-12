import db from './db.js';
import { AuthenticationCreds, AuthenticationState, initAuthCreds, SignalDataTypeMap, BufferJSON } from '@whiskeysockets/baileys';

/**
 * Custom auth state for Baileys using the database
 */
export const useDatabaseAuthState = async (): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  const readData = async (key: string) => {
    try {
      const row = (await db.prepare('SELECT value FROM whatsapp_auth WHERE id = ?').get(key)) as any;
      if (row && row.value) {
        return JSON.parse(row.value, BufferJSON.reviver);
      }
      return null;
    } catch (err) {
      console.error(`[WhatsAppAuth] Error reading ${key}:`, err);
      return null;
    }
  };

  const writeData = async (key: string, data: any) => {
    try {
      const value = JSON.stringify(data, BufferJSON.replacer);
      await db.prepare('INSERT INTO whatsapp_auth (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = ?').run(key, value, value);
    } catch (err) {
      console.error(`[WhatsAppAuth] Error writing ${key}:`, err);
    }
  };

  const removeData = async (key: string) => {
    try {
      await db.prepare('DELETE FROM whatsapp_auth WHERE id = ?').run(key);
    } catch (err) {
      console.error(`[WhatsAppAuth] Error removing ${key}:`, err);
    }
  };

  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [key: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                 // The BufferJSON reviver handles the buffer decoding
              }
              if (value) {
                data[id] = value;
              }
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => {
      return writeData('creds', creds);
    }
  };
};
