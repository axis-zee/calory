#!/usr/bin/env python3
"""
Seed calory.db with diary data for user 'zayt'.
- Days with macro subtotals use those values
- Days without macros get per-ingredient estimates
- Incomplete/nutrition-only days are skipped
All food items are stored as individual meals for tracking.
"""

import sqlite3, sys

DB_PATH = "calory.db"

# ============================================================
# DAY DATA — structure: { date: {
#   "meals": [{"name": "..", "grams": .., "kcal":.., "protein":.., "fat":.., "carbs_total":.., "fiber":.., "net_carbs":..}],
#   "day_totals": { "kcal":.., "protein":.., "fat":.., "carbs_total":.., "fiber":.., "net_carbs":.. }}
# ============================================================

days = {

    # ===== 2026-02-18: lubiye + rice, no macros, carb estimate only =====
    "2026-02-18": {
        "meals": [
            {"name": "Lubiye (green beans/haricot vert)", "grams": 350, "kcal": 109, "protein": 5, "fat": 0.2, "carbs_total": 20, "fiber": 7.5, "net_carbs": 12.5},
            {"name": "2 tbsp cooked rice", "grams": 30, "kcal": 40, "protein": 0.8, "fat": 0.2, "carbs_total": 9, "fiber": 0, "net_carbs": 9},
        ],
        "day_totals": {"kcal": 149, "protein": 5.8, "fat": 0.4, "carbs_total": 29, "fiber": 7.5, "net_carbs": 21.5},
    },

    # ===== 2026-02-19: iftar during Ramadan, kcal given for items =====
    "2026-02-19": {
        "meals": [
            {"name": "Ribeye (~450g)", "grams": 450, "kcal": 1300, "protein": 117, "fat": 90, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Salad (pomegranate + romaine)", "grams": 200, "kcal": 250, "protein": 4, "fat": 15, "carbs_total": 18, "fiber": 3, "net_carbs": 15},
            {"name": "Pistachio nuts", "grams": 40, "kcal": 225, "protein": 8, "fat": 16, "carbs_total": 11, "fiber": 4, "net_carbs": 7},
            {"name": "2 grapes", "grams": 30, "kcal": 21, "protein": 0.2, "fat": 0, "carbs_total": 5.2, "fiber": 0.3, "net_carbs": 4.9},
        ],
        "day_totals": {"kcal": 1796, "protein": 129.2, "fat": 121, "carbs_total": 34.2, "fiber": 3.3, "net_carbs": 26.9},
    },

    # ===== 2026-02-20: food listed, no macros =====
    "2026-02-20": {
        "meals": [
            {"name": "Ribeye (~450g)", "grams": 450, "kcal": 1305, "protein": 117, "fat": 90, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Minced meat kafta (~100g, ~20% fat)", "grams": 100, "kcal": 290, "protein": 18, "fat": 23, "carbs_total": 2, "fiber": 0, "net_carbs": 2},
            {"name": "Big bowl of salad", "grams": 300, "kcal": 120, "protein": 3, "fat": 8, "carbs_total": 10, "fiber": 4, "net_carbs": 6},
            {"name": "Pistachios (~80g kernels)", "grams": 80, "kcal": 449, "protein": 16.2, "fat": 33, "carbs_total": 22, "fiber": 8.2, "net_carbs": 13.8},
        ],
        "day_totals": {"kcal": 2164, "protein": 154.2, "fat": 154, "carbs_total": 10, "fiber": 4.2, "net_carbs": 21.8},
    },

    # ===== 2026-02-21: merged body notes + food =====
    "2026-02-21": {
        "meals": [
            {"name": "Ribeye (~300g)", "grams": 300, "kcal": 870, "protein": 78, "fat": 60, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Skank stew bowl (mostly meat, few spoonfuls potato/carrot)", "grams": 350, "kcal": 520, "protein": 45, "fat": 32, "carbs_total": 18, "fiber": 3, "net_carbs": 15},
            {"name": "Cashew + pistachio nuts (evening mix, ~80g total)", "grams": 80, "kcal": 480, "protein": 14, "fat": 38, "carbs_total": 22, "fiber": 4, "net_carbs": 18},
            {"name": "Dark chocolate 85% (~15g)", "grams": 15, "kcal": 81, "protein": 1.2, "fat": 6, "carbs_total": 2.3, "fiber": 1.5, "net_carbs": 0.8},
        ],
        "day_totals": {"kcal": 1951, "protein": 138.2, "fat": 136, "carbs_total": 42.3, "fiber": 4.5, "net_carbs": 33.8},
    },

    # ===== 2026-02-22: skipped (no food, only body notes) =====

    # ===== 2026-02-23: HAS subtotals + day note=====
    "2026-02-23": {
        "meals": [
            {"name": "Salad (half portion)", "grams": 668, "kcal": 364, "protein": 6.6, "fat": 29, "carbs_total": 22, "fiber": 6, "net_carbs": 16},
            {"name": "Meat mix (300g beef/sausage/coq sausage)", "grams": 300, "kcal": 1250, "protein": 96, "fat": 102, "carbs_total": 6, "fiber": 0, "net_carbs": 6},
            {"name": "Pistachio ~30g (approx kernels, in-shell 60g)", "grams": 30, "kcal": 168, "protein": 6, "fat": 14, "carbs_total": 8.4, "fiber": 3, "net_carbs": 5.4},
            {"name": "Dark chocolate 20g", "grams": 20, "kcal": 108, "protein": 1.4, "fat": 7.4, "carbs_total": 3.6, "fiber": 1.6, "net_carbs": 2},
            {"name": "Cheese (~200g mix)", "grams": 200, "kcal": 640, "protein": 46, "fat": 52, "carbs_total": 2, "fiber": 0, "net_carbs": 2},
        ],
        "day_totals": {"kcal": 2530, "protein": 155.6, "fat": 204.4, "carbs_total": 42, "fiber": 10.6, "net_carbs": 31.4},
    },

    # ===== 2026-02-24: HAS subtotals + snacks =====
    "2026-02-24": {
        "meals": [
            {"name": "Salad Subtotal", "grams": 462, "kcal": 476, "protein": 9, "fat": 35, "carbs_total": 34, "fiber": 10.6, "net_carbs": 23.4},
            {"name": "Salmon (~550g)", "grams": 550, "kcal": 1238, "protein": 110, "fat": 87, "carbs_total": 1, "fiber": 0.1, "net_carbs": 0.9},
            {"name": "Arla Lille Knas 22g", "grams": 22, "kcal": 88, "protein": 6, "fat": 7, "carbs_total": 0.2, "fiber": 0, "net_carbs": 0.2},
            {"name": "Arla Unika Umage Havbrise 20g", "grams": 20, "kcal": 80, "protein": 5, "fat": 7, "carbs_total": 0.1, "fiber": 0, "net_carbs": 0.1},
            {"name": "Prima Donna 15g", "grams": 15, "kcal": 60, "protein": 4, "fat": 5, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Pistachio kernels 25g", "grams": 25, "kcal": 141, "protein": 5.1, "fat": 10.8, "carbs_total": 6.8, "fiber": 2.7, "net_carbs": 4.1},
            {"name": "Dark chocolate 85% 20g", "grams": 20, "kcal": 120, "protein": 2, "fat": 8.8, "carbs_total": 3.6, "fiber": 2, "net_carbs": 1.6},
        ],
        "day_totals": {"kcal": 2303, "protein": 141.1, "fat": 158.6, "carbs_total": 45.8, "fiber": 15.4, "net_carbs": 30.3},
    },

    # ===== 2026-03-08: skipped (body note only, no food) =====

    # ===== 2026-03-24: cheese snacks, no macros =====
    "2026-03-24": {
        "meals": [
            {"name": "Gouda Castello 38g", "grams": 38, "kcal": 152, "protein": 10.3, "fat": 11.8, "carbs_total": 0.6, "fiber": 0, "net_carbs": 0.6},
            {"name": "Cheddar Castello 36g", "grams": 36, "kcal": 148, "protein": 9.4, "fat": 12.2, "carbs_total": 0.4, "fiber": 0, "net_carbs": 0.4},
            {"name": "Creamy White Castello 60g", "grams": 60, "kcal": 190, "protein": 12, "fat": 15.6, "carbs_total": 1.2, "fiber": 0, "net_carbs": 1.2},
            {"name": "Ikon Havarti Castello 31g", "grams": 31, "kcal": 122, "protein": 7.5, "fat": 10, "carbs_total": 0.3, "fiber": 0, "net_carbs": 0.3},
            {"name": "Høstost 63g", "grams": 63, "kcal": 243, "protein": 15.5, "fat": 19.3, "carbs_total": 0.4, "fiber": 0, "net_carbs": 0.4},
        ],
        "day_totals": {"kcal": 855, "protein": 54.7, "fat": 68.9, "carbs_total": 2.9, "fiber": 0, "net_carbs": 2.9},
    },

    # ===== 2026-03-25: beef, salmon, mixed veg =====
    "2026-03-25": {
        "meals": [
            {"name": "Ribeye (~380g)", "grams": 380, "kcal": 1102, "protein": 99, "fat": 76, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Salmon (~300g)", "grams": 300, "kcal": 624, "protein": 60, "fat": 39, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Mixed veg bowl (cauliflower, broccoli, Brussels sprouts, asparagus, carrots)", "grams": 200, "kcal": 76, "protein": 5, "fat": 1, "carbs_total": 15, "fiber": 7, "net_carbs": 8},
        ],
        "day_totals": {"kcal": 1802, "protein": 164, "fat": 116, "carbs_total": 15, "fiber": 7, "net_carbs": 8},
    },

    # ===== 2026-03-26: mixed veg, avocado, onion, beef, cheddar, kefir =====
    "2026-03-26": {
        "meals": [
            {"name": "Cauliflower (~220g)", "grams": 220, "kcal": 74, "protein": 5.7, "fat": 0.6, "carbs_total": 15, "fiber": 6.8, "net_carbs": 8.2},
            {"name": "Asparagus (~200g)", "grams": 200, "kcal": 40, "protein": 3.9, "fat": 0.2, "carbs_total": 7.8, "fiber": 4.6, "net_carbs": 3.2},
            {"name": "Avocado (~1 whole, ~150g edible)", "grams": 150, "kcal": 240, "protein": 3, "fat": 22, "carbs_total": 13, "fiber": 9.3, "net_carbs": 3.7},
            {"name": "Red onion (~80g)", "grams": 80, "kcal": 32, "protein": 0.9, "fat": 0.1, "carbs_total": 7.4, "fiber": 2.2, "net_carbs": 5.2},
            {"name": "Beef 15% fat (~400g)", "grams": 400, "kcal": 1000, "protein": 84, "fat": 68, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Cheddar cheese 10g", "grams": 10, "kcal": 40, "protein": 2.5, "fat": 3.3, "carbs_total": 0.1, "fiber": 0, "net_carbs": 0.1},
            {"name": "Culture kefir (~100g)", "grams": 100, "kcal": 50, "protein": 3.5, "fat": 2.5, "carbs_total": 4, "fiber": 0, "net_carbs": 4},
        ],
        "day_totals": {"kcal": 1476, "protein": 103.5, "fat": 96.7, "carbs_total": 47.3, "fiber": 22.9, "net_carbs": 24.4},
    },

    # ===== 2026-04-18: HAS day total (kcal, net carbs) but missing P/F =====
    "2026-04-18": {
        "meals": [
            {"name": "Culotte (~400g)", "grams": 400, "kcal": 1000, "protein": 104, "fat": 60, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Asparagus (~50g)", "grams": 50, "kcal": 10, "protein": 1, "fat": 0.1, "carbs_total": 2, "fiber": 1.1, "net_carbs": 0.9},
            {"name": "Broccoli (~50g)", "grams": 50, "kcal": 17, "protein": 1.4, "fat": 0.1, "carbs_total": 3.4, "fiber": 1.6, "net_carbs": 1.8},
            {"name": "Chicken thigh (~1 whole, ~170g edible)", "grams": 170, "kcal": 290, "protein": 25, "fat": 20, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
            {"name": "Almonds (~50g)", "grams": 50, "kcal": 290, "protein": 10.5, "fat": 25.1, "carbs_total": 10.6, "fiber": 3.5, "net_carbs": 7.1},
        ],
        "day_totals": {"kcal": 2464, "protein": 140, "fat": 100, "carbs_total": 12, "fiber": 5.6, "net_carbs": 6.4},
        # Note: Diary says 2464 kcal / 4g net carbs. My estimate gives 2607 kcal / 9.8g net.
        # I'll override to match diary totals for day totals but keep meal-level estimates.
    },

    # ===== 2026-04-19: HAS meal subtotals + day total =====
    "2026-04-19": {
        "meals": [
            {"name": "Scrambled egg subtotal (250g eggs, 1tsp butter, 1tsp ghee)", "grams": 265, "kcal": 469, "protein": 33, "fat": 37, "carbs_total": 3, "fiber": 0, "net_carbs": 3},
            {"name": "Almonds (115g)", "grams": 115, "kcal": 667, "protein": 24, "fat": 57, "carbs_total": 25, "fiber": 7.6, "net_carbs": 17.4},
            {"name": "Shish kebab subtotal (3x, ~450g meat)", "grams": 450, "kcal": 1050, "protein": 77, "fat": 76, "carbs_total": 6, "fiber": 0, "net_carbs": 6},
            {"name": "Cheese subtotal (190g gouda/cheddar/castle creamy white)", "grams": 190, "kcal": 665, "protein": 48, "fat": 55, "carbs_total": 0, "fiber": 0, "net_carbs": 0},
        ],
        "day_totals": {"kcal": 2851, "protein": 182, "fat": 225, "carbs_total": 34, "fiber": 7.6, "net_carbs": 26.4},
    },
}


def seed_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    c = conn.cursor()

    # Get user_id for 'zayt'
    user = c.execute('SELECT user_id FROM users WHERE username = ?', ("zayt",)).fetchone()
    if not user:
        print("ERROR: user 'zayt' not found in database. Register first.")
        sys.exit(1)
    user_id = user[0]
    print(f"Seeding days for user: zayt (id={user_id})")

    skipped_dates = {"2026-02-22", "2026-03-08"}

    count_meals = 0
    count_days = 0

    for date_str in sorted(days, key=lambda d: d):
        if date_str in skipped_dates:
            print(f"  Skipping {date_str} — no food logged")
            continue

        data = days[date_str]

        # Upsert day totals
        c.execute("""
            INSERT OR REPLACE INTO days (date, user_id, kcal, protein, fat, carbs_total, fiber, net_carbs)
            VALUES (? ,?, ?, ?, ?, ?, ?, ?)
        """, (date_str, user_id,
              data["day_totals"]["kcal"],
              data["day_totals"]["protein"],
              data["day_totals"]["fat"],
              data["day_totals"]["carbs_total"],
              data["day_totals"]["fiber"],
              data["day_totals"]["net_carbs"]))
        count_days += 1

        # Insert meals
        for m in data["meals"]:
            c.execute("""
                INSERT INTO meals (date, user_id, name, grams, kcal, protein, fat, carbs_total, fiber, net_carbs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (date_str, user_id,
                  m["name"], m["grams"],
                  m["kcal"], m["protein"], m["fat"],
                  m["carbs_total"], m["fiber"], m["net_carbs"]))
            count_meals += 1

        print(f"  {date_str}: {len(data['meals'])} meals, {data['day_totals']['kcal']} kcal, {data['day_totals']['net_carbs']}g net carbs")

    conn.commit()
    conn.close()
    print(f"\nDone! {count_days} days, {count_meals} meals inserted for user 'zayt'")


if __name__ == "__main__":
    seed_db()
