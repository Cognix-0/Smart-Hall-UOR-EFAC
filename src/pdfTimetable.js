// Handles uploading, parsing and maintaining PDF timetables.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const db = require('./db');

function runPythonParser(filePath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'parsePdf.py');
    execFile('python3', [scriptPath, filePath], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try {
        const data = JSON.parse(stdout);
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      } catch (parseErr) {
        reject(new Error(`Failed to parse Python output: ${parseErr.message}\n${stdout}`));
      }
    });
  });
}

// Maps short codes in PDF to DB halls
async function resolveHallId(hallCode, halls) {
  if (!hallCode) return null;
  const code = hallCode.trim().toUpperCase();
  // Direct matches
  let hall = halls.find((h) => h.short_code.toUpperCase() === code);
  if (hall) return hall.id;

  // Synonyms used in engineering faculties
  if (code === 'LT1' || code === 'LH1') {
    hall = halls.find((h) => h.short_code === 'LH1' || h.name.toLowerCase().includes('lecture hall 1'));
  } else if (code === 'LT2' || code === 'LH2') {
    hall = halls.find((h) => h.short_code === 'LH2' || h.name.toLowerCase().includes('lecture hall 2'));
  } else if (code === 'CC') {
    hall = halls.find((h) => h.short_code === 'OCC' || h.short_code === 'NCC' || h.name.toLowerCase().includes('computer centre'));
  } else if (code === 'NCC') {
    hall = halls.find((h) => h.short_code === 'NCC' || h.name.toLowerCase().includes('new computer centre'));
  } else if (code === 'OCC') {
    hall = halls.find((h) => h.short_code === 'OCC' || h.name.toLowerCase().includes('old computer centre'));
  }
  return hall ? hall.id : null;
}

// Ensures all necessary time slots exist in time_slots table
async function ensureTimeSlots(entries) {
  const [existingSlots] = await db.query('SELECT * FROM time_slots');
  const slotMap = new Map(existingSlots.map((s) => [s.label, s.id]));

  for (const e of entries) {
    if (!slotMap.has(e.slot)) {
      const [res] = await db.query(
        'INSERT INTO time_slots (label, start_time, end_time) VALUES (?, ?, ?)',
        [e.slot, e.startTime, e.endTime]
      );
      slotMap.set(e.slot, res.insertId);
    }
  }
  return slotMap;
}

/**
 * Imports a timetable PDF and creates timetable_entries and timetable_files records.
 */
async function importPdfTimetable({ filePath, originalName, batchId = null, overwrite = true }) {
  const parsed = await runPythonParser(filePath);
  const [batches] = await db.query('SELECT * FROM batches ORDER BY name');
  const [halls] = await db.query('SELECT * FROM halls ORDER BY capacity');

  // Determine target batch
  let targetBatch = null;
  if (batchId) {
    targetBatch = batches.find((b) => b.id === Number(batchId));
  }
  if (!targetBatch && parsed.batch) {
    targetBatch = batches.find((b) => b.name.toLowerCase() === parsed.batch.toLowerCase() || b.name.toLowerCase().includes(parsed.batch.toLowerCase()));
  }
  if (!targetBatch && batches.length > 0) {
    targetBatch = batches[0];
  }
  if (!targetBatch) {
    throw new Error('No batch found to associate with this timetable.');
  }

  // Ensure time slots exist
  const slotMap = await ensureTimeSlots(parsed.entries);

  // If overwrite, remove existing lectures for this batch
  if (overwrite) {
    await db.query('DELETE FROM timetable_entries WHERE batch_id = ?', [targetBatch.id]);
  }

  // Insert lectures
  let added = 0;
  const errors = [];
  for (const entry of parsed.entries) {
    const timeSlotId = slotMap.get(entry.slot);
    const hallId = await resolveHallId(entry.hallCode, halls);

    try {
      await db.query(
        `INSERT INTO timetable_entries (batch_id, subject, day_of_week, time_slot_id, hall_id)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE subject = VALUES(subject), hall_id = VALUES(hall_id)`,
        [targetBatch.id, entry.subject, entry.day, timeSlotId, hallId]
      );
      added++;
    } catch (err) {
      errors.push(`${entry.dayName} ${entry.slot}: ${err.message}`);
    }
  }

  // Save PDF file in uploads/timetables
  const timetablesDir = path.join(__dirname, '..', 'uploads', 'timetables');
  if (!fs.existsSync(timetablesDir)) {
    fs.mkdirSync(timetablesDir, { recursive: true });
  }

  const ext = path.extname(originalName || filePath) || '.pdf';
  const savedFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const targetPath = path.join(timetablesDir, savedFilename);
  fs.copyFileSync(filePath, targetPath);

  // Save metadata to timetable_files
  await db.query('DELETE FROM timetable_files WHERE batch_id = ?', [targetBatch.id]);
  await db.query(
    'INSERT INTO timetable_files (batch_id, filename, original_name, title) VALUES (?, ?, ?, ?)',
    [targetBatch.id, savedFilename, originalName || path.basename(filePath), parsed.title || 'Official Timetable']
  );

  return {
    batch: targetBatch,
    title: parsed.title,
    entriesCount: parsed.entries.length,
    added,
    errors,
    savedFilename,
  };
}

module.exports = {
  runPythonParser,
  importPdfTimetable,
};
