// Fixed weekly timetable. Admin: everything. Rep: edit own batch's entries only.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { allocate } = require('../src/allocate');
const { importPdfTimetable } = require('../src/pdfTimetable');

const timetableUpload = multer({
  dest: path.join(__dirname, '..', 'uploads', 'timetables'),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const canEdit = (user, entry) => user.role === 'admin' || (user.role === 'rep' && entry.batch_id === user.batch_id);

async function formOptions() {
  const [batches] = await db.query('SELECT * FROM batches ORDER BY name');
  const [slots] = await db.query('SELECT * FROM time_slots ORDER BY start_time');
  const [halls] = await db.query('SELECT * FROM halls ORDER BY capacity');
  return { batches, slots, halls };
}

// Checks and saves one entry. Returns an error message, or null when saved.
async function saveEntry(e, id = null) {
  const day = Number(e.day_of_week);
  if (!String(e.subject || '').trim()) return 'Subject is required.';
  if (!(day >= 1 && day <= 7)) return 'Pick a valid day.';
  const [[batch]] = await db.query('SELECT * FROM batches WHERE id = ?', [e.batch_id]);
  const [[slot]] = await db.query('SELECT * FROM time_slots WHERE id = ?', [e.time_slot_id]);
  if (!batch || !slot) return 'Pick a valid batch and time slot.';
  const hallId = Number(e.hall_id) || null;
  if (hallId) {
    const [[hall]] = await db.query('SELECT * FROM halls WHERE id = ?', [hallId]);
    if (!hall) return 'Pick a valid hall.';
    if (hall.capacity < batch.student_count) return `${hall.name} has ${hall.capacity} seats but ${batch.name} has ${batch.student_count} students.`;
  }
  // shortcut: only fixed lectures are checked here, not one-off bookings in the same hall; add findClash per week if that matters.
  const values = [batch.id, e.subject.trim(), day, slot.id, hallId];
  try {
    if (id) await db.query('UPDATE timetable_entries SET batch_id = ?, subject = ?, day_of_week = ?, time_slot_id = ?, hall_id = ? WHERE id = ?', [...values, id]);
    else await db.query('INSERT INTO timetable_entries (batch_id, subject, day_of_week, time_slot_id, hall_id) VALUES (?, ?, ?, ?, ?)', values);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    return err.message.includes('one_class_per_hall')
      ? 'That hall already has a lecture at that day and time.'
      : `${batch.name} already has a lecture at that day and time.`;
  }
  return null;
}

router.get('/manage', requireRole('admin', 'rep'), async (req, res) => {
  const user = req.session.user;
  const batchFilter = user.role === 'rep' ? user.batch_id : Number(req.query.batch) || null;
  const [entries] = await db.query(
    `SELECT t.*, b.name AS batch, b.student_count, s.label, h.name AS hall_name, h.short_code
     FROM timetable_entries t JOIN batches b ON b.id = t.batch_id JOIN time_slots s ON s.id = t.time_slot_id
     LEFT JOIN halls h ON h.id = t.hall_id
     WHERE (? IS NULL OR t.batch_id = ?) ORDER BY b.name, t.day_of_week, s.start_time`, [batchFilter, batchFilter]);

  const [timetableFiles] = await db.query(
    `SELECT f.*, b.name AS batch_name
     FROM timetable_files f JOIN batches b ON b.id = f.batch_id
     WHERE (? IS NULL OR f.batch_id = ?)
     ORDER BY f.created_at DESC`, [batchFilter, batchFilter]);

  const projectPdfName = '9AxgTxnvgl0yADgsUzyUlvnY7uYnmrXrhK8mezyM.pdf';
  const hasProjectPdf = fs.existsSync(path.join(__dirname, '..', projectPdfName));

  res.render('timetable/manage', {
    title: 'Manage timetable',
    entries,
    batchFilter,
    timetableFiles,
    hasProjectPdf,
    projectPdfName,
    ...(await formOptions()),
  });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const error = await saveEntry(req.body);
  req.session.flash = error || 'Lecture added.';
  res.redirect('/timetable/manage');
});

// Master timetable upload: supports both PDF and CSV
router.post('/upload', requireRole('admin'), timetableUpload.single('file'), async (req, res) => {
  if (!req.file) {
    req.session.flash = 'Choose a PDF or CSV file to upload.';
    return res.redirect('/timetable/manage');
  }

  const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    try {
      const result = await importPdfTimetable({
        filePath: req.file.path,
        originalName: req.file.originalname,
        batchId: req.body.batch_id ? Number(req.body.batch_id) : null,
      });
      req.session.flash = `Imported official timetable PDF for batch ${result.batch.name} (${result.added} lectures added).`;
    } catch (err) {
      req.session.flash = `Failed to process PDF timetable: ${err.message}`;
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    return res.redirect('/timetable/manage');
  }

  // Handle CSV upload
  try {
    const { batches, slots } = await formOptions();
    const content = fs.readFileSync(req.file.path, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const report = [];
    let added = 0;
    for (const [i, line] of lines.entries()) {
      const [batchName, subject, dayText, slotLabel] = line.split(',').map((c) => c.trim());
      if (i === 0 && batchName.toLowerCase() === 'batch') continue;
      const batch = batches.find((b) => b.name.toLowerCase() === (batchName || '').toLowerCase());
      const slot = slots.find((s) => s.label === slotLabel);
      const day = Number(dayText) || DAY_NAMES.indexOf((dayText || '').slice(0, 3).toLowerCase()) + 1;
      const error = !batch ? `unknown batch "${batchName}"`
        : !slot ? `unknown slot "${slotLabel}"`
        : await saveEntry({ batch_id: batch.id, subject, day_of_week: day, time_slot_id: slot.id });
      if (error) report.push(`Line ${i + 1}: ${error}`);
      else added++;
    }
    req.session.flash = `Added ${added} lectures from CSV.` + (report.length ? ` Skipped ${report.length}: ${report.join(' | ')}` : '');
  } catch (err) {
    req.session.flash = `Failed to process CSV file: ${err.message}`;
  } finally {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
  res.redirect('/timetable/manage');
});

// Import the specific timetable PDF that is stored in the project folder
router.post('/load-project-pdf', requireRole('admin'), async (req, res) => {
  const projectPdfPath = path.join(__dirname, '..', '9AxgTxnvgl0yADgsUzyUlvnY7uYnmrXrhK8mezyM.pdf');
  if (!fs.existsSync(projectPdfPath)) {
    req.session.flash = 'Project timetable PDF file (9AxgTxnvgl0yADgsUzyUlvnY7uYnmrXrhK8mezyM.pdf) not found.';
    return res.redirect('/timetable/manage');
  }
  try {
    const result = await importPdfTimetable({
      filePath: projectPdfPath,
      originalName: '9AxgTxnvgl0yADgsUzyUlvnY7uYnmrXrhK8mezyM.pdf',
      batchId: req.body.batch_id ? Number(req.body.batch_id) : null,
    });
    req.session.flash = `Imported official timetable PDF for batch ${result.batch.name} (${result.added} lectures added).`;
  } catch (err) {
    req.session.flash = `PDF import failed: ${err.message}`;
  }
  res.redirect('/timetable/manage');
});

// Delete official timetable PDF
router.post('/files/:id/delete', requireRole('admin'), async (req, res) => {
  const [[file]] = await db.query('SELECT * FROM timetable_files WHERE id = ?', [req.params.id]);
  if (file) {
    const diskPath = path.join(__dirname, '..', 'uploads', 'timetables', file.filename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    await db.query('DELETE FROM timetable_files WHERE id = ?', [req.params.id]);
    req.session.flash = 'Official timetable PDF removed.';
  }
  res.redirect('/timetable/manage');
});

// Reset all timetables for the new semester
router.post('/reset-all', requireRole('admin'), async (req, res) => {
  const batchId = req.body.batch_id ? Number(req.body.batch_id) : null;
  const clearFiles = Boolean(req.body.clear_files);

  if (batchId) {
    const [[batch]] = await db.query('SELECT name FROM batches WHERE id = ?', [batchId]);
    await db.query('DELETE FROM timetable_entries WHERE batch_id = ?', [batchId]);

    if (clearFiles) {
      const [files] = await db.query('SELECT filename FROM timetable_files WHERE batch_id = ?', [batchId]);
      for (const f of files) {
        const diskPath = path.join(__dirname, '..', 'uploads', 'timetables', f.filename);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      }
      await db.query('DELETE FROM timetable_files WHERE batch_id = ?', [batchId]);
    }

    req.session.flash = `Timetable for batch ${batch ? batch.name : batchId} has been reset for the new semester.`;
  } else {
    // Reset all batches
    await db.query('DELETE FROM timetable_entries');

    if (clearFiles) {
      const [files] = await db.query('SELECT filename FROM timetable_files');
      for (const f of files) {
        const diskPath = path.join(__dirname, '..', 'uploads', 'timetables', f.filename);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      }
      await db.query('DELETE FROM timetable_files');
    }

    req.session.flash = 'All batch timetables have been reset for the new semester.';
  }
  res.redirect('/timetable/manage');
});

router.post('/allocate', requireRole('admin'), async (req, res) => {
  if (req.body.reset) await db.query('UPDATE timetable_entries SET hall_id = NULL');
  const [entries] = await db.query(
    `SELECT t.id, t.day_of_week, t.time_slot_id, t.subject, b.name AS batch, b.student_count
     FROM timetable_entries t JOIN batches b ON b.id = t.batch_id WHERE t.hall_id IS NULL`);
  const [halls] = await db.query('SELECT id, capacity FROM halls');
  const [used] = await db.query('SELECT hall_id, day_of_week, time_slot_id FROM timetable_entries WHERE hall_id IS NOT NULL');
  const taken = new Set(used.map((u) => `${u.hall_id}-${u.day_of_week}-${u.time_slot_id}`));

  const { placed, clashes } = allocate(entries, halls, taken);
  for (const p of placed) await db.query('UPDATE timetable_entries SET hall_id = ? WHERE id = ?', [p.hall_id, p.id]);

  req.session.flash = `Assigned halls to ${placed.length} lectures.` + (clashes.length
    ? ` No hall big enough was free for: ${clashes.map((c) => `${c.batch} ${c.subject}`).join(', ')}.`
    : '');
  res.redirect('/timetable/manage');
});

router.get('/:id/edit', requireRole('admin', 'rep'), async (req, res) => {
  const [[entry]] = await db.query('SELECT * FROM timetable_entries WHERE id = ?', [req.params.id]);
  if (!entry || !canEdit(req.session.user, entry)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You can only edit your own batch timetable.' });
  }
  res.render('timetable/edit', { title: 'Edit lecture', entry, error: null, ...(await formOptions()) });
});

router.post('/:id', requireRole('admin', 'rep'), async (req, res) => {
  const user = req.session.user;
  const [[entry]] = await db.query('SELECT * FROM timetable_entries WHERE id = ?', [req.params.id]);
  if (!entry || !canEdit(user, entry)) {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You can only edit your own batch timetable.' });
  }
  // A rep can never move a lecture to another batch
  const changes = { ...req.body, batch_id: user.role === 'rep' ? user.batch_id : req.body.batch_id };
  const error = await saveEntry(changes, entry.id);
  if (error) {
    return res.status(400).render('timetable/edit', { title: 'Edit lecture', entry: { ...changes, id: entry.id }, error, ...(await formOptions()) });
  }
  req.session.flash = 'Lecture updated.';
  res.redirect('/timetable/manage');
});

router.post('/:id/delete', requireRole('admin'), async (req, res) => {
  await db.query('DELETE FROM timetable_entries WHERE id = ?', [req.params.id]);
  req.session.flash = 'Lecture deleted.';
  res.redirect('/timetable/manage');
});

module.exports = router;
