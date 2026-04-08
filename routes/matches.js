const router           = require('express').Router();
const jwt              = require('jsonwebtoken');
const { getDb }        = require('../db');
const { authenticate, JWT_SECRET } = require('./auth');

// ── List all matches (optionally enriched with requesting user's prediction) ──
router.get('/', async (req, res) => {
  let userId = null;
  const header = req.headers.authorization;
  if (header) {
    try { userId = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET).id; } catch {}
  }

  try {
    const db = await getDb();
    const matches = userId
      ? await db.all(`
          SELECT m.*,
                 p.predicted_result,
                 p.predicted_home_score,
                 p.predicted_away_score,
                 p.points_earned,
                 p.is_scored
          FROM matches m
          LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
          ORDER BY m.match_time ASC
        `, userId)
      : await db.all('SELECT * FROM matches ORDER BY match_time ASC');
    res.json(matches);
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Single match ──────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db    = await getDb();
    const match = await db.get('SELECT * FROM matches WHERE id = ?', req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    res.json(match);
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Admin: set match result & score all predictions ───────────────────────────
router.patch('/:id/result', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { home_score, away_score } = req.body;
  if (home_score == null || away_score == null) {
    return res.status(400).json({ error: 'home_score and away_score are required.' });
  }

  try {
    const db    = await getDb();
    const match = await db.get('SELECT * FROM matches WHERE id = ?', req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    const hScore = parseInt(home_score, 10);
    const aScore = parseInt(away_score, 10);
    const actualResult = hScore > aScore ? 'home' : aScore > hScore ? 'away' : 'draw';

    await db.run(
      `UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?`,
      hScore, aScore, match.id
    );

    const predictions = await db.all(
      'SELECT * FROM predictions WHERE match_id = ? AND is_scored = 0',
      match.id
    );

    for (const p of predictions) {
      let pts = 0;
      if (p.predicted_result === actualResult) {
        pts = 3;
        if (p.predicted_home_score === hScore && p.predicted_away_score === aScore) pts += 2;
      }
      await db.run(
        `UPDATE predictions SET points_earned = ?, is_scored = 1, updated_at = datetime('now') WHERE id = ?`,
        pts, p.id
      );
    }

    res.json({ message: 'Result saved and predictions scored.', scored: predictions.length });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Admin: reset match ────────────────────────────────────────────────────────
router.patch('/:id/reset', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  try {
    const db = await getDb();
    await db.run(`UPDATE matches SET home_score = NULL, away_score = NULL, status = 'upcoming' WHERE id = ?`, req.params.id);
    await db.run('UPDATE predictions SET points_earned = 0, is_scored = 0 WHERE match_id = ?', req.params.id);
    res.json({ message: 'Match reset to upcoming.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Admin: update match details ───────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { home_team, away_team, home_flag, away_flag, match_time, venue, stage, group_name } = req.body;
  try {
    const db = await getDb();
    await db.run(`
      UPDATE matches
      SET home_team  = COALESCE(?, home_team),
          away_team  = COALESCE(?, away_team),
          home_flag  = COALESCE(?, home_flag),
          away_flag  = COALESCE(?, away_flag),
          match_time = COALESCE(?, match_time),
          venue      = COALESCE(?, venue),
          stage      = COALESCE(?, stage),
          group_name = COALESCE(?, group_name)
      WHERE id = ?
    `, home_team, away_team, home_flag, away_flag, match_time, venue, stage, group_name, req.params.id);
    res.json({ message: 'Match updated.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
