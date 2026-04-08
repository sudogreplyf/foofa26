"""
FIFA World Cup 2026 Predictor — Streamlit Edition
Deploy free: https://streamlit.io/cloud
"""

import streamlit as st
import sqlite3
import bcrypt
import os
import random
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
import json

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FIFA WC 2026 Predictor",
    page_icon="⚽",
    layout="wide",
    initial_sidebar_state="expanded",
)

DB_PATH = os.path.join(os.path.dirname(__file__), "predictor.db")
LOCK_MINUTES = 60  # lock predictions 1 hour before kick-off

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
  .stApp {
    background: radial-gradient(circle at top left, #1f3a61 0%, #0b1f35 40%, #071221 100%);
    color: #e8eef4;
  }
  .block-container { padding-top: 1.2rem; }
  .match-card {
    background: linear-gradient(120deg, rgba(18,40,64,.95), rgba(12,29,46,.95));
    border: 1px solid #2f5f88; border-radius: 14px;
    padding: 1.2rem 1.5rem; margin-bottom: .8rem;
    box-shadow: 0 10px 22px rgba(0,0,0,.25);
  }
  .match-teams { font-size: 1.2rem; font-weight: 700; text-align: center; margin: .4rem 0; }
  .badge-gold  { color: #f5a623; font-weight: 800; }
  .badge-green { color: #22c55e; font-weight: 700; }
  .badge-red   { color: #ff6b7a; font-weight: 700; }
  .badge-muted { color: #8ba3bb; }
  h1, h2, h3  { color: #f5a623 !important; }
  [data-testid="stMetric"] {
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 12px;
    padding: .75rem;
  }
  .stButton > button {
    background: linear-gradient(135deg,#2563a8,#1e4f8f,#173e73);
    color: #fff; border: none; border-radius: 8px; font-weight: 700;
    box-shadow: 0 6px 16px rgba(0,0,0,.3);
  }
  .stButton > button:hover { transform: translateY(-1px); }
  div[data-testid="stSidebarContent"] {
    background: linear-gradient(170deg,#0d2740,#0a2035);
  }
</style>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
#  DATABASE
# ══════════════════════════════════════════════════════════════════════════════

@st.cache_resource
def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    db = get_db()
    db.executescript("""
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
            match_time TEXT NOT NULL,
            venue      TEXT NOT NULL DEFAULT '',
            stage      TEXT NOT NULL DEFAULT 'Group Stage',
            group_name TEXT DEFAULT NULL,
            home_score INTEGER DEFAULT NULL,
            away_score INTEGER DEFAULT NULL,
            status     TEXT NOT NULL DEFAULT 'upcoming'
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
            FOREIGN KEY (user_id)  REFERENCES users(id),
            FOREIGN KEY (match_id) REFERENCES matches(id),
            UNIQUE(user_id, match_id)
        );
        CREATE TABLE IF NOT EXISTS password_resets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            reset_code  TEXT NOT NULL,
            expires_at  TEXT NOT NULL,
            used        INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_matches_stage_time ON matches(stage, match_time);
        CREATE INDEX IF NOT EXISTS idx_matches_time ON matches(match_time);
        CREATE INDEX IF NOT EXISTS idx_predictions_user_match ON predictions(user_id, match_id);
        CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id, is_scored);
    """)
    db.commit()
    _seed_matches(db)


def _seed_matches(db):
    cnt = db.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    if cnt > 0:
        return

    # Official tournament format: 12 groups (A-L), 72 group matches + knockout stage slots.
    hosts = [
        ("Estadio Azteca, Mexico City", "🇲🇽"),
        ("MetLife Stadium, New Jersey", "🇺🇸"),
        ("SoFi Stadium, Los Angeles", "🇺🇸"),
        ("AT&T Stadium, Dallas", "🇺🇸"),
        ("Hard Rock Stadium, Miami", "🇺🇸"),
        ("BMO Field, Toronto", "🇨🇦"),
        ("BC Place, Vancouver", "🇨🇦"),
        ("Levi's Stadium, San Francisco", "🇺🇸"),
        ("Lumen Field, Seattle", "🇺🇸"),
        ("Mercedes-Benz Stadium, Atlanta", "🇺🇸"),
        ("NRG Stadium, Houston", "🇺🇸"),
        ("Lincoln Financial Field, Philadelphia", "🇺🇸"),
    ]

    start_dt = datetime(2026, 6, 11, 18, 0)
    matches = []
    slot = 1

    for g in "ABCDEFGHIJKL":
        teams = [f"{g}1", f"{g}2", f"{g}3", f"{g}4"]
        pairings = [
            (teams[0], teams[1]), (teams[2], teams[3]),
            (teams[0], teams[2]), (teams[1], teams[3]),
            (teams[0], teams[3]), (teams[1], teams[2]),
        ]
        for home, away in pairings:
            venue, flag = hosts[(slot - 1) % len(hosts)]
            kickoff = (start_dt + timedelta(hours=6 * (slot - 1))).isoformat()
            matches.append((
                f"Group {g} - {home}",
                f"Group {g} - {away}",
                flag,
                flag,
                kickoff,
                venue,
                "Group Stage",
                g,
            ))
            slot += 1

    knockout_slots = [
        ("R64 Slot 1", "R64 Slot 2", "Round of 64"),
        ("R64 Slot 3", "R64 Slot 4", "Round of 64"),
        ("R64 Slot 5", "R64 Slot 6", "Round of 64"),
        ("R64 Slot 7", "R64 Slot 8", "Round of 64"),
        ("R32 Slot 1", "R32 Slot 2", "Round of 32"),
        ("R32 Slot 3", "R32 Slot 4", "Round of 32"),
        ("R16 Slot 1", "R16 Slot 2", "Round of 16"),
        ("R16 Slot 3", "R16 Slot 4", "Round of 16"),
        ("QF Slot 1", "QF Slot 2", "Quarterfinal"),
        ("QF Slot 3", "QF Slot 4", "Quarterfinal"),
        ("SF Slot 1", "SF Slot 2", "Semifinal"),
        ("SF Slot 3", "SF Slot 4", "Semifinal"),
        ("Third Place Slot 1", "Third Place Slot 2", "Third Place"),
        ("Finalist 1", "Finalist 2", "Final"),
    ]
    for home, away, stage in knockout_slots:
        venue, _ = hosts[(slot - 1) % len(hosts)]
        kickoff = (start_dt + timedelta(hours=6 * (slot - 1))).isoformat()
        matches.append((home, away, "🏆", "🏆", kickoff, venue, stage, None))
        slot += 1

    db.executemany(
        "INSERT INTO matches (home_team,away_team,home_flag,away_flag,match_time,venue,stage,group_name) VALUES (?,?,?,?,?,?,?,?)",
        matches,
    )
    db.commit()


def ensure_demo_data(db):
    existing = db.execute("SELECT COUNT(*) FROM users WHERE username LIKE 'demo_%'").fetchone()[0]
    if existing:
        return 0

    users = []
    for i in range(1, 6):
        users.append((f"demo_{i}", f"demo_{i}@example.com", f"Demo Player {i}", hash_pw("demo1234")))
    db.executemany(
        "INSERT INTO users (username, email, display_name, password_hash) VALUES (?,?,?,?)",
        users,
    )

    user_rows = db.execute("SELECT id FROM users WHERE username LIKE 'demo_%' ORDER BY id").fetchall()
    finished = db.execute("SELECT id, home_score, away_score FROM matches WHERE status='finished' LIMIT 10").fetchall()
    if not finished:
        seed_matches = db.execute("SELECT id FROM matches ORDER BY match_time LIMIT 10").fetchall()
        for row in seed_matches:
            h = random.randint(0, 4)
            a = random.randint(0, 4)
            db.execute("UPDATE matches SET home_score=?, away_score=?, status='finished' WHERE id=?", (h, a, row["id"]))
        finished = db.execute("SELECT id, home_score, away_score FROM matches WHERE status='finished' LIMIT 10").fetchall()

    for u in user_rows:
        for m in finished:
            h_guess = max(0, m["home_score"] + random.choice([-1, 0, 1]))
            a_guess = max(0, m["away_score"] + random.choice([-1, 0, 1]))
            pred = "home" if h_guess > a_guess else "away" if a_guess > h_guess else "draw"
            actual = "home" if m["home_score"] > m["away_score"] else "away" if m["away_score"] > m["home_score"] else "draw"
            pts = 5 if (h_guess == m["home_score"] and a_guess == m["away_score"]) else 3 if pred == actual else 0
            db.execute(
                """
                INSERT INTO predictions (user_id, match_id, predicted_result, predicted_home_score, predicted_away_score, points_earned, is_scored)
                VALUES (?,?,?,?,?,?,1)
                ON CONFLICT(user_id, match_id) DO NOTHING
                """,
                (u["id"], m["id"], pred, h_guess, a_guess, pts),
            )

    db.commit()
    return len(user_rows)


# ══════════════════════════════════════════════════════════════════════════════
#  AUTH HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def check_pw(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())

def current_user():
    return st.session_state.get("user")

def is_open(match_time_str: str) -> bool:
    """Returns True if predictions are still allowed (> 1h before kick-off)."""
    try:
        kickoff = datetime.fromisoformat(match_time_str)
        lock_at = kickoff - timedelta(hours=LOCK_MINUTES / 60)
        return datetime.now() < lock_at
    except Exception:
        return False


@st.cache_data(ttl=30, show_spinner=False)
def fetch_live_scores():
    """Fetch live soccer scores from TheSportsDB (public test key)."""
    try:
        req = Request(
            "https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer",
            headers={"User-Agent": "wc2026-predictor/1.0"},
        )
        with urlopen(req, timeout=6) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        events = payload.get("events") or []
        return events
    except Exception:
        return []


def create_reset_code(db, identity: str):
    user = db.execute(
        "SELECT id, username FROM users WHERE username=? OR email=?",
        (identity.strip(), identity.strip().lower()),
    ).fetchone()
    if not user:
        return None
    code = f"{random.randint(100000, 999999)}"
    expires = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
    db.execute(
        "INSERT INTO password_resets (user_id, reset_code, expires_at) VALUES (?,?,?)",
        (user["id"], code, expires),
    )
    db.commit()
    return code


def apply_reset_code(db, code: str, new_password: str):
    row = db.execute(
        """
        SELECT pr.id, pr.user_id, pr.expires_at, pr.used
        FROM password_resets pr
        WHERE pr.reset_code=?
        ORDER BY pr.id DESC LIMIT 1
        """,
        (code.strip(),),
    ).fetchone()
    if not row:
        return False, "Invalid reset code."
    if row["used"]:
        return False, "Reset code already used."
    if datetime.utcnow() > datetime.fromisoformat(row["expires_at"]):
        return False, "Reset code expired."
    if len(new_password) < 6:
        return False, "Password must be at least 6 characters."

    db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_pw(new_password), row["user_id"]))
    db.execute("UPDATE password_resets SET used=1 WHERE id=?", (row["id"],))
    db.commit()
    return True, "Password updated. You can sign in now."


# ══════════════════════════════════════════════════════════════════════════════
#  PAGES
# ══════════════════════════════════════════════════════════════════════════════

def page_home():
    st.title("⚽ FIFA World Cup 2026 Predictor")
    st.markdown("Predict match results & exact scores. Compete on the global leaderboard!")

    # Scoring guide
    col1, col2, col3 = st.columns(3)
    col1.metric("Correct Result (W/D/L)", "3 pts")
    col2.metric("Correct Exact Score", "5 pts", "+2 bonus")
    col3.metric("Prediction Lock", "1 hour before kick-off")

    st.divider()

    db = get_db()
    total     = db.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    finished  = db.execute("SELECT COUNT(*) FROM matches WHERE status='finished'").fetchone()[0]
    leaders   = db.execute("""
        SELECT u.display_name, u.username,
               COALESCE(SUM(p.points_earned),0) AS pts,
               SUM(CASE WHEN p.is_scored=1 AND p.points_earned=5 THEN 1 ELSE 0 END) AS exact
        FROM users u LEFT JOIN predictions p ON p.user_id=u.id
        GROUP BY u.id ORDER BY pts DESC, exact DESC LIMIT 10
    """).fetchall()

    c1, c2 = st.columns(2)
    with c1:
        st.subheader("📊 Tournament Stats")
        st.write(f"**Total matches:** {total}")
        st.write(f"**Finished:** {finished}")
        st.write(f"**Upcoming:** {total - finished}")

    with c2:
        st.subheader("🏆 Top 10 Predictors")
        if not leaders:
            st.info("No predictions yet. Be the first!")
        else:
            medals = ["🥇","🥈","🥉"] + [f"{i+1}." for i in range(3, 10)]
            u = current_user()
            for i, row in enumerate(leaders):
                you = u and row["username"] == u["username"]
                label = f"{medals[i]} **{row['display_name']}**{' *(you)*' if you else ''}"
                st.write(f"{label} — **{row['pts']} pts** | {row['exact']} exact scores")


def page_leaderboard():
    st.title("🏆 Leaderboard")
    db = get_db()
    rows = db.execute("""
        SELECT u.display_name, u.username,
               COALESCE(SUM(p.points_earned),0)   AS total_points,
               COUNT(p.id)                         AS total_preds,
               SUM(CASE WHEN p.is_scored=1 AND p.points_earned>=3 THEN 1 ELSE 0 END) AS correct,
               SUM(CASE WHEN p.is_scored=1 AND p.points_earned=5  THEN 1 ELSE 0 END) AS exact
        FROM users u LEFT JOIN predictions p ON p.user_id=u.id
        GROUP BY u.id ORDER BY total_points DESC, exact DESC, correct DESC LIMIT 50
    """).fetchall()

    if not rows:
        st.info("No predictions yet.")
        return

    medals = ["🥇","🥈","🥉"] + ["  " for _ in range(47)]
    u = current_user()
    data = []
    for i, r in enumerate(rows):
        you = u and r["username"] == u["username"]
        data.append({
            "Rank":   medals[i],
            "Player": f"{r['display_name']}{' ⭐' if you else ''}",
            "Username": f"@{r['username']}",
            "Points 🏆": r["total_points"],
            "Predictions": r["total_preds"],
            "Correct ✅": r["correct"],
            "Exact 🎯": r["exact"],
        })

    import pandas as pd
    df = pd.DataFrame(data)
    st.dataframe(df, use_container_width=True, hide_index=True)


def page_live_scores():
    st.title("📡 Live Scores")
    st.caption("Data source: TheSportsDB public live soccer endpoint (refreshes every 30 seconds cache).")
    if st.button("🔄 Refresh now"):
        fetch_live_scores.clear()
    events = fetch_live_scores()
    if not events:
        st.info("No live soccer events available right now.")
        return
    for e in events[:30]:
        home = e.get("strHomeTeam", "Home")
        away = e.get("strAwayTeam", "Away")
        hs = e.get("intHomeScore", "?")
        a_s = e.get("intAwayScore", "?")
        league = e.get("strLeague", "Soccer")
        progress = e.get("strProgress", "Live")
        st.markdown(
            f"""<div class='match-card'>
            <b>{home} {hs} - {a_s} {away}</b><br/>
            <span class='badge-muted'>{league}</span> · <span class='badge-gold'>{progress}</span>
            </div>""",
            unsafe_allow_html=True,
        )


def page_matches():
    st.title("⚽ Matches")
    db  = get_db()
    u   = current_user()

    # Stage filter
    stages = [r[0] for r in db.execute("SELECT DISTINCT stage FROM matches ORDER BY match_time").fetchall()]
    stage_choice = st.selectbox("Filter by stage", ["All"] + stages)

    if stage_choice == "All":
        matches = db.execute("SELECT * FROM matches ORDER BY match_time").fetchall()
    else:
        matches = db.execute("SELECT * FROM matches WHERE stage=? ORDER BY match_time", (stage_choice,)).fetchall()

    if not matches:
        st.info("No matches found.")
        return

    user_predictions = {}
    if u:
        pred_rows = db.execute(
            """
            SELECT * FROM predictions
            WHERE user_id=? AND match_id IN ({})
            """.format(",".join("?" * len(matches))),
            (u["id"], *[m["id"] for m in matches]),
        ).fetchall()
        user_predictions = {p["match_id"]: p for p in pred_rows}

    live_events = fetch_live_scores()
    live_lookup = {f"{e.get('strHomeTeam','')} vs {e.get('strAwayTeam','')}": e for e in live_events}

    for m in matches:
        with st.expander(
            f"{m['home_flag']} {m['home_team']}  vs  {m['away_flag']} {m['away_team']}"
            + (f"  ·  **{m['home_score']}–{m['away_score']}**" if m['status'] == 'finished' else "")
            + f"  ·  {m['stage']}"
            + (f" Group {m['group_name']}" if m['group_name'] else ""),
            expanded=False
        ):
            kickoff = datetime.fromisoformat(m['match_time'])
            st.write(f"🕐 {kickoff.strftime('%a %d %b %Y, %H:%M')}  |  📍 {m['venue']}")

            if m['status'] == 'finished':
                st.success(f"Final Score: **{m['home_team']} {m['home_score']} – {m['away_score']} {m['away_team']}**")

            # Show existing prediction
            live_key = f"{m['home_team']} vs {m['away_team']}"
            if live_key in live_lookup:
                e = live_lookup[live_key]
                st.warning(f"🔴 LIVE: {e.get('intHomeScore','?')} - {e.get('intAwayScore','?')} ({e.get('strProgress','in play')})")

            if u:
                existing = user_predictions.get(m["id"])

                if existing:
                    res_label = {"home": f"{m['home_team']} win", "draw": "Draw", "away": f"{m['away_team']} win"}.get(existing["predicted_result"], "?")
                    score_label = f" · {existing['predicted_home_score']}–{existing['predicted_away_score']}" if existing["predicted_home_score"] is not None else ""
                    if m['status'] == 'finished':
                        pts = existing["points_earned"]
                        if pts == 5:
                            st.success(f"Your pick: {res_label}{score_label} → ⭐ **Exact score! +5 pts**")
                        elif pts == 3:
                            st.success(f"Your pick: {res_label}{score_label} → ✅ **Correct result +3 pts**")
                        else:
                            st.error(f"Your pick: {res_label}{score_label} → ❌ Wrong prediction (0 pts)")
                    else:
                        st.info(f"🎯 Your current pick: **{res_label}**{score_label}")

            # Prediction form
            if u and is_open(m['match_time']) and m['status'] != 'finished':
                st.write("---")
                st.write("**Make your prediction:**")

                result_options = {
                    f"🏠 {m['home_team']} wins": "home",
                    "⚖️ Draw":                   "draw",
                    f"✈️ {m['away_team']} wins":  "away",
                }

                existing_pred = user_predictions.get(m["id"])
                default_label = None
                if existing_pred:
                    for lbl, val in result_options.items():
                        if val == existing_pred["predicted_result"]:
                            default_label = lbl
                            break

                default_idx = list(result_options.keys()).index(default_label) if default_label else 0

                chosen_label = st.radio(
                    "Result",
                    list(result_options.keys()),
                    index=default_idx,
                    key=f"res_{m['id']}",
                    horizontal=True
                )
                chosen_result = result_options[chosen_label]

                st.write("**Score (optional — earns +2 bonus if exact):**")
                sc1, sc2, sc3 = st.columns([2, 1, 2])
                with sc1:
                    hs = st.number_input(
                        m['home_team'], min_value=0, max_value=30, step=1,
                        value=int(existing_pred["predicted_home_score"]) if existing_pred and existing_pred["predicted_home_score"] is not None else 0,
                        key=f"hs_{m['id']}"
                    )
                with sc2:
                    st.markdown("<br><center style='font-size:1.5rem'>–</center>", unsafe_allow_html=True)
                with sc3:
                    as_ = st.number_input(
                        m['away_team'], min_value=0, max_value=30, step=1,
                        value=int(existing_pred["predicted_away_score"]) if existing_pred and existing_pred["predicted_away_score"] is not None else 0,
                        key=f"as_{m['id']}"
                    )

                include_score = st.checkbox("Include exact score prediction", key=f"inc_{m['id']}", value=bool(existing_pred and existing_pred["predicted_home_score"] is not None))

                if st.button("💾 Save Prediction", key=f"btn_{m['id']}"):
                    h_score = int(hs) if include_score else None
                    a_score = int(as_) if include_score else None

                    # Auto-fix result to match score if score given
                    if include_score:
                        if hs > as_:
                            chosen_result = "home"
                        elif as_ > hs:
                            chosen_result = "away"
                        else:
                            chosen_result = "draw"

                    db.execute("""
                        INSERT INTO predictions
                          (user_id, match_id, predicted_result, predicted_home_score, predicted_away_score, updated_at)
                        VALUES (?,?,?,?,?,datetime('now'))
                        ON CONFLICT(user_id, match_id) DO UPDATE SET
                          predicted_result=excluded.predicted_result,
                          predicted_home_score=excluded.predicted_home_score,
                          predicted_away_score=excluded.predicted_away_score,
                          points_earned=0, is_scored=0,
                          updated_at=datetime('now')
                    """, (u["id"], m["id"], chosen_result, h_score, a_score))
                    db.commit()
                    st.success("✅ Prediction saved!")
                    st.rerun()

            elif not u:
                st.info("Sign in to predict this match.")
            elif not is_open(m['match_time']) and m['status'] != 'finished':
                st.warning("🔒 Prediction window closed (< 1 hour to kick-off).")


def page_my_predictions():
    u = current_user()
    if not u:
        st.warning("Please sign in to view your predictions.")
        return

    st.title(f"🎯 {u['display_name']}'s Predictions")
    db = get_db()

    rows = db.execute("""
        SELECT p.*, m.home_team, m.away_team, m.home_flag, m.away_flag,
               m.match_time, m.stage, m.group_name, m.status, m.home_score, m.away_score
        FROM predictions p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=? ORDER BY m.match_time
    """, (u["id"],)).fetchall()

    if not rows:
        st.info("No predictions yet. Go to **Matches** to make predictions!")
        return

    total_pts = sum(r["points_earned"] for r in rows)
    correct   = sum(1 for r in rows if r["is_scored"] and r["points_earned"] >= 3)
    exact     = sum(1 for r in rows if r["is_scored"] and r["points_earned"] == 5)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Points", total_pts)
    c2.metric("Predictions", len(rows))
    c3.metric("Correct Results ✅", correct)
    c4.metric("Exact Scores 🎯", exact)

    st.divider()

    for r in rows:
        kickoff   = datetime.fromisoformat(r["match_time"])
        res_label = {"home": f"{r['home_team']} win", "draw": "Draw", "away": f"{r['away_team']} win"}.get(r["predicted_result"], "?")
        score_lbl = f" · {r['predicted_home_score']}–{r['predicted_away_score']}" if r["predicted_home_score"] is not None else ""

        if r["status"] == "finished":
            pts = r["points_earned"]
            icon  = "⭐" if pts == 5 else "✅" if pts == 3 else "❌"
            color = "green" if pts >= 3 else "red"
            with st.container():
                st.markdown(
                    f"""<div class='match-card'>
                    <b>{r['home_flag']} {r['home_team']} {r['home_score']} – {r['away_score']} {r['away_team']} {r['away_flag']}</b>
                    &nbsp;|&nbsp; {r['stage']} &nbsp;|&nbsp; {kickoff.strftime('%d %b')}<br/>
                    Your pick: <b>{res_label}{score_lbl}</b> &nbsp;→&nbsp;
                    <span style='color:{"#22c55e" if pts>=3 else "#ff6b7a"}'>{icon} <b>{pts} pts</b></span>
                    </div>""",
                    unsafe_allow_html=True
                )
        else:
            st.markdown(
                f"""<div class='match-card'>
                <b>{r['home_flag']} {r['home_team']} vs {r['away_team']} {r['away_flag']}</b>
                &nbsp;|&nbsp; {r['stage']} &nbsp;|&nbsp; {kickoff.strftime('%d %b %H:%M')}<br/>
                Your pick: <b>{res_label}{score_lbl}</b> &nbsp;→&nbsp;
                <span style='color:#f5a623'>⏳ Awaiting result</span>
                </div>""",
                unsafe_allow_html=True
            )


def page_admin():
    u = current_user()
    if not u or not u.get("is_admin"):
        st.error("Admin access required.")
        return

    st.title("⚙️ Admin Panel")
    st.write("Enter final scores to auto-score all user predictions.")
    db = get_db()
    c1, c2 = st.columns(2)
    with c1:
        if st.button("🧪 Generate demo test data"):
            created = ensure_demo_data(db)
            st.success(f"Demo data ready. New demo users created: {created}.")
    with c2:
        st.info("Tip: use Demo users (demo_1..demo_5 / demo1234) for quick testing.")

    stage_filter = st.selectbox(
        "Show stage",
        ["All", "Group Stage", "Round of 32", "Round of 16", "Quarterfinal", "Semifinal", "Third Place", "Final"]
    )

    query = "SELECT * FROM matches"
    if stage_filter != "All":
        query += f" WHERE stage='{stage_filter}'"
    query += " ORDER BY match_time"
    matches = db.execute(query).fetchall()

    for m in matches:
        with st.expander(
            f"{'✅' if m['status']=='finished' else '🕐'} "
            f"{m['home_flag']} {m['home_team']} vs {m['away_team']} {m['away_flag']}"
            + (f"  [{m['home_score']}–{m['away_score']}]" if m['status'] == 'finished' else ""),
            expanded=(m['status'] != 'finished')
        ):
            kickoff = datetime.fromisoformat(m['match_time'])
            st.write(f"📅 {kickoff.strftime('%a %d %b %Y, %H:%M')}  |  {m['stage']}")

            col1, col2, col3, col4 = st.columns([2, 1, 2, 2])
            with col1:
                hs = st.number_input("Home score", min_value=0, max_value=30, step=1,
                    value=int(m["home_score"]) if m["home_score"] is not None else 0,
                    key=f"adm_hs_{m['id']}")
            with col2:
                st.markdown("<br><center>–</center>", unsafe_allow_html=True)
            with col3:
                as_ = st.number_input("Away score", min_value=0, max_value=30, step=1,
                    value=int(m["away_score"]) if m["away_score"] is not None else 0,
                    key=f"adm_as_{m['id']}")
            with col4:
                st.write("")
                if st.button("✅ Save & Score", key=f"adm_save_{m['id']}"):
                    h, a = int(hs), int(as_)
                    actual = "home" if h > a else "away" if a > h else "draw"
                    db.execute("UPDATE matches SET home_score=?, away_score=?, status='finished' WHERE id=?", (h, a, m["id"]))
                    preds = db.execute("SELECT * FROM predictions WHERE match_id=? AND is_scored=0", (m["id"],)).fetchall()
                    for p in preds:
                        pts = 0
                        if p["predicted_result"] == actual:
                            pts = 3
                            if p["predicted_home_score"] == h and p["predicted_away_score"] == a:
                                pts += 2
                        db.execute("UPDATE predictions SET points_earned=?, is_scored=1, updated_at=datetime('now') WHERE id=?", (pts, p["id"]))
                    db.commit()
                    st.success(f"Saved! {len(preds)} prediction(s) scored.")
                    st.rerun()

                if m['status'] == 'finished':
                    if st.button("↩️ Reset", key=f"adm_reset_{m['id']}"):
                        db.execute("UPDATE matches SET home_score=NULL, away_score=NULL, status='upcoming' WHERE id=?", (m["id"],))
                        db.execute("UPDATE predictions SET points_earned=0, is_scored=0 WHERE match_id=?", (m["id"],))
                        db.commit()
                        st.success("Match reset.")
                        st.rerun()


def page_login():
    st.title("🔑 Sign In")
    col, _ = st.columns([1, 1])
    with col:
        username = st.text_input("Username", key="li_user")
        password = st.text_input("Password", type="password", key="li_pass")
        if st.button("Sign In", use_container_width=True):
            db   = get_db()
            user = db.execute("SELECT * FROM users WHERE username=?", (username.strip(),)).fetchone()
            if user and check_pw(password, user["password_hash"]):
                st.session_state["user"] = dict(user)
                st.success(f"Welcome back, {user['display_name']}!")
                st.rerun()
            else:
                st.error("Invalid username or password.")

        with st.expander("Forgot password?"):
            identity = st.text_input("Username or email", key="fp_identity")
            if st.button("Send reset code", key="fp_send", use_container_width=True):
                code = create_reset_code(get_db(), identity)
                if code:
                    st.success(f"Reset code generated: `{code}` (demo mode display).")
                else:
                    st.error("No user found with that username/email.")
            code = st.text_input("Reset code", key="fp_code")
            new_pw = st.text_input("New password", type="password", key="fp_new_pw")
            if st.button("Reset password", key="fp_apply", use_container_width=True):
                ok, msg = apply_reset_code(get_db(), code, new_pw)
                st.success(msg) if ok else st.error(msg)

        st.write("Don't have an account? Switch to **Register** in the sidebar.")


def page_register():
    st.title("📝 Create Account")
    col, _ = st.columns([1, 1])
    with col:
        display_name = st.text_input("Display Name", key="reg_dn")
        username     = st.text_input("Username",     key="reg_un")
        email        = st.text_input("Email",        key="reg_em")
        password     = st.text_input("Password (min 6 chars)", type="password", key="reg_pw")

        if st.button("Create Account", use_container_width=True):
            if not all([display_name, username, email, password]):
                st.error("All fields are required.")
            elif len(password) < 6:
                st.error("Password must be at least 6 characters.")
            else:
                db = get_db()
                existing = db.execute(
                    "SELECT id FROM users WHERE username=? OR email=?",
                    (username.strip(), email.strip().lower())
                ).fetchone()
                if existing:
                    st.error("Username or email already taken.")
                else:
                    hashed = hash_pw(password)
                    result = db.execute(
                        "INSERT INTO users (username, email, display_name, password_hash) VALUES (?,?,?,?)",
                        (username.strip(), email.strip().lower(), display_name.strip(), hashed)
                    )
                    db.commit()
                    user = db.execute("SELECT * FROM users WHERE id=?", (result.lastrowid,)).fetchone()
                    st.session_state["user"] = dict(user)
                    st.success(f"Account created! Welcome, {display_name}!")
                    st.rerun()


# ══════════════════════════════════════════════════════════════════════════════
#  SIDEBAR & ROUTING
# ══════════════════════════════════════════════════════════════════════════════

def sidebar():
    with st.sidebar:
        st.markdown("## ⚽ WC 2026 Predictor")
        st.markdown("---")

        u = current_user()
        if u:
            st.success(f"👤 {u['display_name']}")
            if st.button("Logout", use_container_width=True):
                del st.session_state["user"]
                st.rerun()
        else:
            st.info("Sign in to predict matches!")

        st.markdown("---")
        st.markdown("### 📋 Scoring")
        st.markdown("✅ **3 pts** — Correct result  \n🎯 **5 pts** — Exact score  \n🔒 Locks **1h** before kick-off")
        st.markdown("---")

        pages = {
            "🏠 Home":           "home",
            "⚽ Matches":        "matches",
            "📡 Live Scores":    "live",
            "🏆 Leaderboard":    "leaderboard",
        }
        if u:
            pages["🎯 My Predictions"] = "mypreds"
            if u.get("is_admin"):
                pages["⚙️ Admin"] = "admin"

        choice = st.radio("Navigate", list(pages.keys()), label_visibility="collapsed")
        return pages[choice]


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    init_db()
    page = sidebar()

    if page == "home":      page_home()
    elif page == "matches": page_matches()
    elif page == "live":    page_live_scores()
    elif page == "leaderboard": page_leaderboard()
    elif page == "mypreds": page_my_predictions()
    elif page == "admin":   page_admin()
    elif page == "login":   page_login()
    elif page == "register":page_register()

    # Show login/register at the bottom when not logged in and on home
    if not current_user() and page == "home":
        st.divider()
        tab1, tab2 = st.tabs(["Sign In", "Create Account"])
        with tab1:
            page_login()
        with tab2:
            page_register()


if __name__ == "__main__":
    main()
