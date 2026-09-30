/**
 * Commander Chronicle — Google Apps Script backend.
 *
 * Paste this into the Apps Script editor attached to your Google Sheet
 * (Extensions > Apps Script), replacing what's there, then deploy it as a
 * web app (Deploy > Manage deployments > edit > New version).
 *
 *   doPost: saves one row per player sent by the app.
 *   doGet ?action=history: returns every saved row for the Past Games screen.
 */

const SHEET_NAME = "Games";

const COLUMNS = [
  "match_id",
  "player_name",
  "format",
  "commander_name",
  "set_or_theme",
  "color_identity",
  "bracket",
  "turn_order",
  "eliminated_turn",
  "win",
  "win_turn",
  "draw"
];

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getSheets()[0];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  }

  return sheet;
}

// Matches "Player Name", "player_name", and "player name" to the same key.
function normalizeHeader_(header) {
  return String(header).trim().toLowerCase().replace(/\s+/g, "_");
}

function getHeaders_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(normalizeHeader_);
}

// Sheets created before a column existed get it added to the end of row 1, so saves don't drop it.
function ensureColumns_(sheet) {
  const headers = getHeaders_(sheet);
  const missing = COLUMNS.filter((column) => headers.indexOf(column) === -1);

  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = JSON.parse(e.postData.contents);
    if (!Array.isArray(rows) || !rows.length) {
      return json_({ success: false, error: "Expected a non-empty array of rows." });
    }

    const sheet = getSheet_();
    ensureColumns_(sheet);
    const headers = getHeaders_(sheet);
    const values = rows.map((row) =>
      headers.map((key) => (row[key] === undefined || row[key] === null ? "" : row[key]))
    );

    sheet
      .getRange(sheet.getLastRow() + 1, 1, values.length, headers.length)
      .setValues(values);

    return json_({ success: true, saved: values.length });
  } catch (error) {
    return json_({ success: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";

  if (action !== "history") {
    return json_({ success: false, error: "Unknown action. Use ?action=history." });
  }

  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return json_({ success: true, rows: [] });
    }

    const headers = getHeaders_(sheet);
    const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    const rows = values
      .filter((row) => row.some((cell) => cell !== ""))
      .map((row) => {
        const item = {};
        headers.forEach((key, i) => {
          const cell = row[i];
          item[key] = cell instanceof Date ? cell.toISOString() : cell;
        });
        return item;
      });

    return json_({ success: true, rows: rows });
  } catch (error) {
    return json_({ success: false, error: String(error) });
  }
}
