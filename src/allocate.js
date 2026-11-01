// Gives each timetable entry the smallest free hall that fits the batch.
// entries: [{ id, day_of_week, time_slot_id, student_count }]
// halls:   [{ id, capacity }]
// taken:   Set of 'hallId-day-slot' already in use
// Biggest batches go first so they are not left without a large hall.
function allocate(entries, halls, taken = new Set()) {
  const smallestFirst = [...halls].sort((a, b) => a.capacity - b.capacity);
  const placed = [];
  const clashes = [];
  for (const e of [...entries].sort((a, b) => b.student_count - a.student_count)) {
    const key = (hall) => `${hall.id}-${e.day_of_week}-${e.time_slot_id}`;
    const hall = smallestFirst.find((h) => h.capacity >= e.student_count && !taken.has(key(h)));
    if (!hall) {
      clashes.push(e);
      continue;
    }
    taken.add(key(hall));
    placed.push({ id: e.id, hall_id: hall.id });
  }
  return { placed, clashes };
}

module.exports = { allocate };
