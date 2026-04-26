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
const JWT_SECRET = process.env.JWT_SECRET || 'calory-secret-change-in-production-' + uuidv4();
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// ==================== MIDDLEWARE ====================

app.use(express.json());

// ==================== AUTH HELPERS ====================

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function saveUsers(users) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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

function ensureUsersExist() {
  const users = loadUsers();
  if (!users.length) {
    const hash = bcrypt.hashSync('admin', 10);
    users.push({ id: uuidv4(), username: 'admin', password: hash, role: 'admin' });
    saveUsers(users);
  }
}
ensureUsersExist();

// ==================== PUBLIC ROUTES ====================

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'calory', auth: true }));

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'username already taken' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hash, role: 'user' };
  users.push(user);
  saveUsers(users);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'invalid credentials' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

// ==================== STATIC FILES ====================

app.use(express.static(path.join(__dirname, 'dist')));

// Login page
app.get('/login', (req, res) => {
  const fp = path.join(__dirname, 'dist', 'login.html');
  const html = fs.readFileSync(fp, 'utf8');
  res.type('html').send(html);
});

// ==================== API ROUTES ====================

app.get('/api/days', requireAuth, (req, res) => {
  const rows = DB.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM meals m WHERE m.day_num = d.day_num AND m.grams > 0) AS item_count
    FROM days d ORDER BY d.day_num ASC
  `).all();
  res.json(rows);
});

app.get('/api/days/:num', requireAuth, (req, res) => {
  const row = DB.prepare('SELECT * FROM days WHERE day_num = ?').get(req.params.num);
  res.json(row || {});
});

app.post('/api/days', requireAuth, (req, res) => {
  const { day_num, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  const stmt = DB.prepare(`
    INSERT OR REPLACE INTO days (day_num, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@day_num, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `);
  stmt.run({ day_num, kcal, protein, fat, carbs_total: carbs_total || 0, fiber, net_carbs: net_carbs || 0 });
  res.json({ ok: true });
});

app.get('/api/meals/:day', requireAuth, (req, res) => {
  const meals = DB.prepare('SELECT * FROM meals WHERE day_num = ? ORDER BY id ASC').all(req.params.day);
  res.json(meals);
});

app.post('/api/meals', requireAuth, (req, res) => {
  const { day_num, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  const stmt = DB.prepare(`
    INSERT INTO meals (day_num, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@day_num, @name, @grams, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `);
  stmt.run({ day_num, name, grams, kcal, protein, fat, carbs_total: carbs_total || 0, fiber: fiber || 0, net_carbs: net_carbs || 0 });

  const totals = DB.prepare(`
    SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
           COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
    FROM meals WHERE day_num = @day_num
  `).get({ day_num });

  DB.prepare('INSERT OR REPLACE INTO days (day_num, kcal, protein, fat, net_carbs) VALUES (@day_num, @kcal, @protein, @fat, @net_carbs)').run({
    day_num, kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
  });

  res.json({ ok: true });
});

app.delete('/api/meals/:id', requireAuth, (req, res) => {
  DB.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const last7 = DB.prepare(`
    SELECT * FROM days WHERE kcal > 0 ORDER BY day_num DESC LIMIT 7
  `).all();

  let rollingAvg = 0;
  if (last7.length > 0) {
    const avg = last7.reduce((s, d) => s + (d.kcal || 0), 0) / last7.length;
    rollingAvg = Math.round(avg * 10) / 10;
  }

  const totalKcal = last7.reduce((s, d) => s + (d.kcal || 0), 0);
  const totalProtein = last7.reduce((s, d) => s + (d.protein || 0), 0);
  const totalFat = last7.reduce((s, d) => s + (d.fat || 0), 0);

  res.json({
    rollingAvg,
    daysLogged: last7.length,
    totalKcal,
    totalProtein,
    totalFat,
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
