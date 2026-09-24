import sys
import os
import tempfile
import json
import sqlite3
from pathlib import Path
import pandas as pd
import openpyxl

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

OMI_ROOT = Path("c:/projek aplikasi omi")
BOT_ROOT = Path("c:/projek bot")
if str(OMI_ROOT) not in sys.path:
    sys.path.insert(0, str(OMI_ROOT))
if str(BOT_ROOT) not in sys.path:
    sys.path.insert(0, str(BOT_ROOT))

from src.pareto_engine import calculate_pareto, get_restock_recommendations, export_restock_to_excel
from src.recap_engine import calculate_multi_period_recap, export_multi_period_recap_excel
from monitoring_agent import run_full_audit, probe_database_integrity, probe_storage_leaks

def run_tests():
    print("=== Running Tier 3: Cross-Feature Interactions (Desktop Pareto & Monitoring Agent) ===")
    passed_count = 0

    # -----------------------------------------------------------------
    # Interaction 1: R4 (Pareto Boundary Crossing) -> Restock Priority -> Restock Excel Export
    # -----------------------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Dataset with boundary crossing item
        df = pd.DataFrame([
            {'plu': '01', 'name': 'Top Seller', 'sales_amount': 750000.0, 'qty_sold': 100, 'qty_stock': 2, 'unit_price': 7500, 'pkm': 50},
            {'plu': '02', 'name': 'Boundary Item', 'sales_amount': 100000.0, 'qty_sold': 20, 'qty_stock': 3, 'unit_price': 5000, 'pkm': 30},
            {'plu': '03', 'name': 'Mid Item', 'sales_amount': 100000.0, 'qty_sold': 20, 'qty_stock': 15, 'unit_price': 5000, 'pkm': 20},
            {'plu': '04', 'name': 'Low Item', 'sales_amount': 50000.0, 'qty_sold': 10, 'qty_stock': 1, 'unit_price': 5000, 'pkm': 10}
        ])
        pareto_df = calculate_pareto(df)
        assert pareto_df.loc[pareto_df['plu'] == '02', 'pareto_class'].iloc[0] == 'A', "Boundary item must be Class A"

        restock_df = get_restock_recommendations(pareto_df, threshold=10)
        # Class A items with low stock should be ranked at the very top
        assert restock_df.iloc[0]['plu'] in ('01', '02')
        assert restock_df.iloc[1]['plu'] in ('01', '02')

        out_excel = os.path.join(tmp_dir, "Rekomendasi_Restock_Test.xlsx")
        export_restock_to_excel(restock_df, out_excel, period_label="Testing")
        assert os.path.exists(out_excel)

        wb = openpyxl.load_workbook(out_excel)
        assert "Rekomendasi Restock" in wb.sheetnames
        passed_count += 1
        print("  ✔ Interaction 1: Pareto Boundary Classification -> Restock Priority Engine -> Excel Formatter Pipeline")

    # -----------------------------------------------------------------
    # Interaction 2: R4 (Desktop Recap Engine) + R5 (SQLite Integrity PRAGMA Probe)
    # -----------------------------------------------------------------
    # Read periods concurrently with running integrity check
    recap_res = calculate_multi_period_recap([1])
    assert not recap_res['items_df'].empty

    db_probe_res = probe_database_integrity(str(BOT_ROOT), str(OMI_ROOT))
    assert db_probe_res['sqlite']['status'] == 'OK'
    assert 'ok' in db_probe_res['sqlite']['integrity_check']
    passed_count += 1
    print("  ✔ Interaction 2: Analytical Recap Computation + Concurrent Database Integrity PRAGMA Probe")

    # -----------------------------------------------------------------
    # Interaction 3: R1 (Storage Leak Surface) + R5 (Autonomous Leak Detection & Repair)
    # -----------------------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create mock abandoned upload files
        leak1 = Path(tmp_dir) / "pareto_uploaded_interact_1.xls"
        leak2 = Path(tmp_dir) / "pareto_uploaded_interact_2.xls"
        leak1.write_text("LEAK_DATA_1", encoding="utf-8")
        leak2.write_text("LEAK_DATA_2", encoding="utf-8")
        assert leak1.exists() and leak2.exists()

        # Full audit with auto_repair=True
        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=str(OMI_ROOT), auto_repair=True)
        assert not leak1.exists(), "Leaked file 1 must be purged"
        assert not leak2.exists(), "Leaked file 2 must be purged"
        
        storage_info = telemetry['components']['storage_and_leaks']
        assert len(storage_info['repaired_files']) >= 2
        passed_count += 1
        print("  ✔ Interaction 3: Bot Storage Leak Surface -> Autonomous Proactive Detection & Auto-Repair Lifecycle")

    # -----------------------------------------------------------------
    # Interaction 4: R2 (Multi-Device Whitelist) + R5 (State Store Schema Audit)
    # -----------------------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Seed valid whitelist with phone and LID
        valid_wl = {
            "admin": "6285852559058",
            "super_admins": ["6285852559058"],
            "users": [
                {"number": "6285852559058", "name": "Super Admin Utama", "role": "super_admin", "lid": "215633832722432"},
                {"number": "628123456789", "name": "Kasir Toko", "role": "admin_biasa", "lid": "111222333444"}
            ]
        }
        (tmp_path / "whitelist.json").write_text(json.dumps(valid_wl), encoding="utf-8")
        
        # Valid config
        valid_cfg = {
            "nama_toko": "OMI", "kode_toko": "O8BM", "target_spd": 5000000, "target_std": 100,
            "target_apc": 35000, "target_gm": "21.00", "validasi_spd_min": 1000000, "validasi_spd_max": 20000000
        }
        (tmp_path / "config.json").write_text(json.dumps(valid_cfg), encoding="utf-8")

        res_audit = probe_database_integrity(tmp_dir, str(OMI_ROOT))
        assert not any("whitelist.json" in iss for iss in res_audit['issues']), "Whitelist schema should be fully valid"
        passed_count += 1
        print("  ✔ Interaction 4: Multi-Device Whitelist Persistence + Proactive Schema Validation")

    # -----------------------------------------------------------------
    # Interaction 5: R3 (Store Target Configuration) + R5 (Telemetry & Multi-Format Reporting)
    # -----------------------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        cfg_data = {
            "nama_toko": "OMI TITAN EKSEKUTIF MART",
            "kode_toko": "O8BM",
            "target_spd": 4725000,
            "target_std": 135,
            "target_apc": 35000,
            "target_gm": "21.00",
            "validasi_spd_min": 1000000,
            "validasi_spd_max": 20000000
        }
        (tmp_path / "config.json").write_text(json.dumps(cfg_data), encoding="utf-8")
        (tmp_path / "whitelist.json").write_text(json.dumps({"super_admins": ["6281"], "users": []}), encoding="utf-8")

        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=str(OMI_ROOT))
        assert (tmp_path / "monitoring_report.json").exists()
        assert (tmp_path / "monitoring_report.md").exists()
        assert (tmp_path / "status_alert.txt").exists()
        passed_count += 1
        print("  ✔ Interaction 5: Store Targets & Config -> Autonomous Diagnostic Probes -> Multi-Format Reports")

    print(f"  ✔ Successfully passed all {passed_count} Tier 3 Desktop & Monitoring Pairwise Interaction tests!")
    return {"passed": passed_count, "failed": 0, "suite": "Tier 3 Desktop & Monitoring Interactions"}

if __name__ == "__main__":
    result = run_tests()
    print("Result:", result)
