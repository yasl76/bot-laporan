import sys
import os
import subprocess
import json
import tempfile
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BOT_ROOT = Path("c:/projek bot")
AGENT_SCRIPT = BOT_ROOT / "monitoring_agent.py"
PYTHON_EXE = Path("c:/projek aplikasi omi/.venv/Scripts/python.exe")

def run_tests():
    print("--- Running Tier 1: Feature 15 (R5.1 Antigravity Monitoring Agent Core) ---")

    # Test 15.1: CLI --once generates the 3 required report files
    res = subprocess.run(
        [str(PYTHON_EXE), str(AGENT_SCRIPT), "--once"],
        cwd=str(BOT_ROOT),
        capture_output=True,
        text=True
    )
    # Status code is 0 or 1 depending on whether bot is active
    assert res.returncode in (0, 1), f"Exit code should be 0 or 1, got {res.returncode}"

    report_json_path = BOT_ROOT / "monitoring_report.json"
    report_md_path = BOT_ROOT / "monitoring_report.md"
    alert_txt_path = BOT_ROOT / "status_alert.txt"

    assert report_json_path.exists(), "monitoring_report.json must be generated"
    assert report_md_path.exists(), "monitoring_report.md must be generated"
    assert alert_txt_path.exists(), "status_alert.txt must be generated"
    print("  ✔ Case 15.1: CLI invocation with --once generates JSON, Markdown, and text alerts")

    # Test 15.2: Validate JSON report schema
    with open(report_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert "timestamp" in data
    assert "overall_status" in data
    assert "components" in data
    assert len(data["components"]) == 5, f"Expected 5 components in report, got {len(data['components'])}"
    print("  ✔ Case 15.2: monitoring_report.json conforms to complete multi-probe schema")


    # Test 15.3: Exit code contract (1 when overall_status is CRITICAL)
    if data["overall_status"] == "CRITICAL":
        assert res.returncode == 1, "Exit code must be 1 on CRITICAL health status"
    else:
        assert res.returncode == 0, "Exit code must be 0 on HEALTHY or WARNING status"
    print("  ✔ Case 15.3: Exit code aligns strictly with system health status contract")

    # Test 15.4: CLI --repair removes orphaned files
    # Create a simulated orphaned file
    dummy_orphan = BOT_ROOT / "pareto_uploaded_dummy_repair_test.xls"
    dummy_orphan.write_text("DUMMY ORPHAN CONTENT", encoding="utf-8")
    assert dummy_orphan.exists()

    repair_res = subprocess.run(
        [str(PYTHON_EXE), str(AGENT_SCRIPT), "--repair"],
        cwd=str(BOT_ROOT),
        capture_output=True,
        text=True
    )
    assert not dummy_orphan.exists(), "Case 15.4: Dummy orphan file should be purged by --repair"
    print("  ✔ Case 15.4: CLI invocation with --repair successfully purges orphaned temporary files")

    # Test 15.5: Dual-engine fallback operates seamlessly without GEMINI_API_KEY
    env_clean = os.environ.copy()
    env_clean.pop("GEMINI_API_KEY", None)
    offline_res = subprocess.run(
        [str(PYTHON_EXE), str(AGENT_SCRIPT), "--once"],
        cwd=str(BOT_ROOT),
        env=env_clean,
        capture_output=True,
        text=True
    )
    assert offline_res.returncode in (0, 1)
    assert "AUTONOMOUS SYSTEM HEALTH MONITORING REPORT" in offline_res.stdout
    print("  ✔ Case 15.5: Deterministic diagnostic engine executes seamlessly when offline/no API key")

    return {"passed": 5, "failed": 0, "feature": "Feature 15 (R5.1 Antigravity Monitoring Agent Core)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 15 result:", result)
