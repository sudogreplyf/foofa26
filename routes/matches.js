const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { authenticate, JWT_SECRET } = require('./auth');

const OPENLIGA_BASE = process.env.OPENLIGA_BASE_URL || 'https://api.openligadb.de';
const DEFAULT_LEAGUE = process.env.OPENLIGA_LEAGUE_SHORTCUT || 'bl1';
const DEFAULT_SEASON = Number(process.env.OPENLIGA_SEASON || new Date().getUTCFullYear());

function deriveStatus(matchUtcIso, isFinished) {
  if (isFinished) return 'finished';
  const kickoff = new Date(matchUtcIso).getTime();
  if (!Number.isFinite(kickoff)) return 'upcoming';
  return Date.now() >= kickoff ? 'live' : 'upcoming';
}

function scoreFromPayload(match) {
  const final = (match.MatchResults || []).find((r) => r.ResultTypeID === 2) || (match.MatchResults || [])[0];
  if (!final) return { home: null, away: null };
  return { home: final.PointsTeam1 ?? null, away: final.PointsTeam2 ?? null };
}

async function scorePredictionsForMatch(db, matchId, hScore, aScore) {
  const actualResult = hScore > aScore ? 'home' : aScore > hScore ? 'away' : 'draw';
  const predictions = await db.all('SELECT * FROM predictions WHERE match_id = ? AND is_scored = 0', matchId);

  for (const p of predictions) {
    let pts = 0;
    if (p.predicted_result === actualResult) {
      pts = 3;
      if (p.predicted_home_score === hScore && p.predicted_away_score === aScore) pts += 2;
    }
    await db.run(
      `UPDATE predictions SET points_earned = ?, is_scored = 1, updated_at = datetime('now') WHERE id = ?`,
      pts,
      p.id
    );
  }

  return predictions.length;
}

async function syncMatchesFromOpenLigaDb({ leagueShortcut = DEFAULT_LEAGUE, season = DEFAULT_SEASON, initiatedBy = 'system' } = {}) {
  const db = await getDb();
  const resp = await fetch(`${OPENLIGA_BASE}/getmatchdata/${encodeURIComponent(leagueShortcut)}/${encodeURIComponent(season)}`);
  if (!resp.ok) {
    throw new Error(`OpenLigaDB returned ${resp.status}`);
  }

  const payload = await resp.json();
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected OpenLigaDB payload.');
  }

  let upserts = 0;
  let rescoredPredictions = 0;
  for (const m of payload) {
    const externalId = String(m.MatchID);
    const homeTeam = m.Team1?.TeamName || 'Unknown Home';
    const awayTeam = m.Team2?.TeamName || 'Unknown Away';
    const homeFlag = m.Team1?.ShortName || '🏳️';
    const awayFlag = m.Team2?.ShortName || '🏳️';
    const stage = m.Group?.GroupName || 'League Fixture';
    const venue = m.Location?.LocationStadium || m.Location?.LocationCity || 'TBD';
    const matchTime = m.MatchDateTimeUTC || m.MatchDateTime;
    const scores = scoreFromPayload(m);
    const status = deriveStatus(matchTime, !!m.MatchIsFinished);

    const existing = await db.get('SELECT id, home_score, away_score, status FROM matches WHERE external_id = ?', externalId);

    if (existing) {
      await db.run(
        `UPDATE matches
           SET home_team = ?, away_team = ?, home_flag = ?, away_flag = ?, match_time = ?, venue = ?,
               stage = ?, group_name = ?, league_name = ?, league_shortcut = ?, season = ?,
               home_score = ?, away_score = ?, status = ?, live_minute = NULL,
               sync_source = 'openligadb', last_external_payload = ?,
               last_synced_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        homeTeam,
        awayTeam,
        homeFlag,
        awayFlag,
        matchTime,
        venue,
        stage,
        null,
        m.LeagueName || leagueShortcut.toUpperCase(),
        leagueShortcut,
        Number(season),
        scores.home,
        scores.away,
        status,
        JSON.stringify(m),
        existing.id
      );

      if (status === 'finished' && existing.status !== 'finished' && scores.home != null && scores.away != null) {
        rescoredPredictions += await scorePredictionsForMatch(db, existing.id, scores.home, scores.away);
      }
    } else {
      const inserted = await db.run(
        `INSERT INTO matches
          (external_id, sync_source, league_name, league_shortcut, season, home_team, away_team, home_flag, away_flag,
           match_time, venue, stage, group_name, home_score, away_score, status, live_minute,
           last_external_payload, last_synced_at, updated_at)
         VALUES (?, 'openligadb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'))`,
        externalId,
        m.LeagueName || leagueShortcut.toUpperCase(),
        leagueShortcut,
        Number(season),
        homeTeam,
        awayTeam,
        homeFlag,
        awayFlag,
        matchTime,
        venue,
        stage,
        null,
        scores.home,
        scores.away,
        status,
        JSON.stringify(m)
      );

      if (status === 'finished' && scores.home != null && scores.away != null) {
        rescoredPredictions += await scorePredictionsForMatch(db, inserted.lastID, scores.home, scores.away);
      }
    }

    upserts += 1;
  }

  return {
    source: 'openligadb',
    league: leagueShortcut,
    season: Number(season),
    initiatedBy,
    upserts,
    rescoredPredictions
  };
}

router.get('/', async (req, res) => {
  let userId = null;
  const header = req.headers.authorization;
  if (header) {
    try {
      userId = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET).id;
    } catch {
      userId = null;
    }
  }

  try {
    const db = await getDb();
    const matches = userId
      ? await db.all(
          `SELECT m.*, p.predicted_result, p.predicted_home_score, p.predicted_away_score, p.points_earned, p.is_scored
           FROM matches m
           LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
           ORDER BY
             CASE m.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'finished' THEN 2 ELSE 3 END,
             m.match_time ASC`,
          userId
        )
      : await db.all(
          `SELECT * FROM matches
           ORDER BY
             CASE status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'finished' THEN 2 ELSE 3 END,
             match_time ASC`
        );
    res.json(matches);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/live', async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, status, home_score, away_score, live_minute, updated_at
       FROM matches
       WHERE status IN ('live', 'finished')
       ORDER BY updated_at DESC
       LIMIT 200`
    );
    res.json({ updatedAt: new Date().toISOString(), matches: rows });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/admin/sync', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { league = DEFAULT_LEAGUE, season = DEFAULT_SEASON } = req.body || {};

  try {
    const result = await syncMatchesFromOpenLigaDb({
      leagueShortcut: String(league),
      season: Number(season),
      initiatedBy: `admin:${req.user.username || req.user.id}`
    });
    res.json({ message: 'Manual sync completed.', ...result });
  } catch (e) {
    res.status(502).json({
      error: 'Failed to sync external schedule data.',
      detail: e.message
    });
  }
});

router.post('/admin/mock-live-update', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  try {
    const db = await getDb();
    const target =
      (await db.get(`SELECT * FROM matches WHERE status = 'live' ORDER BY updated_at DESC LIMIT 1`)) ||
      (await db.get(`SELECT * FROM matches WHERE status = 'upcoming' ORDER BY match_time ASC LIMIT 1`));

    if (!target) {
      return res.status(404).json({ error: 'No matches found. Run manual sync first.' });
    }

    let nextHome = target.home_score ?? 0;
    let nextAway = target.away_score ?? 0;
    let nextMinute = target.live_minute ?? 1;
    let status = target.status === 'finished' ? 'finished' : 'live';

    const dice = Math.random();
    if (status === 'live') {
      if (dice > 0.66) nextHome += 1;
      else if (dice > 0.33) nextAway += 1;
      nextMinute = Math.min(90, nextMinute + Math.floor(Math.random() * 5) + 1);
      if (nextMinute >= 90) status = 'finished';
    }

    await db.run(
      `UPDATE matches
       SET home_score = ?, away_score = ?, status = ?, live_minute = ?,
           updated_at = datetime('now'), last_synced_at = datetime('now')
       WHERE id = ?`,
      nextHome,
      nextAway,
      status,
      nextMinute,
      target.id
    );

    let scored = 0;
    if (status === 'finished') {
      scored = await scorePredictionsForMatch(db, target.id, nextHome, nextAway);
    }

    const match = await db.get('SELECT * FROM matches WHERE id = ?', target.id);
    res.json({ message: 'Mock live update emitted.', scored, match });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const match = await db.get('SELECT * FROM matches WHERE id = ?', req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    res.json(match);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:id/result', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { home_score, away_score } = req.body;
  if (home_score == null || away_score == null) {
    return res.status(400).json({ error: 'home_score and away_score are required.' });
  }

  try {
    const db = await getDb();
    const match = await db.get('SELECT * FROM matches WHERE id = ?', req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    const hScore = parseInt(home_score, 10);
    const aScore = parseInt(away_score, 10);

    await db.run(
      `UPDATE matches
       SET home_score = ?, away_score = ?, status = 'finished', live_minute = 90,
           updated_at = datetime('now'), last_synced_at = datetime('now')
       WHERE id = ?`,
      hScore,
      aScore,
      match.id
    );

    const scored = await scorePredictionsForMatch(db, match.id, hScore, aScore);

    res.json({ message: 'Result saved and predictions scored.', scored });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:id/reset', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  try {
    const db = await getDb();
    await db.run(
      `UPDATE matches
       SET home_score = NULL, away_score = NULL, live_minute = NULL, status = 'upcoming',
           updated_at = datetime('now')
       WHERE id = ?`,
      req.params.id
    );
    await db.run('UPDATE predictions SET points_earned = 0, is_scored = 0 WHERE match_id = ?', req.params.id);
    res.json({ message: 'Match reset to upcoming.' });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:id', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { home_team, away_team, home_flag, away_flag, match_time, venue, stage, group_name, status, live_minute } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `UPDATE matches
       SET home_team = COALESCE(?, home_team),
           away_team = COALESCE(?, away_team),
           home_flag = COALESCE(?, home_flag),
           away_flag = COALESCE(?, away_flag),
           match_time = COALESCE(?, match_time),
           venue = COALESCE(?, venue),
           stage = COALESCE(?, stage),
           group_name = COALESCE(?, group_name),
           status = COALESCE(?, status),
           live_minute = COALESCE(?, live_minute),
           updated_at = datetime('now')
       WHERE id = ?`,
      home_team,
      away_team,
      home_flag,
      away_flag,
      match_time,
      venue,
      stage,
      group_name,
      status,
      live_minute,
      req.params.id
    );
    res.json({ message: 'Match updated.' });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
module.exports.syncMatchesFromOpenLigaDb = syncMatchesFromOpenLigaDb;
