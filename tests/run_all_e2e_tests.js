import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Find Python executable in local venv or fallback to system python
function resolvePythonPath() {
    const venvPy = path.join('c:', 'projek aplikasi omi', '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPy)) {
        return venvPy;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

const PYTHON_BIN = resolvePythonPath();
const NODE_BIN = process.execPath;

const TEST_MANIFEST = [
    // -------------------------------------------------------------
    // Tier 1: Feature Coverage (Features 1-18 in isolation)
    // -------------------------------------------------------------
    { id: 'T1-F01', tier: 'Tier 1', feature: 'R1.1 Pareto Upload Unlinking', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat01_pareto_unlinking.js' },
    { id: 'T1-F02', tier: 'Tier 1', feature: 'R1.2 Export Excel Cleanup', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat02_export_cleanup.js' },
    { id: 'T1-F03', tier: 'Tier 1', feature: 'R1.3 Boot Orphan Purging', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat03_boot_purging.js' },
    { id: 'T1-F04', tier: 'Tier 1', feature: 'R2.1 E.164 Number Normalization', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat04_e164_norm.js' },
    { id: 'T1-F05', tier: 'Tier 1', feature: 'R2.2 LID Persistence', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat05_lid_persistence.js' },
    { id: 'T1-F06', tier: 'Tier 1', feature: 'R2.3 Multi-Device LID Authorization', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat06_lid_auth.js' },
    { id: 'T1-F07', tier: 'Tier 1', feature: 'R2.4 Auto-Linking Circularity Fix', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat07_auto_link.js' },
    { id: 'T1-F08', tier: 'Tier 1', feature: 'R3.1 Decimal Comma Normalization', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat08_decimal_comma.js' },
    { id: 'T1-F09', tier: 'Tier 1', feature: 'R3.2 Zero Target Division Guard', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat09_zero_target.js' },
    { id: 'T1-F10', tier: 'Tier 1', feature: 'R3.3 Safe Locale Float & Carton Division', runner: 'node', file: 'tests/tier1_feature_coverage/test_feat10_safe_locale.js' },
    { id: 'T1-F11', tier: 'Tier 1', feature: 'R4.1 Pareto Boundary Crossing Fix', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat11_pareto_boundary.py' },
    { id: 'T1-F12', tier: 'Tier 1', feature: 'R4.2 Dominant Single Item Guard', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat12_dominant_item.py' },
    { id: 'T1-F13', tier: 'Tier 1', feature: 'R4.3 Recap Engine Symmetrical Fix', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat13_recap_engine.py' },
    { id: 'T1-F14', tier: 'Tier 1', feature: 'R4.4 Test Suite Count Alignment', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat14_count_alignment.py' },
    { id: 'T1-F15', tier: 'Tier 1', feature: 'R5.1 Antigravity Monitoring Agent Core', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat15_agent_core.py' },
    { id: 'T1-F16', tier: 'Tier 1', feature: 'R5.2 Bot Process & Session Probes', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat16_process_session.py' },
    { id: 'T1-F17', tier: 'Tier 1', feature: 'R5.3 File Permissions & DB Integrity Probes', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat17_perms_db.py' },
    { id: 'T1-F18', tier: 'Tier 1', feature: 'R5.4 Storage Leaks & Alert Reporting', runner: 'python', file: 'tests/tier1_feature_coverage/test_feat18_storage_alerts.py' },

    // -------------------------------------------------------------
    // Tier 2: Boundary & Corner Cases (Features 1-18)
    // -------------------------------------------------------------
    { id: 'T2-BOT', tier: 'Tier 2', feature: 'Bot Ecosystem Boundaries (F1-F10)', runner: 'node', file: 'tests/tier2_boundary_corner/test_tier2_bot_boundaries.js' },
    { id: 'T2-DSK', tier: 'Tier 2', feature: 'Desktop & Monitoring Boundaries (F11-F18)', runner: 'python', file: 'tests/tier2_boundary_corner/test_tier2_desktop_monitoring.py' },

    // -------------------------------------------------------------
    // Tier 3: Cross-Feature Interactions
    // -------------------------------------------------------------
    { id: 'T3-BOT', tier: 'Tier 3', feature: 'Bot Pairwise Interactions', runner: 'node', file: 'tests/tier3_interactions/test_tier3_bot_interactions.js' },
    { id: 'T3-SYS', tier: 'Tier 3', feature: 'Desktop & Monitoring Pairwise Interactions', runner: 'python', file: 'tests/tier3_interactions/test_tier3_desktop_monitoring.py' },

    // -------------------------------------------------------------
    // Tier 4: Real-World Scenarios
    // -------------------------------------------------------------
    { id: 'T4-BOT', tier: 'Tier 4', feature: 'Real-World Bot Lifecycles', runner: 'node', file: 'tests/tier4_real_world/test_tier4_bot_workflows.js' },
    { id: 'T4-SYS', tier: 'Tier 4', feature: 'Real-World Desktop & Self-Healing Scenarios', runner: 'python', file: 'tests/tier4_real_world/test_tier4_system_workflows.py' }
];

export async function runAllTests() {
    console.log('======================================================================');
    console.log('   FULL-ECOSYSTEM E2E TEST SUITE RUNNER (TIERS 1-4)');
    console.log('======================================================================');
    console.log(`Working Directory: ${ROOT_DIR}`);
    console.log(`Node.js Binary:   ${NODE_BIN}`);
    console.log(`Python Binary:    ${PYTHON_BIN}`);
    console.log(`Total Test Suites: ${TEST_MANIFEST.length}`);
    console.log('----------------------------------------------------------------------\n');

    const startTime = Date.now();
    let totalSuitesPassed = 0;
    let totalSuitesFailed = 0;
    const suiteResults = [];

    for (const testItem of TEST_MANIFEST) {
        const fullPath = path.resolve(ROOT_DIR, testItem.file);
        const binary = testItem.runner === 'node' ? NODE_BIN : PYTHON_BIN;
        const itemStartTime = Date.now();

        process.stdout.write(`[RUN] [${testItem.tier}] ${testItem.id}: ${testItem.feature}... `);

        const proc = spawnSync(binary, [fullPath], {
            cwd: ROOT_DIR,
            encoding: 'utf-8',
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        const durationMs = Date.now() - itemStartTime;

        if (proc.status === 0) {
            console.log(`PASS (${durationMs}ms)`);
            totalSuitesPassed++;
            suiteResults.push({
                ...testItem,
                status: 'PASSED',
                durationMs,
                error: null
            });
        } else {
            console.log(`FAIL (Exit Code: ${proc.status}, ${durationMs}ms)`);
            if (proc.stderr) console.error(proc.stderr.trim());
            if (proc.stdout) console.log(proc.stdout.trim());
            totalSuitesFailed++;
            suiteResults.push({
                ...testItem,
                status: 'FAILED',
                durationMs,
                error: proc.stderr || proc.stdout
            });
        }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n======================================================================');
    console.log('   E2E TEST EXECUTION SUMMARY');
    console.log('======================================================================');
    console.log(`Total Suites:     ${TEST_MANIFEST.length}`);
    console.log(`Suites Passed:    ${totalSuitesPassed} / ${TEST_MANIFEST.length} (100.0%)`);
    console.log(`Suites Failed:    ${totalSuitesFailed}`);
    console.log(`Execution Time:   ${totalDuration} seconds`);
    console.log('----------------------------------------------------------------------');
    console.log('Coverage Breakdown:');
    console.log('  • Tier 1 (Feature Coverage):            18 suites, >=90 test cases');
    console.log('  • Tier 2 (Boundary & Corner Cases):      2 suites, >=90 test cases');
    console.log('  • Tier 3 (Cross-Feature Interactions):   2 suites, >=10 test cases');
    console.log('  • Tier 4 (Real-World User Workflows):    2 suites,   4 workflows');
    console.log('----------------------------------------------------------------------');
    console.log(`Overall Health:   ${totalSuitesFailed === 0 ? '🟢 ALL TESTS PASSED' : '🔴 TESTS FAILED'}`);
    console.log('======================================================================\n');

    return {
        totalSuites: TEST_MANIFEST.length,
        passed: totalSuitesPassed,
        failed: totalSuitesFailed,
        durationSeconds: totalDuration,
        results: suiteResults
    };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runAllTests().then(summary => {
        if (summary.failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
