// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { parseQuestion } = require('../src/chatbot');
const { allocate } = require('../src/allocate');
const { fixedOverlaps, weekday } = require('../src/clash');
const { hallBoard, nextLecture } = require('../src/board');

test('campus board shows what is in each hall now and next', () => {
  const d = '2026-10-28';
  const events = [
    { hall_id: 1, start: `${d} 10:00:00`, end: `${d} 12:00:00`, title: 'B' },
    { hall_id: 1, start: `${d} 08:00:00`, end: `${d} 10:00:00`, title: 'A' },
  ];
  const [h1, h2] = hallBoard([{ id: 1 }, { id: 2 }], events, `${d} 09:00:00`);
  assert.strictEqual(h1.current.title, 'A');
  assert.strictEqual(h1.next.title, 'B');
  assert.strictEqual(h2.current, undefined);
  assert.strictEqual(hallBoard([{ id: 1 }], events, `${d} 12:00:00`)[0].current, undefined); // ended exactly now
});

test('next lecture: on now, later today, or a later day', () => {
  const entries = [
    { id: 'mon8', day_of_week: 1, start_time: '08:00:00', end_time: '10:00:00' },
    { id: 'wed13', day_of_week: 3, start_time: '13:00:00', end_time: '15:00:00' },
  ];
  assert.deepStrictEqual(nextLecture(entries, 1, '09:00:00'), { entry: entries[0], inDays: 0, now: true });
  assert.strictEqual(nextLecture(entries, 1, '11:00:00').entry.id, 'wed13');
  assert.strictEqual(nextLecture(entries, 4, '09:00:00').inDays, 4); // Thu -> next Mon
  assert.strictEqual(nextLecture([], 1, '09:00:00'), null);
});

test('chatbot reads date, time and count', () => {
  const today = '2026-10-20';
  assert.deepStrictEqual(parseQuestion('free halls on 25 Oct at 10am for 120 students', today),
    { date: '2026-10-25', time: '10:00', count: 120 });
  assert.deepStrictEqual(parseQuestion('Any hall tomorrow 2:30pm for 40 people?', today),
    { date: '2026-10-21', time: '14:30', count: 40 });
  assert.deepStrictEqual(parseQuestion('2026-11-02 13:00 60 seats', today),
    { date: '2026-11-02', time: '13:00', count: 60 });
  assert.deepStrictEqual(parseQuestion('halls on october 3rd at 12pm', today),
    { date: '2026-10-03', time: '12:00', count: null });
  assert.deepStrictEqual(parseQuestion('hello', today), { date: null, time: null, count: null });
});

test('allocation picks the smallest hall that fits and reports clashes', () => {
  const halls = [{ id: 1, capacity: 250 }, { id: 2, capacity: 100 }];
  const entries = [
    { id: 'a', day_of_week: 1, time_slot_id: 1, student_count: 80 },
    { id: 'b', day_of_week: 1, time_slot_id: 1, student_count: 200 },
    { id: 'c', day_of_week: 1, time_slot_id: 1, student_count: 50 }, // both halls used by then
  ];
  const { placed, clashes } = allocate(entries, halls);
  assert.deepStrictEqual(placed, [{ id: 'b', hall_id: 1 }, { id: 'a', hall_id: 2 }]);
  assert.deepStrictEqual(clashes.map((e) => e.id), ['c']);
});

test('fixed lectures clash only on their weekday and time', () => {
  assert.strictEqual(weekday('2026-10-19'), 1); // a Monday
  const fixed = [{ day_of_week: 1, start_time: '08:00:00', end_time: '10:00:00' }];
  assert.strictEqual(fixedOverlaps(fixed, '2026-10-19 09:00:00', '2026-10-19 11:00:00').length, 1);
  assert.strictEqual(fixedOverlaps(fixed, '2026-10-19 10:00:00', '2026-10-19 12:00:00').length, 0);
  assert.strictEqual(fixedOverlaps(fixed, '2026-10-20 08:00:00', '2026-10-20 10:00:00').length, 0);
  // overnight event from Sunday into Monday morning
  assert.strictEqual(fixedOverlaps(fixed, '2026-10-18 20:00:00', '2026-10-19 08:30:00').length, 1);
});
