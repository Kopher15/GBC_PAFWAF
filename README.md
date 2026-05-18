# GBC @ 34 Pickleball Tournament

Static HTML tournament management system — admin panel + public live bracket — backed by Google Apps Script as a REST API with Google Sheets as the database.

---

## Project Files

| File | Purpose |
|------|---------|
| `Code.gs` | Google Apps Script backend (REST API + all logic) |
| `index.html` | Admin panel — deploy to GitHub Pages |
| `livebracket.html` | Public live bracket — deploy to GitHub Pages |

---

## Setup: Google Apps Script

### 1. Open your Apps Script project

Go to [script.google.com](https://script.google.com), open your existing project (or create a new one linked to the sheet).

### 2. Replace Code.gs

Copy the contents of `Code.gs` into your Apps Script editor, replacing the existing code.

### 3. Deploy as Web App

1. Click **Deploy → New deployment**
2. Select type: **Web app**
3. Set **Execute as**: Me
4. Set **Who has access**: Anyone
5. Click **Deploy**
6. Copy the Web App URL — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> **Important:** Every time you update `Code.gs`, you must create a **new deployment** (not update the existing one) for changes to take effect.

### 4. Set the API URL in both HTML files

Open `index.html` and `livebracket.html` and replace the placeholder near the top of the `<script>` section:

```javascript
var API_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec';
```

Paste your actual Web App URL in both files.

---

## Setup: Google Sheets

The script will auto-create any missing tabs and columns on first run. Your sheet needs the ID set correctly in `Code.gs`:

```javascript
var SHEET_ID = "1vyh7tYMA56yh-LvqKh-ZtT0JVQWztRB-zMJj9S90THk";
```

### Teams sheet columns
`ID, TeamName, P1Name, P1Email, P1Phone, P1Membership, P2Name, P2Email, P2Phone, Category, OwnPaddle, Status, RegisteredAt, Wins, Losses, Sub1Name, Sub2Name`

### Matches sheet columns
`ID, Category, Round, Slot, Team1ID, Team2ID, G1T1, G1T2, G2T1, G2T2, G3T1, G3T2, Score1, Score2, WinnerID, CreatedAt, T1Players, T2Players`

---

## Deploy to GitHub Pages

### 1. Create a GitHub repository

Create a new public repo (e.g. `gbc-pickleball`).

### 2. Push the HTML files

```bash
git init
git add index.html livebracket.html
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/gbc-pickleball.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Save

Your site will be live at:
- Admin: `https://YOUR_USERNAME.github.io/gbc-pickleball/`
- Live Bracket: `https://YOUR_USERNAME.github.io/gbc-pickleball/livebracket.html`

---

## Features

### Admin Panel (`index.html`)
- **Dashboard** — team counts, upcoming matches
- **Register** — embedded Google Form + manual sync
- **Teams** — view all teams, edit substitute players (up to 2 per team, name only)
- **Bracket** — generate bracket, assign actual players per match via dropdown
- **Scores** — enter Best-of-3 game scores, auto-advances winner
- **Announce** — send email announcements to all or specific category teams
- **Emails** — log of all sent announcements

### Live Bracket (`livebracket.html`)
- **Auto-refreshes every 30 seconds**
- Shows assigned players per match (highlighted in lime green)
- Falls back to registered P1/P2 names if no assignment set
- Champion banners when a category is complete
- Teams tab shows full roster including substitutes

### Substitute Players
- Each team can have up to 2 substitute players (name only)
- Admin sets subs via **Teams → Edit Subs**
- Before a match, admin assigns which players will play via **Bracket → Set Players**
- Dropdown shows full team roster: P1, P2, Sub1 (if set), Sub2 (if set)
- Assigned players appear on the live bracket

---

## Tournament Schedule

| Round | Date |
|-------|------|
| Round 1 | June 6, 2026 |
| Round 2 / Semifinals | June 13, 2026 |
| Final | June 20, 2026 |

---

## API Reference

All endpoints are GET requests to your Apps Script web app URL with `?action=` parameter.

| Action | Params | Description |
|--------|--------|-------------|
| `getData` | — | Returns all teams, matches, email log |
| `getFormUrl` | — | Returns Google Form published URL |
| `generateBracket` | `category` | Generates R1 bracket for category |
| `submitScore` | `matchId`, `games` (JSON) | Submits BO3 scores, advances winner |
| `updateSubstitutes` | `teamId`, `sub1`, `sub2` | Sets sub player names for a team |
| `assignMatchPlayers` | `matchId`, `t1players`, `t2players` | Assigns actual players to a match |
| `sendAnnouncement` | `subject`, `body`, `category` | Emails all teams in category |
| `syncResponses` | — | Syncs Google Form responses to Teams sheet |
