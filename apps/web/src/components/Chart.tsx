import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

/**
 * ECharts wrapper with the platform's validated categorical palette
 * (fixed slot order — never cycled or re-ranked; see docs/dataviz notes).
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

const BASE: echarts.EChartsCoreOption = {
  color: SERIES_COLORS,
  textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  grid: { left: 48, right: 16, top: 32, bottom: 32, containLabel: true },
  tooltip: { trigger: 'axis' },
};

export function Chart({ option, height = 300 }: { option: echarts.EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption({ ...BASE, ...option }, true);
  }, [option]);

  return <div ref={ref} style={{ height }} role="img" />;
}
