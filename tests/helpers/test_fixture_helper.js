import fs from 'fs';
import path from 'path';
import os from 'os';
import xlsx from 'xlsx';

/**
 * Creates an isolated sandbox directory for test execution.
 */
export function createTestSandbox(prefix = 'e2e_test_') {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return {
        path: sandboxDir,
        cleanup() {
            try {
                fs.rmSync(sandboxDir, { recursive: true, force: true });
            } catch (_) {}
        },
        createFile(relativePath, content = '') {
            const fullPath = path.join(sandboxDir, relativePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            if (typeof content === 'string') {
                fs.writeFileSync(fullPath, content, 'utf8');
            } else {
                fs.writeFileSync(fullPath, content);
            }
            return fullPath;
        },
        fileExists(relativePath) {
            return fs.existsSync(path.join(sandboxDir, relativePath));
        }
    };
}

/**
 * Creates a minimal valid Pareto Excel workbook (.xls or .xlsx) with mock store items.
 */
export function createMockParetoExcel(outputPath, items = null) {
    const defaultItems = items || [
        { no: 1, plu: '10001', nama: 'INDOMIE GORENG SPESIAL', qtyJual: 120, pkm: 50, ft: 40, qtyStock: 5 },
        { no: 2, plu: '10002', nama: 'AQUA AIR MINERAL 600ML', qtyJual: 95, pkm: 40, ft: 24, qtyStock: 2 },
        { no: 3, plu: '10003', nama: 'ULTRA MILK COKLAT 250ML', qtyJual: 80, pkm: 30, ft: 24, qtyStock: 0 },
        { no: 4, plu: '10004', nama: 'POCOPOCO SNACK PEDAS', qtyJual: 50, pkm: 20, ft: 10, qtyStock: 8 },
        { no: 5, plu: '10005', nama: 'GULA PASIR ROSE BRAND 1KG', qtyJual: 40, pkm: 15, ft: 12, qtyStock: 15 }
    ];

    const rows = [
        ['LAPORAN ANALISA PARETO TOKO'],
        ['OMI TITAN EKSEKUTIF MART (O8BM)'],
        [],
        ['No', 'Kode Barang', 'Nama Barang', 'Sales Qty', 'Harga Jual', 'PKM', 'Frac', 'Qty Stock']
    ];

    defaultItems.forEach(item => {
        rows.push([
            item.no,
            item.plu,
            item.nama,
            item.qtyJual,
            item.hrgJual || 5000,
            item.pkm,
            item.ft,
            item.qtyStock
        ]);
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Data Pareto');
    
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    xlsx.writeFile(wb, outputPath);
    return outputPath;
}

/**
 * Creates a mock Baileys socket object for testing WhatsApp bot interactions.
 */
export function createMockSocket(options = {}) {
    const sentMessages = [];
    const onWhatsAppResults = options.onWhatsAppResults || {};

    return {
        sentMessages,
        ev: {
            on: () => {},
            emit: () => {}
        },
        async sendMessage(jid, content) {
            if (options.shouldThrowSendError) {
                throw new Error('Mock Socket Network Disconnect: Send failed');
            }
            sentMessages.push({ jid, content, timestamp: Date.now() });
            return { key: { id: `MOCK_MSG_${Date.now()}` } };
        },
        async onWhatsApp(queryNumber) {
            if (options.shouldThrowLookupError) {
                throw new Error('Mock Socket Timeout on onWhatsApp');
            }
            if (onWhatsAppResults[queryNumber]) {
                return onWhatsAppResults[queryNumber];
            }
            return [{ jid: `${queryNumber}@s.whatsapp.net`, exists: true, lid: `${queryNumber}999@lid` }];
        }
    };
}
