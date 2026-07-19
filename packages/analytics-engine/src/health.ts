import type { HealthWeights } from '@kynox/shared-types';
import { round } from './stats';

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  availability: 0.25,
  excess: 0.20,
  obsolescence: 0.15,
  aging: 0.15,
  turnover: 0.15,
  dataQuality: 0.10,
};

export interface HealthComponentScores {
  /** Each component 0..100 (100 = healthy). Null = not measurable with supplied data. */
  availability: number | null;
  excess: number | null;
  obsolescence: number | null;
  aging: number | null;
  turnover: number | null;
  dataQuality: number | null;
}

export interface HealthIndexResult {
  score: number;
  components: HealthComponentScores;
  weights: HealthWeights;
  /** Weight actually applied per component after renormalising over measurable ones. */
  appliedWeights: Record<string, number>;
  explanation: string[];
}

/**
 * Weighted inventory-health index. Components that cannot be measured with the
 * supplied data are excluded and the remaining weights are renormalised, and
 * this is disclosed in the explanation — no silent guessing.
 */
export function inventoryHealthIndex(
  components: HealthComponentScores,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): HealthIndexResult {
  const entries = Object.entries(components) as [keyof HealthWeights, number | null][];
  const measurable = entries.filter(([, v]) => v !== null);
  const totalWeight = measurable.reduce((acc, [k]) => acc + weights[k], 0);
  const explanation: string[] = [];
  const appliedWeights: Record<string, number> = {};

  let score = 0;
  for (const [key, value] of entries) {
    if (value === null) {
      appliedWeights[key] = 0;
      explanation.push(`Component '${key}' not measurable with the supplied data; excluded and weights renormalised.`);
      continue;
    }
    const w = totalWeight > 0 ? weights[key] / totalWeight : 0;
    appliedWeights[key] = round(w, 4);
    score += w * Math.max(0, Math.min(100, value));
    explanation.push(`'${key}' = ${round(value, 1)} × weight ${round(w, 3)}`);
  }

  return {
    score: round(measurable.length ? score : 0, 1),
    components,
    weights,
    appliedWeights,
    explanation,
  };
}
