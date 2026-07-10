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
    var data      = JSON.parse(e.postData.contents);
    var sheetName = data.sheetName;
    var headers   = data.headers;
    var rowData   = data.rowData;

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);

    // Create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
    }

    // If sheet is empty (e.g. was cleared), re-add headers
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    }

    sheet.appendRow(rowData);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Test function — run this from the Apps Script editor to verify access
function testSheetAccess() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('Connected to sheet: ' + ss.getName());
  Logger.log('Sheets: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
}
