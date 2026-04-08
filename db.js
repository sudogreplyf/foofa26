const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let _db = null;

const DB_DIR = process.env.DATA_DIR || (process.env.RENDER ? '/data' : __dirname);
const DB_PATH = path.join(DB_DIR, 'predictor.db');

async function ensureColumn(db, table, name, ddl) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.find((c) => c.name === name)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function getDb() {
  if (_db) return _db;

  _db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');

  await _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email         TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      is_admin      INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id          TEXT UNIQUE,
      sync_source          TEXT NOT NULL DEFAULT 'openligadb',
      league_name          TEXT NOT NULL DEFAULT '',
      league_shortcut      TEXT NOT NULL DEFAULT '',
      season               INTEGER,
      home_team            TEXT NOT NULL,
      away_team            TEXT NOT NULL,
      home_flag            TEXT NOT NULL DEFAULT '',
      away_flag            TEXT NOT NULL DEFAULT '',
      match_time           TEXT NOT NULL,
      venue                TEXT NOT NULL DEFAULT '',
      stage                TEXT NOT NULL DEFAULT 'League Fixture',
      group_name           TEXT DEFAULT NULL,
      home_score           INTEGER DEFAULT NULL,
      away_score           INTEGER DEFAULT NULL,
      status               TEXT NOT NULL DEFAULT 'upcoming',
      live_minute          INTEGER DEFAULT NULL,
      last_external_payload TEXT,
      last_synced_at       TEXT DEFAULT (datetime('now')),
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      match_id             INTEGER NOT NULL,
      predicted_result     TEXT NOT NULL,
      predicted_home_score INTEGER DEFAULT NULL,
      predicted_away_score INTEGER DEFAULT NULL,
      points_earned        INTEGER DEFAULT 0,
      is_scored            INTEGER DEFAULT 0,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      UNIQUE(user_id, match_id)
    );
  `);

  await ensureColumn(_db, 'matches', 'external_id', 'external_id TEXT UNIQUE');
  await ensureColumn(_db, 'matches', 'sync_source', "sync_source TEXT NOT NULL DEFAULT 'openligadb'");
  await ensureColumn(_db, 'matches', 'league_name', "league_name TEXT NOT NULL DEFAULT ''");
  await ensureColumn(_db, 'matches', 'league_shortcut', "league_shortcut TEXT NOT NULL DEFAULT ''");
  await ensureColumn(_db, 'matches', 'season', 'season INTEGER');
  await ensureColumn(_db, 'matches', 'live_minute', 'live_minute INTEGER DEFAULT NULL');
  await ensureColumn(_db, 'matches', 'last_external_payload', 'last_external_payload TEXT');
  await ensureColumn(_db, 'matches', 'last_synced_at', "last_synced_at TEXT DEFAULT (datetime('now'))");
  await ensureColumn(_db, 'matches', 'updated_at', "updated_at TEXT DEFAULT (datetime('now'))");

  await _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_matches_time ON matches(match_time);
    CREATE INDEX IF NOT EXISTS idx_matches_status_time ON matches(status, match_time);
    CREATE INDEX IF NOT EXISTS idx_matches_league_date ON matches(league_shortcut, season, match_time);
    CREATE INDEX IF NOT EXISTS idx_matches_sync_source ON matches(sync_source, last_synced_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_match_scored ON predictions(match_id, is_scored);
    CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
  `);

  return _db;
}

module.exports = { getDb };
