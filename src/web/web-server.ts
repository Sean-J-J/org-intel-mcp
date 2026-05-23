import express from "express";
import session from "express-session";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { researchCompany } from "../pipeline/orchestrator.js";

// --- Config ---
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.ORG_INTEL_DB || path.join(process.cwd(), "data", "org-intel.db");
const REPORTS_DIR = process.env.ORG_INTEL_REPORTS || path.join(process.cwd(), "reports");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// --- Ensure directories ---
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

// --- Database ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// --- Auth helpers ---
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const verify = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verify));
}

function getUser(username: string) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
}

// Create default admin if no users exist
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
if (userCount.count === 0) {
  const adminHash = hashPassword("admin123");
  db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)").run("admin", adminHash);
  console.log("Default admin created: admin / admin123");
}

// --- Express setup ---
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    isAdmin?: boolean;
  }
}

// --- Auth middleware ---
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: "Admin required" });
  }
  next();
}

// --- Auth routes ---
app.get("/login", (_req, res) => {
  res.type("html").send(LOGIN_HTML);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const user = getUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.isAdmin = !!user.is_admin;

  res.json({ ok: true, username: user.username, isAdmin: !!user.is_admin });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    username: req.session.username,
    isAdmin: req.session.isAdmin,
  });
});

// --- Report routes ---
app.get("/api/reports", requireAuth, (req, res) => {
  const reports: { username: string; file: string; size: number; date: string }[] = [];

  if (req.session.isAdmin) {
    // Admin sees all reports
    if (fs.existsSync(REPORTS_DIR)) {
      for (const userDir of fs.readdirSync(REPORTS_DIR)) {
        const userPath = path.join(REPORTS_DIR, userDir);
        if (!fs.statSync(userPath).isDirectory()) continue;
        for (const file of fs.readdirSync(userPath)) {
          if (!file.endsWith(".md")) continue;
          const filePath = path.join(userPath, file);
          const stat = fs.statSync(filePath);
          reports.push({
            username: userDir,
            file,
            size: stat.size,
            date: stat.mtime.toISOString(),
          });
        }
      }
    }
  } else {
    // Regular user sees own reports
    const userPath = path.join(REPORTS_DIR, req.session.username!);
    if (fs.existsSync(userPath)) {
      for (const file of fs.readdirSync(userPath)) {
        if (!file.endsWith(".md")) continue;
        const filePath = path.join(userPath, file);
        const stat = fs.statSync(filePath);
        reports.push({
          username: req.session.username!,
          file,
          size: stat.size,
          date: stat.mtime.toISOString(),
        });
      }
    }
  }

  reports.sort((a, b) => b.date.localeCompare(a.date));
  res.json(reports);
});

app.get("/api/reports/:username/:file", requireAuth, (req, res) => {
  const username = String(req.params.username);
  const file = String(req.params.file);

  // Permission check
  if (!req.session.isAdmin && username !== req.session.username) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Prevent path traversal
  if (file.includes("..") || username.includes("..")) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const filePath = path.join(REPORTS_DIR, username, file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Report not found" });
  }

  res.type("text/markdown").send(fs.readFileSync(filePath, "utf-8"));
});

// --- Research SSE endpoint ---
app.post("/api/research", requireAuth, (req, res) => {
  const { companyName, businessNeed, depth } = req.body;

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    return res.status(400).json({ error: "Company name is required" });
  }

  if (companyName.length > 100) {
    return res.status(400).json({ error: "Company name too long" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Flush headers immediately so the browser can start receiving SSE
  res.flushHeaders();

  const send = (event: string, data: Record<string, any>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Express 5: force flush buffered data to the client
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  // Send initial event to establish the SSE connection
  send("connected", { message: "Research started" });

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dateStr = new Date().toISOString().split("T")[0];
  const filename = `${dateStr}-${slug}.md`;
  const userReportDir = path.join(REPORTS_DIR, req.session.username!);
  fs.mkdirSync(userReportDir, { recursive: true });
  const reportPath = path.join(userReportDir, filename);

  researchCompany({
    companyName: companyName.trim(),
    businessNeed: businessNeed?.trim() || undefined,
    depth: ["quick", "standard", "deep"].includes(depth) ? depth : "standard",
    onProgress: (phase, message) => {
      send("progress", { phase, message });
    },
  })
    .then((report) => {
      // Save report
      fs.writeFileSync(reportPath, report, "utf-8");

      send("complete", {
        report,
        filename,
        savedTo: reportPath,
      });
      res.end();
    })
    .catch((err) => {
      send("error", { message: err.message || String(err) });
      res.end();
    });

  // Cleanup on client disconnect
  req.on("close", () => {
    // The research may still be running, but the SSE stream is done
  });
});

// --- Serve main app ---
app.get("/", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  // Inject user info into the HTML
  const html = APP_HTML.replace(
    "__USER_INFO__",
    JSON.stringify({
      username: req.session.username,
      isAdmin: req.session.isAdmin,
    })
  );
  res.type("html").send(html);
});

// --- Health check ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// --- Start ---
app.listen(PORT, HOST, () => {
  console.log(`Org Intel Web Server running at http://${HOST}:${PORT}`);
  console.log(`Reports directory: ${REPORTS_DIR}`);
  console.log(`Database: ${DB_PATH}`);
});

// ============================================================
// HTML Templates
// ============================================================

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Org Intel — Login</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f172a; color: #e2e8f0;
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh;
}
.login-card {
  background: #1e293b; border-radius: 12px; padding: 40px;
  width: 100%; max-width: 400px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}
h1 { font-size: 1.5rem; margin-bottom: 8px; color: #f1f5f9; }
.subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 32px; }
label { display: block; font-size: 0.8125rem; color: #94a3b8; margin-bottom: 4px; }
input {
  width: 100%; padding: 10px 12px;
  background: #0f172a; border: 1px solid #334155; border-radius: 8px;
  color: #e2e8f0; font-size: 0.9375rem; margin-bottom: 16px;
  outline: none; transition: border-color 0.2s;
}
input:focus { border-color: #3b82f6; }
button {
  width: 100%; padding: 10px; background: #3b82f6; color: #fff;
  border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 500;
  cursor: pointer; transition: background 0.2s;
}
button:hover { background: #2563eb; }
button:disabled { background: #475569; cursor: not-allowed; }
.error { color: #f87171; font-size: 0.8125rem; margin-bottom: 12px; display: none; }
.error.visible { display: block; }
</style>
</head>
<body>
<div class="login-card">
  <h1>Org Intel</h1>
  <p class="subtitle">Organizational Intelligence Research</p>
  <div class="error" id="error">Invalid credentials</div>
  <form id="loginForm">
    <label for="username">Username</label>
    <input type="text" id="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" autocomplete="current-password" required>
    <button type="submit" id="submitBtn">Sign in</button>
  </form>
</div>
<script>
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("submitBtn");
  const error = document.getElementById("error");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  error.classList.remove("visible");

  try {
    const resp = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    });
    if (resp.ok) {
      window.location.href = "/";
    } else {
      const data = await resp.json();
      error.textContent = data.error || "Login failed";
      error.classList.add("visible");
    }
  } catch {
    error.textContent = "Network error";
    error.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});
</script>
</body>
</html>`;

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Org Intel</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
  background: #0f172a; color: #e2e8f0;
  display: flex; min-height: 100vh;
}
/* Sidebar */
.sidebar {
  width: 280px; min-width: 280px; background: #1e293b;
  padding: 20px; display: flex; flex-direction: column;
  border-right: 1px solid #334155;
  overflow-y: auto;
}
.sidebar h2 { font-size: 1.125rem; margin-bottom: 4px; color: #f1f5f9; }
.sidebar .user-info { font-size: 0.75rem; color: #64748b; margin-bottom: 24px; }
.sidebar .section-title { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 16px 0 8px; }
.report-item {
  display: block; padding: 8px 10px; border-radius: 6px;
  color: #94a3b8; text-decoration: none; font-size: 0.8125rem;
  cursor: pointer; transition: background 0.15s;
  word-break: break-all;
}
.report-item:hover { background: #334155; color: #e2e8f0; }
.report-item .date { font-size: 0.6875rem; color: #64748b; }
.report-item .user-label { font-size: 0.6875rem; color: #3b82f6; }
.logout-btn {
  margin-top: auto; padding: 8px 12px; background: transparent;
  border: 1px solid #475569; border-radius: 6px; color: #94a3b8;
  font-size: 0.8125rem; cursor: pointer;
}
.logout-btn:hover { background: #334155; color: #e2e8f0; }
/* Main */
.main {
  flex: 1; padding: 32px 40px; overflow-y: auto;
  max-width: 900px;
}
h1 { font-size: 1.5rem; margin-bottom: 24px; color: #f1f5f9; }
/* Form */
.form-row { display: flex; gap: 10px; margin-bottom: 16px; }
.form-row input, .form-row select {
  flex: 1; padding: 10px 12px;
  background: #1e293b; border: 1px solid #334155; border-radius: 8px;
  color: #e2e8f0; font-size: 0.9375rem; outline: none;
}
.form-row input:focus, .form-row select:focus { border-color: #3b82f6; }
.form-row select { cursor: pointer; }
.research-btn {
  width: 100%; padding: 12px; background: #3b82f6; color: #fff;
  border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 500;
  cursor: pointer;
}
.research-btn:hover { background: #2563eb; }
.research-btn:disabled { background: #475569; cursor: not-allowed; }
/* Progress */
.progress-area {
  margin-top: 24px; padding: 16px;
  background: #1e293b; border-radius: 8px;
  border: 1px solid #334155; display: none;
}
.progress-area.visible { display: block; }
.progress-item {
  font-size: 0.8125rem; color: #94a3b8; padding: 4px 0;
  display: flex; align-items: center; gap: 8px;
}
.progress-item .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #3b82f6; animation: pulse 1.5s infinite;
}
.progress-item.done .dot { background: #22c55e; animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid #334155; border-top-color: #3b82f6;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
/* Report */
.report-output {
  margin-top: 24px; padding: 24px;
  background: #1e293b; border-radius: 8px;
  border: 1px solid #334155; display: none;
}
.report-output.visible { display: block; }
.report-output pre {
  white-space: pre-wrap; word-wrap: break-word;
  font-family: "SF Mono", "Menlo", "Monaco", monospace;
  font-size: 0.8125rem; line-height: 1.6; color: #cbd5e1;
  max-height: 70vh; overflow-y: auto;
}
.copy-btn {
  margin-top: 12px; padding: 6px 14px; background: #334155;
  border: none; border-radius: 6px; color: #cbd5e1;
  font-size: 0.75rem; cursor: pointer;
}
.copy-btn:hover { background: #475569; }
.error-msg { color: #f87171; padding: 12px; background: #451a1a; border-radius: 6px; margin-top: 12px; display: none; }
.error-msg.visible { display: block; }
</style>
</head>
<body>
<div class="sidebar">
  <h2>Org Intel</h2>
  <p class="user-info" id="userInfo">Loading...</p>
  <div class="section-title">History</div>
  <div id="reportList"><span style="color:#64748b;font-size:0.75rem;">Loading...</span></div>
  <button class="logout-btn" onclick="logout()">Sign out</button>
</div>
<div class="main">
  <h1>New Research</h1>
  <div class="form-row">
    <input type="text" id="companyName" placeholder="Company name (e.g. Stripe)" required>
    <select id="depth">
      <option value="standard">Standard</option>
      <option value="quick">Quick</option>
      <option value="deep">Deep</option>
    </select>
  </div>
  <input type="text" id="businessNeed" placeholder="Business need (optional, e.g. cloud infra procurement)" style="width:100%;margin-bottom:16px;padding:10px 12px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:0.9375rem;outline:none;">
  <button class="research-btn" id="researchBtn" onclick="startResearch()">Start Research</button>

  <div class="progress-area" id="progressArea">
    <div id="progressItems"></div>
  </div>

  <div class="error-msg" id="errorMsg"></div>

  <div class="report-output" id="reportOutput">
    <pre id="reportContent"></pre>
    <button class="copy-btn" onclick="copyReport()">Copy to clipboard</button>
  </div>
</div>

<script>
const USER = __USER_INFO__;
document.getElementById("userInfo").textContent = USER.username + (USER.isAdmin ? " (admin)" : "");

// Load history
async function loadHistory() {
  try {
    const resp = await fetch("/api/reports");
    const reports = await resp.json();
    const container = document.getElementById("reportList");
    if (reports.length === 0) {
      container.innerHTML = '<span style="color:#64748b;font-size:0.75rem;">No reports yet</span>';
      return;
    }
    container.innerHTML = reports.map(r => {
      const d = new Date(r.date);
      const dateStr = d.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
      const label = USER.isAdmin ? '<span class="user-label">' + escapeHtml(r.username) + '/</span> ' : '';
      return '<div class="report-item" data-username="' + escapeHtml(r.username) + '" data-file="' + escapeHtml(r.file) + '">'
        + label + escapeHtml(r.file) + '<br><span class="date">' + dateStr + '</span></div>';
    }).join("");

    // Event delegation for history clicks
    document.getElementById("reportList").addEventListener("click", function(e) {
      var item = e.target.closest(".report-item");
      if (item && item.dataset.username) {
        loadReport(item.dataset.username, item.dataset.file);
      }
    });
  } catch (e) {
    console.error("Failed to load history", e);
  }
}
loadHistory();

async function loadReport(username, file) {
  try {
    const resp = await fetch("/api/reports/" + encodeURIComponent(username) + "/" + encodeURIComponent(file));
    if (!resp.ok) throw new Error("Not found");
    const content = await resp.text();
    document.getElementById("reportContent").textContent = content;
    document.getElementById("reportOutput").classList.add("visible");
    document.getElementById("reportOutput").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    alert("Failed to load report: " + e.message);
  }
}

async function startResearch() {
  const companyName = document.getElementById("companyName").value.trim();
  if (!companyName) return;

  const businessNeed = document.getElementById("businessNeed").value.trim();
  const depth = document.getElementById("depth").value;

  const btn = document.getElementById("researchBtn");
  const progressArea = document.getElementById("progressArea");
  const progressItems = document.getElementById("progressItems");
  const reportOutput = document.getElementById("reportOutput");
  const reportContent = document.getElementById("reportContent");
  const errorMsg = document.getElementById("errorMsg");

  btn.disabled = true;
  btn.textContent = "Researching...";
  progressArea.classList.add("visible");
  progressItems.innerHTML = '<div class="progress-item"><div class="spinner"></div>Starting...</div>';
  reportOutput.classList.remove("visible");
  errorMsg.classList.remove("visible");

  try {
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, businessNeed, depth }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || "Request failed");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";

    function processLine(line) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        try {
          var data = JSON.parse(line.slice(6));
        } catch(e) { return; }

        if (eventType === "progress") {
          progressItems.innerHTML += '<div class="progress-item"><div class="dot"></div>' + escapeHtml(data.message) + '</div>';
        } else if (eventType === "complete") {
          progressItems.innerHTML += '<div class="progress-item done"><div class="dot"></div>Complete — saved to ' + escapeHtml(data.filename) + '</div>';
          reportContent.textContent = data.report;
          reportOutput.classList.add("visible");
          reportOutput.scrollIntoView({ behavior: "smooth" });
          loadHistory();
        } else if (eventType === "error") {
          errorMsg.textContent = data.message;
          errorMsg.classList.add("visible");
        }
        eventType = "";
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      // Process last chunk if stream ended
      if (done) {
        if (buffer) processLine(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(String.fromCharCode(10));
      buffer = lines.pop() || "";

      for (var i = 0; i < lines.length; i++) {
        processLine(lines[i]);
      }
    }
  } catch (e) {
    errorMsg.textContent = e.message || "Research failed";
    errorMsg.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Start Research";
  }
}

function copyReport() {
  var text = document.getElementById("reportContent").textContent;
  var btn = document.querySelector(".copy-btn");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = "Copied!";
      setTimeout(function() { btn.textContent = "Copy to clipboard"; }, 2000);
    }).catch(function() {
      btn.textContent = "Copy failed";
      setTimeout(function() { btn.textContent = "Copy to clipboard"; }, 2000);
    });
  } else {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); btn.textContent = "Copied!"; }
    catch(e) { btn.textContent = "Copy failed"; }
    document.body.removeChild(ta);
    setTimeout(function() { btn.textContent = "Copy to clipboard"; }, 2000);
  }
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
</script>
</body>
</html>`;
