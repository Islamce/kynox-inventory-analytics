import { describe, expect, it } from 'vitest';
import { createLogisticsCompatibilityAdapter } from './compatibility';

describe('logistics compatibility adapter', () => {
  it('preserves canonical timing semantics and lineage-neutral output', () => {
    const adapter = createLogisticsCompatibilityAdapter();
    const output = adapter.evaluateTiming({
      plannedPickupAt: '2026-01-01T08:00:00Z',
      actualPickupAt: '2026-01-01T08:05:00Z',
      plannedDeliveryAt: '2026-01-01T10:00:00Z',
      actualDeliveryAt: '2026-01-01T10:20:00Z',
    }, 30);

    expect(output.contractVersion).toBe('1.0.0');
    expect(output.formulaVersion).toBe('1.0.0');
    expect(output.pickup).toMatchObject({ evaluable: true, onTime: true, varianceMinutes: 5 });
    expect(output.delivery).toMatchObject({ evaluable: true, onTime: true, varianceMinutes: 20 });
    expect(output.actualTransitMinutes).toBe(135);
    expect(output.plannedTransitMinutes).toBe(120);
    expect(output.transitVarianceMinutes).toBe(15);
  });

  it('keeps missing timing evidence non-evaluable', () => {
    const adapter = createLogisticsCompatibilityAdapter();
    const output = adapter.evaluateTiming({ plannedDeliveryAt: '2026-01-01T10:00:00Z' });
    expect(output.delivery).toEqual({ evaluable: false, onTime: null, varianceMinutes: null });
    expect(output.transitVarianceMinutes).toBeNull();
  });

  it('aggregates freight by normalized currency without cross-currency conversion', () => {
    const adapter = createLogisticsCompatibilityAdapter();
    expect(adapter.totalFreightByCurrency([
      { currency: 'usd', amount: 10 },
      { currency: 'USD', amount: 5.5 },
      { currency: 'EUR', amount: 7 },
    ])).toEqual({ USD: 15.5, EUR: 7 });
  });
});
