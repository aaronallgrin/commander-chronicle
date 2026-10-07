# Commander Chronicle

A mobile-first Magic: The Gathering game tracker, built around Commander. Set up a pod, search commanders on Scryfall, record eliminations by turn, declare a winner or draw, and the game is saved to a Google Sheet through a Google Apps Script web app. Two-player games can also be recorded in other formats.

Live site: [https://aaronallgrin.github.io/commander-chronicle/](https://aaronallgrin.github.io/commander-chronicle/)

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

Production build:

```bash
npm run build
npm run preview
```

## How a game is recorded

1. Choose 2–8 players. Games with 3 or more players are always Commander: enter each name, search and select a commander, and choose a bracket. Sections are labelled **Turn order #1**, **#2**, and so on — fill in #1, then pass the phone clockwise (or to the other player in a 2-player game).
2. With 2 players, Commander is still the default, but **Format** lets you pick another (see below).
3. On the battlefield, tap **Eliminate** when a player loses and enter the turn it happened on (after the first one, the latest turn entered is suggested). There's no turn counter to keep up to date. The game in progress is kept on the device, so it survives the phone reloading the page after being locked or switching apps. **Cancel game without saving** throws it away.
4. When one player remains, they are declared the winner. You can also declare a winner early or record a draw.
5. The game is saved automatically (one row per player) and the end screen shows whether it worked, with a retry button if it didn't. From there, **Play Again** starts a new game with the same players, decks and seats, **New Game** opens a fresh setup, and **Back to Past Games** returns home.

Past Games shows only Commander games by default. **Refresh** sits under the heading so you can reload the sheet without scrolling. The **Formats** dropdown has a checkbox for each format, plus **Select all** to check or clear them all. The stats and list follow the chosen formats, and each card shows its format whenever anything besides Commander is checked.

**Ask about your games** replaces the old player-name filter. Common questions (who wins the most, a player's win history, most recent game, best commanders, win rates, average win turn, best starting seat, including cEDH / bracket / format scopes) are answered from the sheet with a small stats script. Anything else falls back to Google's free **Gemini** model, using your game log plus general Magic / Scryfall knowledge.

Gemini setup (either works):

1. **This device only (easiest):** when Ask needs Gemini, a key box appears under the question. Paste a free key from [Google AI Studio](https://aistudio.google.com/apikey) and tap **Save**. It stays in that phone’s browser only.
2. **Shared for everyone:** paste the latest [`apps-script/Code.gs`](apps-script/Code.gs) (and keep the `oauthScopes` from [`apps-script/appsscript.json`](apps-script/appsscript.json) under Project Settings → Show `appsscript.json`). Set Script property `GEMINI_API_KEY`. Run `authorizeUrlFetch` once from the editor and approve external requests. Then **Deploy → Manage deployments → edit (pencil) → New version → Deploy**. Editing the script without a new deployment version will not update the live web app.

Avg Win Turn uses each won game's `win_turn`. If that's blank (common in older data), it uses the last `eliminated_turn` in that game instead. Games with no winner, draws, and games with neither turn recorded are left out.

Each game card lists players by `turn_order`. Players with a blank turn order (common in older data) come after any seated players, in the order they appear in the sheet.

### Formats

| Format | Group | What's recorded per player |
| --- | --- | --- |
| Commander (default) | | Commander (Scryfall search limited to `is:commander legal:commander`, colors from its color identity), bracket |
| Standard, Pioneer, Modern, Legacy, Vintage, Pauper | Constructed | Deck theme, deck colors |
| Dandân | Constructed | Nothing extra: both players share the mono-blue "Forgetful Fish" deck |
| Pai Gow | Limited | Set name (shared by the game) |
| Booster, Sealed | Limited | Set name (shared, suggestions from Scryfall's set list), deck colors |
| Cube | Limited | Cube name (shared), deck colors |

Each row looks like:

```json
{
  "match_id": "2026_09_30_01",
  "player_name": "Chandra",
  "format": "Commander",
  "commander_name": "Krenko, Mob Boss",
  "set_or_theme": "",
  "color_identity": "R",
  "bracket": "3",
  "turn_order": 1,
  "eliminated_turn": 8,
  "win": 0,
  "win_turn": "",
  "draw": 0
}
```

- `format` is the format name. Rows saved before formats existed have no value here and are shown as Commander.
- `commander_name` and `bracket` are only filled in for Commander.
- For a draw, the tied players have `win` = 1, `draw` = 1, and `win_turn` = the turn the draw happened on (draws saved before this was recorded have `Draw` there instead). Draws aren't counted in the average win turn.
- When a game ends by declaring a winner or a draw, every other player who hadn't already been eliminated gets `eliminated_turn` = the final turn. Past Games also shows them as out on that turn for games saved before this.
- `set_or_theme` is the deck theme (Constructed), `Forgetful Fish` (Dandân), or the set or cube name (Limited).

## Google Apps Script

The POST URL lives at the top of `index.html` as `GOOGLE_APPS_SCRIPT_URL`. History is loaded with `GET ?action=history` against the same endpoint. Shared Gemini Ask uses `GET ?action=ask&question=...` on that same URL (the app can also fall back to a key saved on the device).

Replace that constant if you deploy your own script.

### Setting up the script

The backend is in [`apps-script/Code.gs`](apps-script/Code.gs). It has `doPost` (saves games) and `doGet` (`history` for Past Games, `ask` for Gemini).

Match IDs are the date followed by that day's game number (`2026_09_30_01`, `2026_09_30_02`, ...) and are never reused. The app suggests the next number from the sheet's history, but `doPost` has the final say: if the suggested ID is already taken (for example by a game just recorded on another device), it saves the game under the next free number and the app shows that ID. Sending the same game twice only saves it once. Any duplicate IDs already in the sheet are renumbered automatically on the next save or history load, or you can run `fixDuplicateGameIds` from the Apps Script editor.

1. Open your Google Sheet and go to **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with the file from this repo and save. It writes to a tab named `Games`, or to the first tab if there isn't one. Row 1 holds the column headers (`match_id`, `player_name`, ... `draw`). An empty sheet gets them automatically, and any missing column (such as `format` or `set_or_theme` on an older sheet) is added to the end of row 1 the next time a game is saved.
3. Under **Project Settings**, turn on **Show "appsscript.json" manifest file in editor** and make sure `oauthScopes` includes `https://www.googleapis.com/auth/script.external_request` (copy from [`apps-script/appsscript.json`](apps-script/appsscript.json) if needed).
4. In the editor, select function `authorizeUrlFetch` → **Run**, then approve access (including “Connect to an external service”). This is required for shared Gemini Ask.
5. Go to **Deploy > Manage deployments**, click the pencil icon on your existing deployment, choose **Version: New version**, and click **Deploy**. Keep **Execute as: Me** and **Who has access: Anyone**.

Saving code in the editor does not update the live web app. You must deploy a new version each time. Editing the existing deployment keeps the same `/exec` URL, so `index.html` doesn't need to change.

To check it, open `YOUR_EXEC_URL?action=history` in a browser. You should see JSON starting with `{"success":true`. For Gemini, `YOUR_EXEC_URL?action=ask&question=test` should return an answer once `GEMINI_API_KEY` is set and UrlFetch is authorized.

## Hosting on GitHub Pages

`index.html` is fully self-contained, so GitHub Pages can serve it directly with no build step. The live site is published from `main` at `/ (root)`.

Keep `index.html` at the repository root. GitHub's **Add file > Upload files** page will overwrite that file if another HTML page is uploaded with the same name, which takes the live site down. Prefer git, GitHub Desktop, or Cursor when changing files.

`.nojekyll` tells GitHub Pages to serve the files as-is instead of running Jekyll.
