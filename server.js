const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4002;
const DB = Database(path.join(__dirname, 'calory.db'));
const DATA_DIR = path.join(__dirname, 'data');
const JWT_SECRET_FILE = path.join(DATA_DIR, 'jwt_secret.txt');

// ==================== JWT SECRET ====================

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
    }
  } catch {}
  const secret = 'calory-secret-change-in-production-' + uuidv4();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JWT_SECRET_FILE, secret);
  return secret;
}

const JWT_SECRET = getJwtSecret();

// ==================== DB INIT ====================

function initDb() {
  DB.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );
  `);

  const userCount = DB.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount.c === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    DB.prepare('INSERT INTO users (user_id, username, password, role) VALUES (?, ?, ?, ?)').run(
      uuidv4(), 'admin', hash, 'admin'
    );
  }

  DB.exec(`
    CREATE TABLE IF NOT EXISTS days (
      date TEXT NOT NULL,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      kcal REAL DEFAULT 0,
      protein REAL DEFAULT 0,
      fat REAL DEFAULT 0,
      carbs_total REAL DEFAULT 0,
      fiber REAL DEFAULT 0,
      net_carbs REAL DEFAULT 0,
      PRIMARY KEY (date, user_id)
    );
  `);

  DB.exec(`
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      grams INTEGER DEFAULT 0,
      kcal REAL DEFAULT 0,
      protein REAL DEFAULT 0,
      fat REAL DEFAULT 0,
      carbs_total REAL DEFAULT 0,
      fiber REAL DEFAULT 0,
      net_carbs REAL DEFAULT 0,
      FOREIGN KEY (date, user_id) REFERENCES days(date, user_id)
    );
  `);
}

initDb();

// ==================== MIDDLEWARE ====================

app.use(express.json());

function getUser(username) {
  return DB.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== PUBLIC ROUTES ====================

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'calory', auth: true }));

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });

  const existing = getUser(username);
  if (existing) return res.status(409).json({ error: 'username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const user = { user_id: uuidv4(), username, password: hash, role: 'user' };
  DB.prepare('INSERT INTO users (user_id, username, password, role) VALUES (?, ?, ?, ?)').run(
    user.user_id, user.username, user.password, user.role
  );

  const token = jwt.sign({ id: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: { id: user.user_id, username: user.username, role: user.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = getUser(username);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'invalid credentials' });

  const token = jwt.sign({ id: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.user_id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

// ==================== STATIC FILES ====================

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/login', (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'dist', 'login.html'), 'utf8'));
});

// ==================== API ROUTES ====================

app.get('/api/days', requireAuth, (req, res) => {
  const rows = DB.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM meals m WHERE m.date = d.date AND m.user_id = d.user_id AND m.grams > 0) AS item_count
    FROM days d WHERE d.user_id = ?
    ORDER BY d.date ASC
  `).all(req.user.id);
  res.json(rows);
});

app.get('/api/days/:date', requireAuth, (req, res) => {
  const row = DB.prepare('SELECT * FROM days WHERE date = ? AND user_id = ?').get(req.params.date, req.user.id);
  res.json(row || {});
});

app.post('/api/days', requireAuth, (req, res) => {
  const { date, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  DB.prepare(`
    INSERT OR REPLACE INTO days (date, user_id, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@date, @user_id, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `).run({ date, user_id: req.user.id, kcal, protein, fat, carbs_total: carbs_total || 0, fiber, net_carbs: net_carbs || 0 });
  res.json({ ok: true });
});

app.get('/api/meals/:date', requireAuth, (req, res) => {
  const meals = DB.prepare('SELECT * FROM meals WHERE date = ? AND user_id = ? ORDER BY id ASC').all(req.params.date, req.user.id);
  res.json(meals);
});

app.post('/api/meals', requireAuth, (req, res) => {
  const { date, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  DB.prepare(`
    INSERT INTO meals (date, user_id, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@date, @user_id, @name, @grams, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `).run({ date, user_id: req.user.id, name, grams, kcal, protein, fat, carbs_total: carbs_total || 0, fiber: fiber || 0, net_carbs: net_carbs || 0 });

  const totals = DB.prepare(`
    SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
           COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
    FROM meals WHERE date = @date AND user_id = @user_id
  `).get({ date, user_id: req.user.id });

  DB.prepare('INSERT OR REPLACE INTO days (date, user_id, kcal, protein, fat, net_carbs) VALUES (@date, @user_id, @kcal, @protein, @fat, @net_carbs)').run({
    date, user_id: req.user.id,
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
  });

  res.json({ ok: true });
});

app.put('/api/meals/:id', requireAuth, (req, res) => {
  const { name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = DB.prepare('SELECT * FROM meals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'meal not found' });

  DB.prepare(`
    UPDATE meals SET name=@name, grams=@grams, kcal=@kcal, protein=@protein, fat=@fat,
      carbs_total=@carbs_total, fiber=@fiber, net_carbs=@net_carbs
    WHERE id = ? AND user_id = ?
  `).run({ name, grams, kcal, protein, fat, carbs_total: carbs_total || 0, fiber: fiber || 0, net_carbs: net_carbs || 0 },
    req.params.id, req.user.id);

  const totals = DB.prepare(`
    SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
           COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
    FROM meals WHERE date = ? AND user_id = ?
  `).get(existing.date, req.user.id);

  DB.prepare('INSERT OR REPLACE INTO days (date, user_id, kcal, protein, fat, net_carbs) VALUES (@date, @user_id, @kcal, @protein, @fat, @net_carbs)').run({
    date: existing.date, user_id: req.user.id,
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
  });

  res.json({ ok: true });
});

app.delete('/api/meals/:id', requireAuth, (req, res) => {
  const meal = DB.prepare('SELECT * FROM meals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (meal) {
    DB.prepare('DELETE FROM meals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    const totals = DB.prepare(`
      SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
             COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
      FROM meals WHERE date = ? AND user_id = ?
    `).get(meal.date, req.user.id);
    DB.prepare('INSERT OR REPLACE INTO days (date, user_id, kcal, protein, fat, net_carbs) VALUES (@date, @user_id, @kcal, @protein, @fat, @net_carbs)').run({
      date: meal.date, user_id: req.user.id,
      kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
    });
  }
  res.json({ ok: true });
});

app.get('/api/stats', requireAuth, (req, res) => {
    const last7 = DB.prepare("SELECT * FROM days WHERE user_id = ? AND kcal > 0 AND date < date('now') ORDER BY date DESC LIMIT 7").all(req.user.id);

  let rollingAvg = 0;
  let rollingAvgNetCarbs = 0;
  let rollingAvgProtein = 0;
  if (last7.length > 0) {
    rollingAvg = Math.round(last7.reduce((s, d) => s + (d.kcal || 0), 0) / last7.length * 10) / 10;
    rollingAvgNetCarbs = Math.round(last7.reduce((s, d) => s + (d.net_carbs || 0), 0) / last7.length * 10) / 10;
    rollingAvgProtein = Math.round(last7.reduce((s, d) => s + (d.protein || 0), 0) / last7.length * 10) / 10;
  }

  res.json({
    rollingAvg,
    rollingAvgNetCarbs,
    rollingAvgProtein,
    daysLogged: last7.length,
    recentDays: last7,
  });
});

// ==================== SPA CATCH-ALL ====================

app.use((req, res, next) => {
  const auth = req.headers.authorization;
  const hasValidToken = auth && auth.startsWith('Bearer ') && (() => {
    try { jwt.verify(auth.slice(7), JWT_SECRET); return true; } catch { return false; }
  })();

  if (hasValidToken) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'dist', 'login.html'));
  }
});

// ==================== START ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Calory running on http://0.0.0.0:${PORT}`);
});
