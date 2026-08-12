import { describe, expect, it } from 'vitest';
import type {
  DecisionObject,
  Shipment,
  WarehouseMovementEvidence,
} from './logistics';

describe('logistics contracts', () => {
  it('preserves distinct planned, actual, delivery, and POD evidence timestamps', () => {
    const shipment: Shipment = {
      shipmentId: 'shipment-1',
      shipmentNumber: 'S-001',
      status: 'delivered',
      plannedPickupAt: '2026-08-01T08:00:00Z',
      actualPickupAt: '2026-08-01T09:00:00Z',
      plannedDeliveryAt: '2026-08-02T08:00:00Z',
      actualDeliveryAt: '2026-08-02T10:00:00Z',
      podAt: '2026-08-02T10:05:00Z',
      sourceRef: { sourceSystem: 'fixture', sourceRecordId: 'row-1' },
    };

    expect(new Set([
      shipment.plannedPickupAt,
      shipment.actualPickupAt,
      shipment.plannedDeliveryAt,
      shipment.actualDeliveryAt,
      shipment.podAt,
    ]).size).toBe(5);
  });

  it('keeps warehouse evidence source-addressable and read-only in shape', () => {
    const receipt: WarehouseMovementEvidence = {
      movementId: 'receipt-1',
      movementType: 'receipt',
      materialId: 'MAT-1',
      quantity: 10,
      unitOfMeasure: 'EA',
      occurredAt: '2026-08-02T10:00:00Z',
      sourceRef: { sourceSystem: 'wms', sourceRecordId: 'wms-row-1' },
    };

    expect(receipt).not.toHaveProperty('writeBack');
    expect(receipt.sourceRef).toEqual({ sourceSystem: 'wms', sourceRecordId: 'wms-row-1' });
  });

  it('requires evidence, assumptions, limitations, and confidence on decisions', () => {
    const decision: DecisionObject = {
      decisionObjectId: 'decision-1',
      decisionType: 'material_availability_risk',
      status: 'open',
      severity: 'high',
      title: 'Material may arrive late',
      finding: 'Confirmed inbound arrives after the required date.',
      recommendedAction: 'Confirm an earlier inbound option.',
      confidence: 'high',
      assumptions: ['Confirmed ETA remains unchanged.'],
      dataLimitations: ['No supplier capacity data is available.'],
      evidence: [{ evidenceType: 'material_requirement', recordId: 'requirement-1' }],
      generatedAt: '2026-08-12T08:00:00Z',
    };

    expect(decision.evidence).toHaveLength(1);
    expect(decision.assumptions).not.toHaveLength(0);
    expect(decision.dataLimitations).not.toHaveLength(0);
  });
});
