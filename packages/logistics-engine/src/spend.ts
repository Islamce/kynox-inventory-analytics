export interface SpendChargeInput {
  sourceRowId: string;
  shipmentId: string;
  amount: number;
  currency: string;
  carrierCode?: string | null;
  origin?: string | null;
  destination?: string | null;
  project?: string | null;
  customer?: string | null;
  businessUnit?: string | null;
  chargeType?: string | null;
  invoiceNumber?: string | null;
  accessorial?: boolean;
  expedite?: boolean;
}

export interface ShipmentDenominatorInput {
  shipmentId: string;
  weight?: number | null;
  weightUnit?: string | null;
  palletCount?: number | null;
}

export interface SpendGroup {
  key: string;
  currency: string;
  amount: number;
  chargeCount: number;
  sourceRowIds: string[];
}

export interface UnitCost {
  shipmentId: string;
  currency: string;
  costPerShipment: number;
  costPerWeight: number | null;
  weightUnit: string | null;
  costPerPallet: number | null;
  sourceRowIds: string[];
}

export interface SpendIndicator {
  kind: 'duplicate_charge' | 'abnormal_cost';
  currency: string;
  shipmentId: string;
  sourceRowIds: string[];
  explanation: string;
}

export interface TransportSpendResult {
  totalsByCurrency: SpendGroup[];
  byCarrier: SpendGroup[];
  byLane: SpendGroup[];
  byProject: SpendGroup[];
  byCustomer: SpendGroup[];
  byBusinessUnit: SpendGroup[];
  accessorialByCurrency: SpendGroup[];
  expediteByCurrency: SpendGroup[];
  unitCosts: UnitCost[];
  indicators: SpendIndicator[];
  assumptions: string[];
  dataLimitations: string[];
}

export interface TransportSpendOptions {
  abnormalCostThresholdByCurrency?: Record<string, number>;
}

const text = (value?: string | null): string | null => value?.trim() || null;

function validateCharge(charge: SpendChargeInput): SpendChargeInput & { currency: string } {
  if (!text(charge.sourceRowId) || !text(charge.shipmentId)) throw new Error('Spend evidence requires sourceRowId and shipmentId');
  if (!Number.isFinite(charge.amount) || charge.amount < 0) throw new Error('Freight amount must be finite and non-negative');
  const currency = text(charge.currency)?.toUpperCase();
  if (!currency) throw new Error('Freight currency is required');
  return { ...charge, currency };
}

function group(charges: (SpendChargeInput & { currency: string })[], keyOf: (charge: SpendChargeInput) => string | null): SpendGroup[] {
  const groups = new Map<string, SpendGroup>();
  for (const charge of charges) {
    const key = keyOf(charge);
    if (!key) continue;
    const id = `${charge.currency}|${key}`;
    const current = groups.get(id) ?? { key, currency: charge.currency, amount: 0, chargeCount: 0, sourceRowIds: [] };
    current.amount += charge.amount;
    current.chargeCount += 1;
    current.sourceRowIds.push(charge.sourceRowId);
    groups.set(id, current);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.key.localeCompare(b.key));
}

export function analyzeTransportSpend(
  rawCharges: SpendChargeInput[],
  denominators: ShipmentDenominatorInput[] = [],
  options: TransportSpendOptions = {},
): TransportSpendResult {
  const charges = rawCharges.map(validateCharge);
  const totalsByCurrency = group(charges, () => 'total');
  const byShipment = group(charges, (charge) => charge.shipmentId);
  const denominatorByShipment = new Map(denominators.map((item) => [item.shipmentId, item]));
  const unitCosts = byShipment.map((shipment): UnitCost => {
    const denominator = denominatorByShipment.get(shipment.key);
    const weight = denominator?.weight;
    const pallets = denominator?.palletCount;
    return {
      shipmentId: shipment.key,
      currency: shipment.currency,
      costPerShipment: shipment.amount,
      costPerWeight: weight != null && Number.isFinite(weight) && weight > 0 ? shipment.amount / weight : null,
      weightUnit: weight != null && weight > 0 ? text(denominator?.weightUnit) : null,
      costPerPallet: pallets != null && Number.isFinite(pallets) && pallets > 0 ? shipment.amount / pallets : null,
      sourceRowIds: shipment.sourceRowIds,
    };
  });

  const indicators: SpendIndicator[] = [];
  const duplicateGroups = new Map<string, (SpendChargeInput & { currency: string })[]>();
  for (const charge of charges) {
    const key = JSON.stringify([charge.shipmentId, text(charge.invoiceNumber), text(charge.chargeType), charge.amount, charge.currency]);
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), charge]);
  }
  for (const duplicates of duplicateGroups.values()) {
    if (duplicates.length < 2) continue;
    indicators.push({
      kind: 'duplicate_charge', currency: duplicates[0].currency, shipmentId: duplicates[0].shipmentId,
      sourceRowIds: duplicates.map((charge) => charge.sourceRowId),
      explanation: 'Same shipment, invoice, charge type, amount, and currency appears more than once.',
    });
  }
  for (const shipment of byShipment) {
    const threshold = options.abnormalCostThresholdByCurrency?.[shipment.currency];
    if (threshold !== undefined && shipment.amount > threshold) {
      indicators.push({
        kind: 'abnormal_cost', currency: shipment.currency, shipmentId: shipment.key,
        sourceRowIds: shipment.sourceRowIds,
        explanation: `Shipment spend ${shipment.amount} exceeds the supplied ${shipment.currency} threshold ${threshold}.`,
      });
    }
  }

  const missingDimensions = [
    ['carrier', charges.some((charge) => !text(charge.carrierCode))],
    ['lane', charges.some((charge) => !text(charge.origin) || !text(charge.destination))],
    ['project/customer/business unit', charges.some((charge) => !text(charge.project) && !text(charge.customer) && !text(charge.businessUnit))],
  ].filter(([, missing]) => missing).map(([name]) => `Some charges lack ${name} attribution and are excluded from that breakdown.`);

  return {
    totalsByCurrency,
    byCarrier: group(charges, (charge) => text(charge.carrierCode)),
    byLane: group(charges, (charge) => {
      const origin = text(charge.origin); const destination = text(charge.destination);
      return origin && destination ? `${origin} -> ${destination}` : null;
    }),
    byProject: group(charges, (charge) => text(charge.project)),
    byCustomer: group(charges, (charge) => text(charge.customer)),
    byBusinessUnit: group(charges, (charge) => text(charge.businessUnit)),
    accessorialByCurrency: group(charges.filter((charge) => charge.accessorial === true), () => 'accessorial'),
    expediteByCurrency: group(charges.filter((charge) => charge.expedite === true), () => 'expedite'),
    unitCosts,
    indicators,
    assumptions: [
      'Amounts are transaction-currency values; no FX conversion is performed.',
      'Accessorial and expedite classifications are supplied evidence, not inferred from free text.',
      'Abnormal cost is emitted only when an explicit per-currency threshold is supplied.',
    ],
    dataLimitations: missingDimensions,
  };
}
