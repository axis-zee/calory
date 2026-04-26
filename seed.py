#!/usr/bin/env python3
"""Parse Diary.md and seed a SQLite database for SQLPage."""
import sqlite3, re, os

DIARY_PATH = os.path.expanduser("~/Documents/obsidian/brain/1. Projects/KETO/Diary.md")
DB_PATH = "calory.db"

def try_float(s):
    if not s:
        return None
    s = s.strip().replace(',', '').replace('~', '').replace('g', '')
    try:
        return float(s)
    except:
        return None

def parse_block(block):
    day_match = re.search(r'(?:DAG|Dag)\s+(\d+)', block)
    if not day_match:
        return None, [], None
    day_num = int(day_match.group(1))

    mac = [
        (r'\*\*Kcal:?\*\*\s*[~]?\s*([\d,.]+)', 'kcal'),
        (r'\*\*Kalorier:?\*\*\s*[~]?\s*([\d,.]+)', 'kcal'),
        (r'\*\*Protein:?\*\*\s*[~]?\s*([\d,.]+)', 'protein'),
        (r'\*\*Fedt:?\*\*\s*[~]?\s*([\d,.]+)', 'fat'),
        (r'\*\*Kulhydrat\s+total:?\*\*\s*[~]?\s*([\d,.]+)', 'carbs_total'),
        (r'\*\*Fiber:?\*\*\s*[~]?\s*([\d,.]+)', 'fiber'),
        (r'\*\*Netto\s+kulhydrat:?\*\*\s*[~]?\s*([\d,.]+)', 'net_carbs'),
    ]

    all_meals = []
    day_totals = {}

    # 1. Extract DAGTOTAL section first (if present)
    dt_match = re.search(r'#\s*DAGTOTAL\s*\n((?:-.*\n?)*)', block, re.DOTALL)
    if dt_match:
        for pat, key in mac:
            m = re.search(pat, dt_match.group(1))
            if m:
                val = try_float(m.group(1))
                if val is not None:
                    day_totals[key] = val

    # 2. Split at subtotal headers for meal subtotals
    sub_blocks = re.split(r'(?=###\s+.+?subtotal)', block)
    for sb in sub_blocks:
        if '###' not in sb or 'subtotal' not in sb:
            continue
        nm = re.search(r'###\s+(.+?)\s+subtotal', sb)
        if not nm:
            continue
        sub = dict(grams=0, kcal=0, protein=0, fat=0, carbs_total=0, fiber=0, net_carbs=0)
        for pat, key in mac:
            m = re.search(pat, sb)
            if m:
                val = try_float(m.group(1))
                if val is not None:
                    sub[key] = val
        sub['name'] = nm.group(1).strip()
        sub['day_num'] = day_num
        all_meals.append(sub)

    # 3. Extract food lines (not subtotal headers)
    for line in block.split('\n'):
        line = line.strip()
        if 'subtotal' in line.lower() or '###' in line:
            continue
        gm = re.match(r'^[-\s]*(\d+)g\s+(.+)$', line)
        if gm:
            fn = gm.group(2).strip().lstrip('-').strip()
            if not any(s in fn.lower() for s in ['subtotal', 'måltid', 'net carbs', 'samlet', 'snacks']):
                all_meals.append(dict(
                    day_num=day_num, name=fn, grams=int(gm.group(1)),
                    kcal=0, protein=0, fat=0, carbs_total=0, fiber=0, net_carbs=0))

    # 4. If no DAGTOTAL, look for bold macros in the header+food section (before first subtotal)
    if not day_totals:
        # Get the section before the first subtotal
        non_sub = re.split(r'(?=###\s+.+?subtotal)', block)
        if non_sub:
            first_part = non_sub[0]
            # Remove the day header line itself
            first_part = re.sub(r'^.*(?:DAG|Dag)\s+\d+:.*?\n', '', first_part, count=1, flags=re.DOTALL)
            for pat, key in mac:
                m = re.search(pat, first_part)
                if m:
                    val = try_float(m.group(1))
                    if val is not None:
                        day_totals[key] = val

    return day_num, all_meals, day_totals


def parse_diary(path):
    with open(path) as f:
        text = f.read()
    text = '\n' + text
    blocks = re.split(r'(?=\n(?:#\s*)?(?:DAG|Dag)\s+\d+:)', text)
    blocks = [b for b in blocks if b.strip()]

    days = {}
    all_meals = []

    for block in blocks:
        result = parse_block(block)
        if result[0] is None:
            continue
        day_num, meals, day_totals = result

        if day_num not in days:
            days[day_num] = dict(day_num=day_num, kcal=0, protein=0, fat=0, carbs_total=0, fiber=0, net_carbs=0)

        for k, v in day_totals.items():
            days[day_num][k] = v
        all_meals.extend(meals)

    return days, all_meals


def seed_db(days, all_meals):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DROP TABLE IF EXISTS days')
    c.execute('DROP TABLE IF EXISTS meals')
    c.execute('CREATE TABLE days (day_num INTEGER PRIMARY KEY, kcal REAL, protein REAL, fat REAL, carbs_total REAL, fiber REAL, net_carbs REAL)')
    c.execute('CREATE TABLE meals (id INTEGER PRIMARY KEY AUTOINCREMENT, day_num INTEGER, name TEXT, grams INTEGER, kcal REAL, protein REAL, fat REAL, carbs_total REAL, fiber REAL, net_carbs REAL, FOREIGN KEY(day_num) REFERENCES days(day_num))')
    for d in days.values():
        c.execute('INSERT INTO days VALUES (?,?,?,?,?,?,?)', (d['day_num'],d['kcal'],d['protein'],d['fat'],d['carbs_total'],d['fiber'],d['net_carbs']))
    for m in all_meals:
        c.execute('INSERT INTO meals (day_num,name,grams,kcal,protein,fat,carbs_total,fiber,net_carbs) VALUES (?,?,?,?,?,?,?,?,?)',
                  (m['day_num'],m['name'],m['grams'],m['kcal'],m['protein'],m['fat'],m['carbs_total'],m['fiber'],m['net_carbs']))
    conn.commit()
    conn.close()

if __name__ == '__main__':
    days, all_meals = parse_diary(DIARY_PATH)
    seed_db(days, all_meals)
    print("\n=== DAYS ===")
    for d in sorted(days.values(), key=lambda x: x['day_num']):
        print(f"  Day {d['day_num']:3d}: {d['kcal']:6.0f} kcal, {d['protein']:5.1f}g prot, {d['fat']:5.1f}g fat, {d['carbs_total']:5.1f}g carbs, {d['net_carbs']:5.1f}g net")
    print(f"\n=== MEALS ({len(all_meals)} total) ===")
    for m in all_meals:
        print(f"  Day {m['day_num']:3d}: {m['name'][:45]:45s} | {m['kcal']:6.0f} kcal | {m['grams']}g")
