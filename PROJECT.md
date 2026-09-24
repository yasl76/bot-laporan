# Project: Bot & Pareto Multi-Ecosystem Reliability & Autonomous Monitoring

## Architecture
- **WhatsApp Bot Subsystem (`c:\projek bot`)**: Node.js / Baileys ecosystem. Manages real-time messaging, multi-device socket connections, user authorization (phone + LID), Pareto analysis from uploaded spreadsheets, and monthly performance recaps.
- **Desktop Pareto Subsystem (`c:\projek aplikasi omi`)**: Python / CustomTkinter desktop application. Core analytical engines (`pareto_engine.py`, `recap_engine.py`) calculating Pareto ABC classifications and inventory restocking priority for retail store items.
- **Autonomous Monitoring Subsystem (`google-antigravity`)**: Python autonomous agent utilizing Google Antigravity SDK (`google-antigravity==0.1.18`) with dual-engine execution (autonomous trigger-based when GEMINI_API_KEY is present, deterministic fallback when offline) to probe process health, credentials, database integrity, file permissions, and storage leaks.
- **E2E Testing Track**: Independent requirement-driven opaque-box test harness exercising WhatsApp Bot modules, Pareto engine calculations, and Antigravity monitoring agent.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Pareto Upload Unlinking | Unlink temporary `pareto_uploaded_*.xls` in both directMatch and interactive flows | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R1.2 Export Excel Cleanup | Wrap all intermediate Excel file lifecycles in `try ... finally` to guarantee unlinking | M1 | ORIGINAL_REQUEST §R1 |
| 3 | R1.3 Boot Orphan Purging | On bot startup, purge orphaned `pareto_uploaded_*` and stale `.xlsx` files | M1 | ORIGINAL_REQUEST §R1 |
| 4 | R2.1 E.164 Number Normalization | Normalize numbers to E.164 format before calling `sock.onWhatsApp` | M1 | ORIGINAL_REQUEST §R2 |
| 5 | R2.2 LID Persistence | Update `addNumber` to accept and persist `lid` in `whitelist.json` | M1 | ORIGINAL_REQUEST §R2 |
| 6 | R2.3 Multi-Device LID Authorization | Match incoming `@lid` against `u.lid` in `isAllowed` and `isSuperAdmin` | M1 | ORIGINAL_REQUEST §R2 |
| 7 | R2.4 Auto-Linking Circularity Fix | Allow incoming messages with candidate phone numbers to auto-link with `@lid` without pre-auth rejection | M1 | ORIGINAL_REQUEST §R2 |
| 8 | R3.1 Decimal Comma Normalization | Support comma and dot decimal format (`21,00` -> `21.00`) in `!setrab` | M1 | ORIGINAL_REQUEST §R3 |
| 9 | R3.2 Zero Target Division Guard | Provide fallback `safeTargetSPD` when `targetSPD` is 0 or null to eliminate `NaN`/`Infinity` | M1 | ORIGINAL_REQUEST §R3 |
| 10 | R3.3 Safe Locale Float & Carton Division | Implement `parseSafeFloat` and finite division guards in `pareto_analyzer.js` | M1 | ORIGINAL_REQUEST §R3 |
| 11 | R4.1 Pareto Boundary Crossing Fix | Ensure items crossing the 80% boundary are strictly assigned to Class A via `prev_cum_pct < 80.0` in `pareto_engine.py` | M2 | ORIGINAL_REQUEST §R4 |
| 12 | R4.2 Dominant Single Item Guard | Handle single items with >= 80% of revenue in Class A | M2 | ORIGINAL_REQUEST §R4 |
| 13 | R4.3 Recap Engine Symmetrical Fix | Apply symmetrical boundary fix to `c:\projek aplikasi omi\src\recap_engine.py` | M2 | ORIGINAL_REQUEST §R4 |
| 14 | R4.4 Test Suite Count Alignment | Update desktop test assertions in `test_core.py` and `test_full_features.py` for corrected Class A boundary counts | M2 | ORIGINAL_REQUEST §R4 |
| 15 | R5.1 Antigravity Monitoring Agent Core | Implement `monitoring_agent.py` using `google-antigravity` SDK with dual-engine architecture | M3 | ORIGINAL_REQUEST §R5 |
| 16 | R5.2 Bot Process & Session Probes | Check `node.exe` bot process liveness and validate `sesi_bot/creds.json` | M3 | ORIGINAL_REQUEST §R5 |
| 17 | R5.3 File Permissions & DB Integrity Probes | Audit RW permissions on state files and execute SQLite `PRAGMA integrity_check` on `pareto_store.db` | M3 | ORIGINAL_REQUEST §R5 |
| 18 | R5.4 Storage Leaks & Alert Reporting | Detect orphaned temporary files and generate multi-format reports (JSON, Markdown, WhatsApp alert text) | M3 | ORIGINAL_REQUEST §R5 |
| 19 | E2E.1 E2E Test Suite (Tiers 1-4) | Requirement-driven test harness verifying all features across R1-R5 | M4 | Project Architecture Dual Track |
| 20 | E2E.2 Adversarial Coverage Hardening | White-box stress testing and boundary probing (Tier 5) | M4 | Project Architecture Dual Track |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | WhatsApp Bot Reliability & Hardening | R1 (Disk leak elimination & unlinking), R2 (Multi-device LID & auto-link), R3 (Safe numerics & comma decimals) | none | IN_PROGRESS |
| M2 | Desktop Pareto Boundary Classification | R4 (Pareto engine boundary fix, recap engine fix, test assertions) | none | IN_PROGRESS |
| M3 | Antigravity Autonomous Monitoring Agent | R5 (Monitoring agent, dual-engine SDK runner, probes, alerts) | none | IN_PROGRESS |
| M4 | E2E Verification & Adversarial Hardening | Phase 1 (Tiers 1-4 100% pass), Phase 2 (Tier 5 adversarial hardening) | M1, M2, M3 | PLANNED |

## Interface Contracts

### Whitelist & Authentication Contract (`whitelist_helper.js`)
- `addNumber(number: string, name?: string, lid?: string): { success: boolean, message: string }`
  - Normalizes number to digits.
  - Stores `{ number, name, lid: lid || null }`.
- `isAllowed(jid: string): boolean`
  - Tests both phone number matching and LID matching against stored `u.lid`.
- `isSuperAdmin(jid: string): boolean`
  - Tests both phone number matching and LID matching against stored `u.lid`.
- `linkLid(phoneNumber: string, lid: string): { success: boolean, message: string }`
  - Maps an existing phone entry to a resolved or incoming LID.

### Pareto Engine Classification Contract (`pareto_engine.py`)
- `calculate_pareto(df: pd.DataFrame) -> pd.DataFrame`:
  - Input: DataFrame with `sales_amount` and `qty_sold`.
  - Sort: `by=['sales_amount', 'qty_sold'], ascending=[False, False]`.
  - Cumulative calculation: `cum_sales = df['sales_amount'].cumsum()`, `total_sales = df['sales_amount'].sum()`, `cum_pct = (cum_sales / total_sales) * 100.0`.
  - Prior cumulative: `prev_cum_pct = (cum_sales.shift(fill_value=0) / total_sales) * 100.0`.
  - Boundary logic:
    - Class A: `prev_cum_pct < 80.0` (all items that contribute to the first 80%, including boundary-crossing item).
    - Class B: `(prev_cum_pct >= 80.0) & (prev_cum_pct < 95.0)`.
    - Class C: `prev_cum_pct >= 95.0` or zero sales.
  - Return: DataFrame with `pareto_class` in `['A', 'B', 'C']`.

### Antigravity Monitoring Agent Contract (`monitoring_agent.py`)
- CLI Invocation:
  - `python monitoring_agent.py --once`: Run all probes once, generate `monitoring_report.json`, `monitoring_report.md`, `status_alert.txt`, return exit code (0 = HEALTHY/WARNING, 1 = CRITICAL).
  - `python monitoring_agent.py --daemon`: Run scheduled probe loop via Google Antigravity SDK triggers `every(interval_seconds=300)`.
  - `python monitoring_agent.py --repair`: Purge detected orphaned files and re-check integrity.
- Probes:
  - `probe_bot_process()` -> ProcessStatus
  - `probe_whatsapp_session()` -> SessionStatus
  - `probe_file_permissions()` -> PermissionsStatus
  - `probe_database_integrity()` -> IntegrityStatus
  - `probe_storage_leaks()` -> StorageStatus

## Code Layout
- `c:\projek bot\index.js`: Main WhatsApp bot event handlers, command dispatch, file cleanup lifecycle.
- `c:\projek bot\whitelist_helper.js`: LID resolution, user permissions, whitelist persistence.
- `c:\projek bot\rekap_helper.js`: Safe numeric formatting, SPD calculation, Excel recap export.
- `c:\projek bot\pareto_analyzer.js`: Pareto spreadsheet parsing, safe float parsing, carton division.
- `c:\projek bot\config_helper.js`: Target SPD and GM% configuration parsing.
- `c:\projek bot\monitoring_agent.py`: Google Antigravity autonomous monitoring agent.
- `c:\projek aplikasi omi\src\pareto_engine.py`: Desktop Pareto classification engine.
- `c:\projek aplikasi omi\src\recap_engine.py`: Desktop monthly recap engine.
- `c:\projek aplikasi omi\tests\`: Desktop test suite (`test_core.py`, `test_full_features.py`).
- `c:\projek bot\tests\`: E2E requirement-driven test suite (Tiers 1-4).
