const router           = require('express').Router();
const { getDb }        = require('../db');
const { authenticate } = require('./auth');

function isOpen(matchTime) {
  const kickoff = new Date(matchTime).getTime();
  const lockAt  = kickoff - 60 * 60 * 1000; // 1 hour before
  return Date.now() < lockAt;
}

// ── Submit / update prediction ────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { match_id, predicted_result, predicted_home_score, predicted_away_score } = req.body;

  if (!match_id || !predicted_result) {
    return res.status(400).json({ error: 'match_id and predicted_result are required.' });
  }
  if (!['home', 'draw', 'away'].includes(predicted_result)) {
    return res.status(400).json({ error: 'predicted_result must be "home", "draw", or "away".' });
  }

  try {
    const db    = await getDb();
    const match = await db.get('SELECT * FROM matches WHERE id = ?', match_id);
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    if (match.status === 'finished') {
      return res.status(403).json({ error: 'Match is already finished.' });
    }
    if (!isOpen(match.match_time)) {
      return res.status(403).json({ error: 'Prediction window closed – less than 1 hour to kick-off.' });
    }

    const hScore = predicted_home_score != null && predicted_home_score !== '' ? parseInt(predicted_home_score, 10) : null;
    const aScore = predicted_away_score != null && predicted_away_score !== '' ? parseInt(predicted_away_score, 10) : null;

    if ((hScore == null) !== (aScore == null)) {
      return res.status(400).json({ error: 'Provide both home and away score, or neither.' });
    }
    if (hScore != null && (hScore < 0 || aScore < 0)) {
      return res.status(400).json({ error: 'Scores cannot be negative.' });
    }
    if (hScore != null) {
      const implied = hScore > aScore ? 'home' : aScore > hScore ? 'away' : 'draw';
      if (implied !== predicted_result) {
        return res.status(400).json({
          error: `Score ${hScore}-${aScore} implies result "${implied}", but you selected "${predicted_result}".`
        });
      }
    }

    await db.run(`
      INSERT INTO predictions
        (user_id, match_id, predicted_result, predicted_home_score, predicted_away_score, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, match_id) DO UPDATE SET
        predicted_result      = excluded.predicted_result,
        predicted_home_score  = excluded.predicted_home_score,
        predicted_away_score  = excluded.predicted_away_score,
        points_earned         = 0,
        is_scored             = 0,
        updated_at            = datetime('now')
    `, req.user.id, match_id, predicted_result, hScore, aScore);

    res.json({ message: 'Prediction saved.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── My predictions ────────────────────────────────────────────────────────────
router.get('/mine', authenticate, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(`
      SELECT p.*, m.home_team, m.away_team, m.home_flag, m.away_flag,
             m.match_time, m.stage, m.group_name, m.status,
             m.home_score, m.away_score
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = ?
      ORDER BY m.match_time ASC
    `, req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Leaderboard ───────────────────────────────────────────────────────────────
router.get('/leaderboard', async (_req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(`
      SELECT u.id, u.display_name, u.username,
             COALESCE(SUM(p.points_earned), 0)                              AS total_points,
             COUNT(p.id)                                                     AS total_predictions,
             SUM(CASE WHEN p.is_scored = 1 AND p.points_earned >= 3 THEN 1 ELSE 0 END) AS correct_results,
             SUM(CASE WHEN p.is_scored = 1 AND p.points_earned  = 5 THEN 1 ELSE 0 END) AS exact_scores
      FROM users u
      LEFT JOIN predictions p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY total_points DESC, exact_scores DESC, correct_results DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
