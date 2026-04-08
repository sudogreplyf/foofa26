let currentUser = null;
let allMatches = [];
let activeStage = 'All';
let livePollTimer = null;
const selectedResults = {};
const lastLiveSnapshot = new Map();

function getToken() { return localStorage.getItem('wc2026_token'); }
function saveAuth(token, user) {
  localStorage.setItem('wc2026_token', token);
  localStorage.setItem('wc2026_user', JSON.stringify(user));
  currentUser = user;
}
function clearAuth() {
  localStorage.removeItem('wc2026_token');
  localStorage.removeItem('wc2026_user');
  currentUser = null;
}
function loadAuth() {
  const token = getToken();
  const raw = localStorage.getItem('wc2026_user');
  if (token && raw) currentUser = JSON.parse(raw);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const r = await fetch('/api' + path, { ...options, headers });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.detail || 'Request failed');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.style.display = 'none'; });
  document.getElementById('view-' + name).style.display = '';

  document.querySelectorAll('.nav-btn[id^="nav-"]').forEach((b) => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  if (name === 'home') loadHome();
  if (name === 'matches') loadMatches();
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'mypreds') loadMyPreds();
  if (name === 'admin') loadAdminMatches();

  startLivePolling();
}

function updateNavbar() {
  const loggedIn = !!currentUser;
  document.getElementById('nav-login').style.display = loggedIn ? 'none' : '';
  document.getElementById('nav-register').style.display = loggedIn ? 'none' : '';
  document.getElementById('nav-logout').style.display = loggedIn ? '' : 'none';
  document.getElementById('nav-mypreds').style.display = loggedIn ? '' : 'none';
  document.getElementById('nav-admin').style.display = loggedIn && currentUser.is_admin ? '' : 'none';
  document.getElementById('navUser').textContent = loggedIn ? '👤 ' + currentUser.display_name : '';
  document.getElementById('heroRegister').style.display = loggedIn ? 'none' : '';
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.remove('visible');
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
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
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl = document.getElementById('registerError');
  errEl.classList.remove('visible');
  try {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ display_name, username, email, password }) });
    saveAuth(data.token, data.user);
    updateNavbar();
    toast('Account created!');
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
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.view:not([style*="display: none"])');
  if (active?.id === 'view-login') doLogin();
  if (active?.id === 'view-register') doRegister();
});

async function loadHome() {
  try {
    const [matches, leaders] = await Promise.all([api('/matches'), api('/predictions/leaderboard')]);
    allMatches = matches;
    document.getElementById('statMatches').textContent = matches.length;
    document.getElementById('statFinished').textContent = matches.filter((m) => m.status === 'finished').length;
    document.getElementById('statPredictors').textContent = leaders.length;

    const tbody = document.getElementById('homeLeaderboard');
    tbody.innerHTML = !leaders.length
      ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1rem">No predictions yet.</td></tr>'
      : leaders.slice(0, 5).map((p, i) => `<tr><td>${rankMedal(i + 1)}</td><td>${esc(p.display_name)}</td><td class="pts-cell" style="text-align:right">${p.total_points}</td><td style="text-align:right;color:var(--muted)">${p.exact_scores}</td></tr>`).join('');

    const live = matches.filter((m) => m.status === 'live').slice(0, 4);
    const upcoming = matches.filter((m) => m.status === 'upcoming').slice(0, 4);
    const upEl = document.getElementById('homeUpcoming');
    const blocks = [];
    if (live.length) {
      blocks.push('<div class="section-title">Live Now</div>' + live.map((m) => renderMatchCard(m, false)).join(''));
    }
    blocks.push('<div class="section-title">Next Matches</div>' + (upcoming.length ? upcoming.map((m) => renderMatchCard(m, false)).join('') : '<p style="color:var(--muted)">No upcoming matches available.</p>'));
    upEl.innerHTML = blocks.join('');
  } catch (e) {
    document.getElementById('homeUpcoming').innerHTML = `<p style="color:var(--accent)">Failed to load matches: ${esc(e.message)}</p>`;
  }
}

async function loadMatches() {
  try {
    allMatches = await api('/matches');
    buildStageFilter();
    renderMatchList();
  } catch (e) {
    document.getElementById('matchesList').innerHTML = `<p style="color:var(--accent)">${esc(e.message)}</p>`;
  }
}

function buildStageFilter() {
  const stages = ['All', ...new Set(allMatches.map((m) => m.stage))];
  document.getElementById('stageFilter').innerHTML = stages.map((s) => `<button class="filter-btn ${s === activeStage ? 'active' : ''}" onclick="filterStage(${JSON.stringify(s)})">${esc(s)}</button>`).join('');
}
function filterStage(stage) { activeStage = stage; buildStageFilter(); renderMatchList(); }

function groupMatchesForDashboard(matches) {
  const byDate = new Map();
  for (const m of matches) {
    const d = new Date(m.match_time);
    const dayKey = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'unknown';
    if (!byDate.has(dayKey)) byDate.set(dayKey, []);
    byDate.get(dayKey).push(m);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderMatchList() {
  const filtered = activeStage === 'All' ? allMatches : allMatches.filter((m) => m.stage === activeStage);
  const live = filtered.filter((m) => m.status === 'live');
  const nonLive = filtered.filter((m) => m.status !== 'live');
  const grouped = groupMatchesForDashboard(nonLive);

  const el = document.getElementById('matchesList');
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">⚽</div><p>No matches found.</p></div>';
    return;
  }

  const chunks = [];
  chunks.push('<div class="section-title">🔴 Live Now</div>');
  chunks.push(live.length ? live.map((m) => renderMatchCard(m, true)).join('') : '<div class="card" style="color:var(--muted)">No live matches right now.</div>');
  chunks.push('<div class="section-title">📅 Fixtures by Date</div>');
  for (const [day, rows] of grouped) {
    const dayLabel = day === 'unknown' ? 'Unknown Date' : new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const leagueGroups = rows.reduce((acc, m) => {
      const key = m.league_name || 'Other League';
      if (!acc[key]) acc[key] = [];
      acc[key].push(m);
      return acc;
    }, {});
    chunks.push(`<h3 class="subgroup-title">${esc(dayLabel)}</h3>`);
    for (const [league, list] of Object.entries(leagueGroups)) {
      chunks.push(`<h4 class="subleague-title">${esc(league)}</h4>`);
      chunks.push(list.map((m) => renderMatchCard(m, true)).join(''));
    }
  }

  el.innerHTML = chunks.join('');
}

function renderMatchCard(m, expandable) {
  const kickoff = new Date(m.match_time);
  const lockAt = new Date(kickoff.getTime() - 60 * 60 * 1000);
  const now = new Date();
  const isOpen = m.status !== 'finished' && now < lockAt;
  const isLocked = m.status !== 'finished' && now >= lockAt;
  const stateClass = m.status === 'finished' ? 'finished' : m.status === 'live' ? 'live' : isLocked ? 'locked' : 'open';
  const scoreDisplay = m.home_score != null && m.away_score != null ? `${m.home_score} – ${m.away_score}` : 'vs';

  const snapshotKey = `${m.status}:${m.home_score ?? ''}:${m.away_score ?? ''}:${m.live_minute ?? ''}`;
  const oldSnap = lastLiveSnapshot.get(m.id);
  const changedClass = oldSnap && oldSnap !== snapshotKey ? ' score-flash' : '';
  lastLiveSnapshot.set(m.id, snapshotKey);

  let liveTag = '';
  if (m.status === 'live') {
    liveTag = `<span class="live-pill">LIVE ${m.live_minute ? `${m.live_minute}'` : ''}</span>`;
  } else if (m.status === 'finished') {
    liveTag = '<span class="final-pill">FINAL</span>';
  }

  const stageLabel = `${m.stage}${m.group_name ? ` · ${m.group_name}` : ''}`;

  const predictSection = expandable && currentUser && isOpen ? `
    <div class="predict-form" id="pf-${m.id}">
      <div class="result-btns">
        <button class="result-btn home ${m.predicted_result === 'home' ? 'selected home' : ''}" onclick="selectResult(${m.id},'home')" id="rb-${m.id}-home">🏠 ${esc(m.home_team)}</button>
        <button class="result-btn draw ${m.predicted_result === 'draw' ? 'selected draw' : ''}" onclick="selectResult(${m.id},'draw')" id="rb-${m.id}-draw">⚖️ Draw</button>
        <button class="result-btn away ${m.predicted_result === 'away' ? 'selected away' : ''}" onclick="selectResult(${m.id},'away')" id="rb-${m.id}-away">✈️ ${esc(m.away_team)}</button>
      </div>
      <div class="score-inputs">
        <label>Score:</label>
        <input class="score-input" type="number" min="0" max="30" id="hs-${m.id}" value="${m.predicted_home_score ?? ''}" onchange="syncResult(${m.id})" />
        <span class="score-sep">–</span>
        <input class="score-input" type="number" min="0" max="30" id="as-${m.id}" value="${m.predicted_away_score ?? ''}" onchange="syncResult(${m.id})" />
      </div>
      <button class="predict-submit" onclick="submitPrediction(${m.id})" id="ps-${m.id}">${m.predicted_result ? 'Update Prediction' : 'Save Prediction'}</button>
    </div>` : '';

  const timeStr = kickoff.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `
    <div class="match-card ${stateClass}${changedClass}" data-match-id="${m.id}">
      <div class="match-header">
        <div>
          <div class="match-stage">${esc(stageLabel)}</div>
          <div class="match-time">${timeStr}</div>
          <div class="match-venue">${esc(m.venue || 'Venue TBD')}</div>
        </div>
        ${liveTag}
      </div>
      <div class="match-teams">
        <div class="team"><div class="team-flag">${esc(m.home_flag || '🏳️')}</div><div class="team-name">${esc(m.home_team)}</div></div>
        <div class="team-score">${scoreDisplay}</div>
        <div class="team away"><div class="team-flag">${esc(m.away_flag || '🏳️')}</div><div class="team-name">${esc(m.away_team)}</div></div>
      </div>
      ${predictSection}
      ${expandable && isLocked && m.status !== 'live' && m.status !== 'finished' ? '<div class="lock-notice">🔒 Prediction window closed</div>' : ''}
    </div>`;
}

function selectResult(matchId, result) {
  selectedResults[matchId] = result;
  ['home', 'draw', 'away'].forEach((r) => {
    const btn = document.getElementById(`rb-${matchId}-${r}`);
    if (btn) btn.className = `result-btn ${r}` + (r === result ? ` selected ${r}` : '');
  });
}
function syncResult(matchId) {
  const h = parseInt(document.getElementById(`hs-${matchId}`)?.value, 10);
  const a = parseInt(document.getElementById(`as-${matchId}`)?.value, 10);
  if (Number.isNaN(h) || Number.isNaN(a)) return;
  selectResult(matchId, h > a ? 'home' : a > h ? 'away' : 'draw');
}

async function submitPrediction(matchId) {
  const match = allMatches.find((m) => m.id === matchId);
  const result = selectedResults[matchId] || match?.predicted_result;
  if (!result) return toast('Please select a result.', true);

  const hs = document.getElementById(`hs-${matchId}`);
  const as = document.getElementById(`as-${matchId}`);
  const hScore = hs?.value !== '' ? parseInt(hs.value, 10) : null;
  const aScore = as?.value !== '' ? parseInt(as.value, 10) : null;

  try {
    await api('/predictions', { method: 'POST', body: JSON.stringify({ match_id: matchId, predicted_result: result, predicted_home_score: hScore, predicted_away_score: aScore }) });
    toast('Prediction saved!');
    await loadMatches();
  } catch (e) { toast(e.message, true); }
}

async function loadLeaderboard() {
  try {
    const leaders = await api('/predictions/leaderboard');
    const tbody = document.getElementById('fullLeaderboard');
    tbody.innerHTML = leaders.map((p, i) => `<tr><td>${rankMedal(i + 1)}</td><td>${esc(p.display_name)}<div style="font-size:.75rem;color:var(--muted)">@${esc(p.username)}</div></td><td class="pts-cell" style="text-align:right">${p.total_points}</td><td style="text-align:right;color:var(--muted)">${p.total_predictions}</td><td style="text-align:right;color:#22c55e">${p.correct_results}</td><td style="text-align:right;color:var(--gold)">${p.exact_scores}</td></tr>`).join('');
  } catch (e) {
    document.getElementById('fullLeaderboard').innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`;
  }
}

async function loadMyPreds() {
  if (!currentUser) return showView('login');
  try {
    const preds = await api('/predictions/mine');
    const el = document.getElementById('myPredsList');
    el.innerHTML = preds.length ? preds.map((p) => renderMyPredCard(p)).join('') : '<div class="empty-state"><p>No predictions yet.</p></div>';
  } catch (e) {
    document.getElementById('myPredsList').innerHTML = `<p style="color:var(--accent)">${esc(e.message)}</p>`;
  }
}

function renderMyPredCard(p) {
  return `<div class="match-card ${p.status === 'finished' ? 'finished' : 'locked'}"><div class="match-header"><div><div class="match-stage">${esc(p.stage)}</div><div class="match-time">${new Date(p.match_time).toLocaleString()}</div></div><strong>${p.points_earned || 0} pts</strong></div><div class="match-teams"><div class="team"><div class="team-flag">${esc(p.home_flag || '🏳️')}</div><div class="team-name">${esc(p.home_team)}</div></div><div class="team-score">${p.home_score != null ? `${p.home_score}–${p.away_score}` : 'vs'}</div><div class="team away"><div class="team-flag">${esc(p.away_flag || '🏳️')}</div><div class="team-name">${esc(p.away_team)}</div></div></div></div>`;
}

async function loadAdminMatches() {
  if (!currentUser?.is_admin) return showView('home');
  try {
    const matches = await api('/matches');
    const el = document.getElementById('adminMatchesList');
    if (!matches.length) {
      el.innerHTML = '<p style="color:var(--muted)">No matches in DB. Run Manual Sync.</p>';
      return;
    }

    el.innerHTML = matches.map((m) => `<div class="match-card ${m.status === 'finished' ? 'finished' : ''}"><div class="match-header"><div><div class="match-stage">${esc(m.league_name || m.stage)}</div><div class="match-time">${new Date(m.match_time).toLocaleString()}</div></div><span>${esc((m.status || 'upcoming').toUpperCase())}</span></div><div class="match-teams"><div class="team"><div class="team-name">${esc(m.home_team)}</div></div><div class="team-score">${m.home_score != null ? `${m.home_score}–${m.away_score}` : 'vs'}</div><div class="team away"><div class="team-name">${esc(m.away_team)}</div></div></div><div class="admin-form"><input class="admin-score-input" type="number" min="0" max="30" id="ah-${m.id}" placeholder="H" value="${m.home_score ?? ''}" /><span>–</span><input class="admin-score-input" type="number" min="0" max="30" id="aa-${m.id}" placeholder="A" value="${m.away_score ?? ''}" /><button class="btn-admin" onclick="adminSetResult(${m.id})">Save Final</button>${m.status === 'finished' ? `<button class="btn-admin btn-reset" onclick="adminReset(${m.id})">Reset</button>` : ''}</div></div>`).join('');
  } catch (e) {
    document.getElementById('adminMatchesList').innerHTML = `<p style="color:var(--accent)">${esc(e.message)}</p>`;
  }
}

async function adminManualSync() {
  try {
    const r = await api('/matches/admin/sync', { method: 'POST', body: JSON.stringify({}) });
    document.getElementById('adminSyncStatus').textContent = `Synced ${r.upserts} fixtures from ${r.source} (${r.league} ${r.season}).`;
    toast('Manual sync complete.');
    await Promise.all([loadAdminMatches(), loadMatches(), loadHome()]);
  } catch (e) {
    document.getElementById('adminSyncStatus').textContent = `Sync failed: ${e.message}`;
    toast(e.message, true);
  }
}

async function adminMockLiveUpdate() {
  try {
    const r = await api('/matches/admin/mock-live-update', { method: 'POST', body: JSON.stringify({}) });
    toast(`Mock event applied to ${r.match.home_team} vs ${r.match.away_team}.`);
    await Promise.all([loadAdminMatches(), loadMatches(), loadHome()]);
  } catch (e) { toast(e.message, true); }
}

async function adminSetResult(matchId) {
  const h = parseInt(document.getElementById(`ah-${matchId}`).value, 10);
  const a = parseInt(document.getElementById(`aa-${matchId}`).value, 10);
  if (Number.isNaN(h) || Number.isNaN(a)) return toast('Enter both scores.', true);
  try {
    const r = await api(`/matches/${matchId}/result`, { method: 'PATCH', body: JSON.stringify({ home_score: h, away_score: a }) });
    toast(`Final saved. ${r.scored} prediction(s) rescored.`);
    await loadAdminMatches();
  } catch (e) { toast(e.message, true); }
}

async function adminReset(matchId) {
  try {
    await api(`/matches/${matchId}/reset`, { method: 'PATCH' });
    toast('Match reset.');
    await loadAdminMatches();
  } catch (e) { toast(e.message, true); }
}

function startLivePolling() {
  if (livePollTimer) clearInterval(livePollTimer);
  livePollTimer = setInterval(async () => {
    const active = document.querySelector('.view:not([style*="display: none"])')?.id;
    if (!active || !['view-home', 'view-matches', 'view-admin'].includes(active)) return;

    try {
      const latest = await api('/matches');
      if (JSON.stringify(latest.map((m) => [m.id, m.status, m.home_score, m.away_score, m.live_minute])) !== JSON.stringify(allMatches.map((m) => [m.id, m.status, m.home_score, m.away_score, m.live_minute]))) {
        allMatches = latest;
        if (active === 'view-home') loadHome();
        if (active === 'view-matches') { buildStageFilter(); renderMatchList(); }
        if (active === 'view-admin' && currentUser?.is_admin) loadAdminMatches();
      }
    } catch {
      // silent to avoid toast spam during transient API/network failures
    }
  }, 15000);
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rankMedal(n) {
  if (n === 1) return '<span class="rank-medal">🥇</span>';
  if (n === 2) return '<span class="rank-medal">🥈</span>';
  if (n === 3) return '<span class="rank-medal">🥉</span>';
  return `<span style="color:var(--muted);font-weight:700">${n}</span>`;
}

loadAuth();
updateNavbar();
showView('home');
