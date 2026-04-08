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

// ── Community prediction feed (latest + visible to all users) ─────────────────
router.get('/feed', async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT p.id, p.match_id, p.predicted_result, p.predicted_home_score, p.predicted_away_score,
             p.points_earned, p.is_scored, p.updated_at,
             u.display_name, u.username,
             m.home_team, m.away_team, m.match_time, m.status, m.home_score, m.away_score
      FROM predictions p
      JOIN users u   ON u.id = p.user_id
      JOIN matches m ON m.id = p.match_id
      ORDER BY p.updated_at DESC
      LIMIT 120
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Match consensus + suggested prediction benchmark ──────────────────────────
router.get('/match/:matchId/consensus', async (req, res) => {
  try {
    const db = await getDb();
    const match = await db.get('SELECT id, home_team, away_team FROM matches WHERE id = ?', req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    const resultBreakdown = await db.all(`
      SELECT predicted_result, COUNT(*) AS picks
      FROM predictions
      WHERE match_id = ?
      GROUP BY predicted_result
    `, req.params.matchId);

    const scoreAverages = await db.get(`
      SELECT ROUND(AVG(predicted_home_score), 2) AS avg_home,
             ROUND(AVG(predicted_away_score), 2) AS avg_away,
             COUNT(*) AS sample_size
      FROM predictions
      WHERE match_id = ?
        AND predicted_home_score IS NOT NULL
        AND predicted_away_score IS NOT NULL
    `, req.params.matchId);

    const exactPopular = await db.all(`
      SELECT predicted_home_score, predicted_away_score, COUNT(*) AS picks
      FROM predictions
      WHERE match_id = ?
        AND predicted_home_score IS NOT NULL
        AND predicted_away_score IS NOT NULL
      GROUP BY predicted_home_score, predicted_away_score
      ORDER BY picks DESC, predicted_home_score DESC, predicted_away_score DESC
      LIMIT 5
    `, req.params.matchId);

    const teamWeights = {
      argentina: 88, brazil: 87, france: 86, spain: 85, england: 85, portugal: 84, germany: 84,
      netherlands: 83, belgium: 82, croatia: 81, italy: 83, uruguay: 80, colombia: 79,
      usa: 77, mexico: 77, japan: 78, korea: 76, senegal: 77, morocco: 78, switzerland: 78
    };
    const normalize = (name) => String(name || '').toLowerCase();
    const getWeight = (team) => {
      const key = Object.keys(teamWeights).find((k) => normalize(team).includes(k));
      return key ? teamWeights[key] : 76;
    };
    const h = getWeight(match.home_team);
    const a = getWeight(match.away_team);
    const strengthDelta = h - a;
    const suggestedHome = Math.max(0, Math.min(5, Math.round((1.25 + (h / 100) + (strengthDelta / 40)) * 10) / 10));
    const suggestedAway = Math.max(0, Math.min(5, Math.round((1.1 + (a / 100) - (strengthDelta / 42)) * 10) / 10));
    const roundedHome = Math.round(suggestedHome);
    const roundedAway = Math.round(suggestedAway);
    const suggestedResult = roundedHome > roundedAway ? 'home' : roundedAway > roundedHome ? 'away' : 'draw';

    res.json({
      match_id: match.id,
      result_breakdown: resultBreakdown,
      score_averages: scoreAverages,
      top_exact_scores: exactPopular,
      suggested_benchmark: {
        home_score: roundedHome,
        away_score: roundedAway,
        predicted_result: suggestedResult
      }
    });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Analytics trends ──────────────────────────────────────────────────────────
router.get('/analytics', async (_req, res) => {
  try {
    const db = await getDb();
    const summary = await db.get(`
      SELECT
        COUNT(*) AS total_predictions,
        COUNT(DISTINCT user_id) AS active_predictors,
        ROUND(AVG(points_earned), 2) AS avg_points_per_prediction,
        SUM(CASE WHEN is_scored = 1 AND points_earned = 5 THEN 1 ELSE 0 END) AS exact_hits,
        SUM(CASE WHEN is_scored = 1 AND points_earned >= 3 THEN 1 ELSE 0 END) AS correct_results
      FROM predictions
    `);

    const dailyTrend = await db.all(`
      SELECT substr(updated_at, 1, 10) AS day,
             COUNT(*) AS predictions_count,
             COUNT(DISTINCT user_id) AS unique_predictors
      FROM predictions
      GROUP BY day
      ORDER BY day DESC
      LIMIT 14
    `);

    const outcomeTrend = await db.all(`
      SELECT predicted_result, COUNT(*) AS picks
      FROM predictions
      GROUP BY predicted_result
      ORDER BY picks DESC
    `);

    res.json({
      summary,
      daily_trend: dailyTrend.reverse(),
      outcome_trend: outcomeTrend
    });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
