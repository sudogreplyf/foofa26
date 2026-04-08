const router    = require('express').Router();
const jwt       = require('jsonwebtoken');
const { getDb } = require('../db');
const { authenticate, JWT_SECRET } = require('./auth');
const sse       = require('../lib/sse');

// ── GET /api/matches  — list all (enriched with caller's prediction if logged in) ──
router.get('/', async (req, res) => {
  let userId = null;
  try {
    const hdr = req.headers.authorization;
    if (hdr) userId = jwt.verify(hdr.replace('Bearer ', ''), JWT_SECRET).id;
  } catch { /* anonymous OK */ }

  try {
    const db = await getDb();
    const rows = userId
      ? await db.all(`
          SELECT m.*,
                 p.predicted_result,
                 p.predicted_home_score,
                 p.predicted_away_score,
                 p.points_earned,
                 p.is_scored
          FROM   matches m
          LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
          ORDER  BY m.match_time ASC`, userId)
      : await db.all('SELECT * FROM matches ORDER BY match_time ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/matches/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const m  = await db.get('SELECT * FROM matches WHERE id = ?', req.params.id);
    if (!m) return res.status(404).json({ error: 'Match not found.' });
    res.json(m);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/matches/:id/live  — admin sets match live + optional live score ─
router.patch('/:id/live', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { home_score = null, away_score = null } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `UPDATE matches SET status='live', home_score=?, away_score=? WHERE id=?`,
      home_score, away_score, req.params.id
    );
    const updated = await db.get('SELECT * FROM matches WHERE id=?', req.params.id);
    sse.broadcast('matchUpdate', updated);
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/matches/:id/score  — admin updates live score during match ────
router.patch('/:id/score', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { home_score, away_score } = req.body;
  if (home_score == null || away_score == null)
    return res.status(400).json({ error: 'home_score and away_score required.' });

  try {
    const db = await getDb();
    await db.run(
      `UPDATE matches SET home_score=?, away_score=? WHERE id=?`,
      parseInt(home_score), parseInt(away_score), req.params.id
    );
    const updated = await db.get('SELECT * FROM matches WHERE id=?', req.params.id);
    sse.broadcast('matchUpdate', updated);   // push to all browsers instantly
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/matches/:id/result  — admin finalises match + auto-scores preds ─
router.patch('/:id/result', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });

  const { home_score, away_score } = req.body;
  if (home_score == null || away_score == null)
    return res.status(400).json({ error: 'home_score and away_score required.' });

  try {
    const db  = await getDb();
    const h   = parseInt(home_score), a = parseInt(away_score);
    const actual = h > a ? 'home' : a > h ? 'away' : 'draw';

    await db.run(
      `UPDATE matches SET status='finished', home_score=?, away_score=? WHERE id=?`,
      h, a, req.params.id
    );

    // Score all unscored predictions
    const preds = await db.all(
      'SELECT * FROM predictions WHERE match_id=? AND is_scored=0',
      req.params.id
    );
    for (const p of preds) {
      let pts = 0;
      if (p.predicted_result === actual) {
        pts = 3;  // correct W/D/L
        if (p.predicted_home_score === h && p.predicted_away_score === a) pts = 5; // exact score
      }
      await db.run(
        `UPDATE predictions SET points_earned=?, is_scored=1, updated_at=datetime('now') WHERE id=?`,
        pts, p.id
      );
    }

    const updated = await db.get('SELECT * FROM matches WHERE id=?', req.params.id);
    sse.broadcast('matchUpdate', updated);
    res.json({ match: updated, scored: preds.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/matches/:id/reset  — admin resets match back to upcoming ──────
router.patch('/:id/reset', authenticate, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  try {
    const db = await getDb();
    await db.run(
      `UPDATE matches SET status='upcoming', home_score=NULL, away_score=NULL WHERE id=?`,
      req.params.id
    );
    await db.run(
      'UPDATE predictions SET points_earned=0, is_scored=0 WHERE match_id=?',
      req.params.id
    );
    const updated = await db.get('SELECT * FROM matches WHERE id=?', req.params.id);
    sse.broadcast('matchUpdate', updated);
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
