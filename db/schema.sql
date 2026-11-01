-- SmartHall AI database. Run: mysql -u root -p < db/schema.sql
DROP DATABASE IF EXISTS smarthall;
CREATE DATABASE smarthall;
USE smarthall;

CREATE TABLE batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  student_count INT NOT NULL CHECK (student_count > 0)
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin', 'rep', 'president') NOT NULL,
  batch_id INT NULL,               -- reps only
  society VARCHAR(100) NULL,       -- presidents only
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL
);

CREATE TABLE halls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  short_code VARCHAR(20) NOT NULL UNIQUE,
  building VARCHAR(100) NOT NULL,
  floor VARCHAR(20) NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  directions VARCHAR(255) NULL,
  photo VARCHAR(255) NULL
);

-- Teaching periods, the same every weekday (e.g. 08:00-10:00)
CREATE TABLE time_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(30) NOT NULL UNIQUE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);

-- The fixed weekly timetable. hall_id is NULL until auto-allocation places it.
CREATE TABLE timetable_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  subject VARCHAR(100) NOT NULL,
  day_of_week TINYINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = Monday
  time_slot_id INT NOT NULL,
  hall_id INT NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
  FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE SET NULL,
  UNIQUE KEY one_class_per_batch (batch_id, day_of_week, time_slot_id),
  UNIQUE KEY one_class_per_hall (hall_id, day_of_week, time_slot_id)
);

-- One-off bookings: extra lectures by reps, events by societies
CREATE TABLE bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hall_id INT NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  booked_by INT NOT NULL,
  batch_id INT NULL,
  purpose VARCHAR(255) NOT NULL,
  type ENUM('lecture', 'society') NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL,
  letter_file VARCHAR(255) NULL,
  ai_reason VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE CASCADE,
  FOREIGN KEY (booked_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  CHECK (end_at > start_at),
  INDEX (hall_id, start_at)
);

-- Official timetable files uploaded by admin (e.g. PDF timetables)
CREATE TABLE timetable_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);
