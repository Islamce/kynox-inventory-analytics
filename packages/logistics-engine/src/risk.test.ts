import { describe, expect, it } from 'vitest';
import { createMaterialRiskDecision, evaluateMaterialShipmentRisk } from './risk';

describe('Material / Shipment Risk', () => {
  const base = {
    requirement: { sourceRecordId: 'req-row', materialRequirementId: 'R1', materialId: 'M1', requiredQuantity: 100, unitOfMeasure: 'EA', requiredDate: '2026-08-10' },
    inventory: { sourceRecordId: 'inv-row', availabilitySnapshotId: 'A1', onHandQuantity: 30, otherReservedQuantity: 10, observedAt: '2026-08-01' },
    reservation: { sourceRecordId: 'res-row', reservationId: 'RES1', reservedForRequirementQuantity: 20 },
  };

  it('reports on-time full coverage from inventory, reservation context, and confirmed inbound', () => {
    const risk = evaluateMaterialShipmentRisk({ ...base, supplies: [{ sourceRecordId: 'po-row', supplyId: 'PO1', supplyType: 'purchase_order' as const, confirmedQuantity: 80, confirmedEta: '2026-08-09', shipmentId: 'S1' }] });
    expect(risk).toMatchObject({ currentlyAvailableQuantity: 20, availableByRequiredDate: 100, expectedAvailableQuantity: 100, quantityGap: 0, scheduleGapDays: 0, atRisk: false });
    expect(risk.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ evidenceType: 'shipment', recordId: 'S1' })]));
  });

  it('reports a three-day schedule gap when covering supply arrives late', () => {
    const risk = evaluateMaterialShipmentRisk({ ...base, supplies: [{ sourceRecordId: 'po-row', supplyId: 'PO1', supplyType: 'purchase_order' as const, confirmedQuantity: 80, confirmedEta: '2026-08-13' }] });
    expect(risk).toMatchObject({ availableByRequiredDate: 20, quantityGap: 0, scheduleGapDays: 3, atRisk: true });
  });

  it('reports a quantity gap and keeps missing ETA as a limitation', () => {
    const risk = evaluateMaterialShipmentRisk({ ...base, supplies: [{ sourceRecordId: 'po-row', supplyId: 'PO1', supplyType: 'purchase_order' as const, confirmedQuantity: 50 }] });
    expect(risk).toMatchObject({ expectedAvailableQuantity: 70, quantityGap: 30, scheduleGapDays: 0, atRisk: true });
    expect(risk.dataLimitations).toHaveLength(1);
  });

  it('generates an evidence-backed Decision Object without executing an action', () => {
    const decision = createMaterialRiskDecision({ ...base, supplies: [{ sourceRecordId: 'po-row', supplyId: 'PO1', supplyType: 'purchase_order' as const, confirmedQuantity: 50, confirmedEta: '2026-08-13' }] }, '2026-08-12T08:00:00Z');
    expect(decision).toMatchObject({ decisionType: 'material_availability_risk', status: 'open', severity: 'critical', suggestedOwner: 'material_planner' });
    expect(decision.evidence.length).toBeGreaterThanOrEqual(3);
    expect(decision.alternatives.at(-1)).toContain('do not auto-execute');
  });
});
