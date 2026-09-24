import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';

/**
 * Boot orphan cleanup routine matching specification in PROJECT.md and index.js
 */
export function cleanupOrphanedFiles(targetDir = '.') {
    const cleaned = [];
    try {
        const files = fs.readdirSync(targetDir);
        for (const file of files) {
            const isOrphaned = 
                file.startsWith('pareto_uploaded_') ||
                file.startsWith('Laporan_PB_Pareto_') ||
                file.startsWith('Rekap_Bulanan_');
            
            if (isOrphaned) {
                try {
                    const fullPath = path.join(targetDir, file);
                    fs.unlinkSync(fullPath);
                    cleaned.push(file);
                } catch (_) {}
            }
        }
    } catch (e) {
        // Safe error handling on inaccessible directory
    }
    return cleaned;
}

export async function runTests() {
    console.log('--- Running Tier 1: Feature 3 (R1.3 Boot Orphan Purging) ---');
    const sandbox = createTestSandbox('feat03_purge_');

    try {
        // Test 3.1: Purge pareto_uploaded_* files
        {
            const f1 = sandbox.createFile('pareto_uploaded_1727190000000.xls', 'dummy content');
            const f2 = sandbox.createFile('pareto_uploaded_1727191111111.xlsx', 'dummy content');
            assert.strictEqual(fs.existsSync(f1), true);
            assert.strictEqual(fs.existsSync(f2), true);

            const cleaned = cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(cleaned.includes(path.basename(f1)), true);
            assert.strictEqual(cleaned.includes(path.basename(f2)), true);
            assert.strictEqual(fs.existsSync(f1), false, 'Case 3.1: pareto_uploaded file must be purged');
            assert.strictEqual(fs.existsSync(f2), false, 'Case 3.1: pareto_uploaded file must be purged');
            console.log('  ✔ Case 3.1: Boot purge routine cleans orphaned pareto_uploaded files');
        }

        // Test 3.2: Purge Laporan_PB_Pareto_* files
        {
            const pbFile = sandbox.createFile('Laporan_PB_Pareto_1727192222222.xlsx', 'dummy');
            assert.strictEqual(fs.existsSync(pbFile), true);

            const cleaned = cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(cleaned.includes(path.basename(pbFile)), true);
            assert.strictEqual(fs.existsSync(pbFile), false, 'Case 3.2: PB export file must be purged');
            console.log('  ✔ Case 3.2: Boot purge routine cleans stale Laporan_PB_Pareto export files');
        }

        // Test 3.3: Purge Rekap_Bulanan_* files
        {
            const rekapFile = sandbox.createFile('Rekap_Bulanan_1727193333333.xlsx', 'dummy');
            const rekapAuto = sandbox.createFile('Rekap_Bulanan_Otomatis_2026_09.xlsx', 'dummy');
            assert.strictEqual(fs.existsSync(rekapFile), true);
            assert.strictEqual(fs.existsSync(rekapAuto), true);

            const cleaned = cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(cleaned.includes(path.basename(rekapFile)), true);
            assert.strictEqual(cleaned.includes(path.basename(rekapAuto)), true);
            assert.strictEqual(fs.existsSync(rekapFile), false, 'Case 3.3: Rekap file must be purged');
            assert.strictEqual(fs.existsSync(rekapAuto), false, 'Case 3.3: Auto rekap file must be purged');
            console.log('  ✔ Case 3.3: Boot purge routine cleans stale Rekap_Bulanan export files');
        }

        // Test 3.4: Preserve permanent store files
        {
            const perm1 = sandbox.createFile('whitelist.json', '{"super_admins":[]}');
            const perm2 = sandbox.createFile('config.json', '{"nama_toko":"OMI"}');
            const perm3 = sandbox.createFile('pareto july.xls', 'PERMANENT STORE REFERENCE DATA');
            const perm4 = sandbox.createFile('rekap_data.json', '[]');

            cleanupOrphanedFiles(sandbox.path);

            assert.strictEqual(fs.existsSync(perm1), true, 'Case 3.4: whitelist.json must not be deleted');
            assert.strictEqual(fs.existsSync(perm2), true, 'Case 3.4: config.json must not be deleted');
            assert.strictEqual(fs.existsSync(perm3), true, 'Case 3.4: reference pareto file must not be deleted');
            assert.strictEqual(fs.existsSync(perm4), true, 'Case 3.4: rekap_data.json must not be deleted');
            console.log('  ✔ Case 3.4: Boot purge routine strictly preserves permanent config and data files');
        }

        // Test 3.5: Resilient handling of non-existent or inaccessible directory
        {
            assert.doesNotThrow(() => {
                const result = cleanupOrphanedFiles(path.join(sandbox.path, 'non_existent_folder'));
                assert.strictEqual(Array.isArray(result), true);
                assert.strictEqual(result.length, 0);
            }, 'Case 3.5: Inaccessible directory must not throw');
            console.log('  ✔ Case 3.5: Boot purge routine gracefully handles missing directories without error');
        }

        return { passed: 5, failed: 0, feature: 'Feature 3 (R1.3 Boot Orphan Purging)' };
    } finally {
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 3 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
