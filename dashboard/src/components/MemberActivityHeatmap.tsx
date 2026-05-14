import React from "react";
import {
  WarMemberActivityBucket,
  WarMemberActivityHeatmapResponse,
  WarMemberActivityMetric,
  WarMemberActivityMember,
} from "../api";
import { EmptyState } from "./Common";
import { formatLongDateTime, formatNumber, formatTime } from "../utils/format";

const metricOptions: Array<{ key: WarMemberActivityMetric; label: string; color: "blue" | "red" | "green" }> = [
  { key: "attacks_successful", label: "Attacks", color: "blue" },
  { key: "outside_hits", label: "Outside hits", color: "blue" },
  { key: "defends_lost", label: "Defends lost", color: "red" },
  { key: "respect_gained", label: "Respect gained", color: "green" },
  { key: "respect_lost", label: "Respect lost", color: "red" },
];

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

export function MemberActivityHeatmap({
  heatmap,
  isLoading,
}: {
  heatmap: WarMemberActivityHeatmapResponse | null;
  isLoading: boolean;
}) {
  const [metric, setMetric] = React.useState<WarMemberActivityMetric>("attacks_successful");
  const [selection, setSelection] = React.useState<GridSelection | null>(null);
  const [dragAnchor, setDragAnchor] = React.useState<{ memberIndex: number; bucketIndex: number } | null>(null);

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
  }, [heatmap?.war.id]);

  if (isLoading) {
    return <EmptyState text="Loading member activity" />;
  }

  if (!heatmap || heatmap.members.length === 0) {
    return <EmptyState text="No member activity data yet" />;
  }

  if (heatmap.time_buckets.length === 0) {
    return <EmptyState text="No time buckets available yet" />;
  }

  const data = heatmap;
  const bucketMap = new Map(
    data.buckets.map((bucket) => [bucketKey(bucket.member_id, bucket.bucket_start), bucket]),
  );
  const metricOption = metricOptions.find((option) => option.key === metric) ?? metricOptions[0];
  const maxValue = Math.max(
    0,
    ...data.members.flatMap((member) =>
      data.time_buckets.map((bucketStart) => cellMetric(bucketMap, member.member_id, bucketStart, metric)),
    ),
  );
  const normalizedSelection = normalizeSelection(selection);
  const selectionSummary = normalizedSelection
    ? summarizeSelection(data.members, data.time_buckets, bucketMap, normalizedSelection)
    : null;

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

  return (
    <div className="member-activity-heatmap">
      <div className="member-activity-toolbar">
        <div className="panel-toggle-row" aria-label="Member activity metric">
          {metricOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={metric === option.key ? "toggle-chip active" : "toggle-chip"}
              onClick={() => setMetric(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <SelectionSummary summary={selectionSummary} metric={metric} />
      </div>

      <div className="member-activity-grid-wrap">
        <div
          className="member-activity-grid"
          style={{
            gridTemplateColumns: `minmax(150px, 220px) repeat(${data.time_buckets.length}, 22px)`,
          }}
          onMouseLeave={() => setDragAnchor(null)}
        >
          <div className="member-activity-corner">Member</div>
          {data.time_buckets.map((bucketStart, bucketIndex) => (
            <button
              key={bucketStart}
              type="button"
              className={columnSelected(normalizedSelection, bucketIndex) ? "member-activity-time selected" : "member-activity-time"}
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
                className={rowSelected(normalizedSelection, memberIndex) ? "member-activity-member selected" : "member-activity-member"}
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
                const value = cellMetric(bucketMap, member.member_id, bucketStart, metric);
                const selected = cellSelected(normalizedSelection, memberIndex, bucketIndex);
                return (
                  <button
                    key={`${member.member_id}-${bucketStart}`}
                    type="button"
                    className={selected ? "member-activity-cell selected" : "member-activity-cell"}
                    style={{ backgroundColor: activityCellColor(value, maxValue, metricOption.color) }}
                    title={`${displayMember(member)} | ${formatTime(bucketStart)}-${formatTime(bucketStart + data.bucket_minutes * 60)} | ${metricOption.label}: ${formatNumber(value)}`}
                    onMouseDown={() => beginSelection(memberIndex, bucketIndex)}
                    onMouseEnter={() => extendSelection(memberIndex, bucketIndex)}
                  >
                    {value > 0 ? formatCompactCell(value) : ""}
                  </button>
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
  metric,
}: {
  summary: ReturnType<typeof summarizeSelection> | null;
  metric: WarMemberActivityMetric;
}) {
  if (!summary) {
    return <div className="member-activity-selection">Drag cells, member rows, or time columns to total them.</div>;
  }

  const metricLabel = metricOptions.find((option) => option.key === metric)?.label ?? "Selected metric";

  return (
    <div className="member-activity-selection">
      <strong>{metricLabel}: {formatNumber(summary.totals[metric])}</strong>
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
  members: WarMemberActivityMember[],
  timeBuckets: number[],
  bucketMap: Map<string, WarMemberActivityBucket>,
  selection: NormalizedSelection,
) {
  const totals: Record<WarMemberActivityMetric, number> = {
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
  bucketMap: Map<string, WarMemberActivityBucket>,
  memberId: number,
  bucketStart: number,
  metric: WarMemberActivityMetric,
): number {
  return Number(bucketMap.get(bucketKey(memberId, bucketStart))?.[metric] ?? 0);
}

function bucketKey(memberId: number, bucketStart: number): string {
  return `${memberId}:${bucketStart}`;
}

function displayMember(member: WarMemberActivityMember): string {
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

function activityCellColor(value: number, maxValue: number, color: "blue" | "red" | "green"): string {
  if (value <= 0 || maxValue <= 0) {
    return "#f8fafc";
  }

  const intensity = Math.max(0.12, Math.min(1, Math.log1p(value) / Math.log1p(maxValue)));
  const colors = {
    blue: [37, 99, 235],
    red: [220, 38, 38],
    green: [22, 163, 74],
  }[color];

  return `rgba(${colors[0]}, ${colors[1]}, ${colors[2]}, ${0.16 + intensity * 0.72})`;
}

function formatCompactCell(value: number): string {
  if (value >= 1000) {
    return "999";
  }

  if (value >= 100) {
    return String(Math.round(value));
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
