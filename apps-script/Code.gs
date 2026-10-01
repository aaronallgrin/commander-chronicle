/**
 * Commander Chronicle — Google Apps Script backend.
 *
 * Paste this into the Apps Script editor attached to your Google Sheet
 * (Extensions > Apps Script), replacing what's there, then deploy it as a
 * web app (Deploy > Manage deployments > edit > New version).
 *
 *   doPost: saves one row per player sent by the app, and decides the game's final match ID.
 *            Also answers Ask questions when the body is `{ action: "ask", question }` and
 *            GEMINI_API_KEY is set in Script properties.
 *   doGet ?action=history: returns every saved row for the Past Games screen.
 *
 * For Gemini Ask answers, set Project Settings > Script properties:
 *   GEMINI_API_KEY = your free key from https://aistudio.google.com/apikey
 *
 * Match IDs look like 2026_09_30_01 (date, then that day's game number) and are never reused:
 * the app suggests one, and doPost moves the game to the next free number for that date if the
 * suggestion is already taken (for example by a game recorded on another device).
 */

const SHEET_NAME = "Games";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

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

const BRACKET_NAMES = {
  "p": "Precon",
  "1": "Bracket 1",
  "2": "Bracket 2",
  "3": "Bracket 3",
  "4": "Bracket 4",
  "5": "cEDH"
};

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

function truthy_(value) {
  return value == 1 || value === "1" || value === true || value === "TRUE";
}

function matchIdDate_(matchId) {
  const parts = String(matchId || "").split("_");
  return parts.length >= 3 ? parts[0] + "/" + parts[1] + "/" + parts[2] : String(matchId || "");
}

function formatName_(value) {
  const name = String(value || "").trim();
  return name || "Commander";
}

function buildAskContext_(rows) {
  const games = [];
  rows.forEach((row) => {
    const last = games[games.length - 1];
    if (last && last.match_id === row.match_id) last.players.push(row);
    else games.push({ match_id: row.match_id, players: [row] });
  });

  const leaderboard = {};
  games.forEach((game) => {
    const seen = {};
    game.players.forEach((row) => {
      const name = String(row.player_name || "").trim() || "Unknown";
      const key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      if (!leaderboard[key]) leaderboard[key] = { name: name, games: 0, wins: 0, draws: 0, losses: 0 };
      const entry = leaderboard[key];
      entry.games += 1;
      if (truthy_(row.draw)) entry.draws += 1;
      else if (truthy_(row.win)) entry.wins += 1;
      else entry.losses += 1;
    });
  });

  const commanders = {};
  rows.forEach((row) => {
    if (formatName_(row.format) !== "Commander") return;
    const commander = String(row.commander_name || "").trim();
    if (!commander) return;
    const key = commander.toLowerCase();
    if (!commanders[key]) commanders[key] = { name: commander, games: 0, wins: 0 };
    commanders[key].games += 1;
    if (truthy_(row.win) && !truthy_(row.draw)) commanders[key].wins += 1;
  });

  const recent = games.slice(-60).map((game) => ({
    match_id: game.match_id,
    date: matchIdDate_(game.match_id),
    format: formatName_(game.players[0].format),
    set_or_theme: String(game.players[0].set_or_theme || ""),
    players: game.players.map((p) => ({
      name: String(p.player_name || "").trim() || "Unknown",
      commander: String(p.commander_name || ""),
      colors: String(p.color_identity || ""),
      bracket: BRACKET_NAMES[String(p.bracket)] || String(p.bracket || ""),
      seat: p.turn_order,
      eliminated_turn: p.eliminated_turn,
      win: truthy_(p.win) && !truthy_(p.draw),
      draw: truthy_(p.draw),
      win_turn: p.win_turn
    }))
  }));

  const leaderboardList = Object.keys(leaderboard).map((key) => leaderboard[key])
    .sort(function (a, b) {
      return b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name);
    })
    .slice(0, 12);

  const commanderList = Object.keys(commanders).map((key) => commanders[key])
    .sort(function (a, b) {
      return b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name);
    })
    .slice(0, 12);

  return {
    totals: {
      games: games.length,
      players: Object.keys(leaderboard).length,
      rows: rows.length
    },
    leaderboard: leaderboardList,
    commanders: commanderList,
    recent_games: recent
  };
}

function askSystemPrompt_() {
  return [
    "You are the stats assistant for Commander Chronicle, a private Magic: The Gathering game log.",
    "Answer using the provided game data as the source of truth for this group's results.",
    "You may use Scryfall-level and general Magic knowledge for card/strategy context, but never invent games, wins, or players that are not in the data.",
    "If the data is incomplete for the question, say what is missing.",
    "Keep answers concise and concrete. Prefer short paragraphs or bullet-like lines.",
    "cEDH means Commander bracket 5 in this app."
  ].join(" ");
}

function handleAsk_(body) {
  const question = String(body.question || "").trim();
  if (!question) {
    return json_({ success: false, error: "Empty question." });
  }

  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) {
    return json_({
      success: false,
      needs_key: true,
      error: "Set GEMINI_API_KEY in Apps Script project properties."
    });
  }

  const sheet = getSheet_();
  const headers = getHeaders_(sheet);
  const records = sheet.getLastRow() < 2 ? [] : readRecords_(sheet, headers);
  const rows = records.map((record) => record.item);
  const context = buildAskContext_(rows);

  const payload = {
    contents: [{
      role: "user",
      parts: [{
        text: askSystemPrompt_() +
          "\n\nGAME DATA JSON:\n" + JSON.stringify(context) +
          "\n\nQUESTION:\n" + question
      }]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
  };

  const response = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      GEMINI_MODEL +
      ":generateContent?key=" +
      encodeURIComponent(key),
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const code = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (code < 200 || code >= 300) {
    const message = data.error && data.error.message
      ? data.error.message
      : ("Gemini HTTP " + code);
    return json_({ success: false, error: message });
  }

  const parts = ((data.candidates || [])[0] || {}).content
    ? (((data.candidates || [])[0] || {}).content.parts || [])
    : [];
  const answer = parts.map(function (part) { return part.text || ""; }).join("").trim();
  if (!answer) {
    return json_({ success: false, error: "Gemini returned an empty answer." });
  }

  return json_({ success: true, answer: answer });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const body = JSON.parse(e.postData.contents);

    if (body && !Array.isArray(body) && body.action === "ask") {
      return handleAsk_(body);
    }

    const rows = body;
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
