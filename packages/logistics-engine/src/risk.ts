import type { DecisionObject, DecisionEvidenceRef } from '@kynox/shared-types';

export interface MaterialRiskEvidence {
  requirement: {
    sourceRecordId: string;
    materialRequirementId: string;
    materialId: string;
    requiredQuantity: number;
    unitOfMeasure: string;
    requiredDate: string;
  };
  inventory: {
    sourceRecordId: string;
    availabilitySnapshotId: string;
    onHandQuantity: number;
    otherReservedQuantity: number;
    observedAt: string;
  };
  reservation?: {
    sourceRecordId: string;
    reservationId: string;
    reservedForRequirementQuantity: number;
  } | null;
  supplies: {
    sourceRecordId: string;
    supplyId: string;
    supplyType: 'purchase_order' | 'transfer';
    confirmedQuantity: number;
    confirmedEta?: string | null;
    shipmentId?: string | null;
  }[];
}

export interface MaterialRiskResult {
  materialId: string;
  requiredDate: string;
  requiredQuantity: number;
  currentlyAvailableQuantity: number;
  availableByRequiredDate: number;
  expectedAvailableQuantity: number;
  quantityGap: number;
  scheduleGapDays: number;
  atRisk: boolean;
  alternatives: string[];
  evidence: DecisionEvidenceRef[];
  assumptions: string[];
  dataLimitations: string[];
}

export interface MaterialRiskDecision extends DecisionObject {
  risk: MaterialRiskResult;
  alternatives: string[];
}

const ms = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date`);
  return parsed;
};

const quantity = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
};

export function evaluateMaterialShipmentRisk(input: MaterialRiskEvidence): MaterialRiskResult {
  const requiredQuantity = quantity(input.requirement.requiredQuantity, 'Required quantity');
  const requiredAt = ms(input.requirement.requiredDate, 'Required date');
  const onHand = quantity(input.inventory.onHandQuantity, 'On-hand quantity');
  const otherReserved = quantity(input.inventory.otherReservedQuantity, 'Other reserved quantity');
  const currentlyAvailableQuantity = Math.max(0, onHand - otherReserved);
  if (input.reservation) quantity(input.reservation.reservedForRequirementQuantity, 'Requirement reservation quantity');

  const supplies = input.supplies.map((supply) => ({
    ...supply,
    confirmedQuantity: quantity(supply.confirmedQuantity, 'Confirmed supply quantity'),
    etaMs: supply.confirmedEta ? ms(supply.confirmedEta, 'Confirmed supply ETA') : null,
  }));
  const datedSupplies = supplies.filter((supply): supply is typeof supply & { etaMs: number } => supply.etaMs !== null)
    .sort((a, b) => a.etaMs - b.etaMs);
  const availableByRequiredDate = currentlyAvailableQuantity + datedSupplies
    .filter((supply) => supply.etaMs <= requiredAt)
    .reduce((sum, supply) => sum + supply.confirmedQuantity, 0);
  const expectedAvailableQuantity = currentlyAvailableQuantity
    + supplies.reduce((sum, supply) => sum + supply.confirmedQuantity, 0);
  const quantityGap = Math.max(0, requiredQuantity - expectedAvailableQuantity);

  let cumulative = currentlyAvailableQuantity;
  let coverageAt: number | null = cumulative >= requiredQuantity ? requiredAt : null;
  for (const supply of datedSupplies) {
    cumulative += supply.confirmedQuantity;
    if (coverageAt === null && cumulative >= requiredQuantity) coverageAt = supply.etaMs;
  }
  const latestNeededSupplyAt = datedSupplies.length && currentlyAvailableQuantity < requiredQuantity
    ? datedSupplies[datedSupplies.length - 1].etaMs : null;
  const scheduleEvidenceAt = coverageAt ?? latestNeededSupplyAt;
  const scheduleGapDays = scheduleEvidenceAt === null ? 0 : Math.max(0, Math.ceil((scheduleEvidenceAt - requiredAt) / 86_400_000));
  const atRisk = quantityGap > 0 || scheduleGapDays > 0;
  const alternatives: string[] = [];
  if (quantityGap > 0) alternatives.push(`Secure at least ${quantityGap} ${input.requirement.unitOfMeasure} of additional confirmed supply.`);
  if (scheduleGapDays > 0) alternatives.push(`Advance enough confirmed supply by ${scheduleGapDays} day(s) to meet the required date.`);
  if (currentlyAvailableQuantity < requiredQuantity && input.reservation?.reservedForRequirementQuantity === 0) {
    alternatives.push('Review whether available stock can be reserved for this requirement.');
  }
  if (atRisk) alternatives.push('Escalate for planner review; do not auto-execute a supply, reservation, or carrier action.');

  const evidence: DecisionEvidenceRef[] = [
    { evidenceType: 'material_requirement', recordId: input.requirement.materialRequirementId },
    { evidenceType: 'availability_snapshot', recordId: input.inventory.availabilitySnapshotId },
    ...input.supplies.map((supply) => ({ evidenceType: 'other' as const, recordId: supply.supplyId })),
  ];
  if (input.reservation) evidence.push({ evidenceType: 'other', recordId: input.reservation.reservationId });
  for (const supply of input.supplies) if (supply.shipmentId) evidence.push({ evidenceType: 'shipment', recordId: supply.shipmentId });

  return {
    materialId: input.requirement.materialId,
    requiredDate: input.requirement.requiredDate,
    requiredQuantity,
    currentlyAvailableQuantity,
    availableByRequiredDate,
    expectedAvailableQuantity,
    quantityGap,
    scheduleGapDays,
    atRisk,
    alternatives,
    evidence,
    assumptions: [
      'Other reservations reduce on-hand availability; the requirement reservation remains allocable to this requirement.',
      'Only confirmed supply quantities are counted; only supplies with valid confirmed ETAs contribute to date coverage.',
      'Supply is consumed in ETA order until the requirement is covered.',
    ],
    dataLimitations: supplies.some((supply) => supply.etaMs === null)
      ? ['Confirmed supply without an ETA contributes to expected quantity but not required-date coverage.'] : [],
  };
}

export function createMaterialRiskDecision(
  input: MaterialRiskEvidence,
  generatedAt: string,
): MaterialRiskDecision {
  ms(generatedAt, 'Generated timestamp');
  const risk = evaluateMaterialShipmentRisk(input);
  const severity: DecisionObject['severity'] = risk.quantityGap > 0 && risk.scheduleGapDays > 0
    ? 'critical' : risk.atRisk ? 'high' : 'info';
  return {
    decisionObjectId: `material-risk:${input.requirement.materialRequirementId}:${generatedAt}`,
    decisionType: 'material_availability_risk',
    status: 'open',
    severity,
    title: risk.atRisk ? `Material ${risk.materialId} is at risk` : `Material ${risk.materialId} is covered`,
    finding: risk.atRisk
      ? `Expected availability has a ${risk.quantityGap} ${input.requirement.unitOfMeasure} quantity gap and ${risk.scheduleGapDays} day schedule gap.`
      : 'Confirmed inventory and inbound evidence covers the requirement by its required date.',
    recommendedAction: risk.atRisk ? risk.alternatives.join(' ') : 'Monitor confirmed supply and preserve current allocations.',
    suggestedOwner: 'material_planner',
    targetAt: input.requirement.requiredDate,
    confidence: risk.dataLimitations.length ? 'medium' : 'high',
    assumptions: risk.assumptions,
    dataLimitations: risk.dataLimitations,
    evidence: risk.evidence,
    generatedAt,
    risk,
    alternatives: risk.alternatives,
  };
}
