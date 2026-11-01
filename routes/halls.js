// Halls: anyone can browse; only the admin can add, edit or delete.
const router = require('express').Router();
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { makeUpload } = require('../src/upload');

const upload = makeUpload('uploads/photos', ['image/jpeg', 'image/png']);

// Returns a list of problems with the submitted hall form (empty when valid)
function validateHall(b) {
  const errors = [];
  for (const field of ['name', 'short_code', 'building', 'floor']) {
    if (!String(b[field] || '').trim()) errors.push(`${field.replace('_', ' ')} is required.`);
  }
  if (!Number.isInteger(Number(b.capacity)) || Number(b.capacity) < 1) errors.push('Capacity must be a whole number above 0.');
  return errors;
}

const hallValues = (b) => [b.name.trim(), b.short_code.trim().toUpperCase(), b.building.trim(), b.floor.trim(), Number(b.capacity), (b.directions || '').trim() || null];

router.get('/', async (req, res) => {
  const sorts = { name: 'name', capacity: 'capacity DESC', building: 'building, name' };
  const sort = sorts[req.query.sort] || 'name';
  const q = `%${req.query.q || ''}%`;
  const [halls] = await db.query(
    `SELECT * FROM halls WHERE (name LIKE ? OR short_code LIKE ? OR building LIKE ?) AND capacity >= ? ORDER BY ${sort}`,
    [q, q, q, Number(req.query.min) || 0]);
  res.render('halls/list', { title: 'Halls', halls });
});

router.get('/new', requireRole('admin'), (req, res) => {
  res.render('halls/form', { title: 'Add hall', hall: {}, errors: [] });
});

router.post('/', requireRole('admin'), upload.single('photo'), async (req, res) => {
  const errors = validateHall(req.body);
  if (errors.length) return res.status(400).render('halls/form', { title: 'Add hall', hall: req.body, errors });
  try {
    await db.query(
      'INSERT INTO halls (name, short_code, building, floor, capacity, directions, photo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [...hallValues(req.body), req.file?.filename || null]);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    return res.status(400).render('halls/form', { title: 'Add hall', hall: req.body, errors: ['A hall with that name or short code already exists.'] });
  }
  req.session.flash = 'Hall added.';
  res.redirect('/halls');
});

router.get('/:id', async (req, res) => {
  const [[hall]] = await db.query('SELECT * FROM halls WHERE id = ?', [req.params.id]);
  if (!hall) return res.status(404).render('error', { title: 'Not found', message: 'Hall not found.' });
  const [lectures] = await db.query(
    `SELECT t.day_of_week, t.subject, s.label, b.name AS batch FROM timetable_entries t
     JOIN time_slots s ON s.id = t.time_slot_id JOIN batches b ON b.id = t.batch_id
     WHERE t.hall_id = ? ORDER BY t.day_of_week, s.start_time`, [hall.id]);
  const [bookings] = await db.query(
    `SELECT start_at, end_at, purpose, status FROM bookings
     WHERE hall_id = ? AND status IN ('pending', 'approved') AND end_at >= NOW() ORDER BY start_at LIMIT 20`, [hall.id]);
  res.render('halls/show', { title: hall.name, hall, lectures, bookings });
});

router.get('/:id/edit', requireRole('admin'), async (req, res) => {
  const [[hall]] = await db.query('SELECT * FROM halls WHERE id = ?', [req.params.id]);
  if (!hall) return res.status(404).render('error', { title: 'Not found', message: 'Hall not found.' });
  res.render('halls/form', { title: 'Edit hall', hall, errors: [] });
});

router.post('/:id', requireRole('admin'), upload.single('photo'), async (req, res) => {
  const hall = { ...req.body, id: req.params.id };
  const errors = validateHall(req.body);
  if (errors.length) return res.status(400).render('halls/form', { title: 'Edit hall', hall, errors });
  try {
    await db.query(
      'UPDATE halls SET name = ?, short_code = ?, building = ?, floor = ?, capacity = ?, directions = ?, photo = COALESCE(?, photo) WHERE id = ?',
      [...hallValues(req.body), req.file?.filename || null, req.params.id]);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    return res.status(400).render('halls/form', { title: 'Edit hall', hall, errors: ['A hall with that name or short code already exists.'] });
  }
  req.session.flash = 'Hall updated.';
  res.redirect(`/halls/${req.params.id}`);
});

router.post('/:id/delete', requireRole('admin'), async (req, res) => {
  await db.query('DELETE FROM halls WHERE id = ?', [req.params.id]);
  req.session.flash = 'Hall deleted. Its lectures need a new hall: use Assign halls on Timetable setup.';
  res.redirect('/halls');
});

module.exports = router;
