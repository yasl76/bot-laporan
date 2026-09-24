import sys
import os
import tempfile
import json
import sqlite3
import subprocess
from pathlib import Path
import pandas as pd

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

from src.pareto_engine import calculate_pareto, get_restock_recommendations
from src.recap_engine import calculate_multi_period_recap
from monitoring_agent import (
    probe_bot_process,
    probe_whatsapp_session,
    probe_file_permissions,
    probe_database_integrity,
    probe_storage_leaks,
    run_full_audit,
    format_alert_text,
    format_markdown_report
)

def run_tests():
    print("=== Running Tier 2: Boundary & Corner Cases (Desktop Pareto & Monitoring Features 11-18) ===")
    passed_count = 0

    # -----------------------------------------------------------------
    # F11 Boundaries: Pareto Boundary Crossing
    # -----------------------------------------------------------------
    # 2.11.1 Flat distribution: 10 items of 100 each
    df_flat = pd.DataFrame([
        {'plu': f'F{i}', 'name': f'Item {i}', 'sales_amount': 100.0, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 10}
        for i in range(1, 11)
    ])
    res_flat = calculate_pareto(df_flat)
    # Total = 1000. Each is 10%.
    # Items 1-8: cum 10%, 20%, ..., 80%.
    # For Item 8: prev is 70% < 80% -> Class A!
    # For Item 9: prev is 80% >= 80% and < 95% -> Class B!
    assert res_flat.iloc[7]['pareto_class'] == 'A'
    assert res_flat.iloc[8]['pareto_class'] == 'B'
    passed_count += 1

    # 2.11.2 Micro-sales item
    df_micro = pd.DataFrame([
        {'plu': 'M1', 'name': 'Big', 'sales_amount': 1000.0, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 100},
        {'plu': 'M2', 'name': 'Tiny', 'sales_amount': 0.001, 'qty_sold': 1, 'qty_stock': 5, 'unit_price': 0.001}
    ])
    res_micro = calculate_pareto(df_micro)
    assert res_micro.iloc[0]['pareto_class'] == 'A'
    assert res_micro.iloc[1]['pareto_class'] == 'C'
    passed_count += 1

    # 2.11.3 Negative sales in DataFrame treated safely as Class C
    df_neg = pd.DataFrame([
        {'plu': 'POS', 'name': 'Pos', 'sales_amount': 500.0, 'qty_sold': 5, 'qty_stock': 5, 'unit_price': 100},
        {'plu': 'NEG', 'name': 'Neg', 'sales_amount': -50.0, 'qty_sold': -1, 'qty_stock': 5, 'unit_price': 50}
    ])
    res_neg = calculate_pareto(df_neg)
    assert res_neg.loc[res_neg['plu'] == 'NEG', 'pareto_class'].iloc[0] == 'C'
    passed_count += 1

    # 2.11.4 100-item distribution
    df_100 = pd.DataFrame([
        {'plu': f'P{i}', 'name': f'Item {i}', 'sales_amount': float(101 - i), 'qty_sold': 1, 'qty_stock': 1, 'unit_price': 10}
        for i in range(1, 101)
    ])
    res_100 = calculate_pareto(df_100)
    assert len(res_100[res_100['pareto_class'] == 'A']) > 0
    assert len(res_100[res_100['pareto_class'] == 'B']) > 0
    assert len(res_100[res_100['pareto_class'] == 'C']) > 0
    passed_count += 1

    # 2.11.5 Continuous rank numbers 1..N
    assert list(res_100['rank_no']) == list(range(1, 101))
    passed_count += 1

    # -----------------------------------------------------------------
    # F12 Boundaries: Dominant Single Item
    # -----------------------------------------------------------------
    # 2.12.1 Item with 79.99% revenue (not dominant alone, needs 2nd item)
    df_79 = pd.DataFrame([
        {'plu': 'D1', 'name': 'Item 1', 'sales_amount': 799.9, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 80},
        {'plu': 'D2', 'name': 'Item 2', 'sales_amount': 150.0, 'qty_sold': 5, 'qty_stock': 5, 'unit_price': 30},
        {'plu': 'D3', 'name': 'Item 3', 'sales_amount': 50.1, 'qty_sold': 2, 'qty_stock': 5, 'unit_price': 25}
    ])
    res_79 = calculate_pareto(df_79)
    # Item 1 has 79.99% (prev 0% < 80%) -> A
    # Item 2 has 15% (cum 94.99%, prev 79.99% < 80%) -> A (crosses 80% boundary!)
    # Item 3 has 5.01% (cum 100%, prev 94.99% < 95%) -> B!
    assert res_79.iloc[0]['pareto_class'] == 'A'
    assert res_79.iloc[1]['pareto_class'] == 'A'
    assert res_79.iloc[2]['pareto_class'] == 'B'
    passed_count += 1

    # 2.12.2 Two equal items of 50% each: both Class A
    df_equal2 = pd.DataFrame([
        {'plu': 'E1', 'name': 'Half 1', 'sales_amount': 500.0, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 50},
        {'plu': 'E2', 'name': 'Half 2', 'sales_amount': 500.0, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 50}
    ])
    res_equal2 = calculate_pareto(df_equal2)
    assert res_equal2.iloc[0]['pareto_class'] == 'A'
    assert res_equal2.iloc[1]['pareto_class'] == 'A'
    passed_count += 1

    # 2.12.3 Dominant item with stock 0 gets HABIS status
    restock_dom = get_restock_recommendations(pd.DataFrame([
        {'plu': 'DOM', 'name': 'Dom', 'sales_amount': 1000.0, 'qty_sold': 10, 'qty_stock': 0, 'unit_price': 100, 'pareto_class': 'A'}
    ]), threshold=10)
    assert "HABIS (KRITIS UTAMA)" in restock_dom.iloc[0]['status_label']
    passed_count += 1

    # 2.12.4 Dominant item with stock 3 gets KRITIS status
    restock_dom_crit = get_restock_recommendations(pd.DataFrame([
        {'plu': 'DOM', 'name': 'Dom', 'sales_amount': 1000.0, 'qty_sold': 10, 'qty_stock': 3, 'unit_price': 100, 'pareto_class': 'A'}
    ]), threshold=10)
    assert "KRITIS (Prioritas A)" in restock_dom_crit.iloc[0]['status_label']
    passed_count += 1

    # 2.12.5 Restock filter by class_filter='B' ignores Class A
    df_ab = pd.DataFrame([
        {'plu': 'A1', 'name': 'A', 'sales_amount': 800.0, 'qty_sold': 10, 'qty_stock': 1, 'unit_price': 80, 'pareto_class': 'A'},
        {'plu': 'B1', 'name': 'B', 'sales_amount': 200.0, 'qty_sold': 5, 'qty_stock': 2, 'unit_price': 40, 'pareto_class': 'B'}
    ])
    restock_b = get_restock_recommendations(df_ab, threshold=10, class_filter='B')
    assert len(restock_b) == 1
    assert restock_b.iloc[0]['plu'] == 'B1'
    passed_count += 1

    # -----------------------------------------------------------------
    # F13 Boundaries: Recap Engine
    # -----------------------------------------------------------------
    # 2.13.1 Non-existent period ID returns empty safely
    res_none = calculate_multi_period_recap([999999])
    assert res_none['items_df'].empty
    passed_count += 1

    # 2.13.2 Multi-period recap with multiple periods (periods 20 and 21)
    res_multi = calculate_multi_period_recap([20, 21])
    assert 'summary' in res_multi
    assert res_multi['summary']['num_periods'] == 2
    passed_count += 1

    # 2.13.3 Summary averages divided by num_periods
    avg_omset = res_multi['summary']['avg_monthly_omset']
    tot_omset = res_multi['summary']['total_omset']
    assert abs(avg_omset - (tot_omset / 2.0)) < 0.01
    passed_count += 1

    # 2.13.4 Class percentages sum to 100%
    sum_pct = res_multi['summary']['class_a_pct'] + res_multi['summary']['class_b_pct'] + res_multi['summary']['class_c_pct']
    assert abs(sum_pct - 100.0) < 0.1
    passed_count += 1

    # 2.13.5 Stability status values
    assert isinstance(res_multi['summary']['count_stable_a'], int)
    passed_count += 1

    # -----------------------------------------------------------------
    # F14 Boundaries: Count Alignment & Restock Ordering
    # -----------------------------------------------------------------
    # 2.14.1 Restock threshold = 0 returns only stock < 0 (negative stock)
    df_stock = pd.DataFrame([
        {'plu': 'S1', 'name': 'Zero', 'qty_stock': 0, 'sales_amount': 100, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'},
        {'plu': 'S2', 'name': 'Neg', 'qty_stock': -2, 'sales_amount': 100, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'},
        {'plu': 'S3', 'name': 'Pos', 'qty_stock': 5, 'sales_amount': 100, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'}
    ])
    res_stk0 = get_restock_recommendations(df_stock, threshold=0)
    assert len(res_stk0) == 1
    assert res_stk0.iloc[0]['plu'] == 'S2'
    passed_count += 1

    # 2.14.2 High threshold includes all items
    res_stk_high = get_restock_recommendations(df_stock, threshold=1000)
    assert len(res_stk_high) == 3
    passed_count += 1

    # 2.14.3 Secondary sort tie-breaker in restock: lowest stock first within same class
    df_sort_test = pd.DataFrame([
        {'plu': 'H1', 'name': 'Stock 5', 'qty_stock': 5, 'sales_amount': 500, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'},
        {'plu': 'H2', 'name': 'Stock 1', 'qty_stock': 1, 'sales_amount': 500, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'}
    ])
    res_sorted = get_restock_recommendations(df_sort_test, threshold=10)
    assert res_sorted.iloc[0]['plu'] == 'H2'
    assert res_sorted.iloc[1]['plu'] == 'H1'
    passed_count += 1

    # 2.14.4 Class ordering: Class A before Class B regardless of stock
    df_class_order = pd.DataFrame([
        {'plu': 'B_LOW', 'name': 'B Low', 'qty_stock': 0, 'sales_amount': 100, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'B'},
        {'plu': 'A_HIGH', 'name': 'A High', 'qty_stock': 4, 'sales_amount': 100, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'A'}
    ])
    res_class_order = get_restock_recommendations(df_class_order, threshold=10)
    assert res_class_order.iloc[0]['plu'] == 'A_HIGH'
    assert res_class_order.iloc[1]['plu'] == 'B_LOW'
    passed_count += 1

    # 2.14.5 Status labels for Class C items
    df_c_items = pd.DataFrame([
        {'plu': 'C_ZERO', 'name': 'C Zero', 'qty_stock': 0, 'sales_amount': 10, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'C'},
        {'plu': 'C_LOW', 'name': 'C Low', 'qty_stock': 3, 'sales_amount': 10, 'qty_sold': 1, 'unit_price': 10, 'pareto_class': 'C'}
    ])
    res_c_labels = get_restock_recommendations(df_c_items, threshold=10)
    assert "HABIS (Prioritas C)" in res_c_labels.iloc[0]['status_label']
    assert "STOK MENIPIS" in res_c_labels.iloc[1]['status_label']
    passed_count += 1

    # -----------------------------------------------------------------
    # F15 Boundaries: Monitoring Agent Core & Health Score
    # -----------------------------------------------------------------
    # 2.15.1 Health score is bounded 0 to 100
    with tempfile.TemporaryDirectory() as tmp_dir:
        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=tmp_dir)
        assert 0 <= telemetry['health_score'] <= 100
        passed_count += 1

    # 2.15.2 format_alert_text does not crash with empty telemetry
    alert_text = format_alert_text({})
    assert isinstance(alert_text, str)
    assert len(alert_text) > 0
    passed_count += 1

    # 2.15.3 format_markdown_report contains title
    md_text = format_markdown_report(telemetry)
    assert "# " in md_text
    passed_count += 1

    # 2.15.4 Recommendations are deduplicated
    recs = telemetry.get('recommendations', [])
    assert len(recs) == len(set(recs))
    passed_count += 1

    # 2.15.5 Telemetry contains ISO timestamp
    assert "T" in telemetry['timestamp']
    assert "Z" in telemetry['timestamp']
    passed_count += 1

    # -----------------------------------------------------------------
    # F16 Boundaries: Process & Session Probes
    # -----------------------------------------------------------------
    # 2.16.1 Missing 'me' inside creds.json
    with tempfile.TemporaryDirectory() as tmp_dir:
        sesi = Path(tmp_dir) / "sesi_bot"
        sesi.mkdir()
        (sesi / "creds.json").write_text("{}", encoding="utf-8")
        res_me_none = probe_whatsapp_session(tmp_dir)
        assert res_me_none['status'] == 'UNAUTHENTICATED'
        passed_count += 1

    # 2.16.2 creds.json with empty id inside 'me'
    with tempfile.TemporaryDirectory() as tmp_dir:
        sesi = Path(tmp_dir) / "sesi_bot"
        sesi.mkdir()
        (sesi / "creds.json").write_text('{"me": {"id": ""}}', encoding="utf-8")
        res_me_empty = probe_whatsapp_session(tmp_dir)
        assert res_me_empty['status'] == 'UNAUTHENTICATED'
        passed_count += 1

    # 2.16.3 Session directory counting 10 pre-key files
    with tempfile.TemporaryDirectory() as tmp_dir:
        sesi = Path(tmp_dir) / "sesi_bot"
        sesi.mkdir()
        (sesi / "creds.json").write_text('{"me": {"id": "123:0@s.whatsapp.net"}}', encoding="utf-8")
        for k in range(10):
            (sesi / f"app-state-sync-key-{k}.json").write_text("{}", encoding="utf-8")
        res_keys = probe_whatsapp_session(tmp_dir)
        assert res_keys['session_files_count'] == 11
        passed_count += 1

    # 2.16.4 Bot process probe on non-existent directory
    res_fake_dir = probe_bot_process("C:/non_existent_directory_abc")
    assert isinstance(res_fake_dir, dict)
    passed_count += 1

    # 2.16.5 Recommendation provided for stopped bot
    if not res_fake_dir['running']:
        assert "npm start" in res_fake_dir['recommendation']
        passed_count += 1
    else:
        passed_count += 1

    # -----------------------------------------------------------------
    # F17 Boundaries: Permissions & Database Integrity
    # -----------------------------------------------------------------
    # 2.17.1 Missing periods table in SQLite database
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = Path(tmp_dir) / "data" / "pareto_store.db"
        db_file.parent.mkdir(parents=True)
        conn = sqlite3.connect(str(db_file))
        # Create empty table
        conn.execute("CREATE TABLE dummy (id INT)")
        conn.close()

        res_no_periods = probe_database_integrity(tmp_dir, tmp_dir)
        assert res_no_periods['status'] == 'INTEGRITY_FAILURES'
        assert any("periods" in iss for iss in res_no_periods['issues'])
        passed_count += 1

    # 2.17.2 Corrupted SQLite header
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = Path(tmp_dir) / "data" / "pareto_store.db"
        db_file.parent.mkdir(parents=True)
        db_file.write_text("CORRUPTED NOT AN SQLITE DATABASE", encoding="utf-8")
        res_corrupt_db = probe_database_integrity(tmp_dir, tmp_dir)
        assert res_corrupt_db['status'] == 'INTEGRITY_FAILURES'
        passed_count += 1

    # 2.17.3 config.json validasi_spd_min > validasi_spd_max
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        bad_cfg = {
            "nama_toko": "OMI", "kode_toko": "O8BM", "target_spd": 5000000, "target_std": 100,
            "target_apc": 35000, "target_gm": "21.00", "validasi_spd_min": 10000000, "validasi_spd_max": 5000000
        }
        (p / "config.json").write_text(json.dumps(bad_cfg), encoding="utf-8")
        res_bad_bounds = probe_database_integrity(tmp_dir, tmp_dir)
        assert any("validasi_spd_min" in iss for iss in res_bad_bounds['issues'])
        passed_count += 1

    # 2.17.4 whitelist.json with empty super_admins
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        (p / "whitelist.json").write_text(json.dumps({"super_admins": [], "users": []}), encoding="utf-8")
        res_empty_sa = probe_database_integrity(tmp_dir, tmp_dir)
        assert any("super_admins" in iss for iss in res_empty_sa['issues'])
        passed_count += 1

    # 2.17.5 file permissions checking checked_count is 6
    res_perm_count = probe_file_permissions(str(BOT_ROOT), str(OMI_ROOT))
    assert res_perm_count['checked_count'] == 6
    passed_count += 1

    # -----------------------------------------------------------------
    # F18 Boundaries: Storage Leaks & Alerts
    # -----------------------------------------------------------------
    # 2.18.1 Multiple leaked files detection and counting
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        for i in range(5):
            (p / f"pareto_uploaded_test_{i}.xls").write_text("x", encoding="utf-8")
        res_multi_leaks = probe_storage_leaks(tmp_dir)
        assert res_multi_leaks['leaked_uploads_count'] == 5
        passed_count += 1

    # 2.18.2 auto_repair removes all 5 files
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir)
        for i in range(5):
            (p / f"pareto_uploaded_test_{i}.xls").write_text("x", encoding="utf-8")
        res_repair = probe_storage_leaks(tmp_dir, auto_repair=True)
        assert len(res_repair['repaired_files']) == 5
        assert res_repair['leaked_uploads_count'] == 0
        passed_count += 1

    # 2.18.3 Clean directory returns status HEALTHY or WARNING_LOW_DISK
    with tempfile.TemporaryDirectory() as tmp_dir:
        res_clean = probe_storage_leaks(tmp_dir)
        assert res_clean['status'] in ('HEALTHY', 'WARNING_LOW_DISK')
        passed_count += 1

    # 2.18.4 WhatsApp alert contains critical header when critical alert present
    alert_crit = format_alert_text({"overall_status": "CRITICAL", "components": {}})
    assert "🔴" in alert_crit
    passed_count += 1

    # 2.18.5 WhatsApp alert contains normal header when healthy
    alert_norm = format_alert_text({"overall_status": "HEALTHY", "components": {}})
    assert "🟢" in alert_norm
    passed_count += 1

    print(f"  ✔ Successfully passed all {passed_count} Tier 2 boundary test cases for Features 11-18!")
    return {"passed": passed_count, "failed": 0, "suite": "Tier 2 Desktop & Monitoring Boundaries (Features 11-18)"}

if __name__ == "__main__":
    result = run_tests()
    print("Result:", result)
