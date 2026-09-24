import os
import sys
import tempfile
import shutil
import sqlite3
import json
import pandas as pd
from pathlib import Path

def create_mock_pareto_db(db_path: str):
    """
    Creates an SQLite database initialized with periods and items tables
    conforming to the schema required by pareto_engine and recap_engine.
    """
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute('''
        CREATE TABLE IF NOT EXISTS periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_label TEXT NOT NULL,
            year INTEGER NOT NULL,
            month_no INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_id INTEGER NOT NULL,
            plu TEXT NOT NULL,
            name TEXT NOT NULL,
            qty_sold REAL DEFAULT 0,
            unit_price REAL DEFAULT 0,
            sales_amount REAL DEFAULT 0,
            qty_stock REAL DEFAULT 0,
            pkm REAL DEFAULT 0,
            frac REAL DEFAULT 1,
            pareto_class TEXT DEFAULT 'C',
            FOREIGN KEY (period_id) REFERENCES periods (id)
        )
    ''')

    # Seed 2 periods of data
    cur.execute("INSERT INTO periods (id, period_label, year, month_no) VALUES (1, 'JULI 2026', 2026, 7)")
    cur.execute("INSERT INTO periods (id, period_label, year, month_no) VALUES (2, 'AGUSTUS 2026', 2026, 8)")

    # Seed sample items
    items_data = [
        (1, '10001', 'INDOMIE GORENG', 150, 3100, 465000, 10, 40, 40, 'A'),
        (1, '10002', 'AQUA 600ML', 200, 3500, 700000, 5, 50, 24, 'A'),
        (1, '10003', 'ROKOK SURYA 16', 30, 35000, 1050000, 2, 20, 10, 'A'),
        (1, '10004', 'SARI ROTI COKLAT', 40, 6000, 240000, 15, 10, 1, 'B'),
        (1, '10005', 'PERMEN KOPICO', 20, 1000, 20000, 50, 5, 1, 'C'),
        # Period 2
        (2, '10001', 'INDOMIE GORENG', 160, 3100, 496000, 8, 40, 40, 'A'),
        (2, '10002', 'AQUA 600ML', 210, 3500, 735000, 4, 50, 24, 'A'),
        (2, '10003', 'ROKOK SURYA 16', 35, 35000, 1225000, 3, 20, 10, 'A'),
        (2, '10004', 'SARI ROTI COKLAT', 35, 6000, 210000, 12, 10, 1, 'B'),
        (2, '10005', 'PERMEN KOPICO', 15, 1000, 15000, 45, 5, 1, 'C'),
    ]

    cur.executemany('''
        INSERT INTO items (period_id, plu, name, qty_sold, unit_price, sales_amount, qty_stock, pkm, frac, pareto_class)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', items_data)

    conn.commit()
    conn.close()
    return db_path

class PythonTestSandbox:
    """Creates an isolated temporary directory for testing Python modules."""
    def __init__(self, prefix="py_e2e_"):
        self.temp_dir = tempfile.mkdtemp(prefix=prefix)
        self.root = Path(self.temp_dir)

    def cleanup(self):
        try:
            shutil.rmtree(self.temp_dir)
        except Exception:
            pass

    def create_file(self, relative_path: str, content: str = "") -> Path:
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target

    def create_json(self, relative_path: str, data: dict) -> Path:
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return target
