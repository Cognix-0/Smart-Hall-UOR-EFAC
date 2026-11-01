// One-off bookings. Reps book for their batch (confirmed at once).
// Society presidents book with a permission letter checked by AI. Admin sees and controls all.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { toSql, findClash } = require('../src/clash');
const { checkLetter } = require('../src/letterCheck');
const { makeUpload } = require('../src/upload');

const letterUpload = makeUpload('uploads/letters', ['application/pdf', 'image/jpeg', 'image/png']);
const nowSql = () => new Date().toLocaleString('sv-SE').slice(0, 19); // local 'YYYY-MM-DD HH:MM:SS'

// Who may see / delete a booking
function owns(user, b) {
  return user.role === 'admin'
    || (user.role === 'rep' && b.batch_id !== null && b.batch_id === user.batch_id)
    || (user.role === 'president' && b.booked_by === user.id);
}

// Dropdown data for the forms; batchSize lets the form flag halls that are too small for a rep's batch
async function formOptions(user) {
  const [halls] = await db.query('SELECT * FROM halls ORDER BY name');
  const [slots] = await db.query('SELECT * FROM time_slots ORDER BY start_time');
  const [[batch]] = await db.query('SELECT student_count FROM batches WHERE id = ?', [user?.batch_id || 0]);
  return { halls, slots, batchSize: batch?.student_count || 0 };
}

async function findBooking(id) {
  const [[b]] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
  return b;
}

// Rep form -> { hall, startAt, endAt, purpose } or { error }
async function readRepForm(body, user) {
  const [[hall]] = await db.query('SELECT * FROM halls WHERE id = ?', [body.hall_id]);
  const [[slot]] = await db.query('SELECT * FROM time_slots WHERE id = ?', [body.time_slot_id]);
  const [[batch]] = await db.query('SELECT * FROM batches WHERE id = ?', [user.batch_id]);
  const purpose = String(body.purpose || '').trim();
  if (!hall || !slot) return { error: 'Pick a hall and a time slot.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return { error: 'Pick a valid date.' };
  if (!purpose) return { error: 'Purpose is required (e.g. the subject).' };
  if (!batch) return { error: 'Your account is not linked to a batch. Ask the admin.' };
  if (hall.capacity < batch.student_count) return { error: `${hall.name} has ${hall.capacity} seats but ${batch.name} has ${batch.student_count} students.` };
  const startAt = `${body.date} ${slot.start_time}`;
  if (startAt < nowSql()) return { error: 'That time has already passed.' };
  return { hall, startAt, endAt: `${body.date} ${slot.end_time}`, purpose };
}

router.get('/', requireRole(), async (req, res) => {
  const user = req.session.user;
  const where = ['1 = 1'];
  const params = [];
  if (user.role === 'rep') { where.push('bk.batch_id = ?'); params.push(user.batch_id); }
  if (user.role === 'president') { where.push('bk.booked_by = ?'); params.push(user.id); }
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) { where.push('bk.status = ?'); params.push(req.query.status); }
  if (Number(req.query.hall)) { where.push('bk.hall_id = ?'); params.push(Number(req.query.hall)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) { where.push('DATE(bk.start_at) <= ? AND DATE(bk.end_at) >= ?'); params.push(req.query.date, req.query.date); }
  const order = req.query.sort === 'oldest' ? 'bk.start_at ASC' : req.query.sort === 'created' ? 'bk.created_at DESC' : 'bk.start_at DESC';

  const [bookings] = await db.query(
    `SELECT bk.*, h.name AS hall_name, h.short_code, u.name AS booked_by_name, u.society, b.name AS batch
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id JOIN users u ON u.id = bk.booked_by
     LEFT JOIN batches b ON b.id = bk.batch_id
     WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  res.render('bookings/list', { title: user.role === 'admin' ? 'All bookings' : 'My bookings', bookings, ...(await formOptions()) });
});

router.get('/new', requireRole('rep', 'president'), async (req, res) => {
  res.render('bookings/form', { title: 'Book a hall', booking: { hall_id: req.query.hall }, error: null, ...(await formOptions(req.session.user)) });
});

router.post('/', requireRole('rep', 'president'), letterUpload.single('letter'), async (req, res) => {
  const user = req.session.user;
  const fail = async (error) => {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).render('bookings/form', { title: 'Book a hall', booking: req.body, error, ...(await formOptions(user)) });
  };

  if (user.role === 'rep') {
    const form = await readRepForm(req.body, user);
    if (form.error) return fail(form.error);
    const clash = await findClash(form.hall.id, form.startAt, form.endAt);
    if (clash) return fail(clash);
    await db.query(
      `INSERT INTO bookings (hall_id, start_at, end_at, booked_by, batch_id, purpose, type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'lecture', 'approved')`,
      [form.hall.id, form.startAt, form.endAt, user.id, user.batch_id, form.purpose]);
    req.session.flash = `Booked ${form.hall.name}.`;
    return res.redirect('/bookings');
  }

  // Society president
  const [[hall]] = await db.query('SELECT * FROM halls WHERE id = ?', [req.body.hall_id]);
  const purpose = String(req.body.purpose || '').trim();
  const valid = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '');
  if (!hall) return fail('Pick a hall.');
  if (!valid(req.body.start_at) || !valid(req.body.end_at)) return fail('Enter a valid start and end date and time.');
  const startAt = toSql(req.body.start_at);
  const endAt = toSql(req.body.end_at);
  if (endAt <= startAt) return fail('End must be after start.');
  if (startAt < nowSql()) return fail('That time has already passed.');
  if (!purpose) return fail('Purpose is required.');
  if (!req.file) return fail('Upload the signed permission letter as a PDF, JPG or PNG.');
  const clash = await findClash(hall.id, startAt, endAt);
  if (clash) return fail(clash);

  const result = await checkLetter({
    filePath: req.file.path, mimeType: req.file.mimetype, society: user.society, hall, startAt, endAt, purpose,
  });
  await db.query(
    `INSERT INTO bookings (hall_id, start_at, end_at, booked_by, purpose, type, status, letter_file, ai_reason)
     VALUES (?, ?, ?, ?, ?, 'society', ?, ?, ?)`,
    [hall.id, startAt, endAt, user.id, purpose, result.status, req.file.filename, result.reason]);
  const verdict = { approved: 'Letter verified. Booking confirmed.', rejected: 'Letter not accepted.', pending: '' };
  req.session.flash = `${verdict[result.status]} ${result.reason}`.trim();
  res.redirect('/bookings');
});

// Only reps edit (their own batch's lecture bookings). Society bookings are deleted and re-made so the letter is re-checked.
router.get('/:id/edit', requireRole('rep'), async (req, res) => {
  const b = await findBooking(req.params.id);
  if (!b || b.type !== 'lecture' || !owns(req.session.user, b)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You can only edit your own batch bookings.' });
  }
  const booking = { ...b, date: b.start_at.slice(0, 10) };
  const options = await formOptions(req.session.user);
  booking.time_slot_id = options.slots.find((s) => b.start_at.endsWith(s.start_time))?.id;
  res.render('bookings/form', { title: 'Edit booking', booking, error: null, ...options });
});

router.post('/:id', requireRole('rep'), async (req, res) => {
  const user = req.session.user;
  const b = await findBooking(req.params.id);
  if (!b || b.type !== 'lecture' || !owns(user, b)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You can only edit your own batch bookings.' });
  }
  const fail = async (error) => res.status(400).render('bookings/form',
    { title: 'Edit booking', booking: { ...req.body, id: b.id }, error, ...(await formOptions(user)) });
  const form = await readRepForm(req.body, user);
  if (form.error) return fail(form.error);
  const clash = await findClash(form.hall.id, form.startAt, form.endAt, b.id);
  if (clash) return fail(clash);
  await db.query('UPDATE bookings SET hall_id = ?, start_at = ?, end_at = ?, purpose = ? WHERE id = ?',
    [form.hall.id, form.startAt, form.endAt, form.purpose, b.id]);
  req.session.flash = 'Booking updated.';
  res.redirect('/bookings');
});

router.post('/:id/delete', requireRole(), async (req, res) => {
  const b = await findBooking(req.params.id);
  if (!b || !owns(req.session.user, b)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot delete that booking.' });
  }
  await db.query('DELETE FROM bookings WHERE id = ?', [b.id]);
  if (b.letter_file) fs.unlink(path.join('uploads/letters', b.letter_file), () => {});
  req.session.flash = 'Booking deleted.';
  res.redirect('/bookings');
});

// Admin approves a pending booking, or rejects / revokes any booking
router.post('/:id/status', requireRole('admin'), async (req, res) => {
  const status = req.body.status === 'approved' ? 'approved' : 'rejected';
  const b = await findBooking(req.params.id);
  if (!b) return res.status(404).render('error', { title: 'Not found', message: 'Booking not found.' });
  if (status === 'approved') {
    const clash = await findClash(b.hall_id, b.start_at, b.end_at, b.id);
    if (clash) {
      req.session.flash = `Cannot approve: ${clash}`;
      return res.redirect('/bookings');
    }
  }
  await db.query('UPDATE bookings SET status = ?, ai_reason = CONCAT(COALESCE(ai_reason, ""), ?) WHERE id = ?',
    [status, ` [Admin ${status === 'approved' ? 'approved' : 'rejected'}]`, b.id]);
  req.session.flash = `Booking ${status}.`;
  res.redirect('/bookings');
});

// Permission letters are private: only the admin and the president who uploaded it
router.get('/:id/letter', requireRole(), async (req, res) => {
  const b = await findBooking(req.params.id);
  if (!b || !b.letter_file || !owns(req.session.user, b)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You cannot view that letter.' });
  }
  res.sendFile(path.resolve('uploads/letters', b.letter_file));
});

module.exports = router;
