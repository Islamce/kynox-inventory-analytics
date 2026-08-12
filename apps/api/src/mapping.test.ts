/**
 * Smart column mapping — generic (non-SAP) recognition plus SAP regression.
 * These assert that a generic ERP/WMS/file can be mapped WITHOUT SAP-specific
 * columns, while the existing SAP technical-header mapping is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { mapColumns } from './services/mapping';
import { detectReportType, kindForReportType } from './services/detection';

function fieldFor(headers: string[], header: string): string | null {
  const m = mapColumns(headers).find((x) => x.sourceColumn === header);
  return m?.canonicalField ?? null;
}

describe('generic (non-SAP) column mapping — Scenario A', () => {
  const headers = ['Item Code', 'Item Description', 'Transaction Date', 'Quantity', 'Transaction Type', 'Warehouse'];
  it('maps a generic transaction file with no SAP columns', () => {
    expect(fieldFor(headers, 'Item Code')).toBe('material');
    expect(fieldFor(headers, 'Item Description')).toBe('material_description');
    expect(fieldFor(headers, 'Transaction Date')).toBe('posting_date');
    expect(fieldFor(headers, 'Transaction Type')).toBe('movement_type');
    expect(fieldFor(headers, 'Warehouse')).toBe('warehouse');
    expect(['quantity', 'movement_qty']).toContain(fieldFor(headers, 'Quantity'));
  });

  it('recognises separate receipt / consumption and direction columns', () => {
    const h = ['SKU', 'Received Qty', 'Issued Qty', 'Direction'];
    expect(fieldFor(h, 'SKU')).toBe('material');
    expect(fieldFor(h, 'Received Qty')).toBe('receipt_qty');
    expect(fieldFor(h, 'Issued Qty')).toBe('issue_qty');
    expect(fieldFor(h, 'Direction')).toBe('transaction_direction');
  });
});

describe('logistics import mapping', () => {
  it('maps and detects freight-charge extracts through the shared pipeline', () => {
    const headers = ['Shipment ID', 'Carrier Code', 'Freight Amount', 'Currency', 'Charge Type', 'Invoice Number'];
    const mapping = mapColumns(headers);
    expect(fieldFor(headers, 'Shipment ID')).toBe('shipment_id');
    expect(fieldFor(headers, 'Freight Amount')).toBe('freight_amount');
    const detection = detectReportType(mapping, 'Transport Spend');
    expect(detection.reportType).toBe('FREIGHT_CHARGES');
    expect(kindForReportType(detection.reportType)).toBe('logistics');
  });

  it('keeps planned, actual, delivery, and POD timestamps distinct', () => {
    const headers = ['Shipment ID', 'Planned Pickup', 'Actual Pickup', 'Planned Delivery', 'Actual Delivery', 'POD Date'];
    expect(headers.map((header) => fieldFor(headers, header))).toEqual([
      'shipment_id', 'planned_pickup_at', 'actual_pickup_at',
      'planned_delivery_at', 'actual_delivery_at', 'pod_at',
    ]);
  });
});

describe('SAP mapping regression — technical headers unchanged', () => {
  it('still maps SAP MB51-style technical headers', () => {
    const h = ['MATNR', 'MAKTX', 'BWART', 'MENGE', 'BUDAT', 'WERKS'];
    expect(fieldFor(h, 'MATNR')).toBe('material');
    expect(fieldFor(h, 'MAKTX')).toBe('material_description');
    expect(fieldFor(h, 'BWART')).toBe('movement_type');
    expect(fieldFor(h, 'BUDAT')).toBe('posting_date');
    expect(fieldFor(h, 'WERKS')).toBe('plant');
    expect(['quantity', 'movement_qty']).toContain(fieldFor(h, 'MENGE'));
  });

  it('still maps SAP MB52 stock headers', () => {
    const h = ['Material', 'Plant', 'Storage Location', 'Unrestricted', 'Value'];
    expect(fieldFor(h, 'Material')).toBe('material');
    expect(fieldFor(h, 'Plant')).toBe('plant');
    expect(fieldFor(h, 'Storage Location')).toBe('storage_location');
    expect(fieldFor(h, 'Unrestricted')).toBe('unrestricted_qty');
    expect(fieldFor(h, 'Value')).toBe('value');
  });
});
