#!/usr/bin/env node
/**
 * Add a user to the Org Intel web server.
 * Usage: node scripts/add-user.js <username> <password> [admin]
 *   admin = "admin" or "1" or "true" to create an admin user
 *
 * Examples:
 *   node scripts/add-user.js zhangsan mypassword
 *   node scripts/add-user.js admin secret123 admin
 */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.ORG_INTEL_DB || path.join(process.cwd(), "data", "org-intel.db");

const args = process.argv.slice(2);
const username = args[0];
const password = args[1];
const isAdmin = args[2] === "admin" || args[2] === "1" || args[2] === "true";

if (!username || !password) {
  console.error("Usage: node scripts/add-user.js <username> <password> [admin]");
  console.error("");
  console.error("Examples:");
  console.error("  node scripts/add-user.js zhangsan mypassword");
  console.error("  node scripts/add-user.js admin secret123 admin");
  process.exit(1);
}

if (username.length < 2) {
  console.error("Username must be at least 2 characters");
  process.exit(1);
}

if (password.length < 4) {
  console.error("Password must be at least 4 characters");
  process.exit(1);
}

// Ensure data directory
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Ensure table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Check if user exists
const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (existing) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

// Hash password
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");
const passwordHash = `${salt}:${hash}`;

// Insert
db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)").run(
  username,
  passwordHash,
  isAdmin ? 1 : 0
);

console.log(`User created: ${username}${isAdmin ? " (admin)" : ""}`);
console.log(`Database: ${DB_PATH}`);
