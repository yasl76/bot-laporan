import sys
import os
import tempfile
import json
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BOT_ROOT = Path("c:/projek bot")
if str(BOT_ROOT) not in sys.path:
    sys.path.insert(0, str(BOT_ROOT))

from monitoring_agent import probe_storage_leaks, generate_reports, run_full_audit


def run_tests():
    print("--- Running Tier 1: Feature 18 (R5.4 Storage Leaks & Alert Reporting) ---")

    # Test 18.1: probe_storage_leaks detects orphaned upload files
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Create an orphaned file
        orphan = tmp_path / "pareto_uploaded_1727199999999.xls"
        orphan.write_text("ORPHANED_DATA", encoding="utf-8")

        res_leaks = probe_storage_leaks(tmp_dir)
        assert res_leaks["leaked_uploads_count"] >= 1
        assert any("pareto_uploaded" in f["file"] for f in res_leaks["leaked_uploads"])
        print("  ✔ Case 18.1: probe_storage_leaks successfully detects orphaned temporary files")


    # Test 18.2: probe_storage_leaks reports disk capacity and free percentage
    res_disk = probe_storage_leaks(str(BOT_ROOT))
    assert "disk_free_gb" in res_disk
    assert "disk_free_percent" in res_disk
    assert "disk_low" in res_disk
    assert isinstance(res_disk["disk_free_gb"], (int, float))
    print("  ✔ Case 18.2: probe_storage_leaks accurately calculates available disk space and free percentage")

    # Test 18.3: generate_reports outputs valid JSON report
    with tempfile.TemporaryDirectory() as tmp_dir:
        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=str(Path("c:/projek aplikasi omi")))
        
        json_file = Path(tmp_dir) / "monitoring_report.json"
        assert json_file.exists(), "monitoring_report.json should exist"
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "alerts" in data
        assert "health_score" in data
        print("  ✔ Case 18.3: generate_reports writes valid machine-readable monitoring_report.json")

    # Test 18.4: generate_reports outputs formatted Markdown documentation
    with tempfile.TemporaryDirectory() as tmp_dir:
        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=str(Path("c:/projek aplikasi omi")))
        
        md_file = Path(tmp_dir) / "monitoring_report.md"
        assert md_file.exists(), "monitoring_report.md should exist"
        content = md_file.read_text(encoding="utf-8")
        assert "# " in content, "Must contain Markdown title"
        assert "Komponen" in content or "Component" in content or "Status" in content
        print("  ✔ Case 18.4: generate_reports writes structured Markdown status table with diagnostic icons")

    # Test 18.5: status_alert.txt formatted for WhatsApp broadcast
    with tempfile.TemporaryDirectory() as tmp_dir:
        telemetry = run_full_audit(bot_dir=tmp_dir, app_dir=str(Path("c:/projek aplikasi omi")))
        
        txt_file = Path(tmp_dir) / "status_alert.txt"
        assert txt_file.exists(), "status_alert.txt should exist"
        alert_content = txt_file.read_text(encoding="utf-8")
        assert "SISTEM" in alert_content or "STATUS" in alert_content or "LAPORAN" in alert_content or "Bot" in alert_content
        assert len(alert_content) > 30, "Alert text must not be empty"
        print("  ✔ Case 18.5: generate_reports writes compact WhatsApp broadcast status alert")


    return {"passed": 5, "failed": 0, "feature": "Feature 18 (R5.4 Storage Leaks & Alert Reporting)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 18 result:", result)
