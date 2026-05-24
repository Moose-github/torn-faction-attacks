import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber, formatRelativeTime } from "../utils/format";

export function MetricCard({
  label,
  value,
  icon,
  detail,
  fitValue = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail?: string;
  fitValue?: boolean;
}) {
  const valueStyle = fitValue
    ? ({ "--metric-value-length": String(value.length) } as React.CSSProperties)
    : undefined;

  return (
    <article className="metric-card">
      <div className="panel-kicker">
        {icon}
        <span>{label}</span>
      </div>
      <strong
        className={fitValue ? "metric-card-value metric-card-value-fit" : "metric-card-value"}
        style={valueStyle}
      >
        {value}
      </strong>
      {detail ? <p className="metric-card-detail">{detail}</p> : null}
    </article>
  );
}

export function PanelHeader({
  icon,
  title,
  aside,
  control,
}: {
  icon?: React.ReactNode;
  title: string;
  aside?: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2>
        {icon}
        {title}
      </h2>
      {control ?? (aside ? <span>{aside}</span> : null)}
    </div>
  );
}

export function CollapsiblePanel({
  title,
  aside,
  control,
  collapsed,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  aside?: string;
  control?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel collapsible-panel ${className}`.trim()}>
      <div className="panel-header collapsible-header">
        <button type="button" className="collapse-button" onClick={onToggle}>
          <span>{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
          <strong>{title}</strong>
        </button>
        {control ?? (aside ? <span>{aside}</span> : null)}
      </div>
      {collapsed ? null : children}
    </section>
  );
}

export type FreshnessTone = "live" | "fresh" | "paused" | "stale" | "quiet";

export function FreshnessMeta({
  state,
  updatedAt,
  cadence,
  detail,
  tone = "fresh",
  onClick,
}: {
  state: string;
  updatedAt?: number | null;
  cadence?: string;
  detail?: string;
  tone?: FreshnessTone;
  onClick?: () => void;
}) {
  const updatedLabel = updatedAt === undefined
    ? null
    : updatedAt
      ? `Updated ${formatRelativeTime(updatedAt)}`
      : "Not updated";
  const content = (
    <>
      <span>{state}</span>
      {updatedLabel ? <span>{updatedLabel}</span> : null}
      {cadence ? <span>{cadence}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`freshness-meta clickable ${tone}`}
        title={detail ? `${detail} More information.` : "More information."}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`freshness-meta ${tone}`} title={detail}>
      {content}
    </span>
  );
}

export function InlineMetric({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "inline-metric muted" : "inline-metric"}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
