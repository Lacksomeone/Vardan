import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = '1YH1C0cFZ-JAJrMV0lhkyHtC1I5aWYPVTHDRFTNNwbas';
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Initialize Google Sheets Auth client
let sheetsClient: any = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!CLIENT_EMAIL || !PRIVATE_KEY) {
    console.warn('Google Sheets credentials not set in .env. Skipping spreadsheet sync.');
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

// Ensure sheets exist with correct headers
async function ensureSheetExists(sheets: any, title: string, headers: string[]) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = meta.data.sheets?.some(
      (s: any) => s.properties?.title === title
    );

    if (!sheetExists) {
      // Create new sheet
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

      // Write headers
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

// Sync Patient Registration details
export async function syncPatientToGoogleSheet(patient: {
  name: string;
  phone: string;
  age: number;
  gender: string;
  lang: string;
}) {
  const sheets = getSheetsClient();
  if (!sheets) return;

  const title = 'Patients';
  const headers = ['Name', 'Phone', 'Age', 'Gender', 'Preferred Language', 'Registered At'];
  await ensureSheetExists(sheets, title, headers);

  const rowValues = [
    patient.name,
    patient.phone,
    patient.age,
    patient.gender,
    patient.lang,
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  ];

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
    console.log(`Synced patient "${patient.name}" to Google Sheet.`);
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
  const sheets = getSheetsClient();
  if (!sheets) return;

  const title = 'Appointments';
  const headers = ['Patient Name', 'Patient Phone', 'Doctor Name', 'Date', 'Time Slot', 'Status', 'Booked At'];
  await ensureSheetExists(sheets, title, headers);

  const rowValues = [
    appointment.patientName,
    appointment.patientPhone,
    appointment.doctorName,
    appointment.date,
    appointment.timeSlot,
    appointment.status,
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  ];

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
    console.log(`Synced appointment for patient "${appointment.patientName}" with Dr. ${appointment.doctorName} to Google Sheet.`);
  } catch (err) {
    console.error('Failed to sync appointment row to Google Sheet:', err);
  }
}
