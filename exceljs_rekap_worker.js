import fs from 'fs';
import { buildExcelJSWorkbook } from './exceljs_rekap_builder.js';

async function main() {
    let input = '';
    const buf = Buffer.alloc(65536);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(0, buf, 0, buf.length)) > 0) {
        input += buf.toString('utf-8', 0, bytesRead);
    }

    if (!input) {
        throw new Error('Input data kosong.');
    }

    const { dataList, outputPath, targetSPD, storeInfo } = JSON.parse(input);
    await buildExcelJSWorkbook(dataList, outputPath, targetSPD, storeInfo);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
