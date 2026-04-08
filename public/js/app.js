/* ═══════════════════════════════════════════════════════════════
   FIFA WORLD CUP 2026 PREDICTOR — FRONTEND
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;
let allMatches   = [];
let activeStage  = 'All';

// ── Auth helpers ──────────────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem('wc2026_token'); }
function saveAuth(token, user) {
  localStorage.setItem('wc2026_token', token);
  localStorage.setItem('wc2026_user',  JSON.stringify(user));
  currentUser = user;
}
function clearAuth() {
  localStorage.removeItem('wc2026_token');
  localStorage.removeItem('wc2026_user');
  currentUser = null;
}
function loadAuth() {
  const token = getToken();
  const raw   = localStorage.getItem('wc2026_user');
  if (token && raw) { currentUser = JSON.parse(raw); }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers['Authorization'] = 'Bearer ' + getToken();
  const r = await fetch('/api' + path, { ...options, headers });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('view-' + name).style.display = '';

  // Active nav highlight
  document.querySelectorAll('.nav-btn[id^="nav-"]').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  // Lazy-load view data
  if (name === 'home')        loadHome();
  if (name === 'matches')     loadMatches();
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'mypreds')     loadMyPreds();
  if (name === 'admin')       loadAdminMatches();
}

function updateNavbar() {
  const loggedIn = !!currentUser;
  document.getElementById('nav-login').style.display    = loggedIn ? 'none' : '';
  document.getElementById('nav-register').style.display = loggedIn ? 'none' : '';
  document.getElementById('nav-logout').style.display   = loggedIn ? '' : 'none';
  document.getElementById('nav-mypreds').style.display  = loggedIn ? '' : 'none';
  document.getElementById('nav-admin').style.display    = (loggedIn && currentUser.is_admin) ? '' : 'none';
  document.getElementById('navUser').textContent        = loggedIn ? '👤 ' + currentUser.display_name : '';
  document.getElementById('heroRegister').style.display = loggedIn ? 'none' : '';
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.classList.remove('visible');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    saveAuth(data.token, data.user);
    updateNavbar();
    toast('Welcome back, ' + data.user.display_name + '!');
    showView('home');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('visible');
  }
}

async function doRegister() {
  const display_name = document.getElementById('regDisplayName').value.trim();
  const username     = document.getElementById('regUsername').value.trim();
  const email        = document.getElementById('regEmail').value.trim();
  const password     = document.getElementById('regPassword').value;
  const errEl        = document.getElementById('registerError');
  errEl.classList.remove('visible');
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ display_name, username, email, password })
    });
    saveAuth(data.token, data.user);
    updateNavbar();
    toast('Account created! Welcome, ' + data.user.display_name + '!');
    showView('matches');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('visible');
  }
}

function logout() {
  clearAuth();
  updateNavbar();
  showView('home');
  toast('Logged out.');
}

// Keyboard submit for auth forms
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.view:not([style*="display: none"])');
  if (active?.id === 'view-login')    doLogin();
  if (active?.id === 'view-register') doRegister();
});

// ── HOME ──────────────────────────────────────────────────────────────────────
async function loadHome() {
  try {
    const [matches, leaders] = await Promise.all([
      api('/matches'),
      api('/predictions/leaderboard')
    ]);
    allMatches = matches;

    // Stats
    document.getElementById('statMatches').textContent   = matches.length;
    document.getElementById('statFinished').textContent  = matches.filter(m => m.status === 'finished').length;
    document.getElementById('statPredictors').textContent = leaders.length;

    // Mini leaderboard (top 5)
    const tbody = document.getElementById('homeLeaderboard');
    if (!leaders.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1rem">Be the first to predict!</td></tr>';
    } else {
      tbody.innerHTML = leaders.slice(0, 5).map((p, i) => `
        <tr class="${currentUser && p.id === currentUser.id ? 'you-row' : ''}">
          <td>${rankMedal(i + 1)}</td>
          <td>${esc(p.display_name)} ${currentUser && p.id === currentUser.id ? '<span style="color:var(--gold);font-size:.75rem">(you)</span>' : ''}</td>
          <td class="pts-cell" style="text-align:right">${p.total_points}</td>
          <td style="text-align:right;color:var(--muted)">${p.exact_scores}</td>
        </tr>
      `).join('');
    }

    // Upcoming matches (next 4)
    const upcoming = matches.filter(m => m.status === 'upcoming').slice(0, 4);
    const upEl = document.getElementById('homeUpcoming');
    if (!upcoming.length) {
      upEl.innerHTML = '<p style="color:var(--muted)">No upcoming matches.</p>';
    } else {
      upEl.innerHTML = upcoming.map(m => renderMatchCard(m, false)).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

// ── MATCHES ───────────────────────────────────────────────────────────────────
async function loadMatches() {
  try {
    allMatches = await api('/matches');
    buildStageFilter();
    renderMatchList();
  } catch (e) {
    document.getElementById('matchesList').innerHTML = `<p style="color:var(--muted)">${e.message}</p>`;
  }
}

function buildStageFilter() {
  const stages = ['All', ...new Set(allMatches.map(m => m.stage))];
  document.getElementById('stageFilter').innerHTML = stages.map(s => `
    <button class="filter-btn ${s === activeStage ? 'active' : ''}" onclick="filterStage('${s}')">${s}</button>
  `).join('');
}

function filterStage(stage) {
  activeStage = stage;
  buildStageFilter();
  renderMatchList();
}

function renderMatchList() {
  const filtered = activeStage === 'All' ? allMatches : allMatches.filter(m => m.stage === activeStage);
  const el = document.getElementById('matchesList');
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">⚽</div><p>No matches found.</p></div>';
    return;
  }
  el.innerHTML = filtered.map(m => renderMatchCard(m, true)).join('');
}

// ── MATCH CARD ────────────────────────────────────────────────────────────────
function renderMatchCard(m, expandable) {
  const kickoff  = new Date(m.match_time);
  const lockAt   = new Date(kickoff.getTime() - 60 * 60 * 1000);
  const now      = new Date();
  const isOpen   = m.status !== 'finished' && now < lockAt;
  const isLocked = m.status !== 'finished' && now >= lockAt;

  const stateClass = m.status === 'finished' ? 'finished' : isLocked ? 'locked' : 'open';

  const scoreDisplay = m.status === 'finished'
    ? `${m.home_score ?? '–'} – ${m.away_score ?? '–'}`
    : 'vs';

  const groupLabel = m.group_name ? `Group ${m.group_name} · ` : '';
  const stageLabel = `${groupLabel}${m.stage}`;

  let predBadge = '';
  if (m.predicted_result) {
    if (m.status === 'finished') {
      const actualResult = m.home_score > m.away_score ? 'home' : m.away_score > m.home_score ? 'away' : 'draw';
      const resultCorrect = m.predicted_result === actualResult;
      const exactCorrect  = m.predicted_home_score === m.home_score && m.predicted_away_score === m.away_score;
      if (exactCorrect) {
        predBadge = `<span class="prediction-badge badge-correct">⭐ Exact score! +5 pts</span>`;
      } else if (resultCorrect) {
        predBadge = `<span class="prediction-badge badge-correct">✓ Correct result +3 pts</span>`;
      } else {
        predBadge = `<span class="prediction-badge badge-wrong">✗ Wrong prediction</span>`;
      }
    } else {
      const resLabel = { home: `${esc(m.home_team)} win`, draw: 'Draw', away: `${esc(m.away_team)} win` }[m.predicted_result];
      const scoreLabel = m.predicted_home_score != null
        ? ` · ${m.predicted_home_score}–${m.predicted_away_score}` : '';
      predBadge = `<span class="prediction-badge badge-pending">🎯 ${resLabel}${scoreLabel}</span>`;
    }
  }

  const predictSection = expandable && currentUser && isOpen ? `
    <div class="predict-form" id="pf-${m.id}">
      <div class="result-btns">
        <button class="result-btn home ${m.predicted_result === 'home' ? 'selected home' : ''}"
          onclick="selectResult(${m.id},'home')" id="rb-${m.id}-home">🏠 ${esc(m.home_team)}</button>
        <button class="result-btn draw ${m.predicted_result === 'draw' ? 'selected draw' : ''}"
          onclick="selectResult(${m.id},'draw')" id="rb-${m.id}-draw">⚖️ Draw</button>
        <button class="result-btn away ${m.predicted_result === 'away' ? 'selected away' : ''}"
          onclick="selectResult(${m.id},'away')" id="rb-${m.id}-away">✈️ ${esc(m.away_team)}</button>
      </div>
      <div class="score-inputs">
        <label>Score (optional):</label>
        <span style="font-size:.85rem;color:var(--muted)">${esc(m.home_team)}</span>
        <input class="score-input" type="number" min="0" max="30" id="hs-${m.id}"
          value="${m.predicted_home_score ?? ''}" placeholder="0" onchange="syncResult(${m.id})" />
        <span class="score-sep">–</span>
        <input class="score-input" type="number" min="0" max="30" id="as-${m.id}"
          value="${m.predicted_away_score ?? ''}" placeholder="0" onchange="syncResult(${m.id})" />
        <span style="font-size:.85rem;color:var(--muted)">${esc(m.away_team)}</span>
      </div>
      <button class="predict-submit" onclick="submitPrediction(${m.id})" id="ps-${m.id}">
        ${m.predicted_result ? 'Update Prediction' : 'Save Prediction'}
      </button>
    </div>
  ` : expandable && isLocked && !m.predicted_result && currentUser ? `
    <div class="predict-form">
      <div class="lock-notice">🔒 Prediction window closed for this match</div>
    </div>
  ` : expandable && !currentUser && isOpen ? `
    <div class="predict-form">
      <div class="lock-notice" style="color:var(--brand-light)">
        <a onclick="showView('login')" style="cursor:pointer;color:var(--brand-light)">Sign in</a>&nbsp;to predict this match
      </div>
    </div>
  ` : '';

  const timeStr = kickoff.toLocaleString(undefined, {
    weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
  const lockStr = isOpen
    ? `<span class="countdown">🔒 Locks ${lockAt.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`
    : '';

  return `
    <div class="match-card ${stateClass}">
      <div class="match-header">
        <div>
          <div class="match-stage">${esc(stageLabel)}</div>
          <div class="match-time">${timeStr} ${lockStr}</div>
          <div class="match-venue">${esc(m.venue)}</div>
        </div>
        ${m.status === 'finished' ? '<span style="color:#22c55e;font-size:.8rem;font-weight:700">FINAL</span>' : ''}
      </div>
      <div class="match-teams">
        <div class="team">
          <div class="team-flag">${m.home_flag}</div>
          <div class="team-name">${esc(m.home_team)}</div>
        </div>
        <div class="team-score">${scoreDisplay}</div>
        <div class="team away">
          <div class="team-flag">${m.away_flag}</div>
          <div class="team-name">${esc(m.away_team)}</div>
        </div>
      </div>
      ${predBadge}
      ${predictSection}
    </div>
  `;
}

// ── Prediction interactions ───────────────────────────────────────────────────
const selectedResults = {};

function selectResult(matchId, result) {
  selectedResults[matchId] = result;
  ['home','draw','away'].forEach(r => {
    const btn = document.getElementById(`rb-${matchId}-${r}`);
    if (!btn) return;
    btn.className = `result-btn ${r}` + (r === result ? ` selected ${r}` : '');
  });
  // Sync score inputs if there's a score set that contradicts new result
  syncScoreFromResult(matchId, result);
}

function syncScoreFromResult(matchId, result) {
  const hs = document.getElementById(`hs-${matchId}`);
  const as_ = document.getElementById(`as-${matchId}`);
  if (!hs || !as_) return;
  const h = parseInt(hs.value, 10);
  const a = parseInt(as_.value, 10);
  if (isNaN(h) || isNaN(a)) return;
  // Clear score if it contradicts the selected result
  const implied = h > a ? 'home' : a > h ? 'away' : 'draw';
  if (implied !== result) {
    hs.value = '';
    as_.value = '';
  }
}

function syncResult(matchId) {
  const hs = document.getElementById(`hs-${matchId}`);
  const as_ = document.getElementById(`as-${matchId}`);
  if (!hs || !as_) return;
  const h = parseInt(hs.value, 10);
  const a = parseInt(as_.value, 10);
  if (isNaN(h) || isNaN(a)) return;
  const implied = h > a ? 'home' : a > h ? 'away' : 'draw';
  selectResult(matchId, implied);
}

async function submitPrediction(matchId) {
  const match = allMatches.find(m => m.id === matchId);
  const result = selectedResults[matchId] || match?.predicted_result;
  if (!result) { toast('Please select a result first.', true); return; }

  const hs = document.getElementById(`hs-${matchId}`);
  const as_ = document.getElementById(`as-${matchId}`);
  const hScore = hs?.value !== '' ? parseInt(hs.value, 10) : null;
  const aScore = as_?.value !== '' ? parseInt(as_.value, 10) : null;

  const btn = document.getElementById(`ps-${matchId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    await api('/predictions', {
      method: 'POST',
      body: JSON.stringify({
        match_id: matchId,
        predicted_result: result,
        predicted_home_score: hScore,
        predicted_away_score: aScore
      })
    });
    toast('Prediction saved!');
    // Refresh data
    allMatches = await api('/matches');
    renderMatchList();
  } catch (e) {
    toast(e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Save Prediction'; }
  }
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  try {
    const leaders = await api('/predictions/leaderboard');
    const tbody = document.getElementById('fullLeaderboard');
    if (!leaders.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">No predictions yet.</td></tr>';
      return;
    }
    tbody.innerHTML = leaders.map((p, i) => `
      <tr class="${currentUser && p.id === currentUser.id ? 'you-row' : ''}">
        <td>${rankMedal(i + 1)}</td>
        <td>
          ${esc(p.display_name)}
          ${currentUser && p.id === currentUser.id ? '<span style="color:var(--gold);font-size:.75rem"> (you)</span>' : ''}
          <div style="font-size:.75rem;color:var(--muted)">@${esc(p.username)}</div>
        </td>
        <td class="pts-cell" style="text-align:right">${p.total_points}</td>
        <td style="text-align:right;color:var(--muted)">${p.total_predictions}</td>
        <td style="text-align:right;color:#22c55e">${p.correct_results}</td>
        <td style="text-align:right;color:var(--gold)">${p.exact_scores}</td>
      </tr>
    `).join('');
  } catch (e) {
    document.getElementById('fullLeaderboard').innerHTML = `<tr><td colspan="6">${e.message}</td></tr>`;
  }
}

// ── MY PREDICTIONS ────────────────────────────────────────────────────────────
async function loadMyPreds() {
  if (!currentUser) { showView('login'); return; }
  try {
    const preds = await api('/predictions/mine');
    const el = document.getElementById('myPredsList');
    if (!preds.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="icon">🎯</div>
        <p>No predictions yet.</p>
        <button class="btn-primary" style="width:auto;padding:.6rem 1.5rem;margin-top:1rem"
          onclick="showView('matches')">Make your first prediction</button>
      </div>`;
      return;
    }

    let totalPts = 0, correct = 0, exact = 0;
    preds.forEach(p => {
      totalPts += p.points_earned;
      if (p.is_scored && p.points_earned >= 3) correct++;
      if (p.is_scored && p.points_earned === 5) exact++;
    });

    el.innerHTML = `
      <div class="stats-row" style="margin-bottom:1.5rem">
        <div class="stat-card"><div class="stat-num">${totalPts}</div><div class="stat-lbl">Total Points</div></div>
        <div class="stat-card"><div class="stat-num">${preds.length}</div><div class="stat-lbl">Predictions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${correct}</div><div class="stat-lbl">Correct Results</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--gold)">${exact}</div><div class="stat-lbl">Exact Scores</div></div>
      </div>
      ${preds.map(p => renderMyPredCard(p)).join('')}
    `;
  } catch (e) {
    document.getElementById('myPredsList').innerHTML = `<p style="color:var(--muted)">${e.message}</p>`;
  }
}

function renderMyPredCard(p) {
  const kickoff  = new Date(p.match_time);
  const timeStr  = kickoff.toLocaleString(undefined, {
    weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
  const resultLabel = { home: `${esc(p.home_team)} win`, draw: 'Draw', away: `${esc(p.away_team)} win` }[p.predicted_result];
  const scoreLabel  = p.predicted_home_score != null ? ` · ${p.predicted_home_score}–${p.predicted_away_score}` : '';

  let statusHTML = '';
  if (p.status === 'finished') {
    const actualResult = p.home_score > p.away_score ? 'home' : p.away_score > p.home_score ? 'away' : 'draw';
    if (p.points_earned === 5) {
      statusHTML = `<span class="prediction-badge badge-correct">⭐ Exact score! +5 pts</span>`;
    } else if (p.points_earned === 3) {
      statusHTML = `<span class="prediction-badge badge-correct">✓ Correct result +3 pts</span>`;
    } else {
      statusHTML = `<span class="prediction-badge badge-wrong">✗ Wrong · ${actualResult === 'home' ? esc(p.home_team) : actualResult === 'away' ? esc(p.away_team) : 'Draw'} · ${p.home_score}–${p.away_score}</span>`;
    }
  } else {
    statusHTML = `<span class="prediction-badge badge-pending">⏳ Awaiting result</span>`;
  }

  return `
    <div class="match-card ${p.status === 'finished' ? 'finished' : 'locked'}">
      <div class="match-header">
        <div>
          <div class="match-stage">${esc(p.stage)}${p.group_name ? ' · Group ' + p.group_name : ''}</div>
          <div class="match-time">${timeStr}</div>
        </div>
        ${p.status === 'finished' ? `<strong style="color:var(--gold);font-size:1.1rem">${p.points_earned} pts</strong>` : ''}
      </div>
      <div class="match-teams">
        <div class="team"><div class="team-flag">${p.home_flag}</div><div class="team-name">${esc(p.home_team)}</div></div>
        <div class="team-score">
          ${p.status === 'finished' ? `${p.home_score}–${p.away_score}` : 'vs'}
        </div>
        <div class="team away"><div class="team-flag">${p.away_flag}</div><div class="team-name">${esc(p.away_team)}</div></div>
      </div>
      <div style="margin-top:.5rem">
        <span style="font-size:.85rem;color:var(--muted)">Your pick: </span>
        <strong>${resultLabel}${scoreLabel}</strong>
      </div>
      ${statusHTML}
    </div>
  `;
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
async function loadAdminMatches() {
  if (!currentUser?.is_admin) { showView('home'); return; }
  try {
    const matches = await api('/matches');
    const el = document.getElementById('adminMatchesList');
    if (!matches.length) { el.innerHTML = '<p>No matches.</p>'; return; }

    el.innerHTML = matches.map(m => `
      <div class="match-card ${m.status === 'finished' ? 'finished' : ''}">
        <div class="match-header">
          <div>
            <div class="match-stage">${esc(m.stage)}${m.group_name ? ' · Group ' + m.group_name : ''}</div>
            <div class="match-time">${new Date(m.match_time).toLocaleString()}</div>
          </div>
          <span style="font-size:.8rem;color:${m.status === 'finished' ? '#22c55e' : 'var(--muted)'}">
            ${m.status.toUpperCase()}
          </span>
        </div>
        <div class="match-teams">
          <div class="team"><div class="team-flag">${m.home_flag}</div><div class="team-name">${esc(m.home_team)}</div></div>
          <div class="team-score">${m.status === 'finished' ? `${m.home_score}–${m.away_score}` : 'vs'}</div>
          <div class="team away"><div class="team-flag">${m.away_flag}</div><div class="team-name">${esc(m.away_team)}</div></div>
        </div>
        <div class="admin-form">
          <span style="font-size:.85rem;color:var(--muted)">Set result:</span>
          <input class="admin-score-input" type="number" min="0" max="30" id="ah-${m.id}" placeholder="H" value="${m.home_score ?? ''}" />
          <span style="color:var(--muted)">–</span>
          <input class="admin-score-input" type="number" min="0" max="30" id="aa-${m.id}" placeholder="A" value="${m.away_score ?? ''}" />
          <button class="btn-admin" onclick="adminSetResult(${m.id})">✓ Save & Score</button>
          ${m.status === 'finished' ? `<button class="btn-admin btn-reset" onclick="adminReset(${m.id})">↩ Reset</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('adminMatchesList').innerHTML = `<p style="color:var(--muted)">${e.message}</p>`;
  }
}

async function adminSetResult(matchId) {
  const h = parseInt(document.getElementById(`ah-${matchId}`).value, 10);
  const a = parseInt(document.getElementById(`aa-${matchId}`).value, 10);
  if (isNaN(h) || isNaN(a)) { toast('Enter both scores.', true); return; }
  try {
    const r = await api(`/matches/${matchId}/result`, {
      method: 'PATCH',
      body: JSON.stringify({ home_score: h, away_score: a })
    });
    toast(`Result saved. ${r.scored} prediction(s) scored.`);
    loadAdminMatches();
  } catch (e) { toast(e.message, true); }
}

async function adminReset(matchId) {
  try {
    await api(`/matches/${matchId}/reset`, { method: 'PATCH' });
    toast('Match reset.');
    loadAdminMatches();
  } catch (e) { toast(e.message, true); }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function rankMedal(n) {
  if (n === 1) return '<span class="rank-medal">🥇</span>';
  if (n === 2) return '<span class="rank-medal">🥈</span>';
  if (n === 3) return '<span class="rank-medal">🥉</span>';
  return `<span style="color:var(--muted);font-weight:700">${n}</span>`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAuth();
updateNavbar();
showView('home');
