# Commander Chronicle

A mobile-first Magic: The Gathering Commander tracker. Set up a pod, search commanders on Scryfall, record eliminations by turn, declare a winner or draw, then copy or POST the game as JSON to a Google Apps Script web app.

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

1. Choose 3–6 players. Enter each name, search and select a commander, pick a unique seat order, and choose a bracket.
2. On the battlefield, advance the turn counter and mark players eliminated (the current turn is suggested).
3. When one player remains, they are declared the winner. You can also declare a winner early or record a draw.
4. The end screen shows a JSON array of one row per player, ready to POST.

Each row looks like:

```json
{
  "match_id": "2026_09_30_01",
  "player_name": "Chandra",
  "commander_name": "Krenko, Mob Boss",
  "color_identity": "R",
  "bracket": "3",
  "turn_order": 1,
  "eliminated_turn": 8,
  "win": 0,
  "win_turn": "",
  "draw": 0
}
```

## Google Apps Script

The POST URL lives at the top of `index.html` as `GOOGLE_APPS_SCRIPT_URL`. History is loaded with `GET ?action=history` against the same endpoint.

Replace that constant if you deploy your own script. The app still works without a live endpoint: you can copy the JSON from the end screen.

### Setting up the script

The backend is in [`apps-script/Code.gs`](apps-script/Code.gs). It has `doPost` (saves games) and `doGet` (returns history for the Past Games screen).

1. Open your Google Sheet and go to **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with the file from this repo and save. It writes to a tab named `Games`, or to the first tab if there isn't one. Row 1 must be the column headers (`match_id`, `player_name`, ... `draw`); an empty sheet gets them automatically.
3. Go to **Deploy > Manage deployments**, click the pencil icon on your existing deployment, choose **Version: New version**, and click **Deploy**. Keep **Execute as: Me** and **Who has access: Anyone**.

Saving code in the editor does not update the live web app. You must deploy a new version each time. Editing the existing deployment keeps the same `/exec` URL, so `index.html` doesn't need to change.

To check it, open `YOUR_EXEC_URL?action=history` in a browser. You should see JSON starting with `{"success":true`.

## Hosting on GitHub Pages

`index.html` is fully self-contained, so GitHub Pages can serve it directly with no build step. Put it at the root of the repository, then enable **Settings > Pages > Deploy from a branch** (`main`, `/ (root)`).
