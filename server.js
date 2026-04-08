const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));

// Serve SPA for any unmatched GET
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚽  FIFA WC 2026 Predictor running → http://localhost:${PORT}`);
});
