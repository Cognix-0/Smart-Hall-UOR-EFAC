// "Right now on campus": what is happening in each hall today. Pure functions, so they are unit-tested.

// halls:  [{ id, ... }]
// events: [{ hall_id, start, end, title }] for today, times as 'YYYY-MM-DD HH:MM:SS'
// Returns [{ hall, current, next }] where current/next are events or undefined.
function hallBoard(halls, events, now) {
  return halls.map((hall) => {
    const mine = events.filter((e) => e.hall_id === hall.id).sort((a, b) => (a.start < b.start ? -1 : 1));
    return {
      hall,
      current: mine.find((e) => e.start <= now && e.end > now),
      next: mine.find((e) => e.start > now),
    };
  });
}

// entries: a batch's weekly lectures [{ day_of_week, start_time, end_time, ... }]
// dow: today 1-7 (Mon-Sun), time: 'HH:MM:SS' now.
// Returns { entry, inDays, now } for the lecture on now or coming up next, or null if the batch has none.
function nextLecture(entries, dow, time) {
  for (let inDays = 0; inDays < 7; inDays++) {
    const day = ((dow - 1 + inDays) % 7) + 1;
    const entry = entries
      .filter((e) => e.day_of_week === day && (inDays > 0 || e.end_time > time))
      .sort((a, b) => (a.start_time < b.start_time ? -1 : 1))[0];
    if (entry) return { entry, inDays, now: inDays === 0 && entry.start_time <= time };
  }
  return null;
}

module.exports = { hallBoard, nextLecture };
