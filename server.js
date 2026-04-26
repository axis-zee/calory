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

function ensurePasswordUpdatedAt() {
  const users = loadUsers();
  let changed = false;
  for (const u of users) {
    if (!u.passwordUpdatedAt) {
      u.passwordUpdatedAt = u.createdAt || new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveUsers(users);
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

    // Check if password was changed after token was issued
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    if (user && new Date(user.passwordUpdatedAt) > new Date(decoded.iat * 1000)) {
      return res.status(401).json({ error: 'session expired', reauth: true });
    }

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
ensurePasswordUpdatedAt();

// ==================== HELPERS ====================
function dayNumToDate(dn) {
  const start = new Date('2026-02-19T00:00:00Z');
  const offset = (dn - 1) * 86400000;
  return new Date(start.getTime() + offset).toISOString().split('T')[0];
}

function dateToDayNum(d) {
  const start = new Date('2026-02-19T00:00:00Z');
  const target = new Date(d + 'T00:00:00Z');
  return Math.round((target - start) / 86400000) + 1;
}

// ==================== SCHEMA MIGRATION ====================
const schemaMigrated = DB.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='schema_migration'").get().c > 0;
if (!schemaMigrated) {
  // Create v2 tables with composite PK (day_num, user_id)
  DB.exec(`
    CREATE TABLE _days_v2 (
      day_num INTEGER,
      user_id TEXT,
      kcal REAL, protein REAL, fat REAL,
      carbs_total REAL, fiber REAL, net_carbs REAL,
      PRIMARY KEY (day_num, user_id)
    )
  `);
  DB.exec(`
    CREATE TABLE _meals_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_num INTEGER,
      user_id TEXT,
      name TEXT, grams INTEGER,
      kcal REAL, protein REAL, fat REAL,
      carbs_total REAL, fiber REAL, net_carbs REAL
    )
  `);

  // Only migrate if v2 has no data
  const v2Count = DB.prepare("SELECT count(*) as c FROM _meals_v2").get().c;
  if (v2Count === 0) {
    const adminUser = loadUsers().find(u => u.role === 'admin') || loadUsers()[0];
    const uid = adminUser.id;
    DB.prepare("INSERT INTO _days_v2 (day_num, user_id, kcal, protein, fat, carbs_total, fiber, net_carbs) SELECT day_num, @uid, kcal, protein, fat, carbs_total, fiber, net_carbs FROM days").run({ uid });
    DB.prepare("INSERT INTO _meals_v2 (day_num, user_id, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs) SELECT day_num, @uid, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs FROM meals").run({ uid });
    DB.exec("DROP TABLE meals");
    DB.exec("DROP TABLE days");
    DB.exec("ALTER TABLE _meals_v2 RENAME TO meals");
    DB.exec("ALTER TABLE _days_v2 RENAME TO days");
    DB.exec("INSERT INTO schema_migration VALUES ('user_id', '2026-04-26')");
    console.log('Schema migrated: added user_id, tagged existing data with admin');
  } else {
    DB.exec("DROP TABLE IF EXISTS _days_v2");
    DB.exec("DROP TABLE IF EXISTS _meals_v2");
  }
}

// Add date column if missing
try { DB.exec("ALTER TABLE days ADD COLUMN date TEXT"); } catch {}
const dateColExists = DB.prepare("SELECT count(*) as c FROM pragma_table_info('days') WHERE name='date'").get().c;
if (dateColExists === 0) {
  DB.exec("ALTER TABLE days ADD COLUMN date TEXT");
}
// Populate dates for days without them
const unassignedCount = DB.prepare("SELECT count(*) as c FROM days WHERE date IS NULL").get().c;
if (unassignedCount > 0) {
  const unassigned = DB.prepare("SELECT day_num FROM days WHERE date IS NULL").all();
  for (const row of unassigned) {
    const d = dayNumToDate(row.day_num);
    DB.prepare("UPDATE days SET date = @d WHERE day_num = @dn AND user_id = @uid").run({ d, dn: row.day_num, uid: 'admin' });
  }
  // Also set dates for existing meals if needed
  DB.exec("ALTER TABLE meals ADD COLUMN date TEXT").catch(() => {});
}
console.log('Date column ready');

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
  const now = new Date().toISOString();
  const user = { id: uuidv4(), username, password: hash, role: 'user', passwordUpdatedAt: now };
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

app.put('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'current and new password required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'password must be at least 4 characters' });
  }

  const users = loadUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(401).json({ error: 'invalid current password' });

  const now = new Date().toISOString();
  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordUpdatedAt = now;
  saveUsers(users);

  const newToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET, { expiresIn: '30d' }
  );

  res.json({ ok: true, token: newToken });
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

// ==================== HELPERS ====================

function dayNumToDate(dn) {
  const start = new Date('2026-02-19T00:00:00Z');
  const ms = (dn - 1) * 86400000;
  return new Date(start.getTime() + ms).toISOString().split('T')[0];
}

function dateToDayNum(d) {
  const start = new Date('2026-02-19T00:00:00Z');
  const ms = new Date(d + 'T00:00:00Z') - start;
  return Math.round(ms / 86400000) + 1;
}

function populateDates(rows) {
  return rows.map(r => ({ ...r, date: r.date || dayNumToDate(r.day_num) }));
}

// ==================== API ROUTES ====================

app.get('/api/days', requireAuth, (req, res) => {
  const rows = DB.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM meals m WHERE m.day_num = d.day_num AND m.user_id = d.user_id AND m.grams > 0) AS item_count
    FROM days d WHERE d.user_id = @uid ORDER BY d.day_num ASC
  `).all({ uid: req.user.id });
  res.json(populateDates(rows));
});

app.get('/api/days/:num', requireAuth, (req, res) => {
  // Accept both day_num (int) and date (string)
  const val = parseInt(req.params.num);
  const row = val > 0
    ? DB.prepare('SELECT * FROM days WHERE day_num = ? AND user_id = ?').get(val, req.user.id)
    : DB.prepare('SELECT * FROM days WHERE date = ? AND user_id = ?').get(req.params.num, req.user.id);
  res.json(populateDates([row || {}])[0] || {});
});

app.post('/api/days', requireAuth, (req, res) => {
  const { day_num, date: dateStr, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  const dn = day_num || (dateStr ? dateToDayNum(dateStr) : null);
  if (!dn) return res.status(400).json({ error: 'day_num or date required' });
  const d = dayNumToDate(dn);
  const stmt = DB.prepare(`
    INSERT OR REPLACE INTO days (day_num, user_id, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@day_num, @uid, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `);
  stmt.run({ uid: req.user.id, day_num: dn, kcal, protein, fat, carbs_total: carbs_total || 0, fiber, net_carbs: net_carbs || 0 });
  DB.prepare('UPDATE days SET date = @d WHERE day_num = @dn AND user_id = @uid').run({ d, dn, uid: req.user.id });
  res.json({ ok: true });
});

app.get('/api/meals/:day', requireAuth, (req, res) => {
  // Accept both day_num and date
  const val = parseInt(req.params.day);
  const dayNum = val > 0 ? val : dateToDayNum(req.params.day);
  const meals = DB.prepare('SELECT * FROM meals WHERE day_num = ? AND user_id = ? ORDER BY id ASC').all(dayNum, req.user.id);
  res.json(meals);
});

app.post('/api/meals', requireAuth, (req, res) => {
  const { day_num, date: dateStr, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs } = req.body;
  const uid = req.user.id;
  const dn = day_num || (dateStr ? dateToDayNum(dateStr) : null);
  if (!dn) return res.status(400).json({ error: 'day_num or date required' });
  const d = dayNumToDate(dn);
  const stmt = DB.prepare(`
    INSERT INTO meals (day_num, user_id, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs)
    VALUES (@day_num, @uid, @name, @grams, @kcal, @protein, @fat, @carbs_total, @fiber, @net_carbs)
  `);
  stmt.run({ uid, day_num: dn, name, grams, kcal, protein, fat, carbs_total: carbs_total || 0, fiber: fiber || 0, net_carbs: net_carbs || 0 });

  const totals = DB.prepare(`
    SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
           COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
    FROM meals WHERE day_num = @day_num AND user_id = @uid
  `).get({ day_num: dn, uid });

  DB.prepare('INSERT OR REPLACE INTO days (day_num, user_id, kcal, protein, fat, net_carbs) VALUES (@day_num, @uid, @kcal, @protein, @fat, @net_carbs)').run({
    uid, day_num: dn, kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
  });
  DB.prepare('UPDATE days SET date = @d WHERE day_num = @dn AND user_id = @uid').run({ d, dn, uid });

  res.json({ ok: true });
});

app.delete('/api/meals/:id', requireAuth, (req, res) => {
  const row = DB.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  const dayNum = row.day_num;
  DB.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);

  // Update day totals after deletion
  const totals = DB.prepare(`
    SELECT COALESCE(SUM(kcal), 0) as kcal, COALESCE(SUM(protein), 0) as protein,
           COALESCE(SUM(fat), 0) as fat, COALESCE(SUM(net_carbs), 0) as net_carbs
    FROM meals WHERE day_num = @day_num AND user_id = @uid
  `).get({ day_num: dayNum, uid: req.user.id });

  DB.prepare('INSERT OR REPLACE INTO days (day_num, user_id, kcal, protein, fat, net_carbs) VALUES (@day_num, @uid, @kcal, @protein, @fat, @net_carbs)').run({
    uid: req.user.id, day_num: dayNum, kcal: totals.kcal, protein: totals.protein, fat: totals.fat, net_carbs: totals.net_carbs
  });

  res.json({ ok: true });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const last7 = DB.prepare(`
    SELECT * FROM days WHERE user_id = @uid AND kcal > 0 ORDER BY day_num DESC LIMIT 7
  `).all({ uid: req.user.id });

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
