import sys
import os
import tempfile
import json
import subprocess
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

from src.pareto_engine import calculate_pareto, get_restock_recommendations, export_pareto_to_excel, export_restock_to_excel
from monitoring_agent import run_full_audit, probe_storage_leaks, repair_storage_leaks

PYTHON_EXE = Path("c:/projek aplikasi omi/.venv/Scripts/python.exe")
AGENT_SCRIPT = BOT_ROOT / "monitoring_agent.py"

def run_tests():
    print("=== Running Tier 4: Real-World End-to-End Scenarios (Desktop & Monitoring) ===")
    passed_count = 0

    # =========================================================================
    # Scenario 4.3: Real-World Store Pareto Analysis & Supplier Restock Order Generation
    # =========================================================================
    print("  Executing Scenario 4.3: Realistic Store Pareto Analysis & Restock Ordering...")
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Realistic retail catalog (30 SKUs with Pareto distribution)
        raw_items = [
            {'plu': '101', 'name': 'BERAS RAMOS 5KG', 'sales_amount': 2500000.0, 'qty_sold': 35, 'qty_stock': 3, 'unit_price': 71500, 'pkm': 30, 'frac': 1},
            {'plu': '102', 'name': 'MINYAK GORENG SANIA 2L', 'sales_amount': 2100000.0, 'qty_sold': 60, 'qty_stock': 4, 'unit_price': 35000, 'pkm': 50, 'frac': 6},
            {'plu': '103', 'name': 'GULA PASIR GMP 1KG', 'sales_amount': 1800000.0, 'qty_sold': 100, 'qty_stock': 2, 'unit_price': 18000, 'pkm': 80, 'frac': 20},
            {'plu': '104', 'name': 'ROKOK SAMPOERNA MILD 16', 'sales_amount': 1500000.0, 'qty_sold': 45, 'qty_stock': 0, 'unit_price': 33300, 'pkm': 40, 'frac': 10},
            {'plu': '105', 'name': 'INDOMIE AYAM BAWANG DUS', 'sales_amount': 1200000.0, 'qty_sold': 10, 'qty_stock': 1, 'unit_price': 120000, 'pkm': 15, 'frac': 1},
            # Boundary crossing zone (accumulating to ~80%)
            {'plu': '106', 'name': 'TELUR AYAM NEGERI 1KG', 'sales_amount': 950000.0, 'qty_sold': 32, 'qty_stock': 5, 'unit_price': 29600, 'pkm': 25, 'frac': 10},
            {'plu': '107', 'name': 'SARI ROTI TAWAR SPESIAL', 'sales_amount': 600000.0, 'qty_sold': 40, 'qty_stock': 8, 'unit_price': 15000, 'pkm': 30, 'frac': 10},
            {'plu': '108', 'name': 'AQUA GALON 19L', 'sales_amount': 550000.0, 'qty_sold': 25, 'qty_stock': 6, 'unit_price': 22000, 'pkm': 20, 'frac': 1},
            # Class B zone
            {'plu': '109', 'name': 'KOPI KAPAL API SPECIAL 165G', 'sales_amount': 450000.0, 'qty_sold': 30, 'qty_stock': 15, 'unit_price': 15000, 'pkm': 20, 'frac': 12},
            {'plu': '110', 'name': 'ULTRA MILK FULL CREAM 1L', 'sales_amount': 400000.0, 'qty_sold': 20, 'qty_stock': 5, 'unit_price': 20000, 'pkm': 25, 'frac': 12},
            {'plu': '111', 'name': 'RINSO ANTI NODA REFILL 750ML', 'sales_amount': 350000.0, 'qty_sold': 14, 'qty_stock': 12, 'unit_price': 25000, 'pkm': 15, 'frac': 12},
            {'plu': '112', 'name': 'PEPSODENT WHITE 190G', 'sales_amount': 250000.0, 'qty_sold': 16, 'qty_stock': 2, 'unit_price': 15600, 'pkm': 15, 'frac': 24},
            # Class C zone
            {'plu': '113', 'name': 'TISU PASEO 250S', 'sales_amount': 150000.0, 'qty_sold': 10, 'qty_stock': 20, 'unit_price': 15000, 'pkm': 10, 'frac': 12},
            {'plu': '114', 'name': 'SABUN LIFEBUOY LEMON', 'sales_amount': 100000.0, 'qty_sold': 20, 'qty_stock': 30, 'unit_price': 5000, 'pkm': 15, 'frac': 36},
            {'plu': '115', 'name': 'KOREK API TOKAI GAS', 'sales_amount': 50000.0, 'qty_sold': 12, 'qty_stock': 40, 'unit_price': 4100, 'pkm': 20, 'frac': 50},
        ]
        df_store = pd.DataFrame(raw_items)

        # 1. Run Pareto calculation
        pareto_df = calculate_pareto(df_store)
        assert not pareto_df.empty
        assert 'pareto_class' in pareto_df.columns
        assert 'rank_no' in pareto_df.columns
        
        # Verify boundary crossing item 106 or 107 is in Class A
        item_106_class = pareto_df.loc[pareto_df['plu'] == '106', 'pareto_class'].iloc[0]
        assert item_106_class == 'A', "Item 106 crossing boundary must be Class A"

        # 2. Run restock prioritization with threshold = 10 pcs
        restock_df = get_restock_recommendations(pareto_df, threshold=10)
        assert not restock_df.empty

        # High priority check: Out of stock (qty_stock = 0, ROKOK SAMPOERNA) must be top ranked
        zero_stock_item = restock_df[restock_df['qty_stock'] == 0].iloc[0]
        assert zero_stock_item['plu'] == '104'
        assert "HABIS" in zero_stock_item['status_label']

        # 3. Export Restock Excel and verify workbook
        restock_out = os.path.join(tmp_dir, "Laporan_Restock_Retail.xlsx")
        export_restock_to_excel(restock_df, restock_out, period_label="September 2026")
        assert os.path.exists(restock_out)

        wb_restock = openpyxl.load_workbook(restock_out)
        ws_restock = wb_restock["Rekomendasi Restock"]
        assert ws_restock.cell(row=1, column=1).value.startswith("LAPORAN REKOMENDASI RESTOCK")

        # 4. Export Pareto Analysis Excel and verify workbook
        pareto_out = os.path.join(tmp_dir, "Analisa_Pareto_Retail.xlsx")
        export_pareto_to_excel(pareto_df, pareto_out, period_label="September 2026")
        assert os.path.exists(pareto_out)

        wb_pareto = openpyxl.load_workbook(pareto_out)
        ws_pareto = wb_pareto["Analisa Pareto"]
        assert ws_pareto.cell(row=1, column=1).value.startswith("LAPORAN ANALISA PARETO")

        passed_count += 1
        print("  ✔ Scenario 4.3 Passed: Retail store Pareto classification, restock engine, and dual Excel exports generated successfully.")

    # =========================================================================
    # Scenario 4.4: Autonomous Monitoring, Anomaly Detection & Self-Healing Lifecycle
    # =========================================================================
    print("  Executing Scenario 4.4: Autonomous Monitoring, Leak Anomaly Injection & Self-Healing...")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        
        # Setup mock bot directory environment
        valid_cfg = {
            "nama_toko": "OMI TITAN EKSEKUTIF MART", "kode_toko": "O8BM", "target_spd": 4725000,
            "target_std": 135, "target_apc": 35000, "target_gm": "21.00",
            "validasi_spd_min": 1000000, "validasi_spd_max": 20000000
        }
        (tmp_path / "config.json").write_text(json.dumps(valid_cfg), encoding="utf-8")
        valid_wl = {
            "super_admins": ["6285852559058"],
            "users": [{"number": "6285852559058", "name": "Super Admin Utama", "role": "super_admin"}]
        }
        (tmp_path / "whitelist.json").write_text(json.dumps(valid_wl), encoding="utf-8")
        (tmp_path / "rekap_data.json").write_text(json.dumps([{"tanggal": "01/09/2026", "spd": 4500000}]), encoding="utf-8")
        (tmp_path / "package.json").write_text(json.dumps({"name": "bot"}), encoding="utf-8")

        # Step 1: Baseline check
        telemetry_base = run_full_audit(bot_dir=tmp_dir, app_dir=str(OMI_ROOT))
        assert (tmp_path / "monitoring_report.json").exists()
        assert telemetry_base['components']['storage_and_leaks']['leaked_uploads_count'] == 0

        # Step 2: Inject anomalies - simulate 3 leaked upload files from crashed sessions
        leak1 = tmp_path / "pareto_uploaded_crash_1.xls"
        leak2 = tmp_path / "pareto_uploaded_crash_2.xls"
        leak3 = tmp_path / "pareto_uploaded_crash_3.xls"
        leak1.write_text("CRASH_DUMP_1", encoding="utf-8")
        leak2.write_text("CRASH_DUMP_2", encoding="utf-8")
        leak3.write_text("CRASH_DUMP_3", encoding="utf-8")

        # Step 3: Diagnostic probe detects anomalies
        telemetry_anom = run_full_audit(bot_dir=tmp_dir, app_dir=str(OMI_ROOT))
        storage_anom = telemetry_anom['components']['storage_and_leaks']
        assert storage_anom['leaked_uploads_count'] == 3, f"Expected 3 leaks, got {storage_anom['leaked_uploads_count']}"
        assert any(a['code'] == 'STORAGE_LEAK_DETECTED' for a in telemetry_anom['alerts'])

        # Step 4: Autonomous repair execution via repair_storage_leaks
        repair_res = repair_storage_leaks(bot_dir=tmp_dir)
        assert len(repair_res['repaired_files']) == 3, f"Expected 3 repaired files, got {len(repair_res['repaired_files'])}"
        assert not leak1.exists()
        assert not leak2.exists()
        assert not leak3.exists()

        # Step 5: Post-repair verification audit
        telemetry_repaired = run_full_audit(bot_dir=tmp_dir, app_dir=str(OMI_ROOT))
        assert telemetry_repaired['components']['storage_and_leaks']['leaked_uploads_count'] == 0
        assert not any(a['code'] == 'STORAGE_LEAK_DETECTED' for a in telemetry_repaired['alerts'])

        passed_count += 1
        print("  ✔ Scenario 4.4 Passed: Complete autonomous audit, anomaly detection, self-healing, and post-repair verification completed.")

    print(f"  ✔ Successfully passed all {passed_count} Tier 4 Desktop & Monitoring Real-World Scenarios!")
    return {"passed": passed_count, "failed": 0, "suite": "Tier 4 Desktop & Monitoring Scenarios"}

if __name__ == "__main__":
    result = run_tests()
    print("Result:", result)
