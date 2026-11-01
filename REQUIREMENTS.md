# SmartHall AI — University Hall Allocation and Navigation System

EC4307 Web Application Development mini project. Deadline: 31 Oct 2026.

## Problem
Batch reps have no system for hall allocation. Students and reps can't see which hall a lecture is in, and nobody can book a free hall without asking around.

## Stack
Node.js + Express, EJS server-rendered pages, MySQL. Sessions for login, passwords hashed with bcrypt, file upload with multer. Claude API (needs an API key in `.env`) for the permission-letter check only.

## Roles

| Role | Login | Can | Cannot |
|---|---|---|---|
| Admin | yes | Add, edit and delete halls, time slots, batches and users. Upload the master timetable and run auto-allocation. Approve or reject society bookings. | — |
| Rep (one per batch) | yes | View their batch timetable. Edit their batch's fixed timetable entries. Book, edit or cancel a free hall for their own batch's lectures. Confirmed instantly, no admin approval. | Add or remove halls or slots. Touch other batches' timetable or bookings. |
| Society president | yes | Book a hall by uploading the signed, approved permission letter (PDF/JPG/PNG scan). The booking is confirmed instantly if the AI check passes. View their own bookings. | Book without a letter that passes the check |
| Student | no | View any batch timetable, hall availability and hall locations | Any changes |
| Anyone | no | Use the chatbot | — |

Permission checks run on the server, not only by hiding buttons.

## Features

1. **Halls (CRUD, admin):** name, building, floor, capacity, directions note, optional photo.
2. **Master timetable (admin):** upload a CSV (batch, subject, day, slot, student count) or add rows by form.
3. **Auto-allocation:** each timetable entry gets the smallest free hall with capacity ≥ student count. Entries that can't be placed are listed as clashes.
4. **Fixed timetable edits (rep, own batch):** change day, slot or hall. The server rejects the change if the hall is taken or too small.
5. **Bookings (CRUD):** one-off bookings with a start and end date-time. Society events can run past midnight; the sample letter runs from 5:30 am on 31 Oct to 5:30 am on 1 Nov. Reps pick a date and slot for their batch, and the booking is confirmed straight away (`approved`, no admin step) as long as the hall is free and big enough. Society bookings go through the AI letter check (feature 9).
6. **Views:** timetable by batch; hall availability by date. Search, filter and sort by hall, batch, date and status.
7. **Navigation:** every hall shows its building, floor and directions note.
8. **Chatbot (rule-based):** e.g. "free halls on 25 Oct at 10am for 120 students". It extracts the date, time and count, queries the database and replies with matching halls and their locations. If a part is missing, it asks for it.
9. **AI permission-letter check (society bookings):** the uploaded scan and the booking form details are sent to the Claude API, which returns pass or fail with a reason. A letter passes only if:
   - it is addressed **To: Deputy Registrar, Faculty of Engineering**, and sent **Through** the society's staff counselor;
   - the society named in the letter is the president's society;
   - the venue matches the hall being booked (by name or short code, e.g. "ECC" = Electrical Computer Centre);
   - the date and time range in the letter covers the booked start and end;
   - it carries the requester's signature, the counselor's signature, and the Deputy Registrar's approval (signature or "Approved" note).

   **Pass** → `approved` straight away. **Fail** → `rejected`, and the reason is shown to the president. **API unavailable** → `pending`, and the admin approves by hand.

   The AI cannot detect forged signatures, so every society booking shows "AI-verified" with the reason, and the admin can revoke any booking.

## Database (MySQL)
- `users` (id, name, email, password_hash, role, batch_id NULL, society NULL)
- `batches` (id, name, student_count)
- `halls` (id, name, short_code, building, floor, capacity, directions, photo)
- `time_slots` (id, label, start_time, end_time) — the same periods every weekday
- `timetable_entries` (id, batch_id, subject, day_of_week, time_slot_id, hall_id NULL)
- `bookings` (id, hall_id, start_at, end_at, booked_by, batch_id NULL, purpose, type[lecture|society], status[pending|approved|rejected], letter_file NULL, ai_reason NULL)

Double booking is blocked in two ways. A unique key stops two fixed timetable entries sharing a hall and slot. For one-off bookings, the server rejects any booking whose time range overlaps an active booking or a fixed lecture in the same hall.

## Rubric coverage
- **CRUD:** halls, bookings, timetable entries
- **Validation:** client-side and server-side
- **ERD, README, screenshots:** in the repo
- **Version control:** git

## Out of scope
- Email notifications
- Campus map
- AI/LLM chatbot (the chatbot stays rule-based; AI is used only for letters)
- Verifying that signatures are genuine
- Student accounts
- Mobile app
