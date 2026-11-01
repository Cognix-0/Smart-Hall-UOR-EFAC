const db = require('./db');

// '2026-10-25T10:00' or '2026-10-25 10:00' -> '2026-10-25 10:00:00', so times compare as plain strings
function toSql(dateTime) {
  const s = String(dateTime).replace('T', ' ');
  return s.length === 16 ? s + ':00' : s;
}

// 1 = Monday ... 7 = Sunday, for a 'YYYY-MM-DD' date
function weekday(date) {
  return new Date(date + 'T00:00:00Z').getUTCDay() || 7;
}

// Fixed weekly lectures that overlap [startAt, endAt). Pure, so it is unit-tested.
function fixedOverlaps(fixed, startAt, endAt) {
  const hits = [];
  const last = Date.parse(endAt.slice(0, 10) + 'T00:00:00Z');
  for (let t = Date.parse(startAt.slice(0, 10) + 'T00:00:00Z'); t <= last; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    for (const f of fixed) {
      if (f.day_of_week !== weekday(date)) continue;
      const lectureStart = `${date} ${f.start_time}`;
      const lectureEnd = `${date} ${f.end_time}`;
      if (lectureStart < endAt && lectureEnd > startAt) hits.push({ ...f, date });
    }
  }
  return hits;
}

// Returns why the hall is taken between startAt and endAt, or null if it is free.
async function findClash(hallId, startAt, endAt, ignoreBookingId = 0) {
  startAt = toSql(startAt);
  endAt = toSql(endAt);
  const [bookings] = await db.query(
    `SELECT purpose, start_at, end_at FROM bookings
     WHERE hall_id = ? AND status IN ('pending', 'approved') AND start_at < ? AND end_at > ? AND id <> ?`,
    [hallId, endAt, startAt, ignoreBookingId]);
  if (bookings.length) {
    const b = bookings[0];
    return `Hall already booked for "${b.purpose}" (${b.start_at.slice(0, 16)} to ${b.end_at.slice(0, 16)}).`;
  }
  const [fixed] = await db.query(
    `SELECT t.day_of_week, t.subject, s.start_time, s.end_time, b.name AS batch
     FROM timetable_entries t JOIN time_slots s ON s.id = t.time_slot_id JOIN batches b ON b.id = t.batch_id
     WHERE t.hall_id = ?`, [hallId]);
  const hit = fixedOverlaps(fixed, startAt, endAt)[0];
  return hit ? `Hall has a fixed lecture then: ${hit.batch} ${hit.subject} on ${hit.date}.` : null;
}

module.exports = { toSql, weekday, fixedOverlaps, findClash };
