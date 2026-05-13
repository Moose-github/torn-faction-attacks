import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EnemyFactionMember,
  FactionActivityHeatmapRow,
  MemberStats,
  WarActivityBucket,
} from "../api";
import { EmptyState } from "./Common";
import { formatNumber, formatTime } from "../utils/format";
import { activityLabel, displayMember, memberDefendsLost, MemberSortKey } from "../utils/members";

type ActivityIntervalAverage = {
  averageActive: number;
  averageTotal: number;
  samples: number;
};

export function AttackChart({
  members,
  metricKey = "attacks_vs_enemy_successful",
  metricLabel = "Attacks",
}: {
  members: MemberStats[];
  metricKey?: MemberSortKey;
  metricLabel?: string;
}) {
  if (members.length === 0) {
    return <EmptyState text="No member data yet" />;
  }

  const data = members.map((member) => ({
    name: displayMember(member),
    value: chartMetricValue(member, metricKey),
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-45}
            textAnchor="end"
            interval={0}
            height={80}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Bar dataKey="value" name={metricLabel} radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={`chart-value-${index}`} fill="#2563eb" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function chartMetricValue(member: MemberStats, metricKey: MemberSortKey): number {
  if (metricKey === "member_name") {
    return Number(member.attacks_vs_enemy_successful ?? 0);
  }

  if (metricKey === "defends_lost") {
    return memberDefendsLost(member);
  }

  return Number(member[metricKey] ?? 0);
}

type ActivityKey = keyof Pick<
  WarActivityBucket,
  "enemy_success" | "enemy_assist" | "outside" | "defend_lost" | "defend_won" | "defend_other"
>;

const activityColors: Record<ActivityKey, string> = {
  enemy_success: "#22c55e",
  enemy_assist: "#eab308",
  outside: "#a855f7",
  defend_lost: "#ef4444",
  defend_won: "#f97316",
  defend_other: "#64748b",
};

export function ActivityChart({
  buckets,
  keys,
}: {
  buckets: WarActivityBucket[];
  keys: ActivityKey[];
}) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return <EmptyState text="No activity data yet" />;
  }

  const data = buckets.map((bucket) => ({
    ...bucket,
    label: formatTime(bucket.bucket_start),
  }));

  return (
    <div className="activity-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(value, name) => [
              formatNumber(Number(value)),
              activityLabel(String(name)),
            ]}
            labelFormatter={(label) => `Time ${label}`}
          />
          <Legend formatter={(value) => activityLabel(String(value))} />
          {keys.map((key) => (
            <Bar key={key} dataKey={key} stackId="activity" fill={activityColors[key]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type ScoutingBucket = {
  label: string;
  min: number;
  max: number;
};

const battleStatsBuckets: ScoutingBucket[] = [
  { label: "<1m", min: 0, max: 1_000_000 },
  { label: "1m-10m", min: 1_000_000, max: 10_000_000 },
  { label: "10m-100m", min: 10_000_000, max: 100_000_000 },
  { label: "100m-250m", min: 100_000_000, max: 250_000_000 },
  { label: "250m-500m", min: 250_000_000, max: 500_000_000 },
  { label: "500m-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b+", min: 10_000_000_000, max: Number.POSITIVE_INFINITY },
];

const networthBuckets: ScoutingBucket[] = [
  { label: "<500m", min: 0, max: 500_000_000 },
  { label: "0.5b-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b-20b", min: 10_000_000_000, max: 20_000_000_000 },
  { label: "20b-30b", min: 20_000_000_000, max: 30_000_000_000 },
  { label: "30b-40b", min: 30_000_000_000, max: 40_000_000_000 },
  { label: "40b-50b", min: 40_000_000_000, max: 50_000_000_000 },
  { label: "50b+", min: 50_000_000_000, max: Number.POSITIVE_INFINITY },
];

export function ScoutingComparisonChart({
  homeMembers,
  enemyMembers,
  enemyName,
  metric = "ff_battlestats",
  metricLabel = "FF stats",
}: {
  homeMembers: EnemyFactionMember[];
  enemyMembers: EnemyFactionMember[];
  enemyName: string;
  metric?: "ff_battlestats" | "bsp_battlestats" | "networth";
  metricLabel?: string;
}) {
  const homeEstimated = homeMembers.filter((member) => hasScoutingMetric(member, metric));
  const enemyEstimated = enemyMembers.filter((member) => hasScoutingMetric(member, metric));

  if (homeEstimated.length === 0 && enemyEstimated.length === 0) {
    return <EmptyState text={`No ${metricLabel} loaded yet`} />;
  }

  const buckets = metric === "networth" ? networthBuckets : battleStatsBuckets;
  const data = buckets.map((bucket) => ({
    bucket: bucket.label,
    Buttgrass: countBucket(homeEstimated, bucket.min, bucket.max, metric),
    [enemyName]: countBucket(enemyEstimated, bucket.min, bucket.max, metric),
  }));

  return (
    <div className="scouting-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="buttgrass-stats-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.34} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="enemy-stats-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.34} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(value) => [formatNumber(Number(value)), "Members"]} />
          <Legend />
          <Area
            type="monotone"
            dataKey="Buttgrass"
            stroke="#2563eb"
            strokeWidth={2}
            fill="url(#buttgrass-stats-fill)"
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Area
            type="monotone"
            dataKey={enemyName}
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#enemy-stats-fill)"
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function hasScoutingMetric(
  member: EnemyFactionMember,
  metric: "ff_battlestats" | "bsp_battlestats" | "networth",
): boolean {
  return Number.isFinite(Number(member[metric])) && Number(member[metric]) > 0;
}

function countBucket(
  members: EnemyFactionMember[],
  min: number,
  max: number,
  metric: "ff_battlestats" | "bsp_battlestats" | "networth",
): number {
  return members.filter((member) => {
    const stats = Number(member[metric] ?? 0);
    return stats >= min && stats < max;
  }).length;
}

export function FactionActivityHeatmap({
  rows,
  factionId,
  label,
  color,
}: {
  rows: FactionActivityHeatmapRow[];
  factionId: number | null;
  label: string;
  color: "blue" | "red";
}) {
  if (factionId === null) {
    return <EmptyState text="No faction selected" />;
  }

  const factionRows = rows.filter((row) => sameFactionId(row.faction_id, factionId));
  if (factionRows.length === 0) {
    return <EmptyState text="No heatmap samples yet" />;
  }

  const intervalAverages = averageHeatmapIntervals(factionRows);
  const intervalIntensities = individualHeatmapIntensities(intervalAverages);

  return (
    <div className="heatmap-block">
      <div className="heatmap-title-row">
        <strong>{label}</strong>
        <span>{formatNumber(factionRows.length)} samples</span>
      </div>
      <div className="heatmap-day-stack">
        <div className="heatmap-day">
          <div className="heatmap-day-header">
            <strong>Average day</strong>
            <span>15 min averages</span>
          </div>
          <div className="heatmap-square-grid">
            {Array.from({ length: 96 }, (_, intervalIndex) => {
              const row = intervalAverages.get(intervalIndex);
              const intensity = intervalIntensities.get(intervalIndex) ?? 0;
              const isHourStart = intervalIndex % 4 === 0;
              return (
                <span
                  key={intervalIndex}
                  className={isHourStart ? "heatmap-cell heatmap-hour-cell" : "heatmap-cell"}
                  style={{ backgroundColor: heatmapColor(color, intensity, Boolean(row)) }}
                  title={
                    row
                      ? `${intervalLabel(intervalIndex)}: ${formatNumber(row.averageActive)} / ${formatNumber(row.averageTotal)} active average (${formatNumber(row.samples)} samples)`
                      : `${intervalLabel(intervalIndex)}: no sample`
                  }
                >
                  {isHourStart ? String(Math.floor(intervalIndex / 4)).padStart(2, "0") : null}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FactionActivityComparisonHeatmap({
  rows,
  homeFactionId,
  enemyFactionId,
  homeLabel,
  enemyLabel,
}: {
  rows: FactionActivityHeatmapRow[];
  homeFactionId: number | null;
  enemyFactionId: number | null;
  homeLabel: string;
  enemyLabel: string;
}) {
  if (homeFactionId === null || enemyFactionId === null) {
    return <EmptyState text="No factions selected" />;
  }

  const homeRows = rows.filter((row) => sameFactionId(row.faction_id, homeFactionId));
  const enemyRows = rows.filter((row) => sameFactionId(row.faction_id, enemyFactionId));
  if (homeRows.length === 0 || enemyRows.length === 0) {
    return <EmptyState text="Not enough heatmap samples to compare yet" />;
  }

  const homeAverages = averageHeatmapIntervals(homeRows);
  const enemyAverages = averageHeatmapIntervals(enemyRows);
  const comparableSamples = Array.from({ length: 96 }).filter(
    (_, intervalIndex) => homeAverages.has(intervalIndex) && enemyAverages.has(intervalIndex),
  ).length;

  return (
    <div className="heatmap-block heatmap-comparison-block">
      <div className="heatmap-title-row">
        <strong>Activity comparison</strong>
        <span>{formatNumber(comparableSamples)} comparable time slots</span>
      </div>
      <div className="heatmap-day-stack">
        <div className="heatmap-day">
          <div className="heatmap-day-header">
            <strong>Average day</strong>
            <span>Green favours {homeLabel}; red favours {enemyLabel}</span>
          </div>
          <div className="heatmap-square-grid">
            {Array.from({ length: 96 }, (_, intervalIndex) => {
              const home = homeAverages.get(intervalIndex);
              const enemy = enemyAverages.get(intervalIndex);
              const hasSample = Boolean(home && enemy);
              const homePercent = home && home.averageTotal > 0 ? home.averageActive / home.averageTotal : 0;
              const enemyPercent = enemy && enemy.averageTotal > 0 ? enemy.averageActive / enemy.averageTotal : 0;
              const difference = homePercent - enemyPercent;
              const isHourStart = intervalIndex % 4 === 0;

              return (
                <span
                  key={intervalIndex}
                  className={isHourStart ? "heatmap-cell heatmap-hour-cell" : "heatmap-cell"}
                  style={{ backgroundColor: comparisonHeatmapColor(difference, hasSample) }}
                  title={
                    hasSample
                      ? `${intervalLabel(intervalIndex)}: ${homeLabel} ${formatPercent(homePercent)} active, ${enemyLabel} ${formatPercent(enemyPercent)} active (${formatSignedPercent(difference)})`
                      : `${intervalLabel(intervalIndex)}: no comparable sample`
                  }
                >
                  {isHourStart ? String(Math.floor(intervalIndex / 4)).padStart(2, "0") : null}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function averageHeatmapIntervals(rows: FactionActivityHeatmapRow[]) {
  const totals = new Map<number, { activeTotal: number; memberTotal: number; samples: number }>();

  for (const row of rows) {
    const intervalIndex = heatmapIntervalIndex(row.interval_index);
    if (intervalIndex === null) {
      continue;
    }

    const existing = totals.get(intervalIndex) ?? {
      activeTotal: 0,
      memberTotal: 0,
      samples: 0,
    };
    existing.activeTotal += heatmapNumber(row.active_count);
    existing.memberTotal += heatmapNumber(row.total_count);
    existing.samples += 1;
    totals.set(intervalIndex, existing);
  }

  return new Map<number, ActivityIntervalAverage>(
    [...totals.entries()].map(([intervalIndex, total]) => [
      intervalIndex,
      {
        averageActive: total.activeTotal / total.samples,
        averageTotal: total.memberTotal / total.samples,
        samples: total.samples,
      },
    ]),
  );
}

function sameFactionId(rowFactionId: unknown, factionId: number): boolean {
  return Number(rowFactionId) === factionId;
}

function heatmapIntervalIndex(value: unknown): number | null {
  const intervalIndex = Number(value);
  if (!Number.isInteger(intervalIndex) || intervalIndex < 0 || intervalIndex >= 96) {
    return null;
  }
  return intervalIndex;
}

function heatmapNumber(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function individualHeatmapIntensities(intervalAverages: Map<number, ActivityIntervalAverage>): Map<number, number> {
  const values = [...intervalAverages.entries()]
    .map(([intervalIndex, row]) => ({
      intervalIndex,
      percent: row.averageTotal > 0 ? row.averageActive / row.averageTotal : 0,
    }))
    .filter((value) => Number.isFinite(value.percent));

  if (values.length === 0) {
    return new Map();
  }

  const sortedPercents = values.map((value) => value.percent).sort((a, b) => a - b);
  const lowest = sortedPercents[0];
  const highest = sortedPercents[sortedPercents.length - 1];

  if (lowest === highest) {
    return new Map(values.map((value) => [value.intervalIndex, 0.5]));
  }

  return new Map(
    values.map((value) => {
      const lowerCount = sortedPercents.filter((percent) => percent < value.percent).length;
      const percentile = lowerCount / Math.max(1, sortedPercents.length - 1);
      return [value.intervalIndex, heatmapBucketIntensity(percentile)];
    }),
  );
}

function heatmapBucketIntensity(percentile: number): number {
  if (percentile >= 0.8) {
    return 0.84;
  }
  if (percentile >= 0.6) {
    return 0.68;
  }
  if (percentile >= 0.4) {
    return 0.48;
  }
  if (percentile >= 0.2) {
    return 0.28;
  }
  return 0.1;
}

function comparisonHeatmapColor(difference: number, hasSample: boolean): string {
  if (!hasSample) {
    return "#f1f5f9";
  }

  const magnitude = Math.min(1, Math.abs(difference) / 0.35);
  if (magnitude < 0.05) {
    return "#e2e8f0";
  }

  const alpha = 0.16 + magnitude * 0.72;
  return difference >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}

function heatmapColor(color: "blue" | "red", intensity: number, hasSample: boolean): string {
  if (!hasSample) {
    return "#f1f5f9";
  }

  const alpha = Math.min(0.82, 0.1 + intensity * 0.72);
  return color === "red" ? `rgba(239, 68, 68, ${alpha})` : `rgba(37, 99, 235, ${alpha})`;
}

function intervalLabel(intervalIndex: number): string {
  const minutes = intervalIndex * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatSignedPercent(value: number): string {
  const formatted = formatPercent(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}
