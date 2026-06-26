import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_PATH, ensureDataDirs } from "../lib/paths.js";

let dbInstance = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  ensureDataDirs();
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  dbInstance.exec(readFileSync(schemaPath, "utf8"));
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
