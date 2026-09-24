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

from monitoring_agent import probe_file_permissions, probe_database_integrity

def run_tests():
    print("--- Running Tier 1: Feature 17 (R5.3 File Permissions & DB Integrity Probes) ---")

    # Test 17.1: probe_file_permissions on real system root
    res_perms = probe_file_permissions(str(BOT_ROOT))
    assert isinstance(res_perms, dict)
    assert res_perms["checked_count"] >= 5
    assert "files" in res_perms
    assert "config.json" in res_perms["files"]
    assert "whitelist.json" in res_perms["files"]
    print("  ✔ Case 17.1: probe_file_permissions audits permissions on all critical ecosystem state files")

    # Test 17.2: probe_file_permissions flags missing file
    with tempfile.TemporaryDirectory() as tmp_dir:
        res_missing = probe_file_permissions(tmp_dir)
        assert res_missing["status"] == "CRITICAL_MISSING_FILE"
        assert len(res_missing["missing_files"]) > 0
        print("  ✔ Case 17.2: Correctly detects and flags CRITICAL_MISSING_FILE when state files are missing")

    # Test 17.3: probe_database_integrity validates JSON stores and returns status
    res_db = probe_database_integrity(str(BOT_ROOT))
    assert isinstance(res_db, dict)
    assert "status" in res_db
    assert "sqlite" in res_db
    assert "details" in res_db
    print("  ✔ Case 17.3: probe_database_integrity validates JSON state stores schema and integrity")

    # Test 17.4: SQLite PRAGMA integrity check on pareto_store.db
    sqlite_info = res_db["sqlite"]
    assert sqlite_info["status"] == "OK"
    assert "ok" in sqlite_info["integrity_check"]
    assert sqlite_info["periods_count"] >= 1
    assert sqlite_info["items_count"] >= 1
    print("  ✔ Case 17.4: Executes SQLite PRAGMA integrity_check on pareto_store.db and confirms table health")

    # Test 17.5: Detects corrupted JSON state file
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "config.json").write_text("{ corrupt json: unclosed", encoding="utf-8")
        (tmp_path / "whitelist.json").write_text("{}", encoding="utf-8")
        
        res_corrupt = probe_database_integrity(tmp_dir)
        assert res_corrupt["status"] == "INTEGRITY_FAILURES", f"Expected INTEGRITY_FAILURES, got {res_corrupt['status']}"
        assert len(res_corrupt["issues"]) > 0
        print("  ✔ Case 17.5: Accurately flags integrity failures on corrupted state stores")



    return {"passed": 5, "failed": 0, "feature": "Feature 17 (R5.3 File Permissions & DB Integrity Probes)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 17 result:", result)
