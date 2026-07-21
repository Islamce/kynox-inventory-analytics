import { useEffect, useState } from 'react';

/**
 * Motion primitives for the Kynox design system.
 *
 * Durations and easings mirror the CSS custom properties in `tokens.css` so
 * JS-driven transitions stay in lockstep with CSS ones. Every consumer must
 * honour the user's reduced-motion preference — use `usePrefersReducedMotion`
 * and collapse to `DURATION.none` when it returns true.
 */

export const DURATION = {
  none: 0,
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
} as const;

/** Reactively tracks `prefers-reduced-motion: reduce`. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Builds a `transition` shorthand, collapsing to none when motion is reduced. */
export function transition(
  props: string[],
  ms: number = DURATION.base,
  easing: string = EASING.standard,
  reduced = false,
): string {
  const d = reduced ? DURATION.none : ms;
  return props.map((p) => `${p} ${d}ms ${easing}`).join(', ');
}
