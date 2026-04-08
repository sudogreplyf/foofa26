const express = require('express');
const cors    = require('cors');
const path    = require('path');
const sse     = require('./lib/sse');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE endpoint: browsers subscribe here for live match updates ──────────────
app.get('/api/live-stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering on Render
  res.flushHeaders();

  // Send initial ping so client knows it connected
  res.write('event: connected\ndata: {"ok":true}\n\n');

  // Heartbeat every 25 s to keep proxy connections alive
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 25_000);

  sse.register(res);
  req.on('close', () => { clearInterval(hb); sse.unregister(res); });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`⚽  FIFA WC 2026 Predictor → http://localhost:${PORT}`)
);
