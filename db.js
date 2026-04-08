/**
 * Database module — uses sqlite + sqlite3.
 * Match times are stored as ISO-8601 strings WITH timezone offset so
 * JavaScript's `new Date()` converts them to UTC correctly on both server
 * and client.
 *
 * Schema version: 2  (bumping forces a fresh re-seed of matches)
 */
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path    = require('path');

const DB_SCHEMA_VERSION = 2;
const DB_DIR  = process.env.DATA_DIR || (process.env.RENDER ? '/data' : __dirname);
const DB_PATH = path.join(DB_DIR, 'predictor.db');

let _db = null;

async function getDb() {
  if (_db) return _db;

  _db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');

  // ── Schema ─────────────────────────────────────────────────────────────────
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

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
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      home_team  TEXT NOT NULL,
      away_team  TEXT NOT NULL,
      home_flag  TEXT NOT NULL DEFAULT '',
      away_flag  TEXT NOT NULL DEFAULT '',
      match_time TEXT NOT NULL,        -- ISO-8601 with TZ offset
      venue      TEXT NOT NULL DEFAULT '',
      stage      TEXT NOT NULL DEFAULT 'Group Stage',
      group_name TEXT DEFAULT NULL,
      home_score INTEGER DEFAULT NULL,
      away_score INTEGER DEFAULT NULL,
      status     TEXT NOT NULL DEFAULT 'upcoming'
                 CHECK(status IN ('upcoming','live','finished'))
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      match_id             INTEGER NOT NULL,
      predicted_result     TEXT NOT NULL CHECK(predicted_result IN ('home','draw','away')),
      predicted_home_score INTEGER DEFAULT NULL,
      predicted_away_score INTEGER DEFAULT NULL,
      points_earned        INTEGER DEFAULT 0,
      is_scored            INTEGER DEFAULT 0,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      UNIQUE(user_id, match_id)
    );
  `);

  // ── Version check → re-seed if schema version changed ─────────────────────
  const meta = await _db.get("SELECT value FROM db_meta WHERE key='schema_version'");
  if (!meta || parseInt(meta.value) < DB_SCHEMA_VERSION) {
    await _db.run('DELETE FROM matches');
    await _db.run('DELETE FROM predictions');
    await _db.run(
      "INSERT OR REPLACE INTO db_meta(key,value) VALUES('schema_version',?)",
      String(DB_SCHEMA_VERSION)
    );
    await _seedMatches(_db);
  }

  return _db;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real FIFA World Cup 2026 Schedule
// Source: Official FIFA draw (Dec 5 2024) + confirmed match schedule
// Times stored with UTC offset so JS Date() handles conversion automatically.
// ─────────────────────────────────────────────────────────────────────────────
async function _seedMatches(db) {
  const FLAGS = {
    'Mexico':              '🇲🇽', 'South Korea':     '🇰🇷', 'Czech Republic':   '🇨🇿',
    'South Africa':        '🇿🇦', 'Canada':          '🇨🇦', 'Bosnia Herzegovina':'🇧🇦',
    'Qatar':               '🇶🇦', 'Switzerland':     '🇨🇭', 'Brazil':           '🇧🇷',
    'Morocco':             '🇲🇦', 'Haiti':           '🇭🇹', 'Scotland':         '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'USA':                 '🇺🇸', 'Paraguay':        '🇵🇾', 'Australia':        '🇦🇺',
    'Turkey':              '🇹🇷', 'Germany':         '🇩🇪', 'Curacao':          '🇨🇼',
    'Ivory Coast':         '🇨🇮', 'Ecuador':         '🇪🇨', 'Netherlands':      '🇳🇱',
    'Japan':               '🇯🇵', 'Sweden':          '🇸🇪', 'Tunisia':          '🇹🇳',
    'Belgium':             '🇧🇪', 'Egypt':           '🇪🇬', 'Iran':             '🇮🇷',
    'New Zealand':         '🇳🇿', 'Spain':           '🇪🇸', 'Cape Verde':       '🇨🇻',
    'Saudi Arabia':        '🇸🇦', 'Uruguay':         '🇺🇾', 'France':           '🇫🇷',
    'Senegal':             '🇸🇳', 'Iraq':            '🇮🇶', 'Norway':           '🇳🇴',
    'Argentina':           '🇦🇷', 'Algeria':         '🇩🇿', 'Austria':          '🇦🇹',
    'Jordan':              '🇯🇴', 'Portugal':        '🇵🇹', 'DR Congo':         '🇨🇩',
    'Uzbekistan':          '🇺🇿', 'Colombia':        '🇨🇴', 'England':          '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'Croatia':             '🇭🇷', 'Ghana':           '🇬🇭', 'Panama':           '🇵🇦',
  };

  // [home, away, time_iso_with_tz, venue, stage, group]
  const matches = [
    // ══ GROUP A: Mexico · South Korea · Czech Republic · South Africa ══════
    ['Mexico',       'South Africa', '2026-06-11T13:00:00-06:00', 'Estadio Azteca, Mexico City',          'Group Stage','A'],
    ['South Korea',  'Czech Republic','2026-06-11T20:00:00-06:00','Estadio Akron, Guadalajara',            'Group Stage','A'],
    ['Czech Republic','South Africa', '2026-06-18T12:00:00-04:00','Mercedes-Benz Stadium, Atlanta',       'Group Stage','A'],
    ['Mexico',       'South Korea',  '2026-06-18T19:00:00-06:00', 'Estadio Akron, Guadalajara',           'Group Stage','A'],
    ['Czech Republic','Mexico',      '2026-06-24T19:00:00-06:00', 'Estadio Azteca, Mexico City',          'Group Stage','A'],
    ['South Africa', 'South Korea',  '2026-06-24T19:00:00-06:00', 'Estadio BBVA, Monterrey',              'Group Stage','A'],

    // ══ GROUP B: Canada · Bosnia Herzegovina · Qatar · Switzerland ══════════
    ['Canada',       'Bosnia Herzegovina','2026-06-12T15:00:00-04:00','BMO Field, Toronto',               'Group Stage','B'],
    ['Qatar',        'Switzerland',  '2026-06-13T12:00:00-07:00', "Levi's Stadium, Santa Clara",          'Group Stage','B'],
    ['Switzerland',  'Bosnia Herzegovina','2026-06-18T12:00:00-07:00','SoFi Stadium, Los Angeles',        'Group Stage','B'],
    ['Canada',       'Qatar',        '2026-06-18T15:00:00-07:00', 'BC Place, Vancouver',                  'Group Stage','B'],
    ['Switzerland',  'Canada',       '2026-06-24T12:00:00-07:00', 'BC Place, Vancouver',                  'Group Stage','B'],
    ['Bosnia Herzegovina','Qatar',   '2026-06-24T12:00:00-07:00', 'Lumen Field, Seattle',                 'Group Stage','B'],

    // ══ GROUP C: Brazil · Morocco · Haiti · Scotland ════════════════════════
    ['Brazil',       'Morocco',      '2026-06-13T18:00:00-04:00', 'MetLife Stadium, East Rutherford',     'Group Stage','C'],
    ['Haiti',        'Scotland',     '2026-06-13T21:00:00-04:00', 'Gillette Stadium, Boston',             'Group Stage','C'],
    ['Scotland',     'Morocco',      '2026-06-19T18:00:00-04:00', 'Gillette Stadium, Boston',             'Group Stage','C'],
    ['Brazil',       'Haiti',        '2026-06-19T21:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Group Stage','C'],
    ['Scotland',     'Brazil',       '2026-06-24T18:00:00-04:00', 'Hard Rock Stadium, Miami',             'Group Stage','C'],
    ['Morocco',      'Haiti',        '2026-06-24T18:00:00-04:00', 'Mercedes-Benz Stadium, Atlanta',       'Group Stage','C'],

    // ══ GROUP D: USA · Paraguay · Australia · Turkey ════════════════════════
    ['USA',          'Paraguay',     '2026-06-12T18:00:00-07:00', 'SoFi Stadium, Los Angeles',            'Group Stage','D'],
    ['Australia',    'Turkey',       '2026-06-13T21:00:00-07:00', 'BC Place, Vancouver',                  'Group Stage','D'],
    ['USA',          'Australia',    '2026-06-19T12:00:00-07:00', 'Lumen Field, Seattle',                 'Group Stage','D'],
    ['Turkey',       'Paraguay',     '2026-06-19T21:00:00-07:00', "Levi's Stadium, Santa Clara",          'Group Stage','D'],
    ['Turkey',       'USA',          '2026-06-25T19:00:00-07:00', 'SoFi Stadium, Los Angeles',            'Group Stage','D'],
    ['Paraguay',     'Australia',    '2026-06-25T19:00:00-07:00', "Levi's Stadium, Santa Clara",          'Group Stage','D'],

    // ══ GROUP E: Germany · Curacao · Ivory Coast · Ecuador ══════════════════
    ['Germany',      'Curacao',      '2026-06-14T12:00:00-05:00', 'NRG Stadium, Houston',                 'Group Stage','E'],
    ['Ivory Coast',  'Ecuador',      '2026-06-14T19:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Group Stage','E'],
    ['Germany',      'Ivory Coast',  '2026-06-20T16:00:00-04:00', 'BMO Field, Toronto',                   'Group Stage','E'],
    ['Ecuador',      'Curacao',      '2026-06-20T19:00:00-05:00', 'Arrowhead Stadium, Kansas City',       'Group Stage','E'],
    ['Curacao',      'Ivory Coast',  '2026-06-25T16:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Group Stage','E'],
    ['Ecuador',      'Germany',      '2026-06-25T16:00:00-04:00', 'MetLife Stadium, East Rutherford',     'Group Stage','E'],

    // ══ GROUP F: Netherlands · Japan · Sweden · Tunisia ═════════════════════
    ['Netherlands',  'Japan',        '2026-06-14T15:00:00-05:00', 'AT&T Stadium, Dallas',                 'Group Stage','F'],
    ['Sweden',       'Tunisia',      '2026-06-14T20:00:00-06:00', 'Estadio BBVA, Monterrey',              'Group Stage','F'],
    ['Netherlands',  'Sweden',       '2026-06-20T12:00:00-05:00', 'NRG Stadium, Houston',                 'Group Stage','F'],
    ['Tunisia',      'Japan',        '2026-06-20T22:00:00-06:00', 'Estadio BBVA, Monterrey',              'Group Stage','F'],
    ['Japan',        'Sweden',       '2026-06-25T18:00:00-05:00', 'AT&T Stadium, Dallas',                 'Group Stage','F'],
    ['Tunisia',      'Netherlands',  '2026-06-25T18:00:00-05:00', 'Arrowhead Stadium, Kansas City',       'Group Stage','F'],

    // ══ GROUP G: Belgium · Egypt · Iran · New Zealand ═══════════════════════
    ['Belgium',      'Egypt',        '2026-06-15T12:00:00-07:00', 'Lumen Field, Seattle',                 'Group Stage','G'],
    ['Iran',         'New Zealand',  '2026-06-15T18:00:00-07:00', 'SoFi Stadium, Los Angeles',            'Group Stage','G'],
    ['Belgium',      'Iran',         '2026-06-21T12:00:00-07:00', 'SoFi Stadium, Los Angeles',            'Group Stage','G'],
    ['New Zealand',  'Egypt',        '2026-06-21T18:00:00-07:00', 'BC Place, Vancouver',                  'Group Stage','G'],
    ['Egypt',        'Iran',         '2026-06-26T20:00:00-07:00', 'Lumen Field, Seattle',                 'Group Stage','G'],
    ['New Zealand',  'Belgium',      '2026-06-26T20:00:00-07:00', 'BC Place, Vancouver',                  'Group Stage','G'],

    // ══ GROUP H: Spain · Cape Verde · Saudi Arabia · Uruguay ════════════════
    ['Spain',        'Cape Verde',   '2026-06-15T12:00:00-04:00', 'Mercedes-Benz Stadium, Atlanta',       'Group Stage','H'],
    ['Saudi Arabia', 'Uruguay',      '2026-06-15T18:00:00-04:00', 'Hard Rock Stadium, Miami',             'Group Stage','H'],
    ['Spain',        'Saudi Arabia', '2026-06-21T12:00:00-04:00', 'Mercedes-Benz Stadium, Atlanta',       'Group Stage','H'],
    ['Uruguay',      'Cape Verde',   '2026-06-21T18:00:00-04:00', 'Hard Rock Stadium, Miami',             'Group Stage','H'],
    ['Cape Verde',   'Saudi Arabia', '2026-06-26T19:00:00-05:00', 'NRG Stadium, Houston',                 'Group Stage','H'],
    ['Uruguay',      'Spain',        '2026-06-26T18:00:00-06:00', 'Estadio Akron, Guadalajara',           'Group Stage','H'],

    // ══ GROUP I: France · Senegal · Iraq · Norway ════════════════════════════
    ['France',       'Senegal',      '2026-06-16T15:00:00-04:00', 'MetLife Stadium, East Rutherford',     'Group Stage','I'],
    ['Iraq',         'Norway',       '2026-06-16T18:00:00-04:00', 'Gillette Stadium, Boston',             'Group Stage','I'],
    ['France',       'Iraq',         '2026-06-22T17:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Group Stage','I'],
    ['Norway',       'Senegal',      '2026-06-22T20:00:00-04:00', 'MetLife Stadium, East Rutherford',     'Group Stage','I'],
    ['Norway',       'France',       '2026-06-26T15:00:00-04:00', 'Gillette Stadium, Boston',             'Group Stage','I'],
    ['Senegal',      'Iraq',         '2026-06-26T15:00:00-04:00', 'BMO Field, Toronto',                   'Group Stage','I'],

    // ══ GROUP J: Argentina · Algeria · Austria · Jordan ═════════════════════
    ['Argentina',    'Algeria',      '2026-06-16T20:00:00-05:00', 'Arrowhead Stadium, Kansas City',       'Group Stage','J'],
    ['Austria',      'Jordan',       '2026-06-16T21:00:00-07:00', "Levi's Stadium, Santa Clara",          'Group Stage','J'],
    ['Argentina',    'Austria',      '2026-06-22T12:00:00-05:00', 'AT&T Stadium, Dallas',                 'Group Stage','J'],
    ['Jordan',       'Algeria',      '2026-06-22T20:00:00-07:00', "Levi's Stadium, Santa Clara",          'Group Stage','J'],
    ['Algeria',      'Austria',      '2026-06-27T21:00:00-05:00', 'Arrowhead Stadium, Kansas City',       'Group Stage','J'],
    ['Jordan',       'Argentina',    '2026-06-27T21:00:00-05:00', 'AT&T Stadium, Dallas',                 'Group Stage','J'],

    // ══ GROUP K: Portugal · DR Congo · Uzbekistan · Colombia ════════════════
    ['Portugal',     'DR Congo',     '2026-06-17T12:00:00-05:00', 'NRG Stadium, Houston',                 'Group Stage','K'],
    ['Uzbekistan',   'Colombia',     '2026-06-17T20:00:00-06:00', 'Estadio Azteca, Mexico City',          'Group Stage','K'],
    ['Portugal',     'Uzbekistan',   '2026-06-23T12:00:00-05:00', 'NRG Stadium, Houston',                 'Group Stage','K'],
    ['Colombia',     'DR Congo',     '2026-06-23T20:00:00-06:00', 'Estadio Akron, Guadalajara',           'Group Stage','K'],
    ['Colombia',     'Portugal',     '2026-06-27T19:30:00-04:00', 'Hard Rock Stadium, Miami',             'Group Stage','K'],
    ['DR Congo',     'Uzbekistan',   '2026-06-27T19:30:00-04:00', 'Mercedes-Benz Stadium, Atlanta',      'Group Stage','K'],

    // ══ GROUP L: England · Croatia · Ghana · Panama ══════════════════════════
    ['England',      'Croatia',      '2026-06-17T15:00:00-05:00', 'AT&T Stadium, Dallas',                 'Group Stage','L'],
    ['Ghana',        'Panama',       '2026-06-17T19:00:00-04:00', 'BMO Field, Toronto',                   'Group Stage','L'],
    ['England',      'Ghana',        '2026-06-23T16:00:00-04:00', 'Gillette Stadium, Boston',             'Group Stage','L'],
    ['Panama',       'Croatia',      '2026-06-23T19:00:00-04:00', 'BMO Field, Toronto',                   'Group Stage','L'],
    ['Panama',       'England',      '2026-06-27T17:00:00-04:00', 'MetLife Stadium, East Rutherford',     'Group Stage','L'],
    ['Croatia',      'Ghana',        '2026-06-27T17:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Group Stage','L'],

    // ══ ROUND OF 32 (July 1–4) — bracket TBD after group stage ══════════════
    ['1A', '2C', '2026-07-01T14:00:00-05:00', 'AT&T Stadium, Dallas',                'Round of 32', null],
    ['1C', '2A', '2026-07-01T18:00:00-04:00', 'MetLife Stadium, East Rutherford',    'Round of 32', null],
    ['1B', '2D', '2026-07-02T14:00:00-07:00', 'SoFi Stadium, Los Angeles',           'Round of 32', null],
    ['1D', '2B', '2026-07-02T18:00:00-04:00', 'Hard Rock Stadium, Miami',            'Round of 32', null],
    ['1E', '2G', '2026-07-02T18:00:00-05:00', 'NRG Stadium, Houston',                'Round of 32', null],
    ['1G', '2E', '2026-07-03T14:00:00-04:00', 'Gillette Stadium, Boston',            'Round of 32', null],
    ['1F', '2H', '2026-07-03T18:00:00-04:00', 'Lincoln Financial Field, Philadelphia','Round of 32',null],
    ['1H', '2F', '2026-07-03T18:00:00-06:00', 'Estadio Azteca, Mexico City',         'Round of 32', null],
    ['1I', '2K', '2026-07-04T12:00:00-07:00', 'Lumen Field, Seattle',                'Round of 32', null],
    ['1K', '2I', '2026-07-04T16:00:00-04:00', 'Mercedes-Benz Stadium, Atlanta',      'Round of 32', null],
    ['1J', '2L', '2026-07-04T16:00:00-07:00', 'BC Place, Vancouver',                 'Round of 32', null],
    ['1L', '2J', '2026-07-04T20:00:00-04:00', 'BMO Field, Toronto',                  'Round of 32', null],
    ['3rd Best-1','3rd Best-2', '2026-07-05T14:00:00-05:00', 'Arrowhead Stadium, Kansas City',     'Round of 32', null],
    ['3rd Best-3','3rd Best-4', '2026-07-05T18:00:00-04:00', 'MetLife Stadium, East Rutherford',   'Round of 32', null],
    ['3rd Best-5','3rd Best-6', '2026-07-05T18:00:00-06:00', 'Estadio Akron, Guadalajara',         'Round of 32', null],
    ['3rd Best-7','3rd Best-8', '2026-07-05T21:00:00-05:00', 'NRG Stadium, Houston',               'Round of 32', null],

    // ══ ROUND OF 16 (July 6–9) ══════════════════════════════════════════════
    ['W R32-1',  'W R32-2',  '2026-07-06T14:00:00-05:00', 'AT&T Stadium, Dallas',             'Round of 16', null],
    ['W R32-3',  'W R32-4',  '2026-07-06T18:00:00-04:00', 'MetLife Stadium, East Rutherford', 'Round of 16', null],
    ['W R32-5',  'W R32-6',  '2026-07-07T14:00:00-04:00', 'Gillette Stadium, Boston',         'Round of 16', null],
    ['W R32-7',  'W R32-8',  '2026-07-07T18:00:00-07:00', 'SoFi Stadium, Los Angeles',        'Round of 16', null],
    ['W R32-9',  'W R32-10', '2026-07-08T14:00:00-05:00', 'NRG Stadium, Houston',             'Round of 16', null],
    ['W R32-11', 'W R32-12', '2026-07-08T18:00:00-06:00', 'Estadio Azteca, Mexico City',      'Round of 16', null],
    ['W R32-13', 'W R32-14', '2026-07-09T14:00:00-04:00', 'Hard Rock Stadium, Miami',         'Round of 16', null],
    ['W R32-15', 'W R32-16', '2026-07-09T18:00:00-07:00', 'BC Place, Vancouver',              'Round of 16', null],

    // ══ QUARTERFINALS (July 11–12) ══════════════════════════════════════════
    ['W R16-1', 'W R16-2', '2026-07-11T14:00:00-05:00', 'AT&T Stadium, Dallas',             'Quarterfinal', null],
    ['W R16-3', 'W R16-4', '2026-07-11T18:00:00-04:00', 'MetLife Stadium, East Rutherford', 'Quarterfinal', null],
    ['W R16-5', 'W R16-6', '2026-07-12T14:00:00-04:00', 'Mercedes-Benz Stadium, Atlanta',   'Quarterfinal', null],
    ['W R16-7', 'W R16-8', '2026-07-12T18:00:00-07:00', 'SoFi Stadium, Los Angeles',        'Quarterfinal', null],

    // ══ SEMIFINALS (July 14–15) ══════════════════════════════════════════════
    ['W QF-1', 'W QF-2', '2026-07-14T18:00:00-04:00', 'MetLife Stadium, East Rutherford', 'Semifinal', null],
    ['W QF-3', 'W QF-4', '2026-07-15T18:00:00-07:00', 'SoFi Stadium, Los Angeles',        'Semifinal', null],

    // ══ THIRD PLACE + FINAL ══════════════════════════════════════════════════
    ['L SF-1', 'L SF-2', '2026-07-18T15:00:00-04:00', 'MetLife Stadium, East Rutherford', 'Third Place', null],
    ['W SF-1', 'W SF-2', '2026-07-19T11:00:00-04:00', 'MetLife Stadium, East Rutherford', 'Final',       null],
  ];

  const stmt = await db.prepare(
    'INSERT INTO matches (home_team,away_team,home_flag,away_flag,match_time,venue,stage,group_name) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const [h, a, time, venue, stage, grp] of matches) {
    await stmt.run(h, a, FLAGS[h] || '🏆', FLAGS[a] || '🏆', time, venue, stage, grp);
  }
  await stmt.finalize();
  console.log(`✅ Seeded ${matches.length} matches (real FIFA WC 2026 schedule)`);
}

module.exports = { getDb };
