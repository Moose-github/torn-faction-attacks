import React from "react";
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  WarMemberCombatBucket,
  WarMemberCombatHeatmapResponse,
  WarMemberCombatMetric,
  WarMemberCombatMember,
} from "../api";
import { EmptyState } from "./Common";
import { formatLongDateTime, formatNumber, formatTime } from "../utils/format";

const metricOptions: Array<{ key: WarMemberCombatMetric; label: string; color: "blue" | "red" | "green" }> = [
  { key: "attacks_successful", label: "Attacks", color: "green" },
  { key: "outside_hits", label: "Outside hits", color: "blue" },
  { key: "defends_lost", label: "Defends lost", color: "red" },
  { key: "respect_gained", label: "Respect gained", color: "green" },
  { key: "respect_lost", label: "Respect lost", color: "red" },
];
const combatMetricKeys: WarMemberCombatMetric[] = ["attacks_successful", "outside_hits"];
const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const defaultZoomIndex = 3;

type GridSelection = {
  startMemberIndex: number;
  endMemberIndex: number;
  startBucketIndex: number;
  endBucketIndex: number;
};

type NormalizedSelection = {
  memberStart: number;
  memberEnd: number;
  bucketStart: number;
  bucketEnd: number;
};

export function MemberCombatHeatmap({
  heatmap,
  isLoading,
}: {
  heatmap: WarMemberCombatHeatmapResponse | null;
  isLoading: boolean;
}) {
  const [selectedMetrics, setSelectedMetrics] = React.useState<WarMemberCombatMetric[]>(["attacks_successful"]);
  const [selection, setSelection] = React.useState<GridSelection | null>(null);
  const [dragAnchor, setDragAnchor] = React.useState<{ memberIndex: number; bucketIndex: number } | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [zoomIndex, setZoomIndex] = React.useState(defaultZoomIndex);

  React.useEffect(() => {
    if (!dragAnchor) {
      return;
    }

    function stopDrag() {
      setDragAnchor(null);
    }

    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [dragAnchor]);

  React.useEffect(() => {
    setSelection(null);
    setDragAnchor(null);
    setIsExpanded(false);
  }, [heatmap?.war.id]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isExpanded]);

  if (isLoading) {
    return <EmptyState text="Loading member combat data" />;
  }

  if (!heatmap || heatmap.members.length === 0) {
    return <EmptyState text="No member combat data yet" />;
  }

  if (heatmap.time_buckets.length === 0) {
    return <EmptyState text="No time buckets available yet" />;
  }

  const data = heatmap;
  const bucketMap = new Map(
    data.buckets.map((bucket) => [bucketKey(bucket.member_id, bucket.bucket_start), bucket]),
  );
  const metricLabel = selectedMetricLabel(selectedMetrics);
  const metricColor = selectedMetricColor(selectedMetrics);
  const metricMaxValues = maxValuesByMetric(data.members, data.time_buckets, bucketMap);
  const maxValue = selectedMetrics.length === 1
    ? metricMaxValues[selectedMetrics[0]] ?? 0
    : Math.max(
        0,
        ...data.members.flatMap((member) =>
          data.time_buckets.map((bucketStart) => cellMetric(bucketMap, member.member_id, bucketStart, selectedMetrics)),
        ),
      );
  const normalizedSelection = normalizeSelection(selection);
  const selectionSummary = normalizedSelection
    ? summarizeSelection(data.members, data.time_buckets, bucketMap, normalizedSelection)
    : null;
  const zoom = zoomLevels[zoomIndex] ?? 1;
  const cellWidth = Math.round(22 * zoom);
  const cellHeight = Math.round(24 * zoom);
  const headerHeight = Math.max(30, Math.round(30 * zoom));
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < zoomLevels.length - 1;
  const gridStyle = {
    "--member-combat-cell-width": `${cellWidth}px`,
    "--member-combat-cell-height": `${cellHeight}px`,
    "--member-combat-header-height": `${headerHeight}px`,
    gridTemplateColumns: `minmax(150px, 220px) repeat(${data.time_buckets.length}, var(--member-combat-cell-width))`,
  } as React.CSSProperties;

  function beginSelection(memberIndex: number, bucketIndex: number) {
    setDragAnchor({ memberIndex, bucketIndex });
    setSelection({
      startMemberIndex: memberIndex,
      endMemberIndex: memberIndex,
      startBucketIndex: bucketIndex,
      endBucketIndex: bucketIndex,
    });
  }

  function extendSelection(memberIndex: number, bucketIndex: number) {
    if (!dragAnchor) {
      return;
    }

    setSelection({
      startMemberIndex: dragAnchor.memberIndex,
      endMemberIndex: memberIndex,
      startBucketIndex: dragAnchor.bucketIndex,
      endBucketIndex: bucketIndex,
    });
  }

  function selectColumn(bucketIndex: number) {
    if (data.members.length === 0) return;
    beginSelection(0, bucketIndex);
    setSelection({
      startMemberIndex: 0,
      endMemberIndex: data.members.length - 1,
      startBucketIndex: bucketIndex,
      endBucketIndex: bucketIndex,
    });
    setDragAnchor({ memberIndex: 0, bucketIndex });
  }

  function selectRow(memberIndex: number) {
    if (data.time_buckets.length === 0) return;
    beginSelection(memberIndex, 0);
    setSelection({
      startMemberIndex: memberIndex,
      endMemberIndex: memberIndex,
      startBucketIndex: 0,
      endBucketIndex: data.time_buckets.length - 1,
    });
    setDragAnchor({ memberIndex, bucketIndex: 0 });
  }

  function selectMetric(key: WarMemberCombatMetric) {
    if (!combatMetricKeys.includes(key)) {
      setSelectedMetrics([key]);
      return;
    }

    setSelectedMetrics((current) => {
      const currentIsActivityOnly = current.every((metricKey) => combatMetricKeys.includes(metricKey));
      const selected = current.includes(key);

      if (!currentIsActivityOnly) {
        return [key];
      }

      if (selected && current.length > 1) {
        return current.filter((metricKey) => metricKey !== key);
      }

      if (selected) {
        return current;
      }

      return [...current, key];
    });
  }

  function metricSelected(key: WarMemberCombatMetric): boolean {
    if (combatMetricKeys.includes(key)) {
      return selectedMetrics.includes(key);
    }

    return selectedMetrics.length === 1 && selectedMetrics[0] === key;
  }

  return (
    <div className={isExpanded ? "member-combat-heatmap expanded" : "member-combat-heatmap"}>
      <div className="member-combat-toolbar">
        <div className="panel-toggle-row" aria-label="Member combat metric">
          {metricOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={metricSelected(option.key) ? "toggle-chip active" : "toggle-chip"}
              onClick={() => selectMetric(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="member-combat-toolbar-actions">
          <SelectionSummary summary={selectionSummary} selectedMetrics={selectedMetrics} />
          <div className="member-combat-zoom-controls" aria-label="Member combat zoom">
            <button
              type="button"
              className="panel-action-button member-combat-icon-button"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={!canZoomOut}
              onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
            >
              <ZoomOut size={15} />
            </button>
            <span className="member-combat-zoom-value">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="panel-action-button member-combat-icon-button"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={!canZoomIn}
              onClick={() => setZoomIndex((current) => Math.min(zoomLevels.length - 1, current + 1))}
            >
              <ZoomIn size={15} />
            </button>
          </div>
          <button
            type="button"
            className="panel-action-button member-combat-icon-button"
            title={isExpanded ? "Collapse heatmap" : "Expand heatmap"}
            aria-label={isExpanded ? "Collapse heatmap" : "Expand heatmap"}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      <div className="member-combat-grid-wrap">
        <div
          className="member-combat-grid"
          style={gridStyle}
          onMouseLeave={() => setDragAnchor(null)}
        >
          <div className="member-combat-corner">Member</div>
          {data.time_buckets.map((bucketStart, bucketIndex) => (
            <button
              key={bucketStart}
              type="button"
              className={columnSelected(normalizedSelection, bucketIndex) ? "member-combat-time selected" : "member-combat-time"}
              title={`${formatLongDateTime(bucketStart)} - ${formatTime(bucketStart + data.bucket_minutes * 60)}`}
              onMouseDown={() => selectColumn(bucketIndex)}
              onMouseEnter={() => {
                if (dragAnchor) {
                  setSelection({
                    startMemberIndex: 0,
                    endMemberIndex: data.members.length - 1,
                    startBucketIndex: dragAnchor.bucketIndex,
                    endBucketIndex: bucketIndex,
                  });
                }
              }}
            >
              {bucketIndex % 4 === 0 ? formatTime(bucketStart) : ""}
            </button>
          ))}

          {data.members.map((member, memberIndex) => (
            <React.Fragment key={member.member_id}>
              <button
                type="button"
                className={rowSelected(normalizedSelection, memberIndex) ? "member-combat-member selected" : "member-combat-member"}
                title={displayMember(member)}
                onMouseDown={() => selectRow(memberIndex)}
                onMouseEnter={() => {
                  if (dragAnchor) {
                    setSelection({
                      startMemberIndex: dragAnchor.memberIndex,
                      endMemberIndex: memberIndex,
                      startBucketIndex: 0,
                      endBucketIndex: data.time_buckets.length - 1,
                    });
                  }
                }}
              >
                {displayMember(member)}
              </button>
              {data.time_buckets.map((bucketStart, bucketIndex) => {
                const value = cellMetric(bucketMap, member.member_id, bucketStart, selectedMetrics);
                const selected = cellSelected(normalizedSelection, memberIndex, bucketIndex);
                const bucket = bucketMap.get(bucketKey(member.member_id, bucketStart));
                return (
                  <button
                    key={`${member.member_id}-${bucketStart}`}
                    type="button"
                    className={selected ? "member-combat-cell selected" : "member-combat-cell"}
                    style={{
                      background: combatCellBackground(bucket, selectedMetrics, value, maxValue, metricColor, metricMaxValues),
                    }}
                    title={`${displayMember(member)} | ${formatTime(bucketStart)}-${formatTime(bucketStart + data.bucket_minutes * 60)} | ${metricLabel}: ${formatNumber(value)}${selectedMetrics.length > 1 ? ` (${selectedMetrics.map((metricKey) => `${metricOptionLabel(metricKey)} ${formatNumber(Number(bucket?.[metricKey] ?? 0))}`).join(", ")})` : ""}`}
                    onMouseDown={() => beginSelection(memberIndex, bucketIndex)}
                    onMouseEnter={() => extendSelection(memberIndex, bucketIndex)}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function SelectionSummary({
  summary,
  selectedMetrics,
}: {
  summary: ReturnType<typeof summarizeSelection> | null;
  selectedMetrics: WarMemberCombatMetric[];
}) {
  if (!summary) {
    return <div className="member-combat-selection">Drag cells, member rows, or time columns to total them.</div>;
  }

  const metricLabel = selectedMetricLabel(selectedMetrics);
  const selectedTotal = selectedMetrics.reduce((total, metric) => total + summary.totals[metric], 0);

  return (
    <div className="member-combat-selection">
      <strong>{metricLabel}: {formatNumber(selectedTotal)}</strong>
      <span>{formatNumber(summary.memberCount)} members</span>
      <span>{formatNumber(summary.bucketCount)} time slots</span>
      <span>{formatTime(summary.startBucket)}-{formatTime(summary.endBucket + summary.bucketSeconds)}</span>
      <span>Attacks {formatNumber(summary.totals.attacks_successful)}</span>
      <span>Defends lost {formatNumber(summary.totals.defends_lost)}</span>
      <span>Respect +/- {formatNumber(summary.totals.respect_gained)} / {formatNumber(summary.totals.respect_lost)}</span>
    </div>
  );
}

function summarizeSelection(
  members: WarMemberCombatMember[],
  timeBuckets: number[],
  bucketMap: Map<string, WarMemberCombatBucket>,
  selection: NormalizedSelection,
) {
  const totals: Record<WarMemberCombatMetric, number> = {
    attacks_successful: 0,
    outside_hits: 0,
    defends_lost: 0,
    respect_gained: 0,
    respect_lost: 0,
  };

  for (let memberIndex = selection.memberStart; memberIndex <= selection.memberEnd; memberIndex += 1) {
    const member = members[memberIndex];
    if (!member) continue;

    for (let bucketIndex = selection.bucketStart; bucketIndex <= selection.bucketEnd; bucketIndex += 1) {
      const bucketStart = timeBuckets[bucketIndex];
      const bucket = bucketMap.get(bucketKey(member.member_id, bucketStart));
      for (const option of metricOptions) {
        totals[option.key] += Number(bucket?.[option.key] ?? 0);
      }
    }
  }

  return {
    totals,
    memberCount: selection.memberEnd - selection.memberStart + 1,
    bucketCount: selection.bucketEnd - selection.bucketStart + 1,
    startBucket: timeBuckets[selection.bucketStart],
    endBucket: timeBuckets[selection.bucketEnd],
    bucketSeconds: 15 * 60,
  };
}

function normalizeSelection(selection: GridSelection | null): NormalizedSelection | null {
  if (!selection) {
    return null;
  }

  return {
    memberStart: Math.min(selection.startMemberIndex, selection.endMemberIndex),
    memberEnd: Math.max(selection.startMemberIndex, selection.endMemberIndex),
    bucketStart: Math.min(selection.startBucketIndex, selection.endBucketIndex),
    bucketEnd: Math.max(selection.startBucketIndex, selection.endBucketIndex),
  };
}

function cellMetric(
  bucketMap: Map<string, WarMemberCombatBucket>,
  memberId: number,
  bucketStart: number,
  metrics: WarMemberCombatMetric[],
): number {
  const bucket = bucketMap.get(bucketKey(memberId, bucketStart));
  return metrics.reduce((total, metric) => total + Number(bucket?.[metric] ?? 0), 0);
}

function bucketKey(memberId: number, bucketStart: number): string {
  return `${memberId}:${bucketStart}`;
}

function displayMember(member: WarMemberCombatMember): string {
  return member.member_name ?? `#${member.member_id}`;
}

function cellSelected(selection: NormalizedSelection | null, memberIndex: number, bucketIndex: number): boolean {
  return Boolean(
    selection &&
      memberIndex >= selection.memberStart &&
      memberIndex <= selection.memberEnd &&
      bucketIndex >= selection.bucketStart &&
      bucketIndex <= selection.bucketEnd,
  );
}

function rowSelected(selection: NormalizedSelection | null, memberIndex: number): boolean {
  return Boolean(selection && memberIndex >= selection.memberStart && memberIndex <= selection.memberEnd);
}

function columnSelected(selection: NormalizedSelection | null, bucketIndex: number): boolean {
  return Boolean(selection && bucketIndex >= selection.bucketStart && bucketIndex <= selection.bucketEnd);
}

function maxValuesByMetric(
  members: WarMemberCombatMember[],
  timeBuckets: number[],
  bucketMap: Map<string, WarMemberCombatBucket>,
): Record<WarMemberCombatMetric, number> {
  const maxValues: Record<WarMemberCombatMetric, number> = {
    attacks_successful: 0,
    outside_hits: 0,
    defends_lost: 0,
    respect_gained: 0,
    respect_lost: 0,
  };

  for (const member of members) {
    for (const bucketStart of timeBuckets) {
      const bucket = bucketMap.get(bucketKey(member.member_id, bucketStart));
      for (const option of metricOptions) {
        maxValues[option.key] = Math.max(maxValues[option.key], Number(bucket?.[option.key] ?? 0));
      }
    }
  }

  return maxValues;
}

function combatCellBackground(
  bucket: WarMemberCombatBucket | undefined,
  selectedMetrics: WarMemberCombatMetric[],
  value: number,
  maxValue: number,
  color: "blue" | "red" | "green",
  metricMaxValues: Record<WarMemberCombatMetric, number>,
): string {
  if (selectedMetrics.includes("attacks_successful") && selectedMetrics.includes("outside_hits")) {
    const attacks = Number(bucket?.attacks_successful ?? 0);
    const outside = Number(bucket?.outside_hits ?? 0);

    if (attacks <= 0 && outside <= 0) {
      return "var(--member-combat-empty-cell)";
    }

    return [
      "linear-gradient(90deg,",
      `${combatCellColor(attacks, metricMaxValues.attacks_successful, "green")} 0 50%,`,
      `${combatCellColor(outside, metricMaxValues.outside_hits, "blue")} 50% 100%)`,
    ].join(" ");
  }

  return combatCellColor(value, maxValue, color);
}

function combatCellColor(value: number, maxValue: number, color: "blue" | "red" | "green"): string {
  if (value <= 0 || maxValue <= 0) {
    return "var(--member-combat-empty-cell)";
  }

  const intensity = Math.max(0.12, Math.min(1, Math.log1p(value) / Math.log1p(maxValue)));
  const colors = {
    blue: [37, 99, 235],
    red: [220, 38, 38],
    green: [22, 163, 74],
  }[color];

  return `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.16 + intensity * 0.72})`;
}

function metricOptionLabel(metric: WarMemberCombatMetric): string {
  return metricOptions.find((option) => option.key === metric)?.label ?? metric;
}

function selectedMetricLabel(metrics: WarMemberCombatMetric[]): string {
  return metrics.map(metricOptionLabel).join(" + ");
}

function selectedMetricColor(metrics: WarMemberCombatMetric[]): "blue" | "red" | "green" {
  if (metrics.length === 1) {
    return metricOptions.find((option) => option.key === metrics[0])?.color ?? "green";
  }

  return "green";
}
