/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   GBC @ 34 PICKLEBALL TOURNAMENT — Code.gs (REST API edition)   ║
 * ║   Single Sheet: responses + teams + matches all in one         ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  SETUP (run once from Apps Script editor):                      ║
 * ║  1. Paste into Code.gs                                          ║
 * ║  2. Run  attachFormTrigger()  — wires trigger to existing form  ║
 * ║  3. Run  syncAllResponses()   — imports existing form entries   ║
 * ║  4. Run  diagnoseDev()        — verify everything is connected  ║
 * ║  5. Deploy → New Deployment → Web App                           ║
 * ║     Execute as: Me | Who has access: Anyone                     ║
 * ║  6. Copy the /exec URL into API_URL of both HTML files          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
var ADMIN_EMAIL  = "kophersalada@gmail.com";

// ONE sheet that holds everything: Form Responses tab + Teams + Matches + EmailLog
var SHEET_ID     = "1vyh7tYMA56yh-LvqKh-ZtT0JVQWztRB-zMJj9S90THk";

// Your existing Google Form
var FORM_ID      = "1e9HppGw86N30X7Bm67TDawuAigBePhal86lan8zjNm0";

// The exact tab name where form responses land (check your sheet tab)
var TAB_RESPONSES = "Form Responses";

var TAB_TEAMS    = "Teams";
var TAB_MATCHES  = "Matches";
var TAB_EMAILS   = "EmailLog";
var MAX_TEAMS    = 12;
var GAMES_TO_WIN = 2;

var ROUNDS = [
  { id: 1, label: "Round 1 - Elimination", short: "R1", date: "Saturday, June 6, 2026"  },
  { id: 2, label: "Round 2 - Winners",     short: "R2", date: "Saturday, June 13, 2026" },
  { id: 3, label: "Championship",          short: "CH", date: "Saturday, June 20, 2026" }
];

// Column layouts (single source of truth for migration)
var TEAM_COLS   = ["ID","TeamName","P1Name","P1Email","P1Phone","P1Membership",
                   "P2Name","P2Email","P2Phone","Category","OwnPaddle","Status",
                   "RegisteredAt","Wins","Losses","Sub1Name","Sub2Name"];
var MATCH_COLS  = ["ID","Category","Round","Slot","Team1ID","Team2ID",
                   "G1T1","G1T2","G2T1","G2T2","G3T1","G3T2",
                   "Score1","Score2","WinnerID","CreatedAt","T1Players","T2Players"];

// =============================================================================
// ONE-TIME SETUP
// =============================================================================

function attachFormTrigger() {
  // Remove old triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(tr) {
    if (tr.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(tr);
      Logger.log("Removed old trigger.");
    }
  });

  var form = FormApp.openById(FORM_ID);
  ScriptApp.newTrigger("onFormSubmit").forForm(form).onFormSubmit().create();

  Logger.log("====================================================");
  Logger.log("Trigger attached to: " + form.getTitle());
  Logger.log("Form URL: " + form.getPublishedUrl());
  Logger.log("Sheet:    https://docs.google.com/spreadsheets/d/" + SHEET_ID);
  Logger.log("====================================================");
  Logger.log("Next: run syncAllResponses() to import existing data.");
}

// =============================================================================
// ONE-TIME: add the two substitute questions to the Google Form
// Run once from the Apps Script editor. Safe to re-run (skips if present).
// =============================================================================

function addSubstituteQuestions() {
  var form   = FormApp.openById(FORM_ID);
  var titles = form.getItems().map(function(it){ return it.getTitle().toLowerCase(); });

  function has(substr) {
    return titles.some(function(t){ return t.indexOf(substr.toLowerCase()) !== -1; });
  }

  var added = [];

  if (!has("Substitute Player 1")) {
    form.addTextItem()
      .setTitle("Substitute Player 1 - Full Name")
      .setHelpText("Optional. Reserve/substitute player — name only.")
      .setRequired(false);
    added.push("Substitute Player 1 - Full Name");
  }

  if (!has("Substitute Player 2")) {
    form.addTextItem()
      .setTitle("Substitute Player 2 - Full Name")
      .setHelpText("Optional. Reserve/substitute player — name only.")
      .setRequired(false);
    added.push("Substitute Player 2 - Full Name");
  }

  // Move the new questions to sit right after the last "Player 2" question
  var lastP2 = -1;
  form.getItems().forEach(function(it, i){
    if (it.getTitle().toLowerCase().indexOf("player 2") !== -1
        && it.getTitle().toLowerCase().indexOf("substitute") === -1) lastP2 = i;
  });
  if (lastP2 >= 0) {
    var all = form.getItems();
    all.forEach(function(it){
      var t = it.getTitle().toLowerCase();
      if (t.indexOf("substitute player 1") !== -1) form.moveItem(it.getIndex(), lastP2 + 1);
      if (t.indexOf("substitute player 2") !== -1) form.moveItem(it.getIndex(), lastP2 + 2);
    });
  }

  Logger.log("====================================================");
  if (added.length) Logger.log("Added: " + added.join(", "));
  else Logger.log("Substitute questions already exist — nothing added.");
  Logger.log("Form: " + form.getPublishedUrl());
  Logger.log("====================================================");
  return { ok: true, added: added };
}

// =============================================================================
// SYNC EXISTING RESPONSES → Teams tab
// =============================================================================

function syncAllResponses() {
  var ss    = getSheet();
  var rTab  = findResponseTab(ss);
  if (!rTab) {
    Logger.log("ERROR: Could not find a Form Responses tab. Tabs found: " +
      ss.getSheets().map(function(s){ return s.getName(); }).join(", "));
    return { ok: false, msg: "Form Responses tab not found." };
  }

  var data = rTab.getDataRange().getValues();
  if (data.length < 2) { Logger.log("No responses found."); return { ok: true, msg: "No responses." }; }

  var hdrs   = data[0];
  var teams  = readRows(ss, TAB_TEAMS);
  var synced = 0, skipped = 0, waitlisted = 0;

  for (var i = 1; i < data.length; i++) {
    var mapped = mapRow(hdrs, data[i]);
    if (!mapped) { skipped++; continue; }

    // Deduplicate: skip if same P1 email + category already in Teams
    var exists = teams.some(function(t) {
      return t.P1Email.toLowerCase() === mapped.p1Email.toLowerCase()
          && t.Category === mapped.category;
    });
    if (exists) { skipped++; continue; }

    var catCount = teams.filter(function(t){ return t.Category === mapped.category; }).length;
    var status   = catCount >= MAX_TEAMS ? "waitlisted" : "confirmed";

    ss.getSheetByName(TAB_TEAMS).appendRow([
      makeUID(), mapped.teamName,
      mapped.p1Name, mapped.p1Email, mapped.p1Phone, mapped.p1Membership,
      mapped.p2Name, mapped.p2Email, mapped.p2Phone,
      mapped.category, mapped.paddle, status,
      data[i][0] instanceof Date ? data[i][0].toLocaleString() : new Date().toLocaleString(),
      0, 0, mapped.sub1Name || "", mapped.sub2Name || ""
    ]);

    teams = readRows(ss, TAB_TEAMS); // refresh after each insert
    if (status === "waitlisted") waitlisted++;
    else synced++;
    Logger.log("Synced [" + status + "]: " + mapped.teamName + " — " + mapped.category);
  }

  Logger.log("====================================================");
  Logger.log("Done. Confirmed: " + synced + " | Waitlisted: " + waitlisted + " | Skipped: " + skipped);
  Logger.log("====================================================");
  return { ok: true, msg: "Confirmed " + synced + ", waitlisted " + waitlisted + ", skipped " + skipped + "." };
}

// Helper: find the form responses tab regardless of exact name
function findResponseTab(ss) {
  var sheets = ss.getSheets();
  var t = ss.getSheetByName(TAB_RESPONSES);
  if (t) return t;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().indexOf("form response") !== -1) return sheets[i];
  }
  return null;
}

// =============================================================================
// FORM TRIGGER — fires automatically on every new submission
// =============================================================================

function onFormSubmit(e) {
  try {
    var responses = e.response.getItemResponses();
    var data = {};
    responses.forEach(function(r) { data[r.getItem().getTitle()] = r.getResponse(); });

    var mapped = mapFormData(data);
    if (!mapped) {
      Logger.log("onFormSubmit: Could not map data. Keys: " + Object.keys(data).join(", "));
      return;
    }

    var ss       = getSheet();
    var teams    = readRows(ss, TAB_TEAMS);
    var existing = teams.filter(function(t){ return t.Category === mapped.category; });

    var dup = existing.some(function(t){
      return t.P1Email.toLowerCase() === mapped.p1Email.toLowerCase();
    });
    if (dup) { Logger.log("Duplicate ignored: " + mapped.p1Email); return; }

    var isFull = existing.length >= MAX_TEAMS;
    var status = isFull ? "waitlisted" : "confirmed";

    if (!isFull) {
      ss.getSheetByName(TAB_TEAMS).appendRow([
        makeUID(), mapped.teamName,
        mapped.p1Name, mapped.p1Email, mapped.p1Phone, mapped.p1Membership,
        mapped.p2Name, mapped.p2Email, mapped.p2Phone,
        mapped.category, mapped.paddle, status,
        new Date().toLocaleString(), 0, 0,
        mapped.sub1Name || "", mapped.sub2Name || ""
      ]);
      Logger.log("Registered: " + mapped.teamName + " (" + mapped.category + ")");
    } else {
      Logger.log("Full — waitlisted: " + mapped.teamName);
    }

    var subject = isFull ? "GBC Pickleball - Registration Waitlisted"
                         : "GBC Pickleball - Registration Confirmed! 🏓";
    var body    = isFull ? buildWaitlistEmail(mapped) : buildConfirmEmail(mapped);

    var ss2 = getSheet();
    if (isValidEmail(mapped.p1Email)) mailAndLog(ss2, mapped.p1Email, subject, body);
    if (mapped.p2Email !== mapped.p1Email && isValidEmail(mapped.p2Email)) {
      mailAndLog(ss2, mapped.p2Email, subject, body);
    }
    mailAndLog(ss2, ADMIN_EMAIL,
      "[" + status.toUpperCase() + "] " + mapped.teamName + " — " + mapped.category,
      "Status: " + status.toUpperCase() +
        "\nTeam:     " + mapped.teamName +
        "\nCategory: " + mapped.category +
        "\nP1: " + mapped.p1Name + " <" + mapped.p1Email + "> — " + mapped.p1Membership +
        "\nP2: " + mapped.p2Name + " <" + mapped.p2Email + ">" +
        "\nSubs: " + (mapped.sub1Name || "—") + " / " + (mapped.sub2Name || "—") +
        "\nPaddle: " + mapped.paddle
    );

  } catch(err) {
    Logger.log("onFormSubmit ERROR: " + err.toString());
    try { MailApp.sendEmail({ to: ADMIN_EMAIL, subject: "GBC Pickleball - Error", body: err.toString() }); } catch(e2) {}
  }
}

// =============================================================================
// DATA MAPPER
// =============================================================================

function mapRow(hdrs, row) {
  var data = {};
  hdrs.forEach(function(h, i) { data[h] = row[i] === undefined ? "" : row[i]; });
  return mapFormData(data);
}

function mapFormData(data) {
  function find(patterns) {
    for (var pi = 0; pi < patterns.length; pi++) {
      for (var key in data) {
        if (key.toLowerCase().indexOf(patterns[pi].toLowerCase()) !== -1) {
          var val = data[key];
          if (val !== null && val !== undefined && String(val).trim() !== "") {
            return String(val).trim();
          }
        }
      }
    }
    return "";
  }

  var category     = find(["Category"]);
  var p1Name       = find(["Player 1 - Full Name"]);
  var p1Email      = find(["Player 1 - Email"]);
  var p1Phone      = find(["Player 1 - Phone", "Player 1 - Viber"]);
  var p1Membership = find(["Player 1 - Membership", "Membership Status"]);
  var p2Name       = find(["Player 2 - Full Name"]);
  var p2Email      = find(["Player 2 - Email"]);
  var p2Phone      = find(["Player 2 - Phone", "Player 2 - Viber"]);
  var paddle       = find(["paddle", "own paddle"]);
  var sub1Name     = find(["Sub 1", "Substitute 1", "Sub Player 1", "Substitute Player 1", "Substitute Name 1"]);
  var sub2Name     = find(["Sub 2", "Substitute 2", "Sub Player 2", "Substitute Player 2", "Substitute Name 2"]);

  if (!p1Name || !category) return null;

  var cat = category;
  if (category.toLowerCase().indexOf("women") !== -1) {
    cat = "Womens Doubles";
  } else if (category.toLowerCase().indexOf("men") !== -1) {
    cat = "Mens Doubles";
  }

  var firstName1 = p1Name.split(" ")[0] || p1Name;
  var firstName2 = p2Name ? (p2Name.split(" ")[0] || p2Name) : "Partner";
  var teamName   = firstName1 + " & " + firstName2;

  return {
    category:      cat,
    teamName:      teamName,
    p1Name:        p1Name,
    p1Email:       p1Email,
    p1Phone:       p1Phone,
    p1Membership:  p1Membership,
    p2Name:        p2Name || "",
    p2Email:       p2Email || "",
    p2Phone:       p2Phone || "",
    paddle:        paddle,
    sub1Name:      sub1Name || "",
    sub2Name:      sub2Name || ""
  };
}

// =============================================================================
// EMAIL BUILDERS
// =============================================================================

function buildConfirmEmail(m) {
  return "Hi " + m.p1Name + " & " + m.p2Name + "!\n\n" +
    "Your team \"" + m.teamName + "\" is officially registered!\n\n" +
    "CATEGORY: " + m.category + "\n\n" +
    "TOURNAMENT DATES:\n" +
    "  Round 1      - Saturday, June 6, 2026\n" +
    "  Round 2      - Saturday, June 13, 2026\n" +
    "  Championship - Saturday, June 20, 2026\n\n" +
    "VENUE: 62-B Happy Valley, Cebu City\n" +
    "FORMAT: Single Elimination | Best of 3 Games per Match\n\n" +
    "REMINDERS:\n" +
    "  Bring your own paddle if possible\n" +
    "  Bring your own tumbler — free water provided\n\n" +
    "God bless and see you on the court!\n" +
    "GBC Pickleball Club";
}

function buildWaitlistEmail(m) {
  return "Hi " + m.p1Name + " & " + m.p2Name + "!\n\n" +
    "Thank you for registering! Unfortunately, the " + m.category +
    " category is now full (" + MAX_TEAMS + " teams).\n\n" +
    "You have been added to the waitlist. We will contact you if a slot opens.\n\n" +
    "God bless!\nGBC Pickleball Club";
}

// =============================================================================
// WEB APP ENTRY POINT — REST API
// =============================================================================

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  if (!action) {
    return HtmlService.createHtmlOutput(
      "<h2>GBC @ 34 Pickleball Tournament API</h2>" +
      "<p>This endpoint is a JSON API. Use the ?action= parameter.</p>"
    );
  }

  try {
    switch (action) {
      case "getData":
        return jsonOut(getData());

      case "getFormUrl":
        return jsonOut(getFormUrl());

      case "generateBracket":
        return jsonOut(generateBracket(e.parameter.category));

      case "submitScore":
        var games = JSON.parse(decodeURIComponent(e.parameter.games || "[]"));
        return jsonOut(submitScore(e.parameter.matchId, games));

      case "sendAnnouncement":
        return jsonOut(sendAnnouncement(
          decodeURIComponent(e.parameter.subject || ""),
          decodeURIComponent(e.parameter.body || ""),
          e.parameter.category
        ));

      case "updateSubstitutes":
        return jsonOut(updateSubstitutes(
          e.parameter.teamId,
          decodeURIComponent(e.parameter.sub1 || ""),
          decodeURIComponent(e.parameter.sub2 || "")
        ));

      case "assignMatchPlayers":
        return jsonOut(assignMatchPlayers(
          e.parameter.matchId,
          decodeURIComponent(e.parameter.t1players || ""),
          decodeURIComponent(e.parameter.t2players || "")
        ));

      case "syncResponses":
        return jsonOut(syncAllResponses());

      case "registerTeam":
        return jsonOut(registerTeam(JSON.parse(decodeURIComponent(e.parameter.data || "{}"))));

      default:
        return jsonOut({ ok: false, msg: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonOut({ ok: false, msg: err.toString() });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// SERVER FUNCTIONS
// =============================================================================

function getData() {
  try {
    var ss = getSheet();
    return {
      ok:      true,
      teams:   readRows(ss, TAB_TEAMS),
      matches: readRows(ss, TAB_MATCHES),
      emails:  readRows(ss, TAB_EMAILS).slice(0, 50)
    };
  } catch(e) {
    Logger.log("getData ERROR: " + e.toString());
    return { ok: false, msg: e.toString(), teams: [], matches: [], emails: [] };
  }
}

function getFormUrl() {
  try {
    var form = FormApp.openById(FORM_ID);
    return { ok: true, url: form.getPublishedUrl(), title: form.getTitle() };
  } catch(e) {
    return { ok: false, url: "", msg: e.toString() };
  }
}

function registerTeam(d) {
  try {
    var ss       = getSheet();
    var existing = readRows(ss, TAB_TEAMS).filter(function(t){ return t.Category === d.category; });
    if (existing.length >= MAX_TEAMS) return { ok: false, msg: "Category full (" + MAX_TEAMS + " teams max)." };

    var teamName = (d.p1Name.split(" ")[0] || d.p1Name) + " & " + (d.p2Name.split(" ")[0] || d.p2Name);
    ss.getSheetByName(TAB_TEAMS).appendRow([
      makeUID(), teamName,
      d.p1Name, d.p1Email, d.p1Phone || "", d.p1Membership,
      d.p2Name, d.p2Email, d.p2Phone || "",
      d.category, d.ownPaddle, "confirmed",
      new Date().toLocaleString(), 0, 0,
      d.sub1Name || "", d.sub2Name || ""
    ]);

    var body = buildConfirmEmail({ teamName: teamName, p1Name: d.p1Name, p2Name: d.p2Name, category: d.category });
    if (d.p1Email) mailAndLog(ss, d.p1Email, "GBC Pickleball - You are Registered!", body);
    if (d.p2Email && d.p2Email !== d.p1Email) mailAndLog(ss, d.p2Email, "GBC Pickleball - You are Registered!", body);
    mailAndLog(ss, ADMIN_EMAIL, "[REGISTERED] " + teamName + " — " + d.category,
      "P1: " + d.p1Name + " <" + d.p1Email + ">\nP2: " + d.p2Name + " <" + d.p2Email + ">");

    return { ok: true, msg: "Team registered! Confirmation emails sent." };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

// ── NEW: Substitutes ──────────────────────────────────────────────────────────
function updateSubstitutes(teamId, sub1, sub2) {
  try {
    var ss = getSheet();
    updateRow(ss, TAB_TEAMS, teamId, { Sub1Name: sub1 || "", Sub2Name: sub2 || "" });
    return { ok: true, msg: "Substitutes updated." };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

// ── NEW: Assign actual players for a scheduled match ──────────────────────────
function assignMatchPlayers(matchId, t1players, t2players) {
  try {
    var ss = getSheet();
    updateRow(ss, TAB_MATCHES, matchId, {
      T1Players: t1players || "",
      T2Players: t2players || ""
    });
    return { ok: true, msg: "Players assigned for match." };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

function generateBracket(category) {
  try {
    var ss    = getSheet();
    var teams = readRows(ss, TAB_TEAMS).filter(function(t){
      return t.Category === category && t.Status === "confirmed";
    });
    if (teams.length < 2) return { ok: false, msg: "Need at least 2 confirmed teams." };

    var ms = ss.getSheetByName(TAB_MATCHES);
    if (ms.getLastRow() > 1) {
      var md = ms.getDataRange().getValues();
      var ci = md[0].indexOf("Category");
      for (var x = md.length - 1; x >= 1; x--) {
        if (md[x][ci] === category) ms.deleteRow(x + 1);
      }
    }

    var seeded = teams.slice().sort(function(){ return Math.random() - 0.5; });
    var r1 = [];
    for (var i = 0; i < seeded.length; i += 2) {
      var t1  = seeded[i];
      var t2  = seeded[i + 1] || null;
      var wid = t2 ? "" : t1.ID;
      ms.appendRow([makeUID(), category, 1, Math.floor(i/2),
        t1.ID, t2 ? t2.ID : "",
        "","","","","","","","", wid, new Date().toLocaleString(), "", ""]);
      r1.push({ slot: Math.floor(i/2), t1: t1, t2: t2, wid: wid });
    }

    var r2n = Math.ceil(Math.ceil(seeded.length / 2) / 2);
    var r3n = Math.ceil(r2n / 2);
    for (var j = 0; j < r2n; j++) {
      ms.appendRow([makeUID(),category,2,j,"","","","","","","","","","","",new Date().toLocaleString(),"",""]);
    }
    for (var k = 0; k < r3n; k++) {
      ms.appendRow([makeUID(),category,3,k,"","","","","","","","","","","",new Date().toLocaleString(),"",""]);
    }

    r1.forEach(function(m){ if (m.wid) advanceWinner(ss, category, 1, m.slot, m.wid); });

    return { ok: true, msg: "Bracket generated for " + category + "! (" + teams.length + " teams)" };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

function submitScore(matchId, games) {
  try {
    var ss  = getSheet();
    var all = readRows(ss, TAB_MATCHES);
    var match = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].ID === String(matchId)) { match = all[i]; break; }
    }
    if (!match) return { ok: false, msg: "Match not found: " + matchId };

    var t1Wins = 0, t2Wins = 0;
    for (var g = 0; g < games.length; g++) {
      var gs = games[g];
      if (gs.t1 === "" || gs.t2 === "") continue;
      var s1 = parseInt(gs.t1), s2 = parseInt(gs.t2);
      if (isNaN(s1) || isNaN(s2)) continue;
      if (s1 === s2) return { ok: false, msg: "Game " + (g+1) + " cannot be tied." };
      if (s1 > s2) t1Wins++; else t2Wins++;
    }
    if (t1Wins < GAMES_TO_WIN && t2Wins < GAMES_TO_WIN) {
      return { ok: false, msg: "Match incomplete. A team needs " + GAMES_TO_WIN + " game wins." };
    }

    var wid = t1Wins >= GAMES_TO_WIN ? match.Team1ID : match.Team2ID;
    var lid = t1Wins >= GAMES_TO_WIN ? match.Team2ID : match.Team1ID;

    updateRow(ss, TAB_MATCHES, matchId, {
      G1T1: games[0]?games[0].t1:"", G1T2: games[0]?games[0].t2:"",
      G2T1: games[1]?games[1].t1:"", G2T2: games[1]?games[1].t2:"",
      G3T1: games[2]?games[2].t1:"", G3T2: games[2]?games[2].t2:"",
      Score1: t1Wins, Score2: t2Wins, WinnerID: wid
    });

    var teams = readRows(ss, TAB_TEAMS);
    teams.forEach(function(t){
      if (t.ID === wid) updateRow(ss, TAB_TEAMS, wid, { Wins:   parseInt(t.Wins   || 0) + 1 });
      if (t.ID === lid) updateRow(ss, TAB_TEAMS, lid, { Losses: parseInt(t.Losses || 0) + 1 });
    });

    advanceWinner(ss, match.Category, parseInt(match.Round), parseInt(match.Slot), wid);
    return { ok: true, msg: "Scores saved! Match complete." };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

function sendAnnouncement(subject, body, category) {
  try {
    var ss   = getSheet();
    var all  = readRows(ss, TAB_TEAMS);
    var list = category === "All" ? all : all.filter(function(t){ return t.Category === category; });
    list.forEach(function(tm){
      var msg = body.replace(/{name}/g, tm.P1Name + " & " + tm.P2Name);
      mailAndLog(ss, tm.P1Email, subject, msg);
      if (tm.P2Email && tm.P2Email !== tm.P1Email) mailAndLog(ss, tm.P2Email, subject, msg);
    });
    return { ok: true, msg: "Sent to " + list.length + " teams (" + (list.length * 2) + " players)!" };
  } catch(e) {
    return { ok: false, msg: e.toString() };
  }
}

// =============================================================================
// SHEET HELPERS
// =============================================================================

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ensureTabsExist(ss);
  return ss;
}

function ensureTabsExist(ss) {
  ensureSheet(ss, TAB_TEAMS,   TEAM_COLS);
  ensureSheet(ss, TAB_MATCHES, MATCH_COLS);
  ensureSheet(ss, TAB_EMAILS,  ["ID","To","Subject","Body","SentAt"]);
}

// Creates the sheet if missing; otherwise appends any missing columns (migration)
function ensureSheet(ss, name, cols) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(cols);
    sheet.getRange(1, 1, 1, cols.length)
         .setFontWeight("bold").setBackground("#1e429f").setFontColor("#afe409");
    return sheet;
  }
  // Migrate: add columns that don't exist yet (e.g. Sub1Name, T1Players)
  var lastCol  = sheet.getLastColumn();
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h); });
  cols.forEach(function(col) {
    if (existing.indexOf(col) === -1) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(col)
           .setFontWeight("bold").setBackground("#1e429f").setFontColor("#afe409");
      existing.push(col);
    }
  });
  return sheet;
}

function readRows(ss, tab) {
  var sheet = ss.getSheetByName(tab);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var hdrs = data[0];
  var out  = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < hdrs.length; j++) {
      var val = data[i][j];
      obj[hdrs[j]] = (val instanceof Date) ? val.toLocaleString()
                   : String(val === null || val === undefined ? "" : val);
    }
    out.push(obj);
  }
  return out;
}

function updateRow(ss, tab, id, updates) {
  var sheet = ss.getSheetByName(tab);
  var data  = sheet.getDataRange().getValues();
  var hdrs  = data[0];
  var idCol = hdrs.indexOf("ID");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      Object.keys(updates).forEach(function(k) {
        var c = hdrs.indexOf(k);
        if (c >= 0) sheet.getRange(i+1, c+1).setValue(updates[k]);
      });
      return;
    }
  }
}

function advanceWinner(ss, category, round, slot, wid) {
  var nr = round + 1; if (nr > 3) return;
  var ns = Math.floor(slot / 2);
  var isT1 = slot % 2 === 0;
  var sheet = ss.getSheetByName(TAB_MATCHES);
  var data  = sheet.getDataRange().getValues();
  var hdrs  = data[0];
  var cc = hdrs.indexOf("Category"), rc = hdrs.indexOf("Round"),
      sc = hdrs.indexOf("Slot"),     t1 = hdrs.indexOf("Team1ID"), t2 = hdrs.indexOf("Team2ID");
  for (var i = 1; i < data.length; i++) {
    if (data[i][cc] === category && parseInt(data[i][rc]) === nr && parseInt(data[i][sc]) === ns) {
      sheet.getRange(i+1, (isT1 ? t1 : t2) + 1).setValue(wid);
      return;
    }
  }
}

function makeUID() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function isValidEmail(email) {
  if (!email || String(email).trim() === "") return false;
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).trim());
}

function mailAndLog(ss, to, subject, body) {
  var s = ss.getSheetByName(TAB_EMAILS);
  if (s) s.appendRow([makeUID(), to, subject, body, new Date().toLocaleString()]);
  if (!isValidEmail(to)) {
    Logger.log("Skipped invalid email: " + to);
    return;
  }
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body });
  } catch(e) {
    Logger.log("Mail send failed to " + to + ": " + e.toString());
  }
}

// =============================================================================
// DIAGNOSTICS
// =============================================================================

function diagnoseDev() {
  Logger.log("=== GBC PICKLEBALL DIAGNOSTICS ===");
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    Logger.log("Sheet: " + ss.getName() + "  (" + ss.getUrl() + ")");
    Logger.log("Tabs:  " + ss.getSheets().map(function(s){ return s.getName(); }).join(", "));

    var rTab = findResponseTab(ss);
    Logger.log("Response tab: " + (rTab ? rTab.getName() + " (" + (rTab.getLastRow()-1) + " responses)" : "NOT FOUND"));

    ensureTabsExist(ss);
    var teams = readRows(ss, TAB_TEAMS);
    Logger.log("Teams: " + teams.length + " total");
    Logger.log("  Mens:   " + teams.filter(function(t){return t.Category==="Mens Doubles";}).length + " / " + MAX_TEAMS);
    Logger.log("  Womens: " + teams.filter(function(t){return t.Category==="Womens Doubles";}).length + " / " + MAX_TEAMS);
    Logger.log("Matches: " + readRows(ss, TAB_MATCHES).length);

    var form = FormApp.openById(FORM_ID);
    Logger.log("Form: " + form.getTitle() + "  (" + form.getPublishedUrl() + ")");

    var triggers = ScriptApp.getProjectTriggers();
    Logger.log("Triggers: " + triggers.length);
    triggers.forEach(function(tr){
      Logger.log("  → " + tr.getHandlerFunction() + " [" + tr.getTriggerSource() + "]");
    });
    Logger.log("=== ALL OK ===");
  } catch(err) {
    Logger.log("ERROR: " + err.toString());
  }
}
