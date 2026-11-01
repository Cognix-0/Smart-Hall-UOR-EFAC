// Pages anyone can open without logging in: timetable, availability, chatbot.
const router = require('express').Router();
const db = require('../src/db');
const { weekday, findClash } = require('../src/clash');
const { parseQuestion, askGemini } = require('../src/chatbot');
const { today, niceDate } = require('../src/format');
const { hallBoard, nextLecture } = require('../src/board');

// Home: live campus board, the chosen batch's next lecture, and its weekly timetable
router.get('/', async (req, res) => {
  const [batches] = await db.query('SELECT * FROM batches ORDER BY name');
  // Reps see their own batch first; everyone else the first batch that has lectures
  const [[withLectures]] = await db.query(
    'SELECT t.batch_id FROM timetable_entries t JOIN batches b ON b.id = t.batch_id ORDER BY b.name LIMIT 1');
  const batchId = Number(req.query.batch) || req.session.user?.batch_id || withLectures?.batch_id || batches[0]?.id;
  const [slots] = await db.query('SELECT * FROM time_slots ORDER BY start_time');
  const [entries] = await db.query(
    `SELECT t.*, s.start_time, s.end_time, s.label, h.name AS hall_name, h.short_code, h.building, h.floor, h.directions
     FROM timetable_entries t JOIN time_slots s ON s.id = t.time_slot_id LEFT JOIN halls h ON h.id = t.hall_id
     WHERE t.batch_id = ?`, [batchId]);
  const days = [...new Set([1, 2, 3, 4, 5, ...entries.map((e) => e.day_of_week)])].sort();

  // Everything happening in any hall today, as one list of events
  const date = today();
  const now = new Date().toLocaleString('sv-SE').slice(0, 19); // local 'YYYY-MM-DD HH:MM:SS'
  const [halls] = await db.query('SELECT * FROM halls ORDER BY name');
  const [fixed] = await db.query(
    `SELECT t.hall_id, t.subject, b.name AS batch, s.start_time, s.end_time
     FROM timetable_entries t JOIN time_slots s ON s.id = t.time_slot_id JOIN batches b ON b.id = t.batch_id
     WHERE t.hall_id IS NOT NULL AND t.day_of_week = ?`, [weekday(date)]);
  const [booked] = await db.query(
    `SELECT hall_id, start_at, end_at, purpose FROM bookings
     WHERE status IN ('pending', 'approved') AND start_at < ? AND end_at > ?`, [`${date} 23:59:59`, `${date} 00:00:00`]);
  const events = [
    ...fixed.map((f) => ({ hall_id: f.hall_id, start: `${date} ${f.start_time}`, end: `${date} ${f.end_time}`, title: `${f.batch} ${f.subject}` })),
    ...booked.map((b) => ({ hall_id: b.hall_id, start: b.start_at, end: b.end_at, title: b.purpose })),
  ];

  const [[officialPdf]] = await db.query(
    'SELECT * FROM timetable_files WHERE batch_id = ? ORDER BY id DESC LIMIT 1',
    [batchId]
  );

  res.render('home', {
    title: 'Timetable', batches, batchId, slots, entries, days, now, officialPdf,
    board: hallBoard(halls, events, now),
    next: nextLecture(entries, weekday(date), now.slice(11)),
  });
});

// Which halls are free on a date, slot by slot
router.get('/availability', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const [halls] = await db.query('SELECT * FROM halls ORDER BY name');
  const [slots] = await db.query('SELECT * FROM time_slots ORDER BY start_time');
  const [fixed] = await db.query(
    `SELECT t.hall_id, t.time_slot_id, t.subject, b.name AS batch
     FROM timetable_entries t JOIN batches b ON b.id = t.batch_id
     WHERE t.hall_id IS NOT NULL AND t.day_of_week = ?`, [weekday(date)]);
  const [bookings] = await db.query(
    `SELECT hall_id, start_at, end_at, purpose, status FROM bookings
     WHERE status IN ('pending', 'approved') AND start_at < ? AND end_at > ?`,
    [`${date} 23:59:59`, `${date} 00:00:00`]);

  // grid[hallId][slotId] = text shown in the cell, or undefined when free
  const grid = {};
  for (const h of halls) {
    grid[h.id] = {};
    for (const s of slots) {
      const lecture = fixed.find((f) => f.hall_id === h.id && f.time_slot_id === s.id);
      const booking = bookings.find((b) => b.hall_id === h.id
        && b.start_at < `${date} ${s.end_time}` && b.end_at > `${date} ${s.start_time}`);
      if (lecture) grid[h.id][s.id] = `${lecture.batch} ${lecture.subject}`;
      else if (booking) grid[h.id][s.id] = booking.purpose + (booking.status === 'pending' ? ' (pending)' : '');
    }
  }
  res.render('availability', { title: 'Hall availability', date, halls, slots, grid, min: Number(req.query.min) || 0 });
});

// Used by the booking form to mark each hall free / booked / too small before submitting
router.get('/free-halls', async (req, res) => {
  const { start, end } = req.query;
  const valid = (s) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s || '');
  if (!valid(start) || !valid(end) || end <= start) return res.json({ halls: [] });
  const count = Number(req.query.count) || 0;
  const [halls] = await db.query('SELECT id, capacity FROM halls');
  const result = [];
  for (const h of halls) {
    if (h.capacity < count) { result.push({ id: h.id, status: 'small' }); continue; }
    const clash = await findClash(h.id, start, end, Number(req.query.ignore) || 0); // ignore = the booking being edited
    result.push({ id: h.id, status: clash ? 'booked' : 'free', reason: clash });
  }
  res.json({ halls: result });
});

router.get('/chat', (req, res) => res.render('chat', { title: 'Ask SmartHall' }));

router.post('/chat', async (req, res) => {
  const message = String(req.body.message || '').slice(0, 300);
  let { date, time, count } = parseQuestion(message, today());
  if (!date || !time || !count) {
    const [allHalls] = await db.query('SELECT * FROM halls ORDER BY name');
    const ai = await askGemini(message, today(), allHalls);
    if (ai) {
      [date, time, count] = [date || ai.date, time || ai.time, count || ai.count];
      if ((!date || !time || !count) && ai.answer) return res.json({ reply: ai.answer });
    }
  }
  const missing = [!date && 'a date (e.g. 25 Oct)', !time && 'a time (e.g. 10am)', !count && 'how many students (e.g. 120 students)'].filter(Boolean);
  if (missing.length) {
    return res.json({ reply: `I need ${missing.join(', ')}. Try: "free halls on 25 Oct at 10am for 120 students".` });
  }

  // Check the whole teaching slot that contains the time, or one hour if no slot does
  const [[slot]] = await db.query(
    'SELECT * FROM time_slots WHERE start_time <= ? AND end_time > ? LIMIT 1', [time, time]);
  const start = `${date} ${slot ? slot.start_time.slice(0, 5) : time}`;
  const oneHourLater = time >= '23:00' ? '23:59' : String(Number(time.slice(0, 2)) + 1).padStart(2, '0') + time.slice(2);
  const end = `${date} ${slot ? slot.end_time.slice(0, 5) : oneHourLater}`;

  const [halls] = await db.query('SELECT * FROM halls WHERE capacity >= ? ORDER BY capacity', [count]);
  const free = [];
  for (const h of halls) if (!(await findClash(h.id, start, end))) free.push(h);

  if (!free.length) return res.json({ reply: `No hall for ${count} students is free on ${niceDate(date)} from ${start.slice(11)} to ${end.slice(11)}.` });
  const lines = free.map((h) => `• ${h.name} (${h.short_code}), ${h.capacity} seats: ${h.building}, ${h.floor} floor. ${h.directions || ''}`);
  res.json({ reply: `Free on ${niceDate(date)} from ${start.slice(11)} to ${end.slice(11)} for ${count} students:\n${lines.join('\n')}` });
});

module.exports = router;
