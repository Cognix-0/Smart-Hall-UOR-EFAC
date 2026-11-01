const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

router.get('/login', (req, res) => res.render('login', { title: 'Log in', error: null, email: '' }));

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim();
  const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password_hash))) {
    return res.status(401).render('login', { title: 'Log in', error: 'Wrong email or password.', email });
  }
  req.session.user = { id: user.id, name: user.name, role: user.role, batch_id: user.batch_id, society: user.society };
  res.redirect(user.role === 'admin' ? '/admin' : '/bookings');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

module.exports = router;
