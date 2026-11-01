// Turns database date strings into friendly text for pages, e.g. "Tue 27 Oct, 08:00".
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD...' -> 'Tue 27 Oct'
function niceDate(s) {
  const d = new Date(s.slice(0, 10) + 'T00:00:00Z');
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

// Two 'YYYY-MM-DD HH:MM:SS' strings -> 'Tue 27 Oct, 08:00–10:00' (or both dates when they differ)
function niceRange(start, end) {
  const t = (s) => s.slice(11, 16);
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${niceDate(start)}, ${t(start)}–${t(end)}`
    : `${niceDate(start)} ${t(start)} to ${niceDate(end)} ${t(end)}`;
}

// 'YYYY-MM-DD' shifted by n days
function addDays(date, n) {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

const today = () => new Date().toLocaleDateString('en-CA'); // local 'YYYY-MM-DD'

module.exports = { niceDate, niceRange, addDays, today };
