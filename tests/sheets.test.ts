import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { syncPatientToGoogleSheet, syncAppointmentToGoogleSheet } from '../src/sheets.js';

describe('Google Sheets Module Tests', () => {
  let originalFetch: any;
  let webappPayload: any = null;

  before(() => {
    originalFetch = globalThis.fetch;
    process.env.SHEETS_WEBAPP_URL = 'https://script.google.com/macros/s/mock-webapp-url/exec';
    
    globalThis.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('mock-webapp-url')) {
        webappPayload = JSON.parse(options.body);
        return {
          ok: true,
          text: async () => 'Success Mocked'
        } as any;
      }
      return { ok: false, status: 500 } as any;
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SHEETS_WEBAPP_URL;
  });

  it('should sync patient registration to Google Sheet via Web App URL', async () => {
    webappPayload = null;
    const patientData = {
      name: 'John Doe',
      phone: '919999999999',
      age: 28,
      gender: 'Male',
      lang: 'en'
    };

    await syncPatientToGoogleSheet(patientData);

    assert.ok(webappPayload, 'Should trigger fetch payload');
    assert.strictEqual(webappPayload.sheetName, 'Patients');
    assert.strictEqual(webappPayload.rowData[0], 'John Doe');
    assert.strictEqual(webappPayload.rowData[1], '919999999999');
    assert.strictEqual(webappPayload.rowData[2], 28);
    assert.strictEqual(webappPayload.rowData[3], 'Male');
    assert.strictEqual(webappPayload.rowData[4], 'en');
  });

  it('should sync appointment detail to Google Sheet via Web App URL', async () => {
    webappPayload = null;
    const appointmentData = {
      patientName: 'Jane Smith',
      patientPhone: '918888888888',
      doctorName: 'Dr. Nitin Singh',
      date: '2026-07-15',
      timeSlot: '10:00-10:30',
      status: 'confirmed'
    };

    await syncAppointmentToGoogleSheet(appointmentData);

    assert.ok(webappPayload, 'Should trigger fetch payload');
    assert.strictEqual(webappPayload.sheetName, 'Appointments');
    assert.strictEqual(webappPayload.rowData[0], 'Jane Smith');
    assert.strictEqual(webappPayload.rowData[1], '918888888888');
    assert.strictEqual(webappPayload.rowData[2], 'Dr. Nitin Singh');
    assert.strictEqual(webappPayload.rowData[3], '2026-07-15');
    assert.strictEqual(webappPayload.rowData[4], '10:00-10:30');
    assert.strictEqual(webappPayload.rowData[5], 'confirmed');
  });
});
