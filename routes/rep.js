// Batch Representative Workspace: manages own batch timetable, extra lectures, and view schedule.
const router = require('express').Router();
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { today, niceDate } = require('../src/format');
const { weekday } = require('../src/clash');
const { nextLecture } = require('../src/board');

router.use(requireRole('rep'));

router.get('/', async (req, res) => {
  const user = req.session.user;
  const [[batch]] = await db.query('SELECT * FROM batches WHERE id = ?', [user.batch_id]);
  const date = today();
  const now = new Date().toLocaleString('sv-SE').slice(0, 19);
  const currentDow = weekday(date);

  // All entries for this batch
  const [entries] = await db.query(
    `SELECT t.*, s.start_time, s.end_time, s.label, h.name AS hall_name, h.short_code, h.building, h.floor, h.directions
     FROM timetable_entries t JOIN time_slots s ON s.id = t.time_slot_id LEFT JOIN halls h ON h.id = t.hall_id
     WHERE t.batch_id = ? ORDER BY t.day_of_week, s.start_time`,
    [user.batch_id]
  );

  // Today's lectures
  const todayLectures = entries.filter((e) => e.day_of_week === currentDow);

  // Next upcoming lecture
  const next = nextLecture(entries, currentDow, now.slice(11));

  // Recent bookings made for this batch
  const [bookings] = await db.query(
    `SELECT bk.*, h.name AS hall_name, h.short_code
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id
     WHERE (bk.batch_id = ? OR bk.booked_by = ?)
     ORDER BY bk.start_at DESC LIMIT 6`,
    [user.batch_id, user.id]
  );

  // Official timetable PDF for this batch
  const [[officialPdf]] = await db.query(
    'SELECT * FROM timetable_files WHERE batch_id = ? ORDER BY id DESC LIMIT 1',
    [user.batch_id]
  );

  // Suitable halls that fit this batch's student count
  const studentCount = batch ? batch.student_count : 0;
  const [fittingHalls] = await db.query(
    'SELECT id, name, short_code, building, floor, capacity FROM halls WHERE capacity >= ? ORDER BY capacity ASC',
    [studentCount]
  );

  res.render('rep/dashboard', {
    title: 'Batch Rep Dashboard',
    batch,
    entries,
    todayLectures,
    next,
    bookings,
    officialPdf,
    fittingHalls,
    now,
  });
});

module.exports = router;
