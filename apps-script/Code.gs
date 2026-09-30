/**
 * Commander Chronicle — Google Apps Script backend.
 *
 * Paste this into the Apps Script editor attached to your Google Sheet
 * (Extensions > Apps Script), replacing what's there, then deploy it as a
 * web app (Deploy > Manage deployments > edit > New version).
 *
 *   doPost: saves one row per player sent by the app, and decides the game's final match ID.
 *   doGet ?action=history: returns every saved row for the Past Games screen.
 *
 * Match IDs look like 2026_09_30_01 (date, then that day's game number) and are never reused:
 * the app suggests one, and doPost moves the game to the next free number for that date if the
 * suggestion is already taken (for example by a game recorded on another device).
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

// Every non-empty data row as { rowNumber, item } where item is keyed by header.
function readRecords_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .map((row, i) => {
      const item = {};
      headers.forEach((key, j) => {
        const cell = row[j];
        item[key] = cell instanceof Date ? cell.toISOString() : cell;
      });
      return { rowNumber: i + 2, item: item, empty: !row.some((cell) => cell !== "") };
    })
    .filter((record) => !record.empty);
}

// A game is a run of consecutive rows with the same match ID, because each save appends all of a
// game's rows together.
function groupGames_(records) {
  const games = [];
  records.forEach((record) => {
    const id = String(record.item.match_id);
    const last = games[games.length - 1];
    if (last && last.id === id) {
      last.records.push(record);
    } else {
      games.push({ id: id, records: [record] });
    }
  });
  return games;
}

function datePrefix_(matchId) {
  return String(matchId).replace(/_\d+$/, "");
}

function nextFreeId_(matchId, games) {
  const prefix = datePrefix_(matchId);
  let highest = 0;

  games.forEach((game) => {
    if (datePrefix_(game.id) !== prefix) return;
    const number = Number(game.id.slice(prefix.length + 1));
    if (Number.isInteger(number)) highest = Math.max(highest, number);
  });

  return prefix + "_" + String(highest + 1).padStart(2, "0");
}

// Gives every game after the first that shares a match ID the next free number for its date.
function fixDuplicateGameIds_(sheet, headers, games) {
  const idColumn = headers.indexOf("match_id") + 1;
  const seen = {};
  let changed = 0;

  games.forEach((game) => {
    if (seen[game.id]) {
      const newId = nextFreeId_(game.id, games);
      game.records.forEach((record) => {
        sheet.getRange(record.rowNumber, idColumn).setValue(newId);
        record.item.match_id = newId;
      });
      game.id = newId;
      changed += 1;
    }
    seen[game.id] = true;
  });

  return changed;
}

// Run this from the Apps Script editor to renumber duplicate match IDs by hand. doPost and doGet
// also do it automatically.
function fixDuplicateGameIds() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const headers = getHeaders_(sheet);
    return fixDuplicateGameIds_(sheet, headers, groupGames_(readRecords_(sheet, headers)));
  } finally {
    lock.releaseLock();
  }
}

function gameFingerprint_(rows) {
  return rows
    .map((row) => ["player_name", "turn_order", "win", "win_turn", "eliminated_turn", "draw"]
      .map((key) => String(row[key] === undefined || row[key] === null ? "" : row[key]))
      .join("|"))
    .sort()
    .join("\n");
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
    const games = groupGames_(readRecords_(sheet, headers));
    fixDuplicateGameIds_(sheet, headers, games);

    const requestedId = String(rows[0].match_id || "");
    const existing = games.filter((game) => game.id === requestedId);

    // The same game sent twice (e.g. a retry after the first response was lost) is only saved once.
    const fingerprint = gameFingerprint_(rows);
    if (existing.some((game) => gameFingerprint_(game.records.map((r) => r.item)) === fingerprint)) {
      return json_({ success: true, saved: 0, match_id: requestedId, already_saved: true });
    }

    const matchId = requestedId && !existing.length ? requestedId : nextFreeId_(requestedId, games);
    const values = rows.map((row) =>
      headers.map((key) => {
        if (key === "match_id") return matchId;
        return row[key] === undefined || row[key] === null ? "" : row[key];
      })
    );

    sheet
      .getRange(sheet.getLastRow() + 1, 1, values.length, headers.length)
      .setValues(values);

    return json_({ success: true, saved: values.length, match_id: matchId });
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

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet_();
    if (sheet.getLastRow() < 2) {
      return json_({ success: true, rows: [] });
    }

    const headers = getHeaders_(sheet);
    const records = readRecords_(sheet, headers);
    fixDuplicateGameIds_(sheet, headers, groupGames_(records));

    return json_({ success: true, rows: records.map((record) => record.item) });
  } catch (error) {
    return json_({ success: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}
