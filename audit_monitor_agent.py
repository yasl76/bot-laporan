#!/usr/bin/env python3
"""
Autonomous Ecosystem Monitor & Health Audit Agent
Powered by Google Antigravity (AGY) SDK architecture.

Performs proactive diagnostic probes:
1. WhatsApp Bot process & Baileys multi-file auth session integrity.
2. Storage hygiene & leak elimination (orphaned pareto_uploaded_* files).
3. Whitelist access control & Multi-Device LID mapping verification.
4. Sales data JSON schema conformance and calculation safety.
5. Store configuration and target metrics consistency.
"""

import os
import sys
import json
import time
import glob
import asyncio
from datetime import datetime
from pathlib import Path

# Fix Windows console UTF-8 encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BOT_ROOT = Path(__file__).parent.resolve()
SESSION_DIR = BOT_ROOT / "sesi_bot"
WHITELIST_FILE = BOT_ROOT / "whitelist.json"
CONFIG_FILE = BOT_ROOT / "config.json"
REKAP_FILE = BOT_ROOT / "rekap_data.json"
REPORT_FILE = BOT_ROOT / "AUDIT_REPORT.md"

def probe_auth_session():
    """Probe 1: Verify WhatsApp Baileys multi-file auth session."""
    findings = []
    status = "OK"

    if not SESSION_DIR.exists() or not SESSION_DIR.is_dir():
        return {
            "probe": "WhatsApp Auth Session",
            "status": "WARNING",
            "details": "sesi_bot directory does not exist yet. Bot needs QR scan to initialize."
        }

    creds_path = SESSION_DIR / "creds.json"
    if not creds_path.exists():
        return {
            "probe": "WhatsApp Auth Session",
            "status": "WARNING",
            "details": "creds.json missing in sesi_bot. Session not paired yet."
        }

    try:
        with open(creds_path, "r", encoding="utf-8") as f:
            creds = json.load(f)

        me = creds.get("me", {})
        my_id = me.get("id", "Unknown")
        my_lid = me.get("lid", "Unset")
        findings.append(f"Paired JID: `{my_id}`, LID: `{my_lid}`")
        if not me.get("id"):
            status = "WARNING"
            findings.append("Credentials present but user ID is empty.")
    except Exception as e:
        status = "ERROR"
        findings.append(f"Corrupted creds.json: {str(e)}")

    return {
        "probe": "WhatsApp Auth Session",
        "status": status,
        "details": "; ".join(findings) if findings else "Session authenticated and healthy."
    }

def probe_disk_storage_hygiene():
    """Probe 2: Verify zero orphaned temporary files and verify disk hygiene."""
    findings = []
    status = "OK"

    # Search for orphaned pareto uploads or exports older than 15 minutes
    orphaned_uploads = list(BOT_ROOT.glob("pareto_uploaded_*.*"))
    orphaned_exports = list(BOT_ROOT.glob("Laporan_PB_Pareto_*.xlsx")) + list(BOT_ROOT.glob("Rekap_Bulanan_*.xlsx"))
    
    total_orphaned = len(orphaned_uploads) + len(orphaned_exports)
    if total_orphaned > 0:
        status = "WARNING"
        findings.append(f"Found {len(orphaned_uploads)} leftover upload files and {len(orphaned_exports)} intermediate Excel reports.")
        # Auto-remediation: clean up files older than 1 hour
        now = time.time()
        cleaned = 0
        for f in orphaned_uploads + orphaned_exports:
            try:
                if now - f.stat().st_mtime > 3600:
                    f.unlink()
                    cleaned += 1
            except Exception:
                pass
        if cleaned > 0:
            findings.append(f"Auto-cleaned {cleaned} stale files (>1 hour old).")
    else:
        findings.append("No leftover temporary files detected. Disk hygiene optimal.")

    return {
        "probe": "Storage & Memory Hygiene",
        "status": status,
        "details": " ".join(findings)
    }

def probe_whitelist_integrity():
    """Probe 3: Verify whitelist schema, Super Admin entries, and LID resolution."""
    findings = []
    status = "OK"

    if not WHITELIST_FILE.exists():
        return {
            "probe": "Whitelist & Security",
            "status": "ERROR",
            "details": "whitelist.json is missing!"
        }

    try:
        with open(WHITELIST_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        super_admins = data.get("super_admins", [])
        users = data.get("users", [])

        findings.append(f"{len(super_admins)} Super Admin(s), {len(users)} total registered user(s).")

        if len(super_admins) == 0:
            status = "CRITICAL"
            findings.append("No Super Admins defined!")

        # Check LID mapping health
        lid_linked_count = sum(1 for u in users if u.get("lid"))
        findings.append(f"{lid_linked_count}/{len(users)} users have linked WhatsApp Multi-Device LID.")

    except json.JSONDecodeError as e:
        status = "CRITICAL"
        findings.append(f"Invalid JSON syntax in whitelist.json: {str(e)}")
    except Exception as e:
        status = "ERROR"
        findings.append(f"Error checking whitelist: {str(e)}")

    return {
        "probe": "Whitelist & Security",
        "status": status,
        "details": " ".join(findings)
    }

def probe_data_and_config():
    """Probe 4: Validate store configuration and sales database consistency."""
    findings = []
    status = "OK"

    # Config Check
    if not CONFIG_FILE.exists():
        status = "ERROR"
        findings.append("config.json missing.")
    else:
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            toko = cfg.get("nama_toko", "Unset")
            spd = cfg.get("target_spd", 0)
            if spd <= 0:
                status = "WARNING"
                findings.append(f"Store '{toko}' has non-positive target_spd ({spd}).")
            else:
                findings.append(f"Store: '{toko}' (Target SPD: Rp {spd:,.0f}).")
        except Exception as e:
            status = "ERROR"
            findings.append(f"config.json invalid: {str(e)}")

    # Rekap Data Check
    if not REKAP_FILE.exists():
        findings.append("rekap_data.json not found (will be created automatically on first entry).")
    else:
        try:
            with open(REKAP_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                records = json.loads(content)
                if isinstance(records, list):
                    findings.append(f"rekap_data.json valid with {len(records)} daily records.")
                else:
                    status = "ERROR"
                    findings.append("rekap_data.json is not a JSON array.")
        except Exception as e:
            status = "ERROR"
            findings.append(f"rekap_data.json parsing error: {str(e)}")

    return {
        "probe": "Configuration & Sales Database",
        "status": status,
        "details": " ".join(findings)
    }

def run_all_probes():
    """Run all diagnostic probes and return consolidated report."""
    results = [
        probe_auth_session(),
        probe_disk_storage_hygiene(),
        probe_whitelist_integrity(),
        probe_data_and_config()
    ]
    return results

def generate_markdown_report(probes):
    """Generate Markdown formatted health audit report."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    overall_status = "HEALTHY"
    if any(p["status"] == "CRITICAL" for p in probes):
        overall_status = "CRITICAL"
    elif any(p["status"] == "ERROR" for p in probes):
        overall_status = "ERROR"
    elif any(p["status"] == "WARNING" for p in probes):
        overall_status = "WARNING"

    icon = "✅" if overall_status == "HEALTHY" else ("⚠️" if overall_status == "WARNING" else "🚨")

    md = f"""# {icon} Autonomous Health Audit Report
Generated at: **{timestamp}**
System Health Status: **{overall_status}**

## Diagnostic Summary

| Probe | Status | Details |
|---|---|---|
"""
    for p in probes:
        p_icon = "✅" if p["status"] == "OK" else ("⚠️" if p["status"] == "WARNING" else "🚨")
        md += f"| **{p['probe']}** | {p_icon} `{p['status']}` | {p['details']} |\n"

    md += """
---
*Google Antigravity Autonomous Monitoring Service*
"""
    return md

async def run_monitor_cycle():
    """Run a single monitoring cycle and update report."""
    probes = run_all_probes()
    report = generate_markdown_report(probes)
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Audit completed. Status: {[p['status'] for p in probes]}")
    return report

async def main():
    print("🚀 Initializing Autonomous Ecosystem Monitor...")
    
    # Try using Google Antigravity SDK triggers if available
    try:
        from google.antigravity import Agent, LocalAgentConfig
        from google.antigravity.triggers import every, TriggerContext
        print("⚡ Google Antigravity SDK detected. Starting trigger-based monitoring agent.")
        
        async def sdk_periodic_probe(ctx: TriggerContext):
            report = await run_monitor_cycle()
            # Agent can surface alerts if health degrades
            if "CRITICAL" in report or "ERROR" in report:
                await ctx.send(f"⚠️ Health Alert detected:\n{report}")
                
        timer_trigger = every(300, sdk_periodic_probe)
        config = LocalAgentConfig(
            system_instructions="You are the Autonomous Ecosystem Monitor Agent for the WhatsApp Bot and Pareto application.",
            triggers=[timer_trigger]
        )
        async with Agent(config) as agent:
            print("🟢 Antigravity Agent running in autonomous background mode.")
            while True:
                await asyncio.sleep(60)

    except ImportError:
        print("ℹ️ Google Antigravity SDK package not loaded in this python environment; running in native autonomous daemon mode.")
        if "--daemon" in sys.argv:
            print("🔄 Running continuous loop every 5 minutes (Ctrl+C to stop)...")
            while True:
                await run_monitor_cycle()
                await asyncio.sleep(300)
        else:
            report = await run_monitor_cycle()
            print("\n" + report)

if __name__ == "__main__":
    asyncio.run(main())
