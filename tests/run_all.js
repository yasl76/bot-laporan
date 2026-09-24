import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

let pythonPath = 'python';
const venvPy = path.resolve('../projek aplikasi omi/.venv/Scripts/python.exe');
if (fs.existsSync(venvPy)) {
    pythonPath = `"${venvPy}"`;
}

function findTestFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (file !== 'helpers' && file !== 'node_modules') {
                results = results.concat(findTestFiles(fullPath));
            }
        } else if (file.endsWith('.js') || file.endsWith('.py')) {
            if (file !== 'run_all.js' && file !== 'run_all_e2e_tests.js' && !file.includes('fixture')) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

const testsBaseDir = path.resolve('tests');
const allTestFiles = findTestFiles(testsBaseDir).sort();

console.log(`🚀 Discovered ${allTestFiles.length} total test suites across all tiers...\n`);

let passed = 0;
let failed = 0;

for (const fullPath of allTestFiles) {
    const relPath = path.relative(process.cwd(), fullPath);
    process.stdout.write(`Testing ${relPath} ... `);
    try {
        const cmd = fullPath.endsWith('.py') ? `${pythonPath} "${fullPath}"` : `node "${fullPath}"`;
        execSync(cmd, { 
            stdio: 'pipe', 
            encoding: 'utf-8',
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        });
        console.log('✅ PASSED');
        passed++;
    } catch (err) {
        console.log('❌ FAILED');
        const output = err.stdout ? err.stdout.toString() : (err.stderr ? err.stderr.toString() : err.message);
        console.error(output);
        failed++;
    }
}

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed across ${allTestFiles.length} suites.`);
console.log(`========================================`);

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
