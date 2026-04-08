const express = require('express');
const cors = require('cors');
const path = require('path');

const { syncMatchesFromOpenLigaDb } = require('./routes/matches');
const pkg = require('./package.json');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));
app.get('/api/meta', (_req, res) => {
  res.json({
    app: pkg.name,
    version: process.env.RELEASE_VERSION || pkg.version,
    deployed_at: process.env.RELEASE_DATE || new Date().toISOString()
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`⚽ FIFA WC Predictor running → http://localhost:${PORT}`);

  try {
    const result = await syncMatchesFromOpenLigaDb({ initiatedBy: 'startup' });
    console.log(`✅ External sync complete (${result.upserts} upserts, ${result.rescoredPredictions} rescored).`);
  } catch (e) {
    console.warn(`⚠️ Startup sync skipped: ${e.message}`);
  }

  const syncMs = Number(process.env.EXTERNAL_SYNC_INTERVAL_MS || 120000);
  setInterval(async () => {
    try {
      await syncMatchesFromOpenLigaDb({ initiatedBy: 'interval' });
    } catch (e) {
      console.warn(`⚠️ Interval sync failed: ${e.message}`);
    }
  }, syncMs);
});
