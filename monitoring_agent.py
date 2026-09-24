"""
monitoring_agent.py - Autonomous System Health & Reliability Monitoring Agent
Powered by Google Antigravity SDK

Monitors WhatsApp Bot (Node.js/Baileys), State Stores, SQLite Database,
Disk Capacity, and Storage Leak Surfaces across the Pareto retail ecosystem.

Features:
- Dual-Engine Architecture: Google Antigravity SDK autonomous execution when
  online & GEMINI_API_KEY present; deterministic diagnostic engine fallback when offline.
- 5 Comprehensive Health Probes:
    1. probe_bot_process(): Node.js liveness & PID tracking
    2. probe_whatsapp_session(): Baileys creds.json identity & session keys
    3. probe_file_permissions(): Read/Write access on 6 critical system files
    4. probe_database_integrity(): JSON schema audit & SQLite PRAGMA check
    5. probe_storage_leaks(): Temporary file leak detection & disk capacity
- Multi-Format Reporting:
    - monitoring_report.json (machine-readable)
    - monitoring_report.md (rich markdown status table)
    - status_alert.txt (WhatsApp Super Admin alert broadcast)
- CLI Operational Modes:
    - --once: Run single diagnostic pass and exit (0 = HEALTHY/WARNING, 1 = CRITICAL)
    - --daemon: Continuous autonomous scheduled monitoring
    - --repair: Automatically purge orphaned temporary files and intermediate exports
"""

import os
import sys
import json
import glob
import time
import shutil
import sqlite3
import logging
import argparse
import subprocess
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("MonitoringAgent")

# Google Antigravity SDK Integration (graceful fallback)
try:
    from google.antigravity import Agent, LocalAgentConfig, types
    from google.antigravity.triggers import every, TriggerContext
    from google.antigravity.hooks import policy
    HAS_AGY_SDK = True
except ImportError:
    HAS_AGY_SDK = False
    Agent = None
    LocalAgentConfig = None
    types = None
    every = None
    TriggerContext = None
    policy = None

# Default Base Directories
BOT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.environ.get(
    "OMI_APP_DIR",
    os.path.normpath(os.path.join(BOT_DIR, "..", "projek aplikasi omi"))
)

# Critical File Paths
CONFIG_PATH = os.path.join(BOT_DIR, "config.json")
WHITELIST_PATH = os.path.join(BOT_DIR, "whitelist.json")
REKAP_PATH = os.path.join(BOT_DIR, "rekap_data.json")
SESI_DIR = os.path.join(BOT_DIR, "sesi_bot")
CREDS_PATH = os.path.join(SESI_DIR, "creds.json")
PACKAGE_PATH = os.path.join(BOT_DIR, "package.json")
DB_PATH = os.path.join(APP_DIR, "data", "pareto_store.db")

REPORT_JSON = os.path.join(BOT_DIR, "monitoring_report.json")
REPORT_MD = os.path.join(BOT_DIR, "monitoring_report.md")
ALERT_TXT = os.path.join(BOT_DIR, "status_alert.txt")


# =============================================================================
# Helper Utilities
# =============================================================================

def get_wib_timestamp() -> str:
    """Return current timestamp formatted in Western Indonesian Time (WIB / UTC+7)."""
    wib_tz = timezone(timedelta(hours=7))
    now = datetime.now(wib_tz)
    return now.strftime("%d/%m/%Y %H:%M WIB")


def get_iso_timestamp() -> str:
    """Return current UTC ISO 8601 timestamp string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# =============================================================================
# Probe 1: Bot Process Lifecycle & Health
# =============================================================================

def probe_bot_process(bot_dir: str = BOT_DIR) -> Dict[str, Any]:
    """Probe WhatsApp Bot Node.js process status and liveness.

    Checks if node.exe is executing index.js, captures process IDs,
    computes instance count, and flags status.
    """
    logger.debug("Executing probe_bot_process...")
    pids: List[int] = []
    process_details: List[Dict[str, Any]] = []

    if sys.platform == "win32":
        # Strategy A: Windows CIM / PowerShell query
        try:
            ps_cmd = (
                "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | "
                "Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
            )
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                timeout=8,
            )
            raw_output = proc.stdout.strip()
            if raw_output:
                try:
                    parsed = json.loads(raw_output)
                    items = parsed if isinstance(parsed, list) else [parsed]
                    for item in items:
                        cmdline = (item.get("CommandLine") or "").lower()
                        pid = item.get("ProcessId")
                        if "index.js" in cmdline and pid:
                            pids.append(int(pid))
                            process_details.append({"pid": pid, "command_line": cmdline})
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            logger.debug(f"PowerShell CIM query failed: {e}")

        # Strategy B: Fallback to tasklist if CIM gave 0 and powershell errored
        if not pids:
            try:
                task_proc = subprocess.run(
                    ["tasklist", "/FI", "IMAGENAME eq node.exe", "/FO", "CSV", "/NH"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                for line in task_proc.stdout.splitlines():
                    parts = [p.strip(' "') for p in line.split(",")]
                    if len(parts) >= 2 and parts[0].lower() == "node.exe":
                        try:
                            # Note: tasklist does not show command line, but indicates node is running
                            pass
                        except ValueError:
                            pass
            except Exception:
                pass
    else:
        # Linux / MacOS fallback
        try:
            pgrep_proc = subprocess.run(
                ["pgrep", "-f", "node.*index.js"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if pgrep_proc.returncode == 0:
                for line in pgrep_proc.stdout.splitlines():
                    if line.strip().isdigit():
                        pids.append(int(line.strip()))
        except Exception:
            pass

    count = len(pids)
    if count == 1:
        status = "HEALTHY"
        running = True
        recommendation = "Bot process is active and running normally."
    elif count > 1:
        status = "WARNING_MULTIPLE_INSTANCES"
        running = True
        recommendation = f"Multiple bot instances detected ({count} processes). Terminate redundant processes to avoid state conflicts."
    else:
        status = "CRITICAL_DOWN"
        running = False
        recommendation = f"Start bot using 'npm start' in {bot_dir} to restore bot functionality."

    return {
        "running": running,
        "count": count,
        "pids": pids,
        "status": status,
        "details": f"{count} node.exe instance(s) running index.js (PIDs: {pids})",
        "recommendation": recommendation,
    }


# =============================================================================
# Probe 2: WhatsApp Baileys Auth Session
# =============================================================================

def probe_whatsapp_session(bot_dir: str = BOT_DIR) -> Dict[str, Any]:
    """Inspect WhatsApp Multi-Device session state and credentials.

    Validates existence, JSON integrity, registration status, and cryptographic
    pre-key files in sesi_bot/creds.json.
    """
    logger.debug("Executing probe_whatsapp_session...")
    sesi_path = os.path.join(bot_dir, "sesi_bot")
    creds_file = os.path.join(sesi_path, "creds.json")

    if not os.path.isdir(sesi_path) or not os.path.isfile(creds_file):
        return {
            "status": "MISSING_CREDS",
            "authenticated": False,
            "bot_phone": None,
            "bot_lid": None,
            "bot_name": None,
            "session_files_count": 0,
            "creds_size_bytes": 0,
            "details": "sesi_bot/creds.json does not exist.",
            "recommendation": "Session not initialized. Start bot using 'npm start' to generate QR code and authenticate.",
        }

    try:
        size = os.path.getsize(creds_file)
        if size == 0:
            return {
                "status": "CORRUPT_CREDS",
                "authenticated": False,
                "bot_phone": None,
                "bot_lid": None,
                "bot_name": None,
                "session_files_count": 0,
                "creds_size_bytes": 0,
                "details": "sesi_bot/creds.json is 0 bytes (empty file).",
                "recommendation": "Creds file is truncated. Delete sesi_bot and scan QR code again.",
            }

        with open(creds_file, "r", encoding="utf-8") as f:
            creds = json.load(f)

        me = creds.get("me")
        if not me or not isinstance(me, dict) or not me.get("id"):
            return {
                "status": "UNAUTHENTICATED",
                "authenticated": False,
                "bot_phone": None,
                "bot_lid": None,
                "bot_name": None,
                "session_files_count": 0,
                "creds_size_bytes": size,
                "details": "creds.json exists but 'me' identity is not registered (awaiting QR scan).",
                "recommendation": "Scan the WhatsApp QR code in the bot console to link device.",
            }

        # Extract phone and LID
        raw_id = str(me.get("id", ""))
        bot_phone = raw_id.split(":")[0].split("@")[0] if raw_id else None

        raw_lid = str(me.get("lid", "")) if me.get("lid") else ""
        bot_lid = raw_lid.split(":")[0].split("@")[0] if raw_lid else None

        bot_name = me.get("name") or "Bot"

        # Count session keys
        try:
            session_files = [
                f for f in os.listdir(sesi_path)
                if os.path.isfile(os.path.join(sesi_path, f))
            ]
            session_files_count = len(session_files)
        except Exception:
            session_files_count = 1

        return {
            "status": "AUTHENTICATED",
            "authenticated": True,
            "bot_phone": bot_phone,
            "bot_lid": bot_lid,
            "bot_name": bot_name,
            "session_files_count": session_files_count,
            "creds_size_bytes": size,
            "details": f"Authenticated as '{bot_name}' (+{bot_phone}), {session_files_count} session files.",
            "recommendation": "WhatsApp session is healthy and active.",
        }

    except json.JSONDecodeError as err:
        return {
            "status": "CORRUPT_CREDS",
            "authenticated": False,
            "bot_phone": None,
            "bot_lid": None,
            "bot_name": None,
            "session_files_count": 0,
            "creds_size_bytes": os.path.getsize(creds_file) if os.path.exists(creds_file) else 0,
            "details": f"JSON syntax error in creds.json: {err}",
            "recommendation": "creds.json is corrupted. Re-authenticate bot.",
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "authenticated": False,
            "bot_phone": None,
            "bot_lid": None,
            "bot_name": None,
            "session_files_count": 0,
            "creds_size_bytes": 0,
            "details": f"Failed reading credentials: {e}",
            "recommendation": "Check filesystem permissions for sesi_bot directory.",
        }


# =============================================================================
# Probe 3: File Permissions & Critical Paths
# =============================================================================

def probe_file_permissions(
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR
) -> Dict[str, Any]:
    """Verify read and write permissions on all critical ecosystem state files."""
    logger.debug("Executing probe_file_permissions...")

    target_files = [
        ("config.json", os.path.join(bot_dir, "config.json"), "RW"),
        ("whitelist.json", os.path.join(bot_dir, "whitelist.json"), "RW"),
        ("rekap_data.json", os.path.join(bot_dir, "rekap_data.json"), "RW"),
        ("sesi_bot/creds.json", os.path.join(bot_dir, "sesi_bot", "creds.json"), "RW"),
        ("pareto_store.db", os.path.join(app_dir, "data", "pareto_store.db"), "RW"),
        ("package.json", os.path.join(bot_dir, "package.json"), "R"),
    ]

    files_report: Dict[str, Any] = {}
    missing_files: List[str] = []
    permission_errors: List[str] = []

    for name, path, required_mode in target_files:
        exists = os.path.exists(path)
        readable = os.access(path, os.R_OK) if exists else False
        writable = os.access(path, os.W_OK) if exists else False
        size_bytes = os.path.getsize(path) if exists else 0

        files_report[name] = {
            "path": path,
            "required_mode": required_mode,
            "exists": exists,
            "readable": readable,
            "writable": writable,
            "size_bytes": size_bytes,
        }

        if not exists:
            # Special case: creds.json might not exist before initial QR scan
            if name == "sesi_bot/creds.json":
                continue
            missing_files.append(name)
        else:
            if "R" in required_mode and not readable:
                permission_errors.append(f"{name} (not readable)")
            if "W" in required_mode and not writable:
                permission_errors.append(f"{name} (not writable)")

    if missing_files:
        status = "CRITICAL_MISSING_FILE"
        details = f"Missing critical files: {', '.join(missing_files)}"
        recommendation = "Restore missing state files or initialize default configurations."
    elif permission_errors:
        status = "CRITICAL_PERMISSION_ERROR"
        details = f"File permission denied on: {', '.join(permission_errors)}"
        recommendation = "Adjust filesystem ACL / NTFS permissions to grant Read/Write access."
    else:
        status = "OK"
        details = f"All {len(target_files)} critical files have valid Read/Write permissions."
        recommendation = "File permissions are healthy."

    return {
        "status": status,
        "checked_count": len(target_files),
        "missing_files": missing_files,
        "permission_errors": permission_errors,
        "files": files_report,
        "details": details,
        "recommendation": recommendation,
    }


# =============================================================================
# Probe 4: Database & State Integrity
# =============================================================================

def probe_database_integrity(
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR
) -> Dict[str, Any]:
    """Validate JSON schema validity and SQLite database consistency."""
    logger.debug("Executing probe_database_integrity...")
    issues: List[str] = []
    sqlite_info: Dict[str, Any] = {
        "status": "UNCHECKED",
        "integrity_check": [],
        "periods_count": 0,
        "items_count": 0,
    }

    # 1. Check config.json schema
    cfg_path = os.path.join(bot_dir, "config.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            required_keys = [
                "nama_toko", "kode_toko", "target_spd", "target_std",
                "target_apc", "target_gm", "validasi_spd_min", "validasi_spd_max"
            ]
            for key in required_keys:
                if key not in cfg:
                    issues.append(f"config.json missing required key: '{key}'")

            spd_min = cfg.get("validasi_spd_min", 0)
            spd_max = cfg.get("validasi_spd_max", 0)
            if isinstance(spd_min, (int, float)) and isinstance(spd_max, (int, float)):
                if spd_min > spd_max:
                    issues.append(f"config.json invalid bounds: validasi_spd_min ({spd_min}) > validasi_spd_max ({spd_max})")
        except Exception as e:
            issues.append(f"config.json parsing error: {e}")
    else:
        issues.append("config.json not found on disk")

    # 2. Check whitelist.json schema
    wl_path = os.path.join(bot_dir, "whitelist.json")
    if os.path.exists(wl_path):
        try:
            with open(wl_path, "r", encoding="utf-8") as f:
                wl = json.load(f)
            if not isinstance(wl.get("super_admins"), list) or len(wl.get("super_admins")) == 0:
                issues.append("whitelist.json 'super_admins' must be a non-empty array")
            if not isinstance(wl.get("users"), list):
                issues.append("whitelist.json 'users' must be an array")
        except Exception as e:
            issues.append(f"whitelist.json parsing error: {e}")
    else:
        issues.append("whitelist.json not found on disk")

    # 3. Check rekap_data.json schema
    rk_path = os.path.join(bot_dir, "rekap_data.json")
    if os.path.exists(rk_path):
        try:
            with open(rk_path, "r", encoding="utf-8") as f:
                rk = json.load(f)
            if not isinstance(rk, list):
                issues.append("rekap_data.json must be a JSON array")
            else:
                for idx, entry in enumerate(rk):
                    if not isinstance(entry, dict) or "tanggal" not in entry or "spd" not in entry:
                        issues.append(f"rekap_data.json entry #{idx} missing required fields (tanggal, spd)")
                        break
        except Exception as e:
            issues.append(f"rekap_data.json parsing error: {e}")

    # 4. Check SQLite database (pareto_store.db)
    db_file = os.path.join(app_dir, "data", "pareto_store.db")
    if os.path.exists(db_file):
        conn = None
        try:
            conn = sqlite3.connect(db_file, timeout=5.0)
            cursor = conn.cursor()

            # PRAGMA integrity_check
            cursor.execute("PRAGMA integrity_check")
            integrity_rows = [r[0] for r in cursor.fetchall()]
            sqlite_info["integrity_check"] = integrity_rows

            if integrity_rows != ["ok"]:
                issues.append(f"SQLite PRAGMA integrity_check reported corruption: {integrity_rows}")

            # Verify table existence
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cursor.fetchall()]
            sqlite_info["tables"] = tables

            if "periods" in tables:
                cursor.execute("SELECT count(1) FROM periods")
                sqlite_info["periods_count"] = cursor.fetchone()[0]
            else:
                issues.append("SQLite database missing 'periods' table")

            if "items" in tables:
                cursor.execute("SELECT count(1) FROM items")
                sqlite_info["items_count"] = cursor.fetchone()[0]
            else:
                issues.append("SQLite database missing 'items' table")

            sqlite_info["status"] = "OK" if not issues else "DEGRADED"

        except sqlite3.OperationalError as oe:
            issues.append(f"SQLite operational error (locked or inaccessible): {oe}")
            sqlite_info["status"] = "LOCKED"
        except Exception as e:
            issues.append(f"SQLite database error: {e}")
            sqlite_info["status"] = "ERROR"
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
    else:
        # DB might not exist if desktop app hasn't initialized it yet
        issues.append(f"SQLite database file not found at {db_file}")
        sqlite_info["status"] = "NOT_FOUND"

    if issues:
        status = "INTEGRITY_FAILURES"
        details = f"{len(issues)} integrity issue(s) detected: {'; '.join(issues)}"
        recommendation = "Review corrupted JSON state files or run SQLite recovery."
    else:
        status = "HEALTHY"
        details = f"Config & Whitelist JSON valid. SQLite integrity OK ({sqlite_info['periods_count']} periods, {sqlite_info['items_count']} items)."
        recommendation = "Database and state stores are intact."

    return {
        "status": status,
        "issues": issues,
        "sqlite": sqlite_info,
        "sqlite_integrity": "ok" if sqlite_info.get("integrity_check") == ["ok"] else "failed",
        "periods_count": sqlite_info.get("periods_count", 0),
        "items_count": sqlite_info.get("items_count", 0),
        "details": details,
        "recommendation": recommendation,
    }


# =============================================================================
# Probe 5: Disk Space & Storage Leak Audit
# =============================================================================

def probe_storage_leaks(
    bot_dir: str = BOT_DIR,
    auto_repair: bool = False
) -> Dict[str, Any]:
    """Audit host disk storage capacity and detect orphaned temporary files (R1 leak surface)."""
    logger.debug(f"Executing probe_storage_leaks (auto_repair={auto_repair})...")
    now = time.time()
    leaked_uploads: List[Dict[str, Any]] = []
    expired_temp_files: List[Dict[str, Any]] = []
    repaired_files: List[str] = []

    # 1. Audit orphaned pareto_uploaded_* files
    upload_pattern = os.path.join(bot_dir, "pareto_uploaded_*")
    for file_path in glob.glob(upload_pattern):
        try:
            mtime = os.path.getmtime(file_path)
            age_seconds = now - mtime
            size = os.path.getsize(file_path)
            file_info = {
                "file": os.path.basename(file_path),
                "path": file_path,
                "age_seconds": round(age_seconds, 1),
                "size_bytes": size,
            }
            if auto_repair:
                os.remove(file_path)
                repaired_files.append(os.path.basename(file_path))
                logger.info(f"Auto-repaired: removed leaked file {file_path}")
            else:
                leaked_uploads.append(file_info)
        except Exception as e:
            logger.warning(f"Error inspecting or removing {file_path}: {e}")

    # 2. Audit intermediate export files (*Laporan_PB_Pareto_*.xlsx, *Rekap_Bulanan_*.xlsx)
    export_patterns = [
        os.path.join(bot_dir, "*Laporan_PB_Pareto_*.xlsx"),
        os.path.join(bot_dir, "*Rekap_Bulanan_*.xlsx"),
    ]
    for pattern in export_patterns:
        for file_path in glob.glob(pattern):
            try:
                mtime = os.path.getmtime(file_path)
                age_seconds = now - mtime
                # Only flag as leak if older than 1 hour (3600s)
                if age_seconds > 3600:
                    file_info = {
                        "file": os.path.basename(file_path),
                        "path": file_path,
                        "age_seconds": round(age_seconds, 1),
                        "size_bytes": os.path.getsize(file_path),
                    }
                    if auto_repair:
                        os.remove(file_path)
                        repaired_files.append(os.path.basename(file_path))
                        logger.info(f"Auto-repaired: removed stale export {file_path}")
                    else:
                        expired_temp_files.append(file_info)
            except Exception as e:
                logger.warning(f"Error inspecting export file {file_path}: {e}")

    # 3. Audit host disk capacity
    drive_target = bot_dir
    try:
        total, used, free = shutil.disk_usage(drive_target)
        disk_free_gb = round(free / (1024 ** 3), 2)
        disk_total_gb = round(total / (1024 ** 3), 2)
        disk_used_gb = round(used / (1024 ** 3), 2)
        disk_free_pct = round((free / total) * 100.0, 1) if total > 0 else 0.0
    except Exception as e:
        logger.warning(f"Failed to query disk usage: {e}")
        disk_free_gb, disk_total_gb, disk_used_gb, disk_free_pct = 0.0, 0.0, 0.0, 0.0

    # Warning threshold: free space < 10% or < 5.0 GB
    disk_low = (disk_free_pct < 10.0 or disk_free_gb < 5.0)

    # Determine status
    if leaked_uploads and disk_low:
        status = "WARNING_LOW_DISK_AND_LEAKS"
        details = f"{len(leaked_uploads)} leaked upload(s) detected; Disk free: {disk_free_gb} GB ({disk_free_pct}% - Low)."
        recommendation = "Purge leaked upload files using --repair and free up host drive space."
    elif leaked_uploads:
        status = "WARNING_STORAGE_LEAKS"
        details = f"{len(leaked_uploads)} orphaned temporary uploaded file(s) found in bot directory."
        recommendation = "Execute monitoring agent with --repair to clean orphaned upload files."
    elif disk_low:
        status = "WARNING_LOW_DISK"
        details = f"Drive free space is low: {disk_free_gb} GB ({disk_free_pct}% remaining)."
        recommendation = "Clean temporary files or expand host storage capacity."
    else:
        status = "HEALTHY"
        details = f"0 leaked uploads; Disk free: {disk_free_gb} GB ({disk_free_pct}% - Healthy)."
        recommendation = "Storage usage is optimal."

    return {
        "status": status,
        "disk_free_gb": disk_free_gb,
        "disk_total_gb": disk_total_gb,
        "disk_used_gb": disk_used_gb,
        "disk_free_percent": disk_free_pct,
        "disk_low": disk_low,
        "leaked_uploads_count": len(leaked_uploads),
        "leaked_uploads": leaked_uploads,
        "expired_temp_files": expired_temp_files,
        "repaired_files": repaired_files,
        "details": details,
        "recommendation": recommendation,
    }


def repair_storage_leaks(bot_dir: str = BOT_DIR) -> Dict[str, Any]:
    """Autonomous tool: purge leaked temporary files and intermediate exports."""
    return probe_storage_leaks(bot_dir=bot_dir, auto_repair=True)


# =============================================================================
# Aggregation & Health Telemetry Core
# =============================================================================

def run_full_audit(
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR,
    auto_repair: bool = False
) -> Dict[str, Any]:
    """Execute all 5 diagnostic probes, aggregate telemetry, and compute health score."""
    iso_time = get_iso_timestamp()
    wib_time = get_wib_timestamp()

    # Run Probes
    bot_proc = probe_bot_process(bot_dir=bot_dir)
    wa_session = probe_whatsapp_session(bot_dir=bot_dir)
    file_perms = probe_file_permissions(bot_dir=bot_dir, app_dir=app_dir)
    db_integrity = probe_database_integrity(bot_dir=bot_dir, app_dir=app_dir)
    storage_probe = probe_storage_leaks(bot_dir=bot_dir, auto_repair=auto_repair)

    # Collect Alerts & Recommendations
    alerts: List[Dict[str, str]] = []
    recommendations: List[str] = []
    health_score = 100

    # 1. Bot Process Evaluation
    if not bot_proc.get("running"):
        alerts.append({
            "severity": "CRITICAL",
            "code": "BOT_PROCESS_DOWN",
            "message": "WhatsApp Bot process (node.exe index.js) is not running.",
        })
        recommendations.append(bot_proc.get("recommendation", "Start bot using 'npm start'."))
        health_score -= 30
    elif bot_proc.get("count", 0) > 1:
        alerts.append({
            "severity": "WARNING",
            "code": "BOT_PROCESS_MULTIPLE",
            "message": f"Multiple bot instances ({bot_proc['count']}) detected simultaneously.",
        })
        recommendations.append(bot_proc.get("recommendation", ""))
        health_score -= 10

    # 2. WhatsApp Session Evaluation
    if not wa_session.get("authenticated"):
        if wa_session.get("status") == "UNAUTHENTICATED":
            alerts.append({
                "severity": "WARNING",
                "code": "WHATSAPP_AWAITING_QR",
                "message": "WhatsApp session exists but requires QR code scan.",
            })
            health_score -= 10
        else:
            alerts.append({
                "severity": "CRITICAL",
                "code": "WHATSAPP_SESSION_INVALID",
                "message": f"WhatsApp credentials invalid ({wa_session.get('status')}).",
            })
            health_score -= 20
        recommendations.append(wa_session.get("recommendation", "Authenticate WhatsApp session."))

    # 3. File Permissions Evaluation
    if file_perms.get("status") != "OK":
        alerts.append({
            "severity": "CRITICAL",
            "code": "FILE_PERMISSION_ERROR",
            "message": file_perms.get("details", "File access error."),
        })
        recommendations.append(file_perms.get("recommendation", "Verify file permissions."))
        health_score -= 25

    # 4. Database Integrity Evaluation
    if db_integrity.get("status") != "HEALTHY":
        alerts.append({
            "severity": "CRITICAL",
            "code": "DATABASE_INTEGRITY_ERROR",
            "message": db_integrity.get("details", "Database integrity issues detected."),
        })
        recommendations.append(db_integrity.get("recommendation", "Audit state files and database."))
        health_score -= 25

    # 5. Storage Leaks & Disk Evaluation
    if storage_probe.get("disk_low"):
        alerts.append({
            "severity": "WARNING",
            "code": "DISK_SPACE_LOW",
            "message": f"Host drive free space is below 10% ({storage_probe.get('disk_free_gb')} GB / {storage_probe.get('disk_free_percent')}% free).",
        })
        recommendations.append(storage_probe.get("recommendation", "Free up host disk space."))
        health_score -= 10

    if storage_probe.get("leaked_uploads_count", 0) > 0:
        alerts.append({
            "severity": "WARNING",
            "code": "STORAGE_LEAK_DETECTED",
            "message": f"{storage_probe.get('leaked_uploads_count')} orphaned pareto_uploaded_* file(s) found on disk.",
        })
        recommendations.append("Execute monitoring agent with --repair to purge leaked upload files.")
        health_score -= 10

    health_score = max(0, min(100, health_score))

    # Overall Status Determination
    has_critical = any(a["severity"] == "CRITICAL" for a in alerts)
    has_warning = any(a["severity"] == "WARNING" for a in alerts)

    if has_critical:
        overall_status = "CRITICAL"
    elif has_warning:
        overall_status = "WARNING"
    else:
        overall_status = "HEALTHY"

    # Deduplicate recommendations while preserving order
    seen_recs = set()
    dedup_recs = []
    for r in recommendations:
        if r and r not in seen_recs:
            seen_recs.add(r)
            dedup_recs.append(r)

    telemetry: Dict[str, Any] = {
        "timestamp": iso_time,
        "timestamp_wib": wib_time,
        "overall_status": overall_status,
        "health_score": health_score,
        "components": {
            "bot_process": bot_proc,
            "whatsapp_session": wa_session,
            "file_permissions": file_perms,
            "database_integrity": db_integrity,
            "storage_and_leaks": storage_probe,
        },
        "alerts": alerts,
        "recommendations": dedup_recs,
    }

    # Generate multi-format report files
    generate_reports(telemetry, output_dir=bot_dir)

    return telemetry


# =============================================================================
# Multi-Format Report Generation
# =============================================================================

def format_alert_text(telemetry: Dict[str, Any]) -> str:
    """Format compact WhatsApp-ready broadcast alert for Super Admins."""
    overall = telemetry.get("overall_status", "UNKNOWN")
    wib_time = telemetry.get("timestamp_wib", get_wib_timestamp())

    status_icon_map = {
        "HEALTHY": "🟢 SISTEM NORMAL",
        "WARNING": "⚠️ PERHATIAN DIBUTUHKAN",
        "CRITICAL": "🔴 KRITIKAL (TINDAKAN SEGERA)",
    }
    status_header = status_icon_map.get(overall, "ℹ️ STATUS SISTEM")

    components = telemetry.get("components", {})
    bot = components.get("bot_process", {})
    wa = components.get("whatsapp_session", {})
    perm = components.get("file_permissions", {})
    db = components.get("database_integrity", {})
    storage = components.get("storage_and_leaks", {})

    # Bot line
    if bot.get("running"):
        bot_line = f"🟢 *Bot WhatsApp:* AKTIF (PID: {bot.get('pids', [])})"
    else:
        bot_line = "🔴 *Bot WhatsApp:* TIDAK AKTIF (Process stopped)"

    # WhatsApp session line
    if wa.get("authenticated"):
        bot_name = wa.get("bot_name", "Bot")
        phone = wa.get("bot_phone", "-")
        wa_line = f"🟢 *Sesi WhatsApp:* TERAUTENTIKASI ({bot_name} - {phone})"
    elif wa.get("status") == "UNAUTHENTICATED":
        wa_line = "🟡 *Sesi WhatsApp:* MENUNGGU SCAN QR"
    else:
        wa_line = f"🔴 *Sesi WhatsApp:* BERMASALAH ({wa.get('status')})"

    # Permissions line
    if perm.get("status") == "OK":
        perm_line = "🟢 *Integritas File:* AMAN (Config, Whitelist, Rekap normal)"
    else:
        perm_line = f"🔴 *Integritas File:* PERMASALAHAN IZIN AKSES ({perm.get('status')})"

    # Database line
    if db.get("status") == "HEALTHY":
        db_line = f"🟢 *Database SQLite:* NORMAL ({db.get('periods_count', 0)} Periode, {db.get('items_count', 0):,} Item tersimpan)"
    else:
        db_line = f"🔴 *Database SQLite:* INTEGRITY CHECK GAGAL ({len(db.get('issues', []))} issue)"

    # Disk capacity line
    disk_free = storage.get("disk_free_gb", 0)
    disk_pct = storage.get("disk_free_percent", 0)
    if storage.get("disk_low"):
        disk_line = f"🟡 *Kapasitas Disk:* {disk_free} GB ({disk_pct}% sisa - Rendah)"
    else:
        disk_line = f"🟢 *Kapasitas Disk:* {disk_free} GB ({disk_pct}% sisa - Cukup)"

    # Storage leaks line
    leak_count = storage.get("leaked_uploads_count", 0)
    if leak_count > 0:
        leak_line = f"🔴 *Kebocoran File:* {leak_count} file temporary bocor terdeteksi"
    else:
        leak_line = "🟢 *Kebocoran File:* BERSIH (0 file temporary bocor)"

    # Format recommendations
    recs = telemetry.get("recommendations", [])
    rec_text = "\n".join([f"{i+1}. {r}" for i, r in enumerate(recs)]) if recs else "Sistem beroperasi optimal."

    alert_text = (
        f"*📢 LAPORAN MONITORING SISTEM & BOT*\n"
        f"*Waktu:* {wib_time}\n"
        f"*Status Global:* {status_header}\n\n"
        f"{bot_line}\n"
        f"{wa_line}\n"
        f"{perm_line}\n"
        f"{db_line}\n"
        f"{disk_line}\n"
        f"{leak_line}\n\n"
        f"*Tindakan Disarankan:*\n"
        f"{rec_text}\n"
    )
    return alert_text


def format_markdown_report(telemetry: Dict[str, Any]) -> str:
    """Format rich Markdown document for reports and audit logs."""
    timestamp = telemetry.get("timestamp", get_iso_timestamp())
    overall = telemetry.get("overall_status", "UNKNOWN")
    score = telemetry.get("health_score", 100)

    badge_map = {
        "HEALTHY": "🟢 **HEALTHY (All Systems Operational)**",
        "WARNING": "⚠️ **WARNING (Action Required)**",
        "CRITICAL": "🔴 **CRITICAL (Immediate Attention Required)**",
    }
    status_badge = badge_map.get(overall, overall)

    components = telemetry.get("components", {})
    bot = components.get("bot_process", {})
    wa = components.get("whatsapp_session", {})
    perm = components.get("file_permissions", {})
    db = components.get("database_integrity", {})
    storage = components.get("storage_and_leaks", {})

    bot_icon = "✅" if bot.get("running") else "❌"
    wa_icon = "✅" if wa.get("authenticated") else ("🟡" if wa.get("status") == "UNAUTHENTICATED" else "❌")
    perm_icon = "✅" if perm.get("status") == "OK" else "❌"
    db_icon = "✅" if db.get("status") == "HEALTHY" else "❌"
    storage_icon = "⚠️" if (storage.get("disk_low") or storage.get("leaked_uploads_count", 0) > 0) else "✅"

    alerts = telemetry.get("alerts", [])
    if alerts:
        alerts_md = "\n".join([
            f"- {'🔴' if a['severity'] == 'CRITICAL' else ('🟡' if a['severity'] == 'WARNING' else 'ℹ️')} **{a['severity']}** [{a['code']}]: {a['message']}"
            for a in alerts
        ])
    else:
        alerts_md = "None. All system components operating within nominal parameters."

    recs = telemetry.get("recommendations", [])
    if recs:
        recs_md = "\n".join([f"{i+1}. {r}" for i, r in enumerate(recs)])
    else:
        recs_md = "No remediation needed."

    md_content = f"""# 🛡️ Autonomous System Health Report

**Audit Timestamp:** {timestamp} (UTC)  
**Overall System Status:** {status_badge}  
**Health Score:** {score} / 100  

---

### Component Health Summary

| Component | Status | Details |
|---|---|---|
| **WhatsApp Bot Process** | {bot_icon} **{bot.get('status')}** | {bot.get('details')} |
| **WhatsApp Auth Session** | {wa_icon} **{wa.get('status')}** | {wa.get('details')} |
| **File Permissions** | {perm_icon} **{perm.get('status')}** | {perm.get('details')} |
| **JSON & SQLite Integrity** | {db_icon} **{db.get('status')}** | {db.get('details')} |
| **Storage & Disk Capacity** | {storage_icon} **{storage.get('status')}** | {storage.get('details')} |

---

### Active Alerts

{alerts_md}

---

### Recommended Remediation Steps

{recs_md}
"""
    return md_content


def generate_reports(telemetry: Dict[str, Any], output_dir: str = BOT_DIR) -> None:
    """Safely persist JSON, Markdown, and WhatsApp text alerts to output directory."""
    json_path = os.path.join(output_dir, "monitoring_report.json")
    md_path = os.path.join(output_dir, "monitoring_report.md")
    txt_path = os.path.join(output_dir, "status_alert.txt")

    # 1. Write JSON Report
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(telemetry, f, indent=2, ensure_ascii=False)
        logger.debug(f"Wrote JSON report to {json_path}")
    except Exception as e:
        logger.error(f"Failed writing JSON report: {e}")

    # 2. Write Markdown Report
    try:
        md_text = format_markdown_report(telemetry)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md_text)
        logger.debug(f"Wrote Markdown report to {md_path}")
    except Exception as e:
        logger.error(f"Failed writing Markdown report: {e}")

    # 3. Write WhatsApp Alert Text
    try:
        alert_text = format_alert_text(telemetry)
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(alert_text)
        logger.debug(f"Wrote WhatsApp alert text to {txt_path}")
    except Exception as e:
        logger.error(f"Failed writing WhatsApp alert text: {e}")


# =============================================================================
# Execution Runners: Dual-Engine Architecture
# =============================================================================

def is_gemini_available() -> bool:
    """Check if Google Antigravity SDK is installed and GEMINI_API_KEY is present."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    return bool(api_key and HAS_AGY_SDK)


async def run_antigravity_daemon(
    interval: int = 300,
    auto_repair: bool = False,
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR
) -> None:
    """Run autonomous background monitoring agent using Google Antigravity SDK."""
    logger.info("Initializing Autonomous Monitoring Agent via Google Antigravity SDK...")

    # Immediate baseline audit
    run_full_audit(bot_dir=bot_dir, app_dir=app_dir, auto_repair=auto_repair)

    # Periodic trigger callback
    async def periodic_check(ctx: TriggerContext):
        logger.info("Google Antigravity Trigger: executing scheduled system audit...")
        telemetry = run_full_audit(bot_dir=bot_dir, app_dir=app_dir, auto_repair=auto_repair)
        alert_text = format_alert_text(telemetry)
        try:
            await ctx.send(f"Automated System Audit Result:\n{alert_text}")
        except Exception as e:
            logger.debug(f"TriggerContext send exception: {e}")

    timer_trigger = every(interval, periodic_check)

    config = LocalAgentConfig(
        system_instructions=(
            "You are the autonomous system reliability monitoring agent for the WhatsApp Bot "
            "and Desktop Pareto retail ecosystem. Monitor system health, detect storage leaks, "
            "and alert administrators of critical issues."
        ),
        capabilities=types.CapabilitiesConfig(
            agent_behavior=types.AgentBehavior.AUTONOMOUS,
        ),
        triggers=[timer_trigger],
        policies=[
            policy.confirm_run_command(),
        ],
        tools=[
            probe_bot_process,
            probe_whatsapp_session,
            probe_file_permissions,
            probe_database_integrity,
            probe_storage_leaks,
            repair_storage_leaks,
        ],
    )

    async with Agent(config=config) as agent:
        logger.info("Google Antigravity Agent initialized. Autonomous monitoring running...")
        while True:
            await asyncio.sleep(1)


def run_deterministic_daemon(
    interval: int = 300,
    auto_repair: bool = False,
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR
) -> None:
    """Run deterministic monitoring loop when offline or GEMINI_API_KEY is not configured."""
    logger.info("Starting Deterministic Diagnostic Engine (offline fallback)...")
    logger.info(f"Monitoring interval: {interval} seconds. Press Ctrl+C to stop.")

    try:
        while True:
            telemetry = run_full_audit(bot_dir=bot_dir, app_dir=app_dir, auto_repair=auto_repair)
            logger.info(
                f"Diagnostic completed: Status = {telemetry['overall_status']}, "
                f"Health Score = {telemetry['health_score']}/100"
            )
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("Deterministic monitoring loop stopped by user.")


def run_single_audit_cli(
    auto_repair: bool = False,
    bot_dir: str = BOT_DIR,
    app_dir: str = APP_DIR
) -> int:
    """Execute a single diagnostic run, print summary to stdout, and return exit code."""
    logger.info("Executing single diagnostic audit pass (--once)...")
    telemetry = run_full_audit(bot_dir=bot_dir, app_dir=app_dir, auto_repair=auto_repair)

    # Print summary to stdout
    print("\n" + "=" * 70)
    print("  AUTONOMOUS SYSTEM HEALTH MONITORING REPORT")
    print("=" * 70)
    print(f"Timestamp:      {telemetry['timestamp_wib']} ({telemetry['timestamp']})")
    print(f"Overall Status: {telemetry['overall_status']}")
    print(f"Health Score:   {telemetry['health_score']} / 100")
    print("-" * 70)

    comps = telemetry["components"]
    print(f"1. Bot Process:       {comps['bot_process']['status']} - {comps['bot_process']['details']}")
    print(f"2. WhatsApp Session:  {comps['whatsapp_session']['status']} - {comps['whatsapp_session']['details']}")
    print(f"3. File Permissions:  {comps['file_permissions']['status']} - {comps['file_permissions']['details']}")
    print(f"4. Database Health:   {comps['database_integrity']['status']} - {comps['database_integrity']['details']}")
    print(f"5. Storage & Leaks:   {comps['storage_and_leaks']['status']} - {comps['storage_and_leaks']['details']}")

    if telemetry["alerts"]:
        print("-" * 70)
        print("ACTIVE ALERTS:")
        for a in telemetry["alerts"]:
            print(f"  [{a['severity']}] {a['code']}: {a['message']}")

    if telemetry["recommendations"]:
        print("-" * 70)
        print("RECOMMENDATIONS:")
        for idx, rec in enumerate(telemetry["recommendations"], 1):
            print(f"  {idx}. {rec}")

    print("=" * 70)
    print(f"Reports generated:")
    print(f"  - JSON:     {os.path.join(bot_dir, 'monitoring_report.json')}")
    print(f"  - Markdown: {os.path.join(bot_dir, 'monitoring_report.md')}")
    print(f"  - WhatsApp: {os.path.join(bot_dir, 'status_alert.txt')}")
    print("=" * 70 + "\n")

    # Exit code: 0 = HEALTHY or WARNING, 1 = CRITICAL
    return 1 if telemetry["overall_status"] == "CRITICAL" else 0


# =============================================================================
# CLI Entrypoint
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Autonomous System Health Monitoring Agent (Google Antigravity SDK)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run single diagnostic audit pass and exit with status code (0 = HEALTHY/WARNING, 1 = CRITICAL)",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuous scheduled monitoring loop (Google Antigravity SDK autonomous mode or deterministic fallback)",
    )
    parser.add_argument(
        "--repair",
        action="store_true",
        help="Clean up detected orphaned temporary files (pareto_uploaded_*.xls) and stale exports",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Audit interval in seconds for daemon mode (default: 300)",
    )
    parser.add_argument(
        "--bot-dir",
        type=str,
        default=BOT_DIR,
        help=f"Target bot directory (default: {BOT_DIR})",
    )
    parser.add_argument(
        "--app-dir",
        type=str,
        default=APP_DIR,
        help=f"Target desktop application directory (default: {APP_DIR})",
    )

    args = parser.parse_args()

    # Default to single pass if neither daemon nor once specified
    if not args.daemon and not args.once:
        args.once = True

    if args.once:
        exit_code = run_single_audit_cli(
            auto_repair=args.repair,
            bot_dir=args.bot_dir,
            app_dir=args.app_dir
        )
        sys.exit(exit_code)
    elif args.daemon:
        if is_gemini_available():
            try:
                asyncio.run(
                    run_antigravity_daemon(
                        interval=args.interval,
                        auto_repair=args.repair,
                        bot_dir=args.bot_dir,
                        app_dir=args.app_dir,
                    )
                )
            except KeyboardInterrupt:
                logger.info("Autonomous Agent stopped by user.")
        else:
            run_deterministic_daemon(
                interval=args.interval,
                auto_repair=args.repair,
                bot_dir=args.bot_dir,
                app_dir=args.app_dir,
            )


if __name__ == "__main__":
    main()
