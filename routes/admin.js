// Admin-only lists of batches, time slots and users. Each page adds, edits and deletes in place.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { requireRole } = require('../src/auth');

router.use(requireRole('admin'));

// Runs a write and turns duplicate / still-in-use errors into a friendly flash message
async function save(req, res, page, okMessage, sql, params) {
  try {
    await db.query(sql, params);
    req.session.flash = okMessage;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') req.session.flash = 'That name already exists.';
    else if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') req.session.flash = 'Check the values: numbers must be above 0 and end after start.';
    else throw err;
  }
  res.redirect(`/admin/${page}`);
}

const invalid = (req, res, page, message) => {
  req.session.flash = message;
  res.redirect(`/admin/${page}`);
};

// ---- Overview: what needs the admin's attention ----
router.get('/', async (req, res) => {
  const [[counts]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM halls) AS halls, (SELECT COUNT(*) FROM batches) AS batches,
            (SELECT COUNT(*) FROM timetable_entries) AS lectures,
            (SELECT COUNT(*) FROM timetable_entries WHERE hall_id IS NULL) AS unplaced,
            (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending`);
  const [pending] = await db.query(
    `SELECT bk.id, bk.start_at, bk.end_at, bk.purpose, bk.ai_reason, bk.letter_file, h.id AS hall_id, h.short_code, u.society
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id JOIN users u ON u.id = bk.booked_by
     WHERE bk.status = 'pending' ORDER BY bk.start_at LIMIT 10`);
  const [upcoming] = await db.query(
    `SELECT bk.start_at, bk.end_at, bk.purpose, h.id AS hall_id, h.short_code
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id
     WHERE bk.status = 'approved' AND bk.end_at >= NOW() ORDER BY bk.start_at LIMIT 6`);
  res.render('admin/overview', { title: 'Overview', counts, pending, upcoming });
});

// ---- Batches ----
router.get('/batches', async (req, res) => {
  const [batches] = await db.query('SELECT * FROM batches ORDER BY name');
  res.render('admin/batches', { title: 'Batches', batches });
});

function batchValues(req) {
  const name = String(req.body.name || '').trim();
  const count = Number(req.body.student_count);
  return name && Number.isInteger(count) && count > 0 ? [name, count] : null;
}

router.post('/batches', (req, res) => {
  const values = batchValues(req);
  if (!values) return invalid(req, res, 'batches', 'Enter a batch name and a student count above 0.');
  return save(req, res, 'batches', 'Batch added.', 'INSERT INTO batches (name, student_count) VALUES (?, ?)', values);
});

router.post('/batches/:id', (req, res) => {
  const values = batchValues(req);
  if (!values) return invalid(req, res, 'batches', 'Enter a batch name and a student count above 0.');
  return save(req, res, 'batches', 'Batch updated.', 'UPDATE batches SET name = ?, student_count = ? WHERE id = ?', [...values, req.params.id]);
});

router.post('/batches/:id/delete', (req, res) => save(req, res, 'batches', 'Batch deleted with its timetable.', 'DELETE FROM batches WHERE id = ?', [req.params.id]));

// ---- Time slots ----
router.get('/slots', async (req, res) => {
  const [slots] = await db.query('SELECT * FROM time_slots ORDER BY start_time');
  res.render('admin/slots', { title: 'Time slots', slots });
});

function slotValues(req) {
  const { start_time: start, end_time: end } = req.body;
  const ok = /^\d{2}:\d{2}$/.test(start || '') && /^\d{2}:\d{2}$/.test(end || '') && end > start;
  return ok ? [`${start}-${end}`, start, end] : null;
}

router.post('/slots', (req, res) => {
  const values = slotValues(req);
  if (!values) return invalid(req, res, 'slots', 'Enter a start and end time, with end after start.');
  return save(req, res, 'slots', 'Slot added.', 'INSERT INTO time_slots (label, start_time, end_time) VALUES (?, ?, ?)', values);
});

router.post('/slots/:id', (req, res) => {
  const values = slotValues(req);
  if (!values) return invalid(req, res, 'slots', 'Enter a start and end time, with end after start.');
  return save(req, res, 'slots', 'Slot updated.', 'UPDATE time_slots SET label = ?, start_time = ?, end_time = ? WHERE id = ?', [...values, req.params.id]);
});

router.post('/slots/:id/delete', (req, res) => save(req, res, 'slots', 'Slot deleted with its lectures.', 'DELETE FROM time_slots WHERE id = ?', [req.params.id]));

// ---- Users ----
router.get('/users', async (req, res) => {
  const [users] = await db.query('SELECT u.*, b.name AS batch FROM users u LEFT JOIN batches b ON b.id = u.batch_id ORDER BY u.role, u.name');
  const [batches] = await db.query('SELECT * FROM batches ORDER BY name');
  res.render('admin/users', { title: 'Users', users, batches });
});

// Returns [name, email, role, batch_id, society] or an error message
function userValues(req) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role;
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return 'Enter a name and a valid email.';
  if (!['admin', 'rep', 'president'].includes(role)) return 'Pick a role.';
  if (role === 'rep' && !Number(req.body.batch_id)) return 'A rep needs a batch.';
  if (role === 'president' && !String(req.body.society || '').trim()) return 'A president needs a society name.';
  return [name, email, role, role === 'rep' ? Number(req.body.batch_id) : null, role === 'president' ? req.body.society.trim() : null];
}

router.post('/users', async (req, res) => {
  const values = userValues(req);
  if (typeof values === 'string') return invalid(req, res, 'users', values);
  if (String(req.body.password || '').length < 8) return invalid(req, res, 'users', 'Password must be at least 8 characters.');
  const hash = await bcrypt.hash(req.body.password, 10);
  return save(req, res, 'users', 'User added.',
    'INSERT INTO users (name, email, role, batch_id, society, password_hash) VALUES (?, ?, ?, ?, ?, ?)', [...values, hash]);
});

router.post('/users/:id', async (req, res) => {
  const values = userValues(req);
  if (typeof values === 'string') return invalid(req, res, 'users', values);
  const password = String(req.body.password || '');
  if (password && password.length < 8) return invalid(req, res, 'users', 'Password must be at least 8 characters.');
  const hash = password ? await bcrypt.hash(password, 10) : null; // blank = keep the old password
  return save(req, res, 'users', 'User updated.',
    'UPDATE users SET name = ?, email = ?, role = ?, batch_id = ?, society = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?',
    [...values, hash, req.params.id]);
});

router.post('/users/:id/delete', (req, res) => {
  if (Number(req.params.id) === req.session.user.id) return invalid(req, res, 'users', 'You cannot delete your own account.');
  return save(req, res, 'users', 'User deleted with their bookings.', 'DELETE FROM users WHERE id = ?', [req.params.id]);
});

module.exports = router;
