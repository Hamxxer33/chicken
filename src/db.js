import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  is_premium INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  scored_at INTEGER NOT NULL,
  age_score INTEGER NOT NULL,
  premium_score INTEGER NOT NULL,
  og_score INTEGER NOT NULL,
  wallet TEXT
);
CREATE TABLE IF NOT EXISTS referrals (
  friend_id INTEGER PRIMARY KEY,
  referrer_id INTEGER NOT NULL,
  share INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id);
CREATE TABLE IF NOT EXISTS tasks (
  user_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);
CREATE TABLE IF NOT EXISTS task_opens (
  user_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);
CREATE TABLE IF NOT EXISTS pending_referrals (
  user_id INTEGER PRIMARY KEY,
  referrer_id INTEGER NOT NULL
);
`;

export function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function removeTasks(db, taskIds) {
  if (!taskIds.length) return 0;
  const marks = taskIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM task_opens WHERE task_id IN (${marks})`).run(...taskIds);
  return Number(db.prepare(`DELETE FROM tasks WHERE task_id IN (${marks})`).run(...taskIds).changes);
}
