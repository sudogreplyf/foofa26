const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { getDb } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'wc2026-predictor-secret-key';

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, email, display_name, password } = req.body;

  if (!username || !email || !display_name || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const db = await getDb();
    const existing = await db.get(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      username, email
    );
    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
      username.trim(), email.trim().toLowerCase(), display_name.trim(), hash
    );

    const token = jwt.sign(
      { id: result.lastID, username: username.trim(), display_name: display_name.trim(), is_admin: 0 },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: result.lastID, username, display_name, is_admin: 0 } });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', username.trim());

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin } });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided.' });

  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = router;
module.exports.authenticate = authenticate;
module.exports.JWT_SECRET   = JWT_SECRET;
