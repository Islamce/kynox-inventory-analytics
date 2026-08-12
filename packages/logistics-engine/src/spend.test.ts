import { describe, expect, it } from 'vitest';
import { analyzeTransportSpend } from './spend';

describe('Transport Spend Intelligence', () => {
  const charges = [
    { sourceRowId: 'r1', shipmentId: 'S1', amount: 100, currency: 'sar', carrierCode: 'C1', origin: 'RUH', destination: 'JED', project: 'P1', chargeType: 'linehaul', invoiceNumber: 'I1' },
    { sourceRowId: 'r2', shipmentId: 'S1', amount: 20, currency: 'SAR', carrierCode: 'C1', origin: 'RUH', destination: 'JED', project: 'P1', chargeType: 'handling', invoiceNumber: 'I1', accessorial: true },
    { sourceRowId: 'r3', shipmentId: 'S2', amount: 100, currency: 'USD', carrierCode: 'C2', origin: 'DMM', destination: 'DXB', expedite: true },
  ];

  it('never fabricates a mixed-currency total and preserves source traceability', () => {
    const result = analyzeTransportSpend(charges);
    expect(result.totalsByCurrency).toEqual([
      { key: 'total', currency: 'SAR', amount: 120, chargeCount: 2, sourceRowIds: ['r1', 'r2'] },
      { key: 'total', currency: 'USD', amount: 100, chargeCount: 1, sourceRowIds: ['r3'] },
    ]);
    expect(result.byCarrier.find((group) => group.key === 'C1')?.sourceRowIds).toEqual(['r1', 'r2']);
  });

  it('computes shipment, weight, and pallet unit costs only with valid denominators', () => {
    const result = analyzeTransportSpend(charges, [
      { shipmentId: 'S1', weight: 60, weightUnit: 'kg', palletCount: 3 },
      { shipmentId: 'S2' },
    ]);
    expect(result.unitCosts.find((item) => item.shipmentId === 'S1')).toMatchObject({ costPerShipment: 120, costPerWeight: 2, weightUnit: 'kg', costPerPallet: 40 });
    expect(result.unitCosts.find((item) => item.shipmentId === 'S2')).toMatchObject({ costPerWeight: null, costPerPallet: null });
  });

  it('reports accessorial and expedite spend from explicit classifications', () => {
    const result = analyzeTransportSpend(charges);
    expect(result.accessorialByCurrency[0].amount).toBe(20);
    expect(result.expediteByCurrency[0].amount).toBe(100);
  });

  it('flags duplicates and abnormal costs with their evidence rows', () => {
    const result = analyzeTransportSpend([
      ...charges,
      { ...charges[0], sourceRowId: 'r4' },
    ], [], { abnormalCostThresholdByCurrency: { SAR: 200 } });
    expect(result.indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'duplicate_charge', shipmentId: 'S1', sourceRowIds: ['r1', 'r4'] }),
      expect.objectContaining({ kind: 'abnormal_cost', shipmentId: 'S1', sourceRowIds: ['r1', 'r2', 'r4'] }),
    ]));
  });

  it('rejects missing currency and invalid amounts instead of guessing', () => {
    expect(() => analyzeTransportSpend([{ sourceRowId: 'r1', shipmentId: 'S1', amount: 1, currency: '' }])).toThrow('currency');
    expect(() => analyzeTransportSpend([{ sourceRowId: 'r1', shipmentId: 'S1', amount: -1, currency: 'SAR' }])).toThrow('non-negative');
  });
});
