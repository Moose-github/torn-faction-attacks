import React from "react";
import {
  cashPerEnergyAtBreakEven, compareEnhancerEfficiency, graphPositionForStat, statAtGraphPosition,
  type StatEnhancerSettings,
} from "../utils/statEnhancerRange";
import { formatCompact, formatMoney } from "../views/BookStrategy.helpers";

const HEIGHT = 380;
const TOP = 28;
const BOTTOM = HEIGHT - 54;
const LEFT = 70;
const RIGHT = 20;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function StatEnhancerRangeChart({ stat, cashPerEnergy, energyUnit, settings, onSelect }: {
  stat: number;
  cashPerEnergy: number;
  energyUnit: 1 | 25;
  settings: StatEnhancerSettings;
  onSelect: (stat: number, cashPerEnergy: number) => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(800);
  const [extent, setExtent] = React.useState({ minStat: 1e8, maxStat: 1e11, maxCash: 500_000 });
  const [hover, setHover] = React.useState<{ stat: number; cash: number; x: number; y: number } | null>(null);
  const dragPointer = React.useRef<number | null>(null);
  const clipId = React.useId().replace(/:/g, "");
  const unitLabel = `${energyUnit} energy`;
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    setWidth(element.getBoundingClientRect().width);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the default viewport steady while dragging; typed values expand it when necessary.
  const minStat = Math.min(extent.minStat, 10 ** Math.floor(Math.log10(stat)));
  const maxStat = Math.max(extent.maxStat, 10 ** Math.ceil(Math.log10(stat)));
  const maxCash = Math.max(extent.maxCash, Math.ceil(cashPerEnergy / 100_000) * 100_000);
  React.useEffect(() => {
    setExtent((current) => current.minStat === minStat && current.maxStat === maxStat && current.maxCash === maxCash
      ? current : { minStat, maxStat, maxCash });
  }, [minStat, maxStat, maxCash]);
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plotHeight = BOTTOM - TOP;
  const xFor = (value: number) => LEFT + graphPositionForStat(value, minStat, maxStat) * plotWidth;
  const yFor = (value: number) => BOTTOM - value / maxCash * plotHeight;
  const samples = Array.from({ length: 301 }, (_, index) => {
    const position = index / 300;
    const sampleStat = statAtGraphPosition(position, minStat, maxStat);
    return { x: LEFT + position * plotWidth, y: yFor(cashPerEnergyAtBreakEven(sampleStat, settings)) };
  });
  const boundary = samples.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x},${clamp(y, TOP - 1, BOTTOM + 1)}`).join(" ");
  const area = `M${LEFT},${TOP} L${width - RIGHT},${TOP} ${[...samples].reverse().map(({ x, y }) => `L${x},${clamp(y, TOP, BOTTOM)}`).join(" ")} Z`;
  const ticks: number[] = [];
  for (let exponent = Math.log10(minStat); exponent <= Math.log10(maxStat); exponent += 1) {
    for (const multiple of width >= 650 ? [1, 5] : [1]) {
      const tick = multiple * 10 ** exponent;
      if (tick <= maxStat && (ticks.length === 0 || xFor(tick) - xFor(ticks[ticks.length - 1]) >= 46)) ticks.push(tick);
    }
  }
  const hoverResult = hover ? compareEnhancerEfficiency(hover.stat, hover.cash, settings) : null;

  function pointerPoint(event: React.PointerEvent<SVGSVGElement>, outsideAllowed: boolean) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - bounds.left) * width / bounds.width;
    const rawY = (event.clientY - bounds.top) * HEIGHT / bounds.height;
    if (!outsideAllowed && (rawX < LEFT || rawX > width - RIGHT || rawY < TOP || rawY > BOTTOM)) return null;
    const x = clamp(rawX, LEFT, width - RIGHT);
    const y = clamp(rawY, TOP, BOTTOM);
    return { stat: statAtGraphPosition((x - LEFT) / plotWidth, minStat, maxStat), cash: (BOTTOM - y) / plotHeight * maxCash, x, y };
  }

  function stopDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (dragPointer.current !== event.pointerId) return;
    const point = pointerPoint(event, true);
    if (event.type !== "pointercancel" && point) onSelect(point.stat, point.cash);
    dragPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setHover(null);
  }

  return (
    <div className="se-range-chart" ref={container}>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" tabIndex={0}
        aria-label="Interactive stat enhancer range graph" aria-describedby={`${clipId}-help`}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const point = pointerPoint(event, false);
          if (!point) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragPointer.current = event.pointerId;
          setHover(point);
          onSelect(point.stat, point.cash);
        }}
        onPointerMove={(event) => {
          const dragging = dragPointer.current === event.pointerId;
          const point = pointerPoint(event, dragging);
          setHover(point);
          if (dragging && point) onSelect(point.stat, point.cash);
        }}
        onPointerUp={stopDrag} onPointerCancel={stopDrag}
        onLostPointerCapture={() => { dragPointer.current = null; }}
        onPointerLeave={() => { if (dragPointer.current === null) setHover(null); }}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.01;
          const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            onSelect(statAtGraphPosition(graphPositionForStat(stat, minStat, maxStat) + direction * step, minStat, maxStat), cashPerEnergy);
          } else onSelect(stat, clamp(cashPerEnergy + direction * maxCash * step, 0, maxCash));
          setHover(null);
        }}>
        <desc id={`${clipId}-help`}>Current stat increases from left to right on a logarithmic scale. Profit per {unitLabel} increases upwards. The green region above the curve is SE range. Click or drag to select. Left and right arrows change stat; up and down arrows change profit. Hold Shift for larger steps.</desc>
        <defs><clipPath id={clipId}><rect x={LEFT} y={TOP} width={plotWidth} height={plotHeight} /></clipPath></defs>
        <rect className="se-chart-gym" x={LEFT} y={TOP} width={plotWidth} height={plotHeight} />
        <path className="se-chart-enhancer" d={area} />
        {Array.from({ length: 6 }, (_, index) => {
          const cash = maxCash * index / 5;
          const y = yFor(cash);
          return <g key={index}><line className="se-chart-grid" x1={LEFT} x2={width - RIGHT} y1={y} y2={y} />
            <text className="se-chart-tick" x={LEFT - 10} y={y + 4} textAnchor="end">{axisMoney(cash * energyUnit)}</text></g>;
        })}
        {ticks.map((tick) => <g key={tick}>
          <line className="se-chart-grid" x1={xFor(tick)} x2={xFor(tick)} y1={TOP} y2={BOTTOM} />
          <text className="se-chart-tick" x={xFor(tick)} y={BOTTOM + 22} textAnchor="middle">{formatCompact(tick)}</text>
        </g>)}
        <text className="se-chart-axis-title" x={LEFT} y={15}>Profit per {unitLabel}</text>
        <text className="se-chart-axis-title" x={LEFT + plotWidth / 2} y={HEIGHT - 6} textAnchor="middle">Current stat</text>
        <g clipPath={`url(#${clipId})`}>
          <path className="se-chart-boundary" d={boundary} />
          <line className="se-chart-crosshair" x1={LEFT} x2={width - RIGHT} y1={yFor(cashPerEnergy)} y2={yFor(cashPerEnergy)} />
          <line className="se-chart-crosshair" x1={xFor(stat)} x2={xFor(stat)} y1={TOP} y2={BOTTOM} />
          {hover ? <circle className="se-chart-hover" cx={hover.x} cy={hover.y} r={4} /> : null}
        </g>
        <circle className="se-chart-marker-halo" cx={xFor(stat)} cy={yFor(cashPerEnergy)} r={12} />
        <circle className="se-chart-marker" cx={xFor(stat)} cy={yFor(cashPerEnergy)} r={6} />
      </svg>
      {hover && hoverResult ? (
        <div className="se-range-tooltip" role="tooltip" style={{
          left: clamp(hover.x + 16, 4, Math.max(4, width - 244)),
          top: hover.y > 180 ? hover.y - 144 : hover.y + 16,
        }}>
          <strong>{hoverResult.winner === "equal" ? "Break-even" : hoverResult.winner === "enhancer" ? "In SE range" : "Gym training wins"}</strong>
          <span>Stat: {formatCompact(hover.stat)}</span>
          <span>Profit / {unitLabel}: {formatMoney(hover.cash * energyUnit)}</span>
          <span>Break-even: {formatMoney(hoverResult.requiredCashPerEnergy * energyUnit)} / {unitLabel}</span>
          <span>{hoverResult.advantagePercent === null ? `No enhancer gain at $0 / ${unitLabel}` : `${formatCompact(hoverResult.advantagePercent)}% ${hoverResult.winner === "equal" ? "difference" : `more stats per ${unitLabel}`}`}</span>
        </div>
      ) : null}
    </div>
  );
}

function axisMoney(value: number) {
  if (value >= 1e6) return formatMoney(value);
  return value >= 1000 ? `$${formatCompact(value / 1000)}k` : `$${formatCompact(value)}`;
}
