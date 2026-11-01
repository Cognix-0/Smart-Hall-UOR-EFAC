// Society President Portal: manages event venue bookings, permission letter statuses, and upcoming events.
const router = require('express').Router();
const db = require('../src/db');
const { requireRole } = require('../src/auth');

router.use(requireRole('president'));

router.get('/', async (req, res) => {
  const user = req.session.user;
  const society = user.society || 'University Society';

  // Bookings by this society or user
  const [bookings] = await db.query(
    `SELECT bk.*, h.name AS hall_name, h.short_code, h.building, h.floor, h.capacity
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id
     WHERE bk.booked_by = ? OR bk.purpose LIKE ?
     ORDER BY bk.start_at DESC`,
    [user.id, `%${society}%`]
  );

  const counts = {
    total: bookings.length,
    approved: bookings.filter((b) => b.status === 'approved').length,
    pending: bookings.filter((b) => b.status === 'pending').length,
    rejected: bookings.filter((b) => b.status === 'rejected').length,
  };

  // Upcoming approved events
  const [upcoming] = await db.query(
    `SELECT bk.*, h.name AS hall_name, h.short_code, h.building
     FROM bookings bk JOIN halls h ON h.id = bk.hall_id
     WHERE (bk.booked_by = ? OR bk.purpose LIKE ?) AND bk.status = 'approved' AND bk.end_at >= NOW()
     ORDER BY bk.start_at ASC LIMIT 5`,
    [user.id, `%${society}%`]
  );

  // Large halls suitable for society workshops and major gatherings
  const [eventHalls] = await db.query(
    'SELECT * FROM halls WHERE capacity >= 100 ORDER BY capacity DESC'
  );

  res.render('president/dashboard', {
    title: 'Society Portal',
    society,
    bookings,
    counts,
    upcoming,
    eventHalls,
  });
});

module.exports = router;
