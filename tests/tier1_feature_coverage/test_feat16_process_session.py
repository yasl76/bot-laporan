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

from monitoring_agent import probe_bot_process, probe_whatsapp_session

def run_tests():
    print("--- Running Tier 1: Feature 16 (R5.2 Bot Process & Session Probes) ---")

    # Test 16.1: probe_bot_process returns structured dictionary
    res_proc = probe_bot_process(str(BOT_ROOT))
    assert isinstance(res_proc, dict)
    assert "running" in res_proc
    assert "count" in res_proc
    assert "pids" in res_proc
    assert "status" in res_proc
    assert "recommendation" in res_proc
    print("  ✔ Case 16.1: probe_bot_process returns complete structured lifecycle diagnostics")

    # Test 16.2: probe_bot_process detects stopped bot
    # If no bot is running right now, it should report CRITICAL_DOWN
    if not res_proc["running"]:
        assert res_proc["status"] == "CRITICAL_DOWN"
        assert res_proc["count"] == 0
        print("  ✔ Case 16.2: Correctly reports CRITICAL_DOWN when node.exe bot is not running")
    else:
        assert res_proc["status"] in ("HEALTHY", "WARNING_MULTIPLE_INSTANCES")
        print("  ✔ Case 16.2: Correctly captures active PID and status of running bot")

    # Test 16.3: probe_whatsapp_session on non-existent session folder returns MISSING_CREDS
    with tempfile.TemporaryDirectory() as tmp_dir:
        res_missing = probe_whatsapp_session(tmp_dir)
        assert res_missing["status"] == "MISSING_CREDS"
        assert res_missing["authenticated"] is False
        assert "sesi_bot" in res_missing["details"]
        print("  ✔ Case 16.3: Returns MISSING_CREDS when sesi_bot folder is absent")

    # Test 16.4: probe_whatsapp_session on valid mock credentials returns AUTHENTICATED
    with tempfile.TemporaryDirectory() as tmp_dir:
        sesi_dir = Path(tmp_dir) / "sesi_bot"
        sesi_dir.mkdir(parents=True)
        creds_file = sesi_dir / "creds.json"
        
        valid_creds = {
            "me": {
                "id": "6285852559058:1@s.whatsapp.net",
                "lid": "215633832722432:0@lid",
                "name": "Bot Laporan OMI"
            }
        }
        creds_file.write_text(json.dumps(valid_creds), encoding="utf-8")

        res_valid = probe_whatsapp_session(tmp_dir)
        assert res_valid["status"] == "AUTHENTICATED"
        assert res_valid["authenticated"] is True
        assert res_valid["bot_phone"] == "6285852559058"
        assert res_valid["bot_lid"] == "215633832722432"
        assert res_valid["bot_name"] == "Bot Laporan OMI"
        print("  ✔ Case 16.4: Accurately parses valid credentials and extracts phone, LID, and name")

    # Test 16.5: probe_whatsapp_session on corrupted/invalid creds.json returns CORRUPT_CREDS
    with tempfile.TemporaryDirectory() as tmp_dir:
        sesi_dir = Path(tmp_dir) / "sesi_bot"
        sesi_dir.mkdir(parents=True)
        creds_file = sesi_dir / "creds.json"
        creds_file.write_text("CORRUPTED INVALID NOT A JSON", encoding="utf-8")

        res_corrupt = probe_whatsapp_session(tmp_dir)
        assert res_corrupt["status"] == "CORRUPT_CREDS"
        assert res_corrupt["authenticated"] is False
        print("  ✔ Case 16.5: Catches corrupted JSON syntax in creds.json and reports CORRUPT_CREDS")

    return {"passed": 5, "failed": 0, "feature": "Feature 16 (R5.2 Bot Process & Session Probes)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 16 result:", result)
