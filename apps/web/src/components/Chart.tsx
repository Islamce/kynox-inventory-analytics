import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

/**
 * ECharts wrapper with the platform's validated categorical palette
 * (fixed slot order — never cycled or re-ranked; see docs/dataviz notes).
 * The data palettes below are semantically load-bearing and unchanged; only
 * the chart *chrome* (axes, labels, split lines, tooltip surface) is themed
 * from the live design tokens so charts read correctly in light and dark.
 */
export const SERIES_COLORS = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#1baf7a', // aqua
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
];

export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** Sequential blue ramp (light -> dark) for magnitude encodings. */
export const SEQUENTIAL_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

/** Reads a design-token colour from the document root. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chromeBase(): echarts.EChartsCoreOption {
  const line = token('--kx-line', '#dce3ec');
  const label = token('--kx-muted', '#6b7a8f');
  const surface = token('--kx-elevated', '#ffffff');
  const body = token('--kx-body', '#131b27');
  return {
    color: SERIES_COLORS,
    textStyle: { fontFamily: 'var(--kx-font-sans), system-ui, sans-serif', color: label },
    grid: { left: 48, right: 16, top: 32, bottom: 32, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: line,
      borderWidth: 1,
      textStyle: { color: body },
      extraCssText: 'box-shadow: var(--kx-shadow-md); border-radius: 10px;',
    },
    categoryAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: label } },
    valueAxis: { splitLine: { lineStyle: { color: line } }, axisLabel: { color: label } },
  };
}

/** Applies themed axis defaults without overwriting caller-supplied axis config. */
function themeAxes(base: echarts.EChartsCoreOption, opt: echarts.EChartsCoreOption): echarts.EChartsCoreOption {
  const line = token('--kx-line', '#dce3ec');
  const label = token('--kx-muted', '#6b7a8f');
  const axisDefaults = (a: unknown) => {
    if (Array.isArray(a)) return a.map((x) => ({ axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } }, axisLabel: { color: label }, ...x }));
    if (a && typeof a === 'object') return { axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } }, axisLabel: { color: label }, ...a };
    return a;
  };
  const merged: Record<string, unknown> = { ...base, ...opt };
  if (opt.xAxis) merged.xAxis = axisDefaults(opt.xAxis);
  if (opt.yAxis) merged.yAxis = axisDefaults(opt.yAxis);
  return merged as echarts.EChartsCoreOption;
}

export function Chart({ option, height = 300, label = 'Data visualisation' }: { option: echarts.EChartsCoreOption; height?: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    // Re-theme chrome when the app theme changes (explicit or system).
    const observer = new MutationObserver(() => setThemeTick((t) => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => setThemeTick((t) => t + 1);
    mq.addEventListener('change', onScheme);

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      mq.removeEventListener('change', onScheme);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(themeAxes(chromeBase(), option), true);
  }, [option, themeTick]);

  return <div ref={ref} style={{ height }} role="img" aria-label={label} />;
}
