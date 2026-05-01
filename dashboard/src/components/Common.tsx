import React from "react";
import { formatNumber } from "../utils/format";

export function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="panel-kicker">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
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
          <span>{collapsed ? "+" : "-"}</span>
          <strong>{title}</strong>
        </button>
        {control ?? (aside ? <span>{aside}</span> : null)}
      </div>
      {collapsed ? null : children}
    </section>
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
