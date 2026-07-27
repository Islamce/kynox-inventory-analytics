#!/usr/bin/env node
/**
 * Generates the anonymized staging UAT data package under uat-data/.
 * Deterministic (no randomness), realistic SAP export formats, and covers
 * every scenario in docs/UAT_DATA_PACKAGE.md including deliberate
 * data-quality errors. All materials, vendors and descriptions are synthetic.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../uat-data');
fs.mkdirSync(OUT, { recursive: true });

const csv = (rows) => rows.map((r) => r.map((c) => {
  const s = String(c ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), '﻿' + csv(rows), 'utf8');
  console.log(`${name}: ${rows.length - 1} data rows`);
};

// ---------------------------------------------------------------------------
// Material catalogue: 30 synthetic materials across 2 plants (P100, P200)
// ---------------------------------------------------------------------------
const GROUPS = ['FASTENERS', 'BEARINGS', 'SEALS', 'ELECTRICAL', 'LUBRICANTS', 'SPARES'];
const materials = [];
for (let i = 1; i <= 30; i++) {
  const id = `UAT-${String(i).padStart(4, '0')}`;
  materials.push({
    id,
    desc: `Synthetic Part ${String(i).padStart(4, '0')} (${GROUPS[i % GROUPS.length].toLowerCase()})`,
    group: GROUPS[i % GROUPS.length],
    unit: i % 7 === 0 ? 'KG' : 'EA',
    price: 5 + (i * 3.5),
    plant: i <= 20 ? 'P100' : 'P200',
    sloc: ['0001', '0002', '0003'][i % 3],
  });
}

// Scenario roles (documented in docs/UAT_DATA_PACKAGE.md):
// UAT-0001..0010 active consumers · UAT-0011/0012 slow-moving ·
// UAT-0013/0014 non-moving (>1y no issue) · UAT-0015 shortage (below safety) ·
// UAT-0016 excess (stock >> max) · UAT-0017 blocked+quality stock ·
// UAT-0018 intermittent demand · UAT-0019 seasonal · UAT-0020 returns-heavy ·
// UAT-0021 transfer-only · UAT-0022 multi-unit conflict (EA + KG lines) ·
// UAT-0023 negative stock error · UAT-0024 missing valuation ·
// remaining: background noise.

// ---------------------------------------------------------------------------
// MB52 — warehouse stock (with deliberate quality errors)
// ---------------------------------------------------------------------------
{
  const rows = [[
    'Material', 'Material Description', 'Plant', 'Storage Location', 'Base Unit',
    'Unrestricted', 'Blocked', 'In Quality Insp.', 'Value', 'Currency',
    'Safety Stock', 'Reorder Point', 'Maximum Stock', 'Plnd Delivery Time', 'Last Movement',
  ]];
  for (const m of materials) {
    let unrestricted = 40 + (parseInt(m.id.slice(4), 10) * 7) % 300;
    let blocked = 0; let quality = 0;
    let lastMovement = '2026-06-15';
    if (m.id === 'UAT-0013' || m.id === 'UAT-0014') lastMovement = '2025-03-01'; // non-moving
    if (m.id === 'UAT-0011' || m.id === 'UAT-0012') lastMovement = '2025-12-20'; // slow-moving
    if (m.id === 'UAT-0015') unrestricted = 3;                                    // shortage vs safety 25
    if (m.id === 'UAT-0016') unrestricted = 2400;                                 // excess vs max 200
    if (m.id === 'UAT-0017') { blocked = 60; quality = 25; }
    if (m.id === 'UAT-0023') unrestricted = -12;                                  // deliberate error
    const value = m.id === 'UAT-0024' ? 0 : Math.round((unrestricted + blocked + quality) * m.price * 100) / 100;
    rows.push([
      m.id, m.desc, m.plant, m.sloc, m.unit,
      // EU number format on a few rows to exercise normalisation:
      parseInt(m.id.slice(4), 10) % 9 === 0 ? String(unrestricted).replace('.', ',') : unrestricted,
      blocked, quality, value, 'SAR',
      25, 40, 200, m.id === 'UAT-0015' ? 14 : 7, lastMovement,
    ]);
  }
  // Deliberate errors: missing material code, exact duplicate, bad date
  rows.push(['', 'Row without material code', 'P100', '0001', 'EA', 10, 0, 0, 100, 'SAR', 0, 0, 0, 7, '2026-06-01']);
  rows.push([...rows[5]]); // duplicate of a real row
  rows.push(['UAT-0025', 'Bad date row', 'P200', '0002', 'EA', 5, 0, 0, 50, 'SAR', 0, 0, 0, 7, '31.02.2026']);
  // Multi-unit conflict for UAT-0022 (second line in KG)
  rows.push(['UAT-0022', 'Synthetic Part 0022 (electrical)', 'P200', '0003', 'KG', 15, 0, 0, 380, 'SAR', 25, 40, 200, 7, '2026-06-10']);
  write('MB52-stock.csv', rows);
}

// ---------------------------------------------------------------------------
// MB51 — 18 months of movements (issues, receipts, reversals, transfers)
// ---------------------------------------------------------------------------
{
  const rows = [[
    'Material', 'Plant', 'Storage Location', 'Movement Type', 'Posting Date',
    'Qty in unit of entry', 'Amount in Local Currency', 'Material Document', 'Cost Center', 'User Name',
  ]];
  let doc = 4900000000;
  const months = [];
  for (let y of [2025, 2026]) {
    for (let mo = 1; mo <= 12; mo++) {
      if (y === 2026 && mo > 6) break;
      months.push(`${y}-${String(mo).padStart(2, '0')}`);
    }
  }
  for (const m of materials.slice(0, 22)) {
    const n = parseInt(m.id.slice(4), 10);
    if (m.id === 'UAT-0013' || m.id === 'UAT-0014' || m.id === 'UAT-0021') continue; // non-moving / transfer-only
    months.forEach((month, idx) => {
      let qty = 10 + (n % 5) * 4;
      if (m.id === 'UAT-0018') { if (idx % 3 !== 0) return; qty = 30; }            // intermittent
      if (m.id === 'UAT-0019') qty = [4, 4, 6, 10, 18, 30, 34, 30, 18, 10, 6, 4][idx % 12]; // seasonal
      if (m.id === 'UAT-0011' || m.id === 'UAT-0012') { if (idx % 6 !== 0) return; qty = 3; } // slow
      const value = Math.round(qty * m.price * 100) / 100;
      rows.push([m.id, m.plant, m.sloc, '201', `${month}-10`, -qty, -value, ++doc, `CC-${m.plant}`, 'UAT.PLANNER1']);
      // Receipts every other month
      if (idx % 2 === 0) {
        rows.push([m.id, m.plant, m.sloc, '101', `${month}-03`, qty + 5, Math.round((qty + 5) * m.price * 100) / 100, ++doc, '', 'UAT.STORES1']);
      }
      // Returns/reversals for the returns-heavy material
      if (m.id === 'UAT-0020' && idx % 2 === 1) {
        rows.push([m.id, m.plant, m.sloc, '202', `${month}-18`, Math.floor(qty / 2), Math.round(qty / 2 * m.price * 100) / 100, ++doc, `CC-${m.plant}`, 'UAT.PLANNER1']);
      }
    });
  }
  // Transfer-only material: plant-to-plant transfers, never consumption
  for (const month of months) {
    rows.push(['UAT-0021', 'P100', '0001', '311', `${month}-20`, -50, -500, ++doc, '', 'UAT.STORES2']);
  }
  // Duplicate movement (deliberate error)
  rows.push(['UAT-0001', 'P100', '0002', '201', '2026-05-10', -14, -119, 4900000001, 'CC-P100', 'UAT.PLANNER1']);
  write('MB51-movements.csv', rows);
}

// ---------------------------------------------------------------------------
// MB5B — historical stock on posting date (opening/closing per month)
// ---------------------------------------------------------------------------
{
  const rows = [['Material', 'Plant', 'Posting Date', 'Quantity', 'Value', 'Currency']];
  for (const m of materials.slice(0, 10)) {
    let qty = 100 + parseInt(m.id.slice(4), 10) * 3;
    for (let mo = 1; mo <= 6; mo++) {
      qty = qty - 8 + (mo % 2 === 0 ? 10 : 0);
      rows.push([m.id, m.plant, `2026-${String(mo).padStart(2, '0')}-01`, qty, Math.round(qty * m.price * 100) / 100, 'SAR']);
    }
  }
  write('MB5B-historical-stock.csv', rows);
}

// ---------------------------------------------------------------------------
// MMBE — stock overview breakdown
// ---------------------------------------------------------------------------
{
  const rows = [['Material', 'Plant', 'Storage Location', 'Unrestricted', 'In Quality Insp.', 'Blocked', 'In Transit']];
  for (const m of materials) {
    rows.push([m.id, m.plant, m.sloc,
      50 + (parseInt(m.id.slice(4), 10) * 3) % 150,
      m.id === 'UAT-0017' ? 25 : 0,
      m.id === 'UAT-0017' ? 60 : 0,
      parseInt(m.id.slice(4), 10) % 5 === 0 ? 20 : 0]);
  }
  write('MMBE-stock-overview.csv', rows);
}

// ---------------------------------------------------------------------------
// Material master (with deliberate gaps: missing lead time / group / price)
// ---------------------------------------------------------------------------
{
  const rows = [[
    'MATNR', 'MAKTX', 'MTART', 'MATKL', 'MEINS', 'WERKS',
    'STPRS', 'WAERS', 'EISBE', 'MINBE', 'MABST', 'PLIFZ', 'DISPO',
  ]];
  for (const m of materials) {
    rows.push([
      m.id, m.desc, 'ERSA', m.id === 'UAT-0026' ? '' : m.group, m.unit, m.plant,
      m.id === 'UAT-0024' ? '' : m.price, 'SAR',
      25, 40, 200,
      m.id === 'UAT-0027' ? '' : 7,          // missing lead time
      `M${(parseInt(m.id.slice(4), 10) % 3) + 1}`,
    ]);
  }
  write('material-master.csv', rows);
}

// ---------------------------------------------------------------------------
// Physical inventory (variances incl. a wrong stated difference)
// ---------------------------------------------------------------------------
{
  const rows = [['Material', 'Plant', 'Storage Location', 'Book Quantity', 'Counted Quantity', 'Difference', 'Counted By', 'Posting Date']];
  materials.slice(0, 15).forEach((m, i) => {
    const book = 60 + i * 5;
    const counted = i % 4 === 0 ? book : book + (i % 3 === 0 ? -3 : 2);
    const statedDiff = m.id === 'UAT-0005' ? 99 : counted - book; // deliberate wrong stated difference
    rows.push([m.id, m.plant, m.sloc, book, counted, statedDiff, 'UAT.COUNTER1', '2026-06-30']);
  });
  write('physical-inventory.csv', rows);
}

// ---------------------------------------------------------------------------
// MD04-style requirements/supply (optional file)
// ---------------------------------------------------------------------------
{
  const rows = [['Material', 'Plant', 'Posting Date', 'Requirement Quantity', 'Purchase Order', 'Vendor']];
  for (const m of materials.slice(0, 8)) {
    rows.push([m.id, m.plant, '2026-08-05', 40, `45000${parseInt(m.id.slice(4), 10)}`, 'VENDOR-SYN-01']);
    rows.push([m.id, m.plant, '2026-09-05', 40, '', '']);
  }
  write('MD04-requirements.csv', rows);
}

console.log(`\nUAT data package written to ${OUT}`);
