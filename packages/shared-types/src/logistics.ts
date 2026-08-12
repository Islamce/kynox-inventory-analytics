/** Additive Logistics Intelligence v1 contracts. No persistence or write-back is implied. */

export type LogisticsTimestamp = string;
export type LogisticsDate = string;
export type LogisticsId = string;

export interface SourceReference {
  sourceSystem: string;
  sourceRecordId: string;
  sourceDatasetId?: number | null;
}

export interface CarrierRef {
  carrierId: LogisticsId;
  carrierCode?: string | null;
  carrierName: string;
  sourceRef?: SourceReference | null;
}

export interface Shipment {
  shipmentId: LogisticsId;
  shipmentNumber: string;
  status: 'planned' | 'booked' | 'in_transit' | 'delivered' | 'cancelled' | 'unknown';
  carrier?: CarrierRef | null;
  originLocationId?: LogisticsId | null;
  destinationLocationId?: LogisticsId | null;
  plannedPickupAt?: LogisticsTimestamp | null;
  actualPickupAt?: LogisticsTimestamp | null;
  plannedArrivalAt?: LogisticsTimestamp | null;
  actualArrivalAt?: LogisticsTimestamp | null;
  plannedDeliveryAt?: LogisticsTimestamp | null;
  actualDeliveryAt?: LogisticsTimestamp | null;
  podAt?: LogisticsTimestamp | null;
  sourceRef: SourceReference;
}

export interface ShipmentLeg {
  shipmentLegId: LogisticsId;
  shipmentId: LogisticsId;
  sequence: number;
  mode?: 'road' | 'air' | 'sea' | 'rail' | 'courier' | 'multimodal' | 'unknown' | null;
  carrier?: CarrierRef | null;
  originLocationId?: LogisticsId | null;
  destinationLocationId?: LogisticsId | null;
  plannedDepartureAt?: LogisticsTimestamp | null;
  actualDepartureAt?: LogisticsTimestamp | null;
  plannedArrivalAt?: LogisticsTimestamp | null;
  actualArrivalAt?: LogisticsTimestamp | null;
  sourceRef?: SourceReference | null;
}

export interface ShipmentMaterial {
  shipmentMaterialId: LogisticsId;
  shipmentId: LogisticsId;
  shipmentLegId?: LogisticsId | null;
  materialId: string;
  quantity: number;
  unitOfMeasure: string;
  batch?: string | null;
  purchaseOrder?: string | null;
  reservationId?: string | null;
  materialRequirementId?: LogisticsId | null;
  sourceRef?: SourceReference | null;
}

export interface FreightCharge {
  freightChargeId: LogisticsId;
  shipmentId: LogisticsId;
  shipmentLegId?: LogisticsId | null;
  chargeType: string;
  amount: number;
  currency: string;
  invoiceNumber?: string | null;
  invoicedAt?: LogisticsTimestamp | null;
  sourceRef: SourceReference;
}

export interface LogisticsMilestone {
  logisticsMilestoneId: LogisticsId;
  shipmentId: LogisticsId;
  shipmentLegId?: LogisticsId | null;
  milestoneType: 'pickup' | 'departure' | 'arrival' | 'delivery' | 'pod' | 'customs' | 'other';
  plannedAt?: LogisticsTimestamp | null;
  actualAt?: LogisticsTimestamp | null;
  locationId?: LogisticsId | null;
  evidenceRef?: SourceReference | null;
}

export interface MaterialRequirementRef {
  materialRequirementId: LogisticsId;
  materialId: string;
  requiredQuantity: number;
  unitOfMeasure: string;
  requiredDate: LogisticsDate;
  plant?: string | null;
  storageLocation?: string | null;
  reservationId?: string | null;
  projectId?: string | null;
  sourceRef: SourceReference;
}

export interface AvailabilitySnapshot {
  availabilitySnapshotId: LogisticsId;
  materialId: string;
  observedAt: LogisticsTimestamp;
  plant?: string | null;
  storageLocation?: string | null;
  unrestrictedQuantity: number;
  qualityQuantity?: number | null;
  blockedQuantity?: number | null;
  reservedQuantity?: number | null;
  confirmedInboundQuantity?: number | null;
  confirmedInboundEta?: LogisticsTimestamp | null;
  unitOfMeasure: string;
  sourceRef: SourceReference;
}

export interface DecisionEvidenceRef {
  evidenceType: 'shipment' | 'milestone' | 'freight_charge' | 'material_requirement' | 'availability_snapshot' | 'warehouse_event' | 'other';
  recordId: LogisticsId;
  sourceRef?: SourceReference | null;
}

export interface DecisionObject {
  decisionObjectId: LogisticsId;
  decisionType: 'shipment_delay' | 'freight_spend' | 'carrier_performance' | 'material_availability_risk' | 'data_quality';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  finding: string;
  recommendedAction: string;
  suggestedOwner?: string | null;
  targetAt?: LogisticsTimestamp | null;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  dataLimitations: string[];
  evidence: DecisionEvidenceRef[];
  generatedAt: LogisticsTimestamp;
}

// Read-only integration projections. These contracts grant no write-back authority.
export interface WarehouseRef {
  warehouseId: string;
  plant?: string | null;
  storageLocation?: string | null;
  sourceRef: SourceReference;
}

export interface ReservationRef {
  reservationId: string;
  materialId: string;
  requiredQuantity: number;
  requiredDate?: LogisticsDate | null;
  warehouse?: WarehouseRef | null;
  sourceRef: SourceReference;
}

export interface WarehouseMovementEvidence {
  movementId: string;
  movementType: 'receipt' | 'issue';
  materialId: string;
  quantity: number;
  unitOfMeasure: string;
  occurredAt: LogisticsTimestamp;
  warehouse?: WarehouseRef | null;
  shipmentId?: LogisticsId | null;
  reservationId?: string | null;
  sourceRef: SourceReference;
}

export interface R4CRequirementRef {
  projectId: string;
  materialRequirementId: string;
  materialId: string;
  requiredQuantity: number;
  unitOfMeasure: string;
  requiredDate: LogisticsDate;
  sourceRef: SourceReference;
}
