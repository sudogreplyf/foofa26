"""
FIFA World Cup 2026 Predictor — Streamlit Edition
Deploy free: https://streamlit.io/cloud
"""

import streamlit as st
import sqlite3
import bcrypt
import os
from datetime import datetime, timedelta, timezone

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
  .stApp { background: #0b1f35; color: #e8eef4; }
  .match-card {
    background: #122840; border: 1px solid #1e3f5c; border-radius: 12px;
    padding: 1.2rem 1.5rem; margin-bottom: .8rem;
  }
  .match-teams { font-size: 1.2rem; font-weight: 700; text-align: center; margin: .4rem 0; }
  .badge-gold  { color: #f5a623; font-weight: 800; }
  .badge-green { color: #22c55e; font-weight: 700; }
  .badge-red   { color: #ff6b7a; font-weight: 700; }
  .badge-muted { color: #8ba3bb; }
  h1, h2, h3  { color: #f5a623 !important; }
  .stButton > button {
    background: linear-gradient(135deg,#2563a8,#1e4f8f);
    color: #fff; border: none; border-radius: 8px; font-weight: 700;
  }
  div[data-testid="stSidebarContent"] { background: #0d2740; }
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
    """)
    db.commit()
    _seed_matches(db)


def _seed_matches(db):
    cnt = db.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    if cnt > 0:
        return

    matches = [
        # Group A
        ('Mexico','Poland','🇲🇽','🇵🇱','2026-06-11T18:00:00','Estadio Azteca, Mexico City','Group Stage','A'),
        ('Argentina','Iceland','🇦🇷','🇮🇸','2026-06-11T21:00:00','MetLife Stadium, New Jersey','Group Stage','A'),
        ('Mexico','Argentina','🇲🇽','🇦🇷','2026-06-15T21:00:00','Estadio Azteca, Mexico City','Group Stage','A'),
        ('Iceland','Poland','🇮🇸','🇵🇱','2026-06-15T18:00:00','SoFi Stadium, Los Angeles','Group Stage','A'),
        ('Poland','Argentina','🇵🇱','🇦🇷','2026-06-19T21:00:00','MetLife Stadium, New Jersey','Group Stage','A'),
        ('Iceland','Mexico','🇮🇸','🇲🇽','2026-06-19T21:00:00','AT&T Stadium, Dallas','Group Stage','A'),
        # Group B
        ('USA','Wales','🇺🇸','🏴󠁧󠁢󠁷󠁬󠁳󠁿','2026-06-12T18:00:00','SoFi Stadium, Los Angeles','Group Stage','B'),
        ('England','Iran','🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇮🇷','2026-06-12T14:00:00','AT&T Stadium, Dallas','Group Stage','B'),
        ('USA','England','🇺🇸','🏴󠁧󠁢󠁥󠁮󠁧󠁿','2026-06-16T20:00:00','MetLife Stadium, New Jersey','Group Stage','B'),
        ('Iran','Wales','🇮🇷','🏴󠁧󠁢󠁷󠁬󠁳󠁿','2026-06-16T14:00:00',"Levi's Stadium, San Francisco",'Group Stage','B'),
        ('Wales','England','🏴󠁧󠁢󠁷󠁬󠁳󠁿','🏴󠁧󠁢󠁥󠁮󠁧󠁿','2026-06-20T21:00:00','Rose Bowl, Los Angeles','Group Stage','B'),
        ('Iran','USA','🇮🇷','🇺🇸','2026-06-20T21:00:00','AT&T Stadium, Dallas','Group Stage','B'),
        # Group C
        ('France','Australia','🇫🇷','🇦🇺','2026-06-12T21:00:00','Hard Rock Stadium, Miami','Group Stage','C'),
        ('Denmark','Tunisia','🇩🇰','🇹🇳','2026-06-13T14:00:00','Lumen Field, Seattle','Group Stage','C'),
        ('France','Denmark','🇫🇷','🇩🇰','2026-06-17T17:00:00','Hard Rock Stadium, Miami','Group Stage','C'),
        ('Tunisia','Australia','🇹🇳','🇦🇺','2026-06-17T14:00:00','SoFi Stadium, Los Angeles','Group Stage','C'),
        ('Australia','Denmark','🇦🇺','🇩🇰','2026-06-21T20:00:00','Lumen Field, Seattle','Group Stage','C'),
        ('Tunisia','France','🇹🇳','🇫🇷','2026-06-21T20:00:00','Hard Rock Stadium, Miami','Group Stage','C'),
        # Group D
        ('Spain','Costa Rica','🇪🇸','🇨🇷','2026-06-13T17:00:00','Allegiant Stadium, Las Vegas','Group Stage','D'),
        ('Germany','Japan','🇩🇪','🇯🇵','2026-06-13T20:00:00','MetLife Stadium, New Jersey','Group Stage','D'),
        ('Spain','Germany','🇪🇸','🇩🇪','2026-06-18T20:00:00','AT&T Stadium, Dallas','Group Stage','D'),
        ('Japan','Costa Rica','🇯🇵','🇨🇷','2026-06-18T14:00:00',"Levi's Stadium, San Francisco",'Group Stage','D'),
        ('Japan','Spain','🇯🇵','🇪🇸','2026-06-22T20:00:00','Rose Bowl, Los Angeles','Group Stage','D'),
        ('Costa Rica','Germany','🇨🇷','🇩🇪','2026-06-22T20:00:00','Lumen Field, Seattle','Group Stage','D'),
        # Group E
        ('Brazil','Serbia','🇧🇷','🇷🇸','2026-06-14T17:00:00','AT&T Stadium, Dallas','Group Stage','E'),
        ('Switzerland','Cameroon','🇨🇭','🇨🇲','2026-06-14T14:00:00','Hard Rock Stadium, Miami','Group Stage','E'),
        ('Brazil','Switzerland','🇧🇷','🇨🇭','2026-06-19T17:00:00','Lumen Field, Seattle','Group Stage','E'),
        ('Cameroon','Serbia','🇨🇲','🇷🇸','2026-06-19T14:00:00','SoFi Stadium, Los Angeles','Group Stage','E'),
        ('Serbia','Switzerland','🇷🇸','🇨🇭','2026-06-23T20:00:00','AT&T Stadium, Dallas','Group Stage','E'),
        ('Cameroon','Brazil','🇨🇲','🇧🇷','2026-06-23T20:00:00','Hard Rock Stadium, Miami','Group Stage','E'),
        # Group F
        ('Morocco','Croatia','🇲🇦','🇭🇷','2026-06-14T20:00:00','Allegiant Stadium, Las Vegas','Group Stage','F'),
        ('Belgium','Canada','🇧🇪','🇨🇦','2026-06-15T14:00:00','BMO Field, Toronto','Group Stage','F'),
        ('Morocco','Belgium','🇲🇦','🇧🇪','2026-06-19T14:00:00','MetLife Stadium, New Jersey','Group Stage','F'),
        ('Canada','Croatia','🇨🇦','🇭🇷','2026-06-19T17:00:00','BMO Field, Toronto','Group Stage','F'),
        ('Croatia','Belgium','🇭🇷','🇧🇪','2026-06-23T17:00:00','SoFi Stadium, Los Angeles','Group Stage','F'),
        ('Canada','Morocco','🇨🇦','🇲🇦','2026-06-23T17:00:00','BMO Field, Toronto','Group Stage','F'),
        # Group G
        ('Portugal','Ghana','🇵🇹','🇬🇭','2026-06-15T17:00:00','Rose Bowl, Los Angeles','Group Stage','G'),
        ('Uruguay','South Korea','🇺🇾','🇰🇷','2026-06-15T20:00:00',"Levi's Stadium, San Francisco",'Group Stage','G'),
        ('Portugal','Uruguay','🇵🇹','🇺🇾','2026-06-20T17:00:00','Rose Bowl, Los Angeles','Group Stage','G'),
        ('South Korea','Ghana','🇰🇷','🇬🇭','2026-06-20T14:00:00','Allegiant Stadium, Las Vegas','Group Stage','G'),
        ('South Korea','Portugal','🇰🇷','🇵🇹','2026-06-24T20:00:00','Hard Rock Stadium, Miami','Group Stage','G'),
        ('Ghana','Uruguay','🇬🇭','🇺🇾','2026-06-24T20:00:00','AT&T Stadium, Dallas','Group Stage','G'),
        # Group H
        ('Netherlands','Senegal','🇳🇱','🇸🇳','2026-06-16T17:00:00','Lumen Field, Seattle','Group Stage','H'),
        ('Ecuador','Qatar','🇪🇨','🇶🇦','2026-06-16T14:00:00','MetLife Stadium, New Jersey','Group Stage','H'),
        ('Netherlands','Ecuador','🇳🇱','🇪🇨','2026-06-21T17:00:00','SoFi Stadium, Los Angeles','Group Stage','H'),
        ('Qatar','Senegal','🇶🇦','🇸🇳','2026-06-21T14:00:00','Allegiant Stadium, Las Vegas','Group Stage','H'),
        ('Qatar','Netherlands','🇶🇦','🇳🇱','2026-06-25T20:00:00',"Levi's Stadium, San Francisco",'Group Stage','H'),
        ('Senegal','Ecuador','🇸🇳','🇪🇨','2026-06-25T20:00:00','Hard Rock Stadium, Miami','Group Stage','H'),
        # Knockout
        ('1A','2B','🏆','🏆','2026-06-28T18:00:00','MetLife Stadium, New Jersey','Round of 32',None),
        ('1C','2D','🏆','🏆','2026-06-28T22:00:00','AT&T Stadium, Dallas','Round of 32',None),
        ('1E','2F','🏆','🏆','2026-06-29T18:00:00','SoFi Stadium, Los Angeles','Round of 32',None),
        ('1G','2H','🏆','🏆','2026-06-29T22:00:00','Hard Rock Stadium, Miami','Round of 32',None),
        ('W R32-1','W R32-2','🏆','🏆','2026-07-04T20:00:00','MetLife Stadium, New Jersey','Round of 16',None),
        ('W R32-3','W R32-4','🏆','🏆','2026-07-05T20:00:00','SoFi Stadium, Los Angeles','Round of 16',None),
        ('QF1','QF2','🏆','🏆','2026-07-08T20:00:00','AT&T Stadium, Dallas','Quarterfinal',None),
        ('QF3','QF4','🏆','🏆','2026-07-09T20:00:00','Hard Rock Stadium, Miami','Quarterfinal',None),
        ('SF1','SF2','🏆','🏆','2026-07-14T20:00:00','MetLife Stadium, New Jersey','Semifinal',None),
        ('SF3','SF4','🏆','🏆','2026-07-15T20:00:00','SoFi Stadium, Los Angeles','Semifinal',None),
        ('3rd A','3rd B','🏆','🏆','2026-07-18T18:00:00','Hard Rock Stadium, Miami','Third Place',None),
        ('Champion 1','Champion 2','🏆','🏆','2026-07-19T18:00:00','MetLife Stadium, New Jersey','Final',None),
    ]
    db.executemany(
        "INSERT INTO matches (home_team,away_team,home_flag,away_flag,match_time,venue,stage,group_name) VALUES (?,?,?,?,?,?,?,?)",
        matches
    )
    db.commit()


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
        matches = db.execute(
            "SELECT * FROM matches WHERE stage=? ORDER BY match_time", (stage_choice,)
        ).fetchall()

    if not matches:
        st.info("No matches found.")
        return

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
            if u:
                existing = db.execute(
                    "SELECT * FROM predictions WHERE user_id=? AND match_id=?",
                    (u["id"], m["id"])
                ).fetchone()

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

                existing_pred = db.execute(
                    "SELECT * FROM predictions WHERE user_id=? AND match_id=?",
                    (u["id"], m["id"])
                ).fetchone()
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
