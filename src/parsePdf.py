#!/usr/bin/env python3
"""
Extracts timetable structure and lectures from a PDF timetable.
Outputs JSON to stdout.
"""
import sys
import json
import re

try:
    import pypdf
except ImportError:
    print(json.dumps({'error': 'pypdf is not installed'}))
    sys.exit(1)

def parse_pdf(file_path):
    reader = pypdf.PdfReader(file_path)
    if len(reader.pages) == 0:
        return {'error': 'Empty PDF'}

    full_text = '\n'.join(p.extract_text() for p in reader.pages)
    
    # 1. Detect Batch and Title
    title = 'Lecture Timetable'
    batch_name = None
    for line in full_text.splitlines()[:10]:
        line_clean = line.strip()
        if 'timetable' in line_clean.lower():
            title = line_clean
        bm = re.search(r'(\d+)(?:st|nd|rd|th)?\s+batch', line_clean, re.IGNORECASE)
        if bm and not batch_name:
            batch_name = bm.group(1)
        em = re.search(r'\b(E\d{2})\b', line_clean, re.IGNORECASE)
        if em and not batch_name:
            batch_name = em.group(1).upper()

    # 2. Extract Course Module Names and Halls (typically on page 2 or notes)
    course_map = {}
    hall_map = {}
    for line in full_text.splitlines():
        # Match e.g. "EC5301 Control Systems Design" or "IS5311 Discrete Mathematics"
        m = re.match(r'([A-Z]{2}\d{4})\s+(.+)', line.strip())
        if m:
            code = m.group(1)
            name = m.group(2).strip()
            # ignore header labels
            if not any(k in name.lower() for k in ['time', 'monday', 'tuesday', 'notes']):
                course_map[code] = name
        
        # Match e.g. "LT1 - Lecture Theatre – 1"
        hm = re.match(r'([A-Z0-9]+)\s*-\s*(.+)', line.strip())
        if hm:
            hcode = hm.group(1).strip()
            hname = hm.group(2).strip()
            if not hcode.startswith(('EC', 'IS')) and not hcode.isdigit():
                hall_map[hcode] = hname

    # 3. Coordinate-based cell extraction on Page 1
    page1 = reader.pages[0]
    items = []
    def visitor(text, cm, tm, fontDict, fontSize):
        t = text.strip()
        if t:
            items.append((tm[4], tm[5], t))
    page1.extract_text(visitor_text=visitor)

    # Standard timetable time rows for RUHUNA Faculty of Engineering
    time_rows = [
        ('08:30-09:30', '08:30:00', '09:30:00', 380, 425),
        ('09:30-10:30', '09:30:00', '10:30:00', 340, 380),
        ('10:30-11:30', '10:30:00', '11:30:00', 295, 340),
        ('11:30-12:30', '11:30:00', '12:30:00', 250, 295),
        ('13:30-14:30', '13:30:00', '14:30:00', 170, 215),
        ('14:30-15:30', '14:30:00', '15:30:00', 125, 170),
        ('15:30-16:30', '15:30:00', '16:30:00',  80, 125),
        ('16:30-17:30', '16:30:00', '17:30:00',  50,  80),
    ]

    day_cols = [
        (1, 'Mon', 170, 270),
        (2, 'Tue', 270, 390),
        (3, 'Wed', 390, 500),
        (4, 'Thu', 500, 630),
        (5, 'Fri', 630, 760),
    ]

    entries = []
    for slot_label, start_t, end_t, ymin, ymax in time_rows:
        for day_num, day_name, xmin, xmax in day_cols:
            cell_items = [t for x, y, t in items if xmin <= x < xmax and ymin <= y < ymax]
            if not cell_items:
                continue
            raw = ' '.join(cell_items)
            if 'lunch' in raw.lower() or not raw.strip():
                continue

            cleaned = re.sub(r'E\s*C\s*(\d{4})', r'EC\1', raw)
            cleaned = re.sub(r'I\s*S\s*(\d{4})', r'IS\1', cleaned)
            cleaned = re.sub(r'\[\s+', '[', cleaned)
            cleaned = re.sub(r'\s+\]', ']', cleaned)
            cleaned = re.sub(r'LT\s+1', 'LT1', cleaned)
            cleaned = re.sub(r'LT\s+2', 'LT2', cleaned)
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()

            hall_code = None
            hm = re.search(r'\[([A-Za-z0-9]+)\]', cleaned)
            if hm:
                hall_code = hm.group(1).strip()

            cm = re.search(r'\b([A-Z]{2}\d{4})(?:-Lab)?\b', cleaned)
            if cm:
                code = cm.group(1)
                is_lab = '-Lab' in cleaned or '- Lab' in cleaned or 'lab' in cleaned.lower()
                module_name = course_map.get(code, '')
                if is_lab:
                    subject = f'{code} {module_name} (Lab)'.strip() if module_name else f'{code} Lab'
                elif module_name:
                    subject = f'{code} {module_name}'.strip()
                else:
                    subject = code
            else:
                subject = cleaned

            # Normalize subject length
            if len(subject) > 95:
                subject = subject[:95]

            entries.append({
                'day': day_num,
                'dayName': day_name,
                'slot': slot_label,
                'startTime': start_t,
                'endTime': end_t,
                'subject': subject,
                'hallCode': hall_code,
                'raw': raw
            })

    return {
        'title': title,
        'batch': batch_name,
        'courses': course_map,
        'halls': hall_map,
        'entries': entries
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No file path provided'}))
        sys.exit(1)
    result = parse_pdf(sys.argv[1])
    print(json.dumps(result))
