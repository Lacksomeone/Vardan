// =====================================================================
// VardanAI → Google Sheets Sync Script
// =====================================================================
// HOW TO DEPLOY:
//   1. Open https://script.google.com
//   2. Create a new project, paste this entire script
//   3. Replace SPREADSHEET_ID below with your actual Google Sheet ID
//      (It's in the URL: docs.google.com/spreadsheets/d/<ID>/edit)
//   4. Click Deploy → New Deployment
//   5. Type = "Web App"
//   6. Execute as = "Me"
//   7. Who has access = "Anyone"
//   8. Click Deploy → Copy the Web App URL
//   9. Add it to Render environment variables:
//      SHEETS_WEBAPP_URL = <paste the URL here>
// =====================================================================

var SPREADSHEET_ID = '1YH1C0cFZ-JAJrMV0lhkyHtC1I5aWYPVTHDRFTNNwbas';

function doPost(e) {
  try {
    // Parse incoming JSON data
    var data = JSON.parse(e.postData.contents);
    var sheetName = data.sheetName;
    var headers   = data.headers;
    var rowData   = data.rowData;

    // Validate required fields
    if (!sheetName || !rowData) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Missing sheetName or rowData' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);

    // Create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      if (headers && headers.length > 0) {
        sheet.appendRow(headers);
      }
    }

    // If sheet is empty (e.g. was cleared), re-add headers
    if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
      sheet.appendRow(headers);
    }

    // Append the actual data row
    sheet.appendRow(rowData);

    // Flush changes to ensure they're saved
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: 'Row added to ' + sheetName }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Also handle GET requests (Google sometimes sends GET after redirect)
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'VardanAI Sheets Sync is active. Use POST to sync data.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Test function — run this from the Apps Script editor to verify access
function testSheetAccess() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('Connected to sheet: ' + ss.getName());
  Logger.log('Sheets: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
}
