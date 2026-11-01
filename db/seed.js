// Sample data for the demo. Run after schema.sql: npm run seed
// Every demo account uses the password: password123
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function seed() {
  const hash = await bcrypt.hash('password123', 10);

  await db.query(`INSERT INTO batches (name, student_count) VALUES
    ('E21', 180), ('E22', 160), ('E23', 120), ('E24', 60)`);

  await db.query(`INSERT INTO halls (name, short_code, building, floor, capacity, directions) VALUES
    ('Main Lecture Theatre', 'MLT', 'Administration Building', 'Ground', 250, 'Enter from the main entrance, first door on the left.'),
    ('Lecture Hall 1', 'LH1', 'Lecture Hall Complex', 'Ground', 180, 'Lecture Hall Complex, turn right after the stairs.'),
    ('Lecture Hall 2', 'LH2', 'Lecture Hall Complex', '1st', 130, 'Lecture Hall Complex, first floor, above LH1.'),
    ('Electrical Computer Centre', 'ECC', 'Department of Electrical and Information Engineering', '2nd', 90, 'EIE building, second floor, end of the corridor.'),
    ('Drawing Office', 'DO', 'Civil Engineering Building', '1st', 70, 'Civil building, first floor, next to the staff room.'),
    ('New Computer Centre', 'NCC', 'Computer Centre', 'Ground', 120, 'New Computer Centre building, ground floor.'),
    ('Old Computer Centre', 'OCC', 'Computer Centre', 'Ground', 80, 'Old Computer Centre building, ground floor.'),
    ('Auditorium', 'AUD', 'Faculty Auditorium', 'Ground', 400, 'Faculty Auditorium, main entrance.')`);

  await db.query(`INSERT INTO time_slots (label, start_time, end_time) VALUES
    ('08:00-10:00', '08:00', '10:00'), ('10:00-12:00', '10:00', '12:00'),
    ('13:00-15:00', '13:00', '15:00'), ('15:00-17:00', '15:00', '17:00')`);

  await db.query(`INSERT INTO users (name, email, password_hash, role, batch_id, society) VALUES
    ('Admin', 'admin@smarthall.test', ?, 'admin', NULL, NULL),
    ('E21 Rep', 'rep.e21@smarthall.test', ?, 'rep', 1, NULL),
    ('E22 Rep', 'rep.e22@smarthall.test', ?, 'rep', 2, NULL),
    ('IEEE President', 'ieee@smarthall.test', ?, 'president', NULL, 'IEEE Student Branch')`, [hash, hash, hash, hash]);

  // Master timetable rows, halls left empty for auto-allocation
  await db.query(`INSERT INTO timetable_entries (batch_id, subject, day_of_week, time_slot_id) VALUES
    (1, 'EE4307 Web Application Development', 1, 1), (1, 'EE4201 Signals and Systems', 1, 2),
    (2, 'EE3301 Electronics', 1, 1), (2, 'EE3204 Data Structures', 2, 2),
    (3, 'IS2101 Mathematics', 1, 1), (3, 'EE2302 Circuit Theory', 3, 3),
    (4, 'IS1101 Programming', 1, 1), (4, 'IS1203 Physics', 4, 4)`);

  console.log('Seeded. Log in with any @smarthall.test account, password: password123');
  await db.end();
}

seed().catch((err) => { console.error(err.message); process.exit(1); });
