import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = '1YH1C0cFZ-JAJrMV0lhkyHtC1I5aWYPVTHDRFTNNwbas';
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Initialize Google Sheets Auth client (Service Account)
let sheetsClient: any = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!CLIENT_EMAIL || !PRIVATE_KEY) {
    console.warn('Google Sheets API credentials not set in .env. Skipping Service Account fallback.');
    return null;
  }

  try {
    const auth = new google.auth.JWT(
      CLIENT_EMAIL,
      undefined,
      PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (err) {
    console.error('Failed to initialize Google Sheets client:', err);
    return null;
  }
}

// Ensure sheets exist with correct headers (Service Account Method)
async function ensureSheetExists(sheets: any, title: string, headers: string[]) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = meta.data.sheets?.some(
      (s: any) => s.properties?.title === title
    );

    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title }
              }
            }
          ]
        }
      });
      console.log(`Created Google Sheet: "${title}"`);

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${title}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers]
        }
      });
    }
  } catch (err) {
    console.error(`Error ensuring sheet "${title}" exists:`, err);
  }
}

// Helper: Sync using Google Apps Script Web App URL
async function syncViaWebApp(sheetName: string, headers: string[], rowData: any[]): Promise<boolean> {
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) return false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetName, headers, rowData })
    });
    
    if (res.ok) {
      console.log(`Successfully synced to sheet "${sheetName}" via Google Web App URL.`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Google Apps Script web app sync failed for "${sheetName}":`, err);
    return false;
  }
}

// Sync Patient Registration details
export async function syncPatientToGoogleSheet(patient: {
  name: string;
  phone: string;
  age: number;
  gender: string;
  lang: string;
}) {
  const title = 'Patients';
  const headers = ['Name', 'Phone', 'Age', 'Gender', 'Preferred Language', 'Registered At'];
  const rowValues = [
    patient.name,
    patient.phone,
    patient.age,
    patient.gender,
    patient.lang,
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  ];

  // Method 1: Try Google Apps Script Web App URL (Simplest)
  if (process.env.SHEETS_WEBAPP_URL) {
    const success = await syncViaWebApp(title, headers, rowValues);
    if (success) return;
  }

  // Method 2: Try Service Account Fallback
  const sheets = getSheetsClient();
  if (!sheets) {
    console.warn('Google Sheets sync skipped: Neither SHEETS_WEBAPP_URL nor Service Account Key configured.');
    return;
  }

  await ensureSheetExists(sheets, title, headers);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues]
      }
    });
    console.log(`Synced patient "${patient.name}" to Google Sheet via Service Account.`);
  } catch (err) {
    console.error('Failed to sync patient row to Google Sheet:', err);
  }
}

// Sync Appointment booking details
export async function syncAppointmentToGoogleSheet(appointment: {
  patientName: string;
  patientPhone: string;
  doctorName: string;
  date: string;
  timeSlot: string;
  status: string;
}) {
  const title = 'Appointments';
  const headers = ['Patient Name', 'Patient Phone', 'Doctor Name', 'Date', 'Time Slot', 'Status', 'Booked At'];
  const rowValues = [
    appointment.patientName,
    appointment.patientPhone,
    appointment.doctorName,
    appointment.date,
    appointment.timeSlot,
    appointment.status,
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  ];

  // Method 1: Try Google Apps Script Web App URL (Simplest)
  if (process.env.SHEETS_WEBAPP_URL) {
    const success = await syncViaWebApp(title, headers, rowValues);
    if (success) return;
  }

  // Method 2: Try Service Account Fallback
  const sheets = getSheetsClient();
  if (!sheets) return;

  await ensureSheetExists(sheets, title, headers);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues]
      }
    });
    console.log(`Synced appointment for patient "${appointment.patientName}" with Dr. ${appointment.doctorName} to Google Sheet via Service Account.`);
  } catch (err) {
    console.error('Failed to sync appointment row to Google Sheet:', err);
  }
}
