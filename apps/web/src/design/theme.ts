import { useCallback, useEffect, useState } from 'react';

/**
 * Theme engine. Three user-facing modes:
 *   - "light" / "dark": explicit override (stamps `data-theme` on <html>)
 *   - "system":         follow the OS (removes `data-theme`; CSS media query wins)
 *
 * The initial paint is handled by an inline bootstrap in `index.html` so there
 * is never a flash of the wrong theme. This module keeps React in sync and
 * persists the choice.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'kynox.theme';

export function getStoredMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

/** Applies a mode to the document root and persists it. */
export function applyMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  localStorage.setItem(STORAGE_KEY, mode);
}

/** Resolves the effective palette (light/dark) for the current mode. */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'system' : getStoredMode(),
  );
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(getStoredMode()),
  );

  const setThemeMode = useCallback((next: ThemeMode) => {
    applyMode(next);
    setMode(next);
    setResolved(resolveTheme(next));
  }, []);

  // Keep "system" mode reactive to OS changes.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  /** Cycles light → dark → system for a single toggle control. */
  const cycle = useCallback(() => {
    setThemeMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light');
  }, [mode, setThemeMode]);

  return { mode, resolved, setThemeMode, cycle };
}
