function doPost(e) {
  var SPREADSHEET_ID = '1YH1C0cFZ-JAJrMV0lhkyHtC1I5aWYPVTHDRFTNNwbas';
  
  try {
    var data = JSON.parse(e.postData.contents);
    var sheetName = data.sheetName;
    var headers   = data.headers;
    var rowData   = data.rowData;

    if (!sheetName || !rowData) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Missing sheetName or rowData' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      if (headers && headers.length > 0) {
        sheet.appendRow(headers);
      }
    }

    if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
      sheet.appendRow(headers);
    }

    sheet.appendRow(rowData);
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

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'VardanAI Sheets Sync is active.' }))
    .setMimeType(ContentService.MimeType.JSON);
}
