/**
 * seed-test-data.js
 * ─────────────────
 * Creates realistic test data so you can demo & test the predictor immediately.
 *
 * What it does
 * ───────────────────────────────────────────────────────────────────────────
 * 1. Creates 10 test users  (test1 … test10, password = "test1234")
 * 2. Picks the first 6 Group Stage matches and marks them FINISHED with
 *    realistic scorelines.
 * 3. Generates varied predictions for each test user for those 6 matches —
 *    some exact, some just the right result, some wrong — so the leaderboard
 *    looks real.
 * 4. Scores all predictions automatically.
 *
 * Usage
 * ─────
 *   node scripts/seed-test-data.js
 *
 * Re-run safely — test users that already exist are skipped.
 * Pass --reset to wipe ALL predictions and match scores first.
 */

const bcrypt  = require('bcryptjs');
const { getDb } = require('../db');

const RESET = process.argv.includes('--reset');

// Realistic scorelines with notes about what kind of result they produce
const SCORELINES = [
  { h:2, a:0 }, // home win
  { h:1, a:1 }, // draw
  { h:0, a:2 }, // away win
  { h:3, a:1 }, // home win
  { h:1, a:2 }, // away win
  { h:0, a:0 }, // draw
];

// For each match index, test users predict in one of 3 "profiles"
// profile A: always guesses correct result (earns 3 pts each)
// profile B: sometimes guesses exact score (earns 5 pts)
// profile C: often wrong (earns 0 pts usually)
// profile D: perfect — always exact (earns 5 pts each)
const PROFILES = {
  // profile: [matchIdx → {predicted_result, h, a}]
  perfect:      (actual) => ({ ...actual }),                 // exact every time
  resultOnly:   (actual) => ({ predicted_result: actual.predicted_result, h: null, a: null }), // right result, no score
  wrongResult:  (actual) => ({                               // always wrong result
    predicted_result: actual.predicted_result === 'home' ? 'away' : actual.predicted_result === 'away' ? 'draw' : 'home',
    h: null, a: null,
  }),
  almostRight: (actual) => ({                                // right result, wrong score
    predicted_result: actual.predicted_result,
    h: (actual.h ?? 0) + 1, a: actual.a ?? 0,
  }),
};

const TEST_USERS = [
  { name:'Alice',   user:'alice_pred',   email:'alice@test.com',   profile:'perfect'     },
  { name:'Bob',     user:'bob_scores',   email:'bob@test.com',     profile:'perfect'     },
  { name:'Carlos',  user:'carlos26',     email:'carlos@test.com',  profile:'resultOnly'  },
  { name:'Diana',   user:'diana_wc',     email:'diana@test.com',   profile:'resultOnly'  },
  { name:'Ethan',   user:'ethan_preds',  email:'ethan@test.com',   profile:'almostRight' },
  { name:'Fatima',  user:'fatima26',     email:'fatima@test.com',  profile:'almostRight' },
  { name:'George',  user:'george_tips',  email:'george@test.com',  profile:'wrongResult' },
  { name:'Hina',    user:'hina_26',      email:'hina@test.com',    profile:'wrongResult' },
  { name:'Ivan',    user:'ivan_soccer',  email:'ivan@test.com',    profile:'resultOnly'  },
  { name:'Julia',   user:'julia_goals',  email:'julia@test.com',   profile:'perfect'     },
];

async function run() {
  const db = await getDb();

  if (RESET) {
    console.log('⚠️  --reset: clearing all predictions and match scores…');
    await db.run('DELETE FROM predictions');
    await db.run("UPDATE matches SET status='upcoming', home_score=NULL, away_score=NULL");
  }

  // ── 1. Create test users ──────────────────────────────────────────────────
  const hash = bcrypt.hashSync('test1234', 10);
  const userIds = {};

  for (const u of TEST_USERS) {
    const exists = await db.get('SELECT id FROM users WHERE username=?', u.user);
    if (exists) {
      userIds[u.user] = exists.id;
      console.log(`  ↩  user "${u.user}" already exists (id=${exists.id})`);
    } else {
      const r = await db.run(
        'INSERT INTO users (username,email,display_name,password_hash) VALUES (?,?,?,?)',
        u.user, u.email, u.name, hash
      );
      userIds[u.user] = r.lastID;
      console.log(`  ✅ Created user "${u.user}" (id=${r.lastID})`);
    }
  }

  // ── 2. Pick first 6 group stage matches ──────────────────────────────────
  const matches = await db.all(
    "SELECT * FROM matches WHERE stage='Group Stage' ORDER BY match_time LIMIT 6"
  );
  if (matches.length < 6) {
    console.error('❌ Not enough group stage matches found. Run the app once to seed matches.');
    process.exit(1);
  }

  // ── 3. Set match results ──────────────────────────────────────────────────
  for (let i = 0; i < matches.length; i++) {
    const m  = matches[i];
    const sc = SCORELINES[i];
    await db.run(
      "UPDATE matches SET status='finished', home_score=?, away_score=? WHERE id=?",
      sc.h, sc.a, m.id
    );
    console.log(`  ⚽ ${m.home_team} ${sc.h}–${sc.a} ${m.away_team} → finished`);
  }

  // ── 4. Create predictions + score them ────────────────────────────────────
  for (const u of TEST_USERS) {
    const uid = userIds[u.user];
    for (let i = 0; i < matches.length; i++) {
      const m  = matches[i];
      const sc = SCORELINES[i];
      const actualResult = sc.h > sc.a ? 'home' : sc.a > sc.h ? 'away' : 'draw';

      const actual = { predicted_result: actualResult, h: sc.h, a: sc.a };
      const pfn    = PROFILES[u.profile];
      const pred   = pfn(actual);

      // Skip if prediction already exists
      const exists = await db.get(
        'SELECT id FROM predictions WHERE user_id=? AND match_id=?', uid, m.id
      );
      if (exists) continue;

      await db.run(
        `INSERT INTO predictions (user_id,match_id,predicted_result,predicted_home_score,predicted_away_score)
         VALUES (?,?,?,?,?)`,
        uid, m.id, pred.predicted_result,
        pred.h != null ? pred.h : null,
        pred.a != null ? pred.a : null
      );

      // Score it
      let pts = 0;
      if (pred.predicted_result === actualResult) {
        pts = 3;
        if (pred.h === sc.h && pred.a === sc.a) pts = 5;
      }
      await db.run(
        'UPDATE predictions SET points_earned=?, is_scored=1 WHERE user_id=? AND match_id=?',
        pts, uid, m.id
      );
    }
  }

  // ── 5. Print leaderboard summary ──────────────────────────────────────────
  console.log('\n📊 Leaderboard after seeding:\n');
  const board = await db.all(`
    SELECT u.display_name, u.username,
           SUM(p.points_earned) AS pts,
           SUM(CASE WHEN p.points_earned=5 THEN 1 ELSE 0 END) AS exact,
           SUM(CASE WHEN p.points_earned=3 THEN 1 ELSE 0 END) AS correct
    FROM users u JOIN predictions p ON p.user_id=u.id
    GROUP BY u.id ORDER BY pts DESC
  `);
  board.forEach((r, i) =>
    console.log(`  ${i+1}. ${r.display_name.padEnd(10)} ${String(r.pts).padStart(3)} pts  |  ${r.exact} exact  |  ${r.correct} correct result`)
  );

  console.log(`
✅ Done!
──────────────────────────────────────────────
🔑 All test users: password = test1234
   alice_pred, bob_scores, carlos26 … etc.

🎯 6 matches marked FINISHED with predictions scored.
📊 Leaderboard is now populated — open the app to see it.
──────────────────────────────────────────────
  `);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
