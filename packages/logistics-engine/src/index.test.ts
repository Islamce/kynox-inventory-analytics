import { describe, expect, it } from 'vitest';
import {
  actualTransitMinutes,
  evaluateDeliveryTimeliness,
  evaluateMaterialAvailabilityRisk,
  evaluatePickupTimeliness,
  totalFreightByCurrency,
  transitVarianceMinutes,
} from './index';

describe('logistics metric primitives', () => {
  it('A: treats a pickup 15 minutes late as on time with a 30-minute tolerance', () => {
    expect(evaluatePickupTimeliness({
      plannedPickupAt: '2026-08-10T10:00:00Z',
      actualPickupAt: '2026-08-10T10:15:00Z',
    }, 30)).toEqual({ evaluable: true, onTime: true, varianceMinutes: 15 });
  });

  it('B: treats a pickup 45 minutes late as late with a 30-minute tolerance', () => {
    expect(evaluatePickupTimeliness({
      plannedPickupAt: '2026-08-10T10:00:00Z',
      actualPickupAt: '2026-08-10T10:45:00Z',
    }, 30)).toEqual({ evaluable: true, onTime: false, varianceMinutes: 45 });
  });

  it('C: reports OTD as late when actual delivery is one day after planned delivery', () => {
    expect(evaluateDeliveryTimeliness({
      plannedDeliveryAt: '2026-08-10T00:00:00Z',
      actualDeliveryAt: '2026-08-11T00:00:00Z',
    })).toEqual({ evaluable: true, onTime: false, varianceMinutes: 1440 });
  });

  it('does not silently evaluate missing timestamps', () => {
    expect(evaluateDeliveryTimeliness({ plannedDeliveryAt: '2026-08-02T08:00:00Z' })).toEqual({
      evaluable: false,
      onTime: null,
      varianceMinutes: null,
    });
  });

  it('E: calculates a +1 day transit variance from 3 planned days and 4 actual days', () => {
    const timing = {
      plannedPickupAt: '2026-08-01T00:00:00Z',
      plannedDeliveryAt: '2026-08-04T00:00:00Z',
      actualPickupAt: '2026-08-01T00:00:00Z',
      actualDeliveryAt: '2026-08-05T00:00:00Z',
    };
    expect(actualTransitMinutes(timing)).toBe(4 * 1440);
    expect(transitVarianceMinutes(timing)).toBe(1440);
  });

  it('D: keeps SAR 100 and USD 100 separated instead of fabricating a total of 200', () => {
    expect(totalFreightByCurrency([
      { amount: 100, currency: 'SAR' },
      { amount: 100, currency: 'USD' },
    ])).toEqual({ SAR: 100, USD: 100 });
  });

  it('F: reports no gap when confirmed inbound covers demand before the required date', () => {
    expect(evaluateMaterialAvailabilityRisk({
      requiredDate: '2026-08-10T00:00:00Z',
      requiredQuantity: 100,
      availableQuantity: 20,
      confirmedInboundQuantity: 80,
      inboundEta: '2026-08-09T00:00:00Z',
    })).toEqual({ scheduleGapDays: 0, quantityGap: 0, atRisk: false });
  });

  it('G: reports a +3 day schedule gap when covering inbound arrives late', () => {
    expect(evaluateMaterialAvailabilityRisk({
      requiredDate: '2026-08-10T00:00:00Z',
      requiredQuantity: 100,
      availableQuantity: 20,
      confirmedInboundQuantity: 80,
      inboundEta: '2026-08-13T00:00:00Z',
    })).toEqual({ scheduleGapDays: 3, quantityGap: 0, atRisk: true });
  });

  it('H: reports a quantity shortage of 30 when confirmed supply totals 70', () => {
    expect(evaluateMaterialAvailabilityRisk({
      requiredDate: '2026-08-10T00:00:00Z',
      requiredQuantity: 100,
      availableQuantity: 20,
      confirmedInboundQuantity: 50,
      inboundEta: '2026-08-09T00:00:00Z',
    })).toEqual({ scheduleGapDays: 0, quantityGap: 30, atRisk: true });
  });
});
