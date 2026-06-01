#!/usr/bin/env python3
"""Ingest Open Food Facts into calory.db food_db table.
Uses Python csv module streaming through the gzipped tab-separated CSV line-by-line.

Columns needed (tab-separated order):
  10: product_name
  89: energy-kcal_100g
  90: energy_100g
  92: fat_100g
  108: carbohydrates_100g
  126: fiber_100g
  127: proteins_100g
"""

import csv
import gzip
import sqlite3
import os
import time
import sys

CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "openfoodfacts.csv.gz")
DB_PATH = os.path.join(os.path.dirname(__file__), "calory.db")

# Increase field size limit to handle CSV fields with embedded tabs/spaces
csv.field_size_limit(10_000_000)

# Column indices (0-based) found by examining column headers
COL_IDX = {
    "product_name": 10,
    "energy-kcal_100g": 89,
    "fat_100g": 92,
    "carbohydrates_100g": 129,
    "fiber_100g": 146,
    "proteins_100g": 150,
}

def parse_float(val):
    """Return float or None."""
    if val is None or val.strip() == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def ingest():
    t0 = time.time()
    
    print(f"Reading CSV from {CSV_PATH}")
    n_total = 0
    n_blank_name = 0
    
    rows = []
    with gzip.open(CSV_PATH, "rt", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t", quotechar='"', doublequote=True)
        for row in reader:
            n_total += 1
            
            # Get product_name
            name = row[COL_IDX["product_name"]].strip()
            if not name:
                n_blank_name += 1
                continue
            
            kcal = parse_float(row[COL_IDX["energy-kcal_100g"]])
            fat = parse_float(row[COL_IDX["fat_100g"]])
            carbs = parse_float(row[COL_IDX["carbohydrates_100g"]])
            fiber = parse_float(row[COL_IDX["fiber_100g"]])
            protein = parse_float(row[COL_IDX["proteins_100g"]])
            
            # Net carbs = carbs - fiber, floored at 0
            if carbs is not None and fiber is not None:
                net_carbs = max(carbs - fiber, 0)
            elif carbs is not None:
                net_carbs = carbs
            else:
                net_carbs = 0.0
            
            # Count verified nutrients
            verified = sum(1 for v in [kcal, fat, carbs, fiber, protein] if v is not None)
            
            # Store nulls as 0 for DB
            rows.append((
                name,
                kcal if kcal is not None else 0.0,
                protein if protein is not None else 0.0,
                fat if fat is not None else 0.0,
                net_carbs if net_carbs is not None else 0.0,
                int(verified),
            ))
            
            if n_total % 1_000_000 == 0:
                print(f"  Processed {n_total:,} rows, have {len(rows):,} valid rows...")
    
    print(f"\nProcessed {n_total:,} rows")
    print(f"Dropped {n_blank_name:,} with blank names")
    print(f"Kept {len(rows):,} valid rows in {time.time()-t0:.1f}s")
    
    # Count nutrition coverage
    if rows:
        print(f"\nNutrition field coverage ({len(rows):,} rows):")
        cols = [
            ("energy-kcal_100g", 0, 0),
            ("proteins_100g", 0, 1),
            ("fat_100g", 0, 2),
            ("carbohydrates_100g", 0, 4),
            ("fiber_100g", 0, 4),
        ]
        counts = {"energy-kcal_100g": 0, "proteins_100g": 0, "fat_100g": 0, "carbohydrates_100g": 0, "fiber_100g": 0}
        for row in rows:
            if row[1] != 0 and (rows[0][1] is not None or True):
                counts["energy-kcal_100g"] += 1
            if row[2] != 0:  # protein (0 could be valid)
                counts["proteins_100g"] += 1
            if row[3] != 0:
                counts["fat_100g"] += 1
            if row[4] != 0:
                counts["carbohydrates_100g"] += 1
        
        # Better counting: check nutrients_verified
        verified_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for row in rows:
            n = row[5]
            verified_counts[n] = verified_counts.get(n, 0) + 1
        
        print("\nNutrients verified per product:")
        for n in sorted(verified_counts):
            pct = verified_counts[n] / len(rows) * 100
            label = f"{n}/5" if n < 5 else "5/5"
            print(f"  {label}: {verified_counts[n]:,} ({pct:.1f}%)")
    
    # Write to SQLite
    print(f"\nWriting {len(rows):,} rows to {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("DROP TABLE IF EXISTS food_db")
    conn.execute("""
        CREATE TABLE food_db (
            product_name TEXT,
            kcal_per_100g REAL,
            protein_per_100g REAL,
            fat_per_100g REAL,
            net_carbs_per_100g REAL,
            nutrients_verified INTEGER
        )
    """)
    conn.execute("CREATE INDEX idx_food_name ON food_db(product_name)")
    
    conn.executemany(
        "INSERT INTO food_db VALUES (?, ?, ?, ?, ?, ?)",
        rows
    )
    conn.commit()
    conn.close()
    
    print(f"Done! {len(rows):,} rows inserted in {time.time()-t0:.1f}s")

if __name__ == "__main__":
    ingest()
