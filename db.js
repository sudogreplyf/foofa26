const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let _db = null;

async function getDb() {
  if (_db) return _db;

  _db = await open({
    filename: path.join(__dirname, 'predictor.db'),
    driver: sqlite3.Database
  });

  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');

  // ── Schema ────────────────────────────────────────────────────────────────
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email        TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_admin     INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      home_team  TEXT NOT NULL,
      away_team  TEXT NOT NULL,
      home_flag  TEXT NOT NULL DEFAULT '',
      away_flag  TEXT NOT NULL DEFAULT '',
      match_time TEXT NOT NULL,
      venue      TEXT NOT NULL DEFAULT '',
      stage      TEXT NOT NULL DEFAULT 'Group Stage',
      group_name TEXT DEFAULT NULL,
      home_score INTEGER DEFAULT NULL,
      away_score INTEGER DEFAULT NULL,
      status     TEXT NOT NULL DEFAULT 'upcoming',
      created_at TEXT DEFAULT (datetime('now'))
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

  // ── Seed matches ──────────────────────────────────────────────────────────
  const { cnt } = await _db.get('SELECT COUNT(*) as cnt FROM matches');
  if (cnt === 0) {
    const seedMatches = [
      // Group A
      ['Mexico',     'Poland',       '🇲🇽','🇵🇱', '2026-06-11T18:00:00', 'Estadio Azteca, Mexico City',    'Group Stage', 'A'],
      ['Argentina',  'Iceland',      '🇦🇷','🇮🇸', '2026-06-11T21:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'A'],
      ['Mexico',     'Argentina',    '🇲🇽','🇦🇷', '2026-06-15T21:00:00', 'Estadio Azteca, Mexico City',    'Group Stage', 'A'],
      ['Iceland',    'Poland',       '🇮🇸','🇵🇱', '2026-06-15T18:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'A'],
      ['Poland',     'Argentina',    '🇵🇱','🇦🇷', '2026-06-19T21:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'A'],
      ['Iceland',    'Mexico',       '🇮🇸','🇲🇽', '2026-06-19T21:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'A'],
      // Group B
      ['USA',        'Wales',        '🇺🇸','🏴󠁧󠁢󠁷󠁬󠁳󠁿', '2026-06-12T18:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'B'],
      ['England',    'Iran',         '🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇮🇷', '2026-06-12T14:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'B'],
      ['USA',        'England',      '🇺🇸','🏴󠁧󠁢󠁥󠁮󠁧󠁿', '2026-06-16T20:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'B'],
      ['Iran',       'Wales',        '🇮🇷','🏴󠁧󠁢󠁷󠁬󠁳󠁿', '2026-06-16T14:00:00', "Levi's Stadium, San Francisco",  'Group Stage', 'B'],
      ['Wales',      'England',      '🏴󠁧󠁢󠁷󠁬󠁳󠁿','🏴󠁧󠁢󠁥󠁮󠁧󠁿', '2026-06-20T21:00:00', 'Rose Bowl, Los Angeles',         'Group Stage', 'B'],
      ['Iran',       'USA',          '🇮🇷','🇺🇸', '2026-06-20T21:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'B'],
      // Group C
      ['France',     'Australia',    '🇫🇷','🇦🇺', '2026-06-12T21:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'C'],
      ['Denmark',    'Tunisia',      '🇩🇰','🇹🇳', '2026-06-13T14:00:00', 'Lumen Field, Seattle',           'Group Stage', 'C'],
      ['France',     'Denmark',      '🇫🇷','🇩🇰', '2026-06-17T17:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'C'],
      ['Tunisia',    'Australia',    '🇹🇳','🇦🇺', '2026-06-17T14:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'C'],
      ['Australia',  'Denmark',      '🇦🇺','🇩🇰', '2026-06-21T20:00:00', 'Lumen Field, Seattle',           'Group Stage', 'C'],
      ['Tunisia',    'France',       '🇹🇳','🇫🇷', '2026-06-21T20:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'C'],
      // Group D
      ['Spain',      'Costa Rica',   '🇪🇸','🇨🇷', '2026-06-13T17:00:00', 'Allegiant Stadium, Las Vegas',   'Group Stage', 'D'],
      ['Germany',    'Japan',        '🇩🇪','🇯🇵', '2026-06-13T20:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'D'],
      ['Spain',      'Germany',      '🇪🇸','🇩🇪', '2026-06-18T20:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'D'],
      ['Japan',      'Costa Rica',   '🇯🇵','🇨🇷', '2026-06-18T14:00:00', "Levi's Stadium, San Francisco",  'Group Stage', 'D'],
      ['Japan',      'Spain',        '🇯🇵','🇪🇸', '2026-06-22T20:00:00', 'Rose Bowl, Los Angeles',         'Group Stage', 'D'],
      ['Costa Rica', 'Germany',      '🇨🇷','🇩🇪', '2026-06-22T20:00:00', 'Lumen Field, Seattle',           'Group Stage', 'D'],
      // Group E
      ['Brazil',     'Serbia',       '🇧🇷','🇷🇸', '2026-06-14T17:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'E'],
      ['Switzerland','Cameroon',     '🇨🇭','🇨🇲', '2026-06-14T14:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'E'],
      ['Brazil',     'Switzerland',  '🇧🇷','🇨🇭', '2026-06-19T17:00:00', 'Lumen Field, Seattle',           'Group Stage', 'E'],
      ['Cameroon',   'Serbia',       '🇨🇲','🇷🇸', '2026-06-19T14:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'E'],
      ['Serbia',     'Switzerland',  '🇷🇸','🇨🇭', '2026-06-23T20:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'E'],
      ['Cameroon',   'Brazil',       '🇨🇲','🇧🇷', '2026-06-23T20:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'E'],
      // Group F
      ['Morocco',    'Croatia',      '🇲🇦','🇭🇷', '2026-06-14T20:00:00', 'Allegiant Stadium, Las Vegas',   'Group Stage', 'F'],
      ['Belgium',    'Canada',       '🇧🇪','🇨🇦', '2026-06-15T14:00:00', 'BMO Field, Toronto',             'Group Stage', 'F'],
      ['Morocco',    'Belgium',      '🇲🇦','🇧🇪', '2026-06-19T14:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'F'],
      ['Canada',     'Croatia',      '🇨🇦','🇭🇷', '2026-06-19T17:00:00', 'BMO Field, Toronto',             'Group Stage', 'F'],
      ['Croatia',    'Belgium',      '🇭🇷','🇧🇪', '2026-06-23T17:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'F'],
      ['Canada',     'Morocco',      '🇨🇦','🇲🇦', '2026-06-23T17:00:00', 'BMO Field, Toronto',             'Group Stage', 'F'],
      // Group G
      ['Portugal',   'Ghana',        '🇵🇹','🇬🇭', '2026-06-15T17:00:00', 'Rose Bowl, Los Angeles',         'Group Stage', 'G'],
      ['Uruguay',    'South Korea',  '🇺🇾','🇰🇷', '2026-06-15T20:00:00', "Levi's Stadium, San Francisco",  'Group Stage', 'G'],
      ['Portugal',   'Uruguay',      '🇵🇹','🇺🇾', '2026-06-20T17:00:00', 'Rose Bowl, Los Angeles',         'Group Stage', 'G'],
      ['South Korea','Ghana',        '🇰🇷','🇬🇭', '2026-06-20T14:00:00', 'Allegiant Stadium, Las Vegas',   'Group Stage', 'G'],
      ['South Korea','Portugal',     '🇰🇷','🇵🇹', '2026-06-24T20:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'G'],
      ['Ghana',      'Uruguay',      '🇬🇭','🇺🇾', '2026-06-24T20:00:00', 'AT&T Stadium, Dallas',           'Group Stage', 'G'],
      // Group H
      ['Netherlands','Senegal',      '🇳🇱','🇸🇳', '2026-06-16T17:00:00', 'Lumen Field, Seattle',           'Group Stage', 'H'],
      ['Ecuador',    'Qatar',        '🇪🇨','🇶🇦', '2026-06-16T14:00:00', 'MetLife Stadium, New Jersey',    'Group Stage', 'H'],
      ['Netherlands','Ecuador',      '🇳🇱','🇪🇨', '2026-06-21T17:00:00', 'SoFi Stadium, Los Angeles',      'Group Stage', 'H'],
      ['Qatar',      'Senegal',      '🇶🇦','🇸🇳', '2026-06-21T14:00:00', 'Allegiant Stadium, Las Vegas',   'Group Stage', 'H'],
      ['Qatar',      'Netherlands',  '🇶🇦','🇳🇱', '2026-06-25T20:00:00', "Levi's Stadium, San Francisco",  'Group Stage', 'H'],
      ['Senegal',    'Ecuador',      '🇸🇳','🇪🇨', '2026-06-25T20:00:00', 'Hard Rock Stadium, Miami',       'Group Stage', 'H'],
      // Round of 32
      ['1A', '2B', '🏆','🏆', '2026-06-28T18:00:00', 'MetLife Stadium, New Jersey',   'Round of 32', null],
      ['1C', '2D', '🏆','🏆', '2026-06-28T22:00:00', 'AT&T Stadium, Dallas',          'Round of 32', null],
      ['1E', '2F', '🏆','🏆', '2026-06-29T18:00:00', 'SoFi Stadium, Los Angeles',     'Round of 32', null],
      ['1G', '2H', '🏆','🏆', '2026-06-29T22:00:00', 'Hard Rock Stadium, Miami',      'Round of 32', null],
      // Round of 16
      ['W R32-1', 'W R32-2', '🏆','🏆', '2026-07-04T20:00:00', 'MetLife Stadium, New Jersey',  'Round of 16', null],
      ['W R32-3', 'W R32-4', '🏆','🏆', '2026-07-05T20:00:00', 'SoFi Stadium, Los Angeles',   'Round of 16', null],
      // Quarterfinals
      ['QF1', 'QF2', '🏆','🏆', '2026-07-08T20:00:00', 'AT&T Stadium, Dallas',         'Quarterfinal', null],
      ['QF3', 'QF4', '🏆','🏆', '2026-07-09T20:00:00', 'Hard Rock Stadium, Miami',     'Quarterfinal', null],
      // Semifinals
      ['SF1', 'SF2', '🏆','🏆', '2026-07-14T20:00:00', 'MetLife Stadium, New Jersey',  'Semifinal', null],
      ['SF3', 'SF4', '🏆','🏆', '2026-07-15T20:00:00', 'SoFi Stadium, Los Angeles',   'Semifinal', null],
      // Third place & Final
      ['3rd A', '3rd B', '🏆','🏆', '2026-07-18T18:00:00', 'Hard Rock Stadium, Miami',  'Third Place', null],
      ['Champion 1', 'Champion 2', '🏆','🏆', '2026-07-19T18:00:00', 'MetLife Stadium, New Jersey', 'Final', null],
    ];

    const stmt = await _db.prepare(`
      INSERT INTO matches (home_team, away_team, home_flag, away_flag, match_time, venue, stage, group_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of seedMatches) await stmt.run(...row);
    await stmt.finalize();
    console.log(`✅ Seeded ${seedMatches.length} matches`);
  }

  return _db;
}

module.exports = { getDb };
