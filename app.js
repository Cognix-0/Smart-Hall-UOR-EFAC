require('dotenv').config({ quiet: true });
const express = require('express');
const session = require('express-session');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); }); // Express 5 leaves body undefined on empty POSTs
app.use(express.static('public'));
app.use('/photos', express.static('uploads/photos')); // hall photos are public; letters are not
app.use('/timetables', express.static('uploads/timetables')); // timetable PDFs are public
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
}));

// Values every page can use
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.flash = req.session.flash;
  res.locals.DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  res.locals.query = req.query;
  res.locals.path = req.path;
  res.locals.fmt = require('./src/format');
  delete req.session.flash;
  next();
});

app.use(require('./routes/auth'));
app.use(require('./routes/public'));
app.use('/halls', require('./routes/halls'));
app.use('/timetable', require('./routes/timetable'));
app.use('/bookings', require('./routes/bookings'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too big (max 5 MB).' : 'Something went wrong. Please try again.';
  res.status(500).render('error', { title: 'Error', message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SmartHall AI running at http://localhost:${port}`));
