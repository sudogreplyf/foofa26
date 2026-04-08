/* ══════════════════════════════════════════════════════
   FIFA WC 2026 PREDICTOR — Frontend
   ══════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let allMatches  = [];
let activeStage = 'Group Stage';
let activeGroup = 'A';
let adminStage  = 'Group Stage';

// ── Auth ──────────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('wc_token'); }
function setAuth(token, user) {
  localStorage.setItem('wc_token', token);
  localStorage.setItem('wc_user', JSON.stringify(user));
  currentUser = user;
}
function clearAuth() {
  localStorage.removeItem('wc_token');
  localStorage.removeItem('wc_user');
  currentUser = null;
}
function loadAuth() {
  const t = getToken(), u = localStorage.getItem('wc_user');
  if (t && u) try { currentUser = JSON.parse(u); } catch {}
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (getToken()) h['Authorization'] = 'Bearer ' + getToken();
  const r = await fetch('/api' + path, { ...opts, headers: h });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _tt;
function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.className = '', 3200);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday:'short', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function isOpen(matchTime) {
  return Date.now() < new Date(matchTime).getTime() - 3_600_000;
}

function resultLabel(m, result) {
  if (result === 'home') return esc(m.home_team) + ' Win';
  if (result === 'away') return esc(m.away_team) + ' Win';
  return 'Draw';
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function updateNav() {
  const li = !!currentUser;
  const el = id => document.getElementById(id);
  el('nb-login').classList.toggle('hidden', li);
  el('nb-register').classList.toggle('hidden', li);
  el('nb-logout').classList.toggle('hidden', !li);
  el('nb-mine').classList.toggle('hidden', !li);
  el('nb-admin').classList.toggle('hidden', !(li && currentUser.is_admin));
  el('navUser').classList.toggle('hidden', !li);
  el('navUser').textContent = li ? '👤 ' + currentUser.display_name : '';
  document.getElementById('heroBtns') &&
    (document.getElementById('heroBtns').innerHTML = li
      ? `<button class="btn-red" onclick="nav('matches')">⚽ Predict Now</button>
         <button class="btn-ghost" onclick="nav('mine')">My Predictions</button>`
      : `<button class="btn-red" onclick="nav('register')">🚀 Join & Predict</button>
         <button class="btn-ghost" onclick="nav('matches')">View Schedule</button>`);
}

function toggleBurger() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ── Navigation ────────────────────────────────────────────────────────────────
const VIEWS = ['home','matches','leaderboard','mine','admin','login','register'];

function nav(name) {
  VIEWS.forEach(v => {
    document.getElementById('v-' + v).classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.nb[id^="nb-"]').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nb-' + name);
  if (nb) nb.classList.add('active');
  document.getElementById('navLinks').classList.remove('open');

  if (name === 'home')        renderHome();
  if (name === 'matches')     renderMatches();
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'mine')        renderMine();
  if (name === 'admin')       renderAdmin();
}

// ── SSE live updates ──────────────────────────────────────────────────────────
function initSSE() {
  const es = new EventSource('/api/live-stream');
  es.addEventListener('matchUpdate', e => {
    const updated = JSON.parse(e.data);
    const idx = allMatches.findIndex(m => m.id === updated.id);
    if (idx !== -1) {
      // preserve user's prediction fields
      allMatches[idx] = { ...allMatches[idx], ...updated };
    }
    // Re-render if on a page that shows matches
    const active = VIEWS.find(v => !document.getElementById('v-'+v).classList.contains('hidden'));
    if (active === 'matches') renderMatchList();
    if (active === 'home')    renderHome();
    if (active === 'admin')   renderAdmin();
  });
  es.onerror = () => setTimeout(initSSE, 5000); // reconnect on error
}

// ── HOME ──────────────────────────────────────────────────────────────────────
async function renderHome() {
  try {
    const [matches, board] = await Promise.all([api('/matches'), api('/predictions/leaderboard')]);
    allMatches = matches;

    document.getElementById('statMatches').textContent   = matches.length;
    document.getElementById('statPredictors').textContent = board.length;

    // Mini leaderboard
    const boardEl = document.getElementById('homeBoard');
    if (!board.length) {
      boardEl.innerHTML = '<div class="empty"><span class="ei">🏆</span>No predictions yet — be the first!</div>';
    } else {
      const medals = ['🥇','🥈','🥉'];
      boardEl.innerHTML = `<table class="lb-table"><thead><tr>
        <th>#</th><th>Player</th><th style="text-align:right">Pts</th><th style="text-align:right">Exact</th>
      </tr></thead><tbody>${
        board.slice(0,5).map((p,i) => `<tr class="${currentUser && p.id===currentUser.id?'you':''}">
          <td class="rank-cell">${medals[i]||i+1}</td>
          <td>${esc(p.display_name)}${currentUser&&p.id===currentUser.id?' <small class="gold">(you)</small>':''}</td>
          <td class="pts-cell" style="text-align:right">${p.total_points}</td>
          <td style="text-align:right;color:var(--gold)">${p.exact_scores}</td>
        </tr>`).join('')
      }</tbody></table>`;
    }

    // Next 3 upcoming matches
    const upcoming = matches.filter(m => m.status === 'upcoming').slice(0, 3);
    const nextEl   = document.getElementById('homeNext');
    nextEl.innerHTML = upcoming.length
      ? upcoming.map(m => matchCard(m, false)).join('')
      : '<div class="empty">No upcoming matches.</div>';

  } catch (e) { console.error(e); }
}

// ── MATCHES ───────────────────────────────────────────────────────────────────
async function renderMatches() {
  try {
    allMatches = await api('/matches');
    buildStageTabs();
    renderMatchList();
  } catch (e) {
    document.getElementById('matchList').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function buildStageTabs() {
  const stages = [...new Set(allMatches.map(m => m.stage))];
  document.getElementById('stageTabs').innerHTML = stages.map(s =>
    `<button class="tab${s===activeStage?' active':''}" onclick="setStage('${esc(s)}')">${esc(s)}</button>`
  ).join('');

  // Group sub-tabs only for Group Stage
  const groupTabsEl = document.getElementById('groupTabs');
  if (activeStage === 'Group Stage') {
    const groups = [...new Set(allMatches.filter(m=>m.stage==='Group Stage').map(m=>m.group_name).filter(Boolean))].sort();
    groupTabsEl.classList.remove('hidden');
    groupTabsEl.innerHTML = ['All',...groups].map(g =>
      `<button class="tab${g===activeGroup?' active':''}" onclick="setGroup('${g}')">${g==='All'?'All Groups':'Group '+g}</button>`
    ).join('');
  } else {
    groupTabsEl.classList.add('hidden');
  }
}
function filterStage(stage) { activeStage = stage; buildStageFilter(); renderMatchList(); }

function setStage(s) {
  activeStage = s;
  if (s === 'Group Stage' && activeGroup !== 'All') {
    // keep group selection
  } else {
    activeGroup = 'All';
  }
  buildStageTabs();
  renderMatchList();
}

function setGroup(g) {
  activeGroup = g;
  buildStageTabs();
  renderMatchList();
}

function renderMatchList() {
  let filtered = allMatches.filter(m => m.stage === activeStage || activeStage === 'All');
  if (activeStage === 'Group Stage' && activeGroup !== 'All') {
    filtered = filtered.filter(m => m.group_name === activeGroup);
  }
  const el = document.getElementById('matchList');
  el.innerHTML = filtered.length
    ? filtered.map(m => matchCard(m, true)).join('')
    : '<div class="empty"><span class="ei">⚽</span>No matches found.</div>';
}

// ── Match card renderer ───────────────────────────────────────────────────────
function matchCard(m, withPredict) {
  const open   = isOpen(m.match_time);
  const live   = m.status === 'live';
  const done   = m.status === 'finished';
  const locked = !open && !done;

  const stateClass = live ? 'live' : done ? 'done' : locked ? 'locked' : 'open';

  const scoreHtml = live
    ? `<div class="mc-score">
         <div class="mc-score-num">${m.home_score ?? 0}–${m.away_score ?? 0}</div>
         <div class="mc-score-lbl"><span class="live-badge"><span class="live-dot"></span>LIVE</span></div>
       </div>`
    : done
    ? `<div class="mc-score">
         <div class="mc-score-num">${m.home_score}–${m.away_score}</div>
         <div class="mc-score-lbl">Final</div>
       </div>`
    : `<div class="mc-score">
         <div class="mc-score-num" style="font-size:.85rem;color:var(--muted)">${fmtTime(m.match_time).split(',').slice(1).join(',').trim()}</div>
         <div class="mc-score-lbl">vs</div>
       </div>`;

  let predHtml = '';
  if (withPredict) {
    if (m.predicted_result) {
      const resLbl = resultLabel(m, m.predicted_result);
      const scoreLbl = m.predicted_home_score != null
        ? ` · ${m.predicted_home_score}–${m.predicted_away_score}` : '';
      if (done) {
        const pts = m.points_earned;
        if (pts === 5)
          predHtml = `<span class="pred-badge pb-exact">⭐ Exact score +5 pts</span>`;
        else if (pts === 3)
          predHtml = `<span class="pred-badge pb-correct">✅ Correct result +3 pts</span>`;
        else
          predHtml = `<span class="pred-badge pb-wrong">❌ Wrong prediction</span>`;
      } else {
        predHtml = `<span class="pred-badge pb-pending">🎯 ${esc(resLbl)}${esc(scoreLbl)}</span>`;
      }
    }

    let actionHtml = '';
    if (!currentUser) {
      actionHtml = `<span class="lock-note" onclick="nav('login')" style="cursor:pointer;color:var(--brand2)">🔐 Sign in to predict</span>`;
    } else if (done) {
      actionHtml = '';
    } else if (!open) {
      actionHtml = `<span class="lock-note">🔒 Locked</span>`;
    } else {
      actionHtml = `<button class="predict-btn" onclick="openPredModal(${m.id})">${m.predicted_result ? '✏️ Edit Pick' : '🎯 Predict'}</button>`;
    }

    predHtml = `<div class="mc-pred">${predHtml || '<span></span>'}${actionHtml}</div>`;
  }

  const grpLabel = m.group_name ? `Group ${m.group_name} · ` : '';
  const dateStr  = new Date(m.match_time).toLocaleString(undefined, {
    weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });

  return `<div class="match-card ${stateClass}" id="mc-${m.id}">
    <div class="mc-head">
      <span class="mc-stage">${esc(grpLabel + m.stage)}</span>
      <span>${esc(dateStr)}</span>
      <span class="mc-venue">${esc(m.venue)}</span>
    </div>
    <div class="mc-teams">
      <div class="mc-team">
        <span class="mc-flag">${m.home_flag}</span>
        <span class="mc-name">${esc(m.home_team)}</span>
      </div>
      ${scoreHtml}
      <div class="mc-team away">
        <span class="mc-flag">${m.away_flag}</span>
        <span class="mc-name">${esc(m.away_team)}</span>
      </div>
    </div>
    ${predHtml}
  </div>`;
}

// ── PREDICTION MODAL ──────────────────────────────────────────────────────────
let _predMatchId = null;
let _selResult   = null;

function openPredModal(matchId) {
  const m = allMatches.find(x => x.id === matchId);
  if (!m) return;
  _predMatchId = matchId;
  _selResult   = m.predicted_result || null;

  const existing = m.predicted_result;
  const exHS = m.predicted_home_score;
  const exAS = m.predicted_away_score;

  document.getElementById('predModalContent').innerHTML = `
    <div class="modal-match">
      <div class="modal-teams">
        <div class="modal-team"><div class="modal-flag">${m.home_flag}</div><div class="modal-name">${esc(m.home_team)}</div></div>
        <div class="modal-vs">vs</div>
        <div class="modal-team"><div class="modal-flag">${m.away_flag}</div><div class="modal-name">${esc(m.away_team)}</div></div>
      </div>
      <div class="modal-meta">📍 ${esc(m.venue)}<br/>🕐 ${fmtTime(m.match_time)}</div>
    </div>

    <div class="modal-err" id="predErr"></div>

    <div class="result-label">Step 1 — Pick a result *</div>
    <div class="result-btns">
      <button class="rb${existing==='home'?' sel-home':''}" id="rb-home" onclick="selResult('home')">
        ${m.home_flag}<br/>${esc(m.home_team)}<br/><small>Win</small>
      </button>
      <button class="rb${existing==='draw'?' sel-draw':''}" id="rb-draw" onclick="selResult('draw')">
        ⚖️<br/>Draw
      </button>
      <button class="rb${existing==='away'?' sel-away':''}" id="rb-away" onclick="selResult('away')">
        ${m.away_flag}<br/>${esc(m.away_team)}<br/><small>Win</small>
      </button>
    </div>

    <div class="score-label">Step 2 — Predict exact score <span class="gold">(+2 bonus)</span></div>
    <div class="score-hint">Optional but earns extra points if correct!</div>
    <div class="score-row">
      <span class="score-team-lbl">${esc(m.home_team)}</span>
      <input class="score-inp" type="number" min="0" max="20" id="hsInp"
        value="${exHS != null ? exHS : ''}" placeholder="—" oninput="syncResultFromScore()"/>
      <span class="score-sep">–</span>
      <input class="score-inp" type="number" min="0" max="20" id="asInp"
        value="${exAS != null ? exAS : ''}" placeholder="—" oninput="syncResultFromScore()"/>
      <span class="score-team-lbl right">${esc(m.away_team)}</span>
    </div>
    <button class="btn-red full" style="margin-top:.75rem" onclick="submitPred()">
      ${existing ? '✅ Update Prediction' : '🎯 Save Prediction'}
    </button>
    ${existing ? `<button class="btn-gray full" style="margin-top:.5rem" onclick="clearPred(${m.id})">Remove my prediction</button>` : ''}
  `;

  document.getElementById('predModal').classList.remove('hidden');
}

function closePredModal(e) {
  if (e && e.target !== document.getElementById('predModal')) return;
  document.getElementById('predModal').classList.add('hidden');
  _predMatchId = null;
}

function selResult(r) {
  _selResult = r;
  ['home','draw','away'].forEach(x => {
    const b = document.getElementById('rb-' + x);
    if (!b) return;
    b.className = 'rb' + (x === r ? ` sel-${x}` : '');
  });
  // If score is filled, check consistency
  const h = document.getElementById('hsInp')?.value;
  const a = document.getElementById('asInp')?.value;
  if (h !== '' && a !== '') {
    const hn = parseInt(h), an = parseInt(a);
    if (!isNaN(hn) && !isNaN(an)) {
      const imp = hn > an ? 'home' : an > hn ? 'away' : 'draw';
      if (imp !== r) {
        document.getElementById('hsInp').value = '';
        document.getElementById('asInp').value = '';
      }
    }
  }
}

function syncResultFromScore() {
  const h = parseInt(document.getElementById('hsInp').value);
  const a = parseInt(document.getElementById('asInp').value);
  if (!isNaN(h) && !isNaN(a)) {
    const r = h > a ? 'home' : a > h ? 'away' : 'draw';
    selResult(r);
  }
}

async function submitPred() {
  if (!_selResult) {
    showPredErr('Please select a result first (Step 1).');
    return;
  }
  const h = document.getElementById('hsInp').value;
  const a = document.getElementById('asInp').value;
  const hScore = h !== '' ? parseInt(h) : null;
  const aScore = a !== '' ? parseInt(a) : null;

  if ((hScore == null) !== (aScore == null)) {
    showPredErr('Enter both home and away score, or leave both empty.');
    return;
  }

  try {
    await api('/predictions', {
      method: 'POST',
      body: JSON.stringify({
        match_id:             _predMatchId,
        predicted_result:     _selResult,
        predicted_home_score: hScore,
        predicted_away_score: aScore,
      }),
    });
    toast('Prediction saved! 🎯');
    document.getElementById('predModal').classList.add('hidden');
    // refresh match data
    allMatches = await api('/matches');
    renderMatchList();
  } catch (e) {
    showPredErr(e.message);
  }
}

function showPredErr(msg) {
  const el = document.getElementById('predErr');
  el.textContent = msg;
  el.style.display = 'block';
}

async function clearPred(matchId) {
  if (!confirm('Remove your prediction for this match?')) return;
  // There's no DELETE endpoint — but we can re-submit with flag; simplest: just close
  toast('To remove a prediction, contact admin.', true);
  closePredModal();
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
async function renderLeaderboard() {
  const el = document.getElementById('lbCard');
  try {
    const board = await api('/predictions/leaderboard');
    if (!board.length) { el.innerHTML = '<div class="empty">No predictions yet.</div>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.innerHTML = `<div style="overflow-x:auto"><table class="lb-table">
      <thead><tr>
        <th>#</th><th>Player</th>
        <th style="text-align:right">Points</th>
        <th style="text-align:right">Predictions</th>
        <th style="text-align:right">Correct ✅</th>
        <th style="text-align:right">Exact 🎯</th>
      </tr></thead>
      <tbody>${board.map((p,i)=>`
        <tr class="${currentUser&&p.id===currentUser.id?'you':''}">
          <td class="rank-cell">${medals[i]||i+1}</td>
          <td>
            <strong>${esc(p.display_name)}</strong>${currentUser&&p.id===currentUser.id?' <span class="gold">(you)</span>':''}
            <div class="muted">@${esc(p.username)}</div>
          </td>
          <td class="pts-cell" style="text-align:right">${p.total_points}</td>
          <td style="text-align:right;color:var(--muted)">${p.total_predictions}</td>
          <td style="text-align:right;color:var(--green)">${p.correct_results}</td>
          <td style="text-align:right;color:var(--gold)">${p.exact_scores}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ── MY PICKS ──────────────────────────────────────────────────────────────────
async function renderMine() {
  if (!currentUser) { nav('login'); return; }
  const listEl  = document.getElementById('mineList');
  const statsEl = document.getElementById('mineStats');
  try {
    const rows = await api('/predictions/mine');
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">
        <span class="ei">🎯</span>
        No predictions yet.<br/>
        <button class="btn-red" style="margin-top:1rem" onclick="nav('matches')">Start Predicting</button>
      </div>`;
      statsEl.innerHTML = '';
      return;
    }

    const pts  = rows.reduce((s,r) => s + r.points_earned, 0);
    const corr = rows.filter(r => r.is_scored && r.points_earned >= 3).length;
    const exct = rows.filter(r => r.is_scored && r.points_earned === 5).length;
    statsEl.innerHTML = `
      <div class="stat"><span>${pts}</span><label>Total Points</label></div>
      <div class="stat"><span>${rows.length}</span><label>Predictions</label></div>
      <div class="stat"><span style="color:var(--green)">${corr}</span><label>Correct ✅</label></div>
      <div class="stat"><span style="color:var(--gold)">${exct}</span><label>Exact 🎯</label></div>`;

    listEl.innerHTML = rows.map(r => {
      const resLbl  = resultLabel(r, r.predicted_result);
      const scoreLbl= r.predicted_home_score != null
        ? `${r.predicted_home_score}–${r.predicted_away_score}` : '—';
      let resultHtml;
      if (r.status === 'finished') {
        if (r.points_earned === 5)
          resultHtml = `<span class="pred-badge pb-exact">⭐ Exact! +5 pts</span>`;
        else if (r.points_earned === 3)
          resultHtml = `<span class="pred-badge pb-correct">✅ Correct +3 pts</span>`;
        else
          resultHtml = `<span class="pred-badge pb-wrong">❌ Wrong — 0 pts</span>`;
      } else if (r.status === 'live') {
        resultHtml = `<span class="pred-badge pb-pending">⚽ In progress…</span>`;
      } else {
        resultHtml = `<span class="pred-badge pb-pending">⏳ Pending</span>`;
      }

      const finalScore = r.status === 'finished'
        ? `<strong>${r.home_score}–${r.away_score}</strong>` : '—';

      return `<div class="mine-card">
        <div>
          <div class="mine-teams">${r.home_flag} ${esc(r.home_team)} vs ${esc(r.away_team)} ${r.away_flag}</div>
          <div class="mine-meta">${fmtTime(r.match_time)} · ${esc(r.stage)}${r.group_name?' · Group '+r.group_name:''}</div>
          <div class="mine-pick">Your pick: <strong>${esc(resLbl)}</strong> · Score: <strong>${esc(scoreLbl)}</strong></div>
          ${r.status==='finished'?`<div class="mine-pick muted">Final: ${finalScore}</div>`:''}
        </div>
        <div>
          <div class="mine-pts">${r.status==='finished'?`<span class="${r.points_earned>=3?'gold':'red'}">${r.points_earned}</span> <small style="font-size:.7rem;font-weight:400">pts</small>`:'—'}</div>
          ${resultHtml}
        </div>
      </div>`;
    }).join('');
  } catch (e) { listEl.innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
async function renderAdmin() {
  if (!currentUser?.is_admin) { nav('home'); return; }
  try {
    const matches = await api('/matches');
    const stages  = [...new Set(matches.map(m => m.stage))];

    document.getElementById('adminStageTabs').innerHTML = stages.map(s =>
      `<button class="tab${s===adminStage?' active':''}" onclick="setAdminStage('${esc(s)}')">${esc(s)}</button>`
    ).join('');

    const filtered = matches.filter(m => m.stage === adminStage);
    document.getElementById('adminList').innerHTML = filtered.map(m => adminCard(m)).join('');
  } catch (e) {
    document.getElementById('adminList').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function setAdminStage(s) {
  adminStage = s;
  renderAdmin();
}

function adminCard(m) {
  const statusBadge = m.status === 'live'
    ? `<span class="live-badge"><span class="live-dot"></span>LIVE</span>`
    : m.status === 'finished'
    ? `<span style="color:var(--green);font-size:.75rem;font-weight:700">✅ FINISHED</span>`
    : `<span style="color:var(--muted);font-size:.75rem">UPCOMING</span>`;

  return `<div class="admin-card">
    <div class="mc-head">
      <span class="mc-stage">${esc(m.group_name ? 'Group '+m.group_name+' · ' : '')}${esc(m.stage)}</span>
      <span>${fmtTime(m.match_time)}</span>
      ${statusBadge}
    </div>
    <div class="mc-teams" style="padding:.5rem 1rem">
      <div class="mc-team">
        <span class="mc-flag">${m.home_flag}</span>
        <span class="mc-name">${esc(m.home_team)}</span>
      </div>
      <div class="mc-score">
        <div class="mc-score-num" style="font-size:1rem">${m.home_score??'—'}–${m.away_score??'—'}</div>
      </div>
      <div class="mc-team away">
        <span class="mc-flag">${m.away_flag}</span>
        <span class="mc-name">${esc(m.away_team)}</span>
      </div>
    </div>
    <div class="admin-actions">
      <input class="admin-score" type="number" min="0" max="20" id="ah-${m.id}"
        value="${m.home_score??''}" placeholder="H"/>
      <span style="color:var(--muted)">–</span>
      <input class="admin-score" type="number" min="0" max="20" id="aa-${m.id}"
        value="${m.away_score??''}" placeholder="A"/>
      <button class="btn-orange btn-sm" onclick="adminSetLive(${m.id})">📡 Set Live</button>
      <button class="btn-green btn-sm"  onclick="adminFinish(${m.id})">✅ Final Result</button>
      ${m.status!=='upcoming'?`<button class="btn-gray btn-sm" onclick="adminReset(${m.id})">↩ Reset</button>`:''}
    </div>
  </div>`;
}

async function adminSetLive(id) {
  const h = document.getElementById('ah-'+id)?.value;
  const a = document.getElementById('aa-'+id)?.value;
  try {
    await api('/matches/'+id+'/live', {
      method:'PATCH',
      body: JSON.stringify({
        home_score: h !== '' ? parseInt(h) : null,
        away_score: a !== '' ? parseInt(a) : null,
      })
    });
    toast('Match is now LIVE 📡');
    renderAdmin();
  } catch (e) { toast(e.message, true); }
}

async function adminFinish(id) {
  const h = parseInt(document.getElementById('ah-'+id)?.value);
  const a = parseInt(document.getElementById('aa-'+id)?.value);
  if (isNaN(h) || isNaN(a)) { toast('Enter both scores first.', true); return; }
  try {
    const r = await api('/matches/'+id+'/result', {
      method:'PATCH',
      body: JSON.stringify({ home_score: h, away_score: a })
    });
    toast(`✅ Result saved — ${r.scored} prediction(s) scored!`);
    renderAdmin();
  } catch (e) { toast(e.message, true); }
}

async function adminReset(id) {
  if (!confirm('Reset this match to upcoming? Prediction scores will be cleared.')) return;
  try {
    await api('/matches/'+id+'/reset', { method:'PATCH' });
    toast('Match reset to upcoming.');
    renderAdmin();
  } catch (e) { toast(e.message, true); }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('liUser').value.trim();
  const password = document.getElementById('liPass').value;
  const errEl    = document.getElementById('loginErr');
  errEl.classList.add('hidden');
  try {
    const d = await api('/auth/login', { method:'POST', body: JSON.stringify({ username, password }) });
    setAuth(d.token, d.user);
    updateNav();
    toast('Welcome back, ' + d.user.display_name + '! 👋');
    nav('matches');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function doRegister() {
  const display_name = document.getElementById('regName').value.trim();
  const username     = document.getElementById('regUser').value.trim();
  const email        = document.getElementById('regEmail').value.trim();
  const password     = document.getElementById('regPass').value;
  const errEl        = document.getElementById('regErr');
  errEl.classList.add('hidden');
  try {
    const d = await api('/auth/register', { method:'POST', body: JSON.stringify({ display_name, username, email, password }) });
    setAuth(d.token, d.user);
    updateNav();
    toast('Account created! Welcome ' + d.user.display_name + '! ⚽');
    nav('matches');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

function doLogout() {
  clearAuth();
  updateNav();
  nav('home');
  toast('Logged out.');
}

// Enter key support on auth forms
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('v-login').classList.contains('hidden'))    doLogin();
  if (!document.getElementById('v-register').classList.contains('hidden')) doRegister();
  if (!document.getElementById('predModal').classList.contains('hidden'))  submitPred();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAuth();
updateNav();
initSSE();
nav('home');
