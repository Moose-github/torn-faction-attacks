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
import { activityLabel, displayMember, MemberSortKey } from "../utils/members";

export function AttackChart({
  members,
  metricKey = "enemy_attacks_successful",
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
    return Number(member.enemy_attacks_successful ?? 0);
  }

  return Number(member[metricKey] ?? 0);
}

export type ActivityKey = keyof Pick<
  WarActivityBucket,
  "enemy_success" | "enemy_assist" | "outside" | "defend_lost" | "defend_won"
>;

const activityColors: Record<ActivityKey, string> = {
  enemy_success: "#22c55e",
  enemy_assist: "#eab308",
  outside: "#a855f7",
  defend_lost: "#ef4444",
  defend_won: "#f97316",
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

const scoutingBuckets = [
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
] as const;

export function ScoutingComparisonChart({
  homeMembers,
  enemyMembers,
  enemyName,
}: {
  homeMembers: EnemyFactionMember[];
  enemyMembers: EnemyFactionMember[];
  enemyName: string;
}) {
  const homeEstimated = homeMembers.filter(hasEstimate);
  const enemyEstimated = enemyMembers.filter(hasEstimate);

  if (homeEstimated.length === 0 && enemyEstimated.length === 0) {
    return <EmptyState text="No estimated stats loaded yet" />;
  }

  const data = scoutingBuckets.map((bucket) => ({
    bucket: bucket.label,
    Buttgrass: countBucket(homeEstimated, bucket.min, bucket.max),
    [enemyName]: countBucket(enemyEstimated, bucket.min, bucket.max),
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

function hasEstimate(member: EnemyFactionMember): boolean {
  return Number.isFinite(Number(member.estimated_stats)) && Number(member.estimated_stats) > 0;
}

function countBucket(
  members: EnemyFactionMember[],
  min: number,
  max: number,
): number {
  return members.filter((member) => {
    const stats = Number(member.estimated_stats ?? 0);
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

  const factionRows = rows.filter((row) => row.faction_id === factionId);
  if (factionRows.length === 0) {
    return <EmptyState text="No heatmap samples yet" />;
  }

  const dates = Array.from(new Set(factionRows.map((row) => row.date))).sort();
  const rowMap = new Map(
    factionRows.map((row) => [`${row.date}:${row.interval_index}`, row]),
  );

  return (
    <div className="heatmap-block">
      <div className="heatmap-title-row">
        <strong>{label}</strong>
        <span>{formatNumber(factionRows.length)} samples</span>
      </div>
      <div className="heatmap-day-stack">
        {dates.map((date) => (
          <div className="heatmap-day" key={date}>
            <div className="heatmap-day-header">
              <strong>{formatHeatmapDate(date)}</strong>
              <span>15 min slots</span>
            </div>
            <div className="heatmap-square-grid">
              {Array.from({ length: 96 }, (_, intervalIndex) => {
                const row = rowMap.get(`${date}:${intervalIndex}`);
                const percent = row && row.total_count > 0 ? row.active_count / row.total_count : 0;
                return (
                  <span
                    key={intervalIndex}
                    className="heatmap-cell"
                    style={{ backgroundColor: heatmapColor(color, percent, Boolean(row)) }}
                    title={
                      row
                        ? `${formatHeatmapDate(date)} ${intervalLabel(intervalIndex)}: ${row.active_count}/${row.total_count} active`
                        : `${formatHeatmapDate(date)} ${intervalLabel(intervalIndex)}: no sample`
                    }
                  />
                );
              })}
            </div>
            <div className="heatmap-square-axis">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function heatmapColor(color: "blue" | "red", percent: number, hasSample: boolean): string {
  if (!hasSample) {
    return "#f1f5f9";
  }

  const alpha = Math.min(0.92, 0.14 + percent * 0.78);
  return color === "red" ? `rgba(239, 68, 68, ${alpha})` : `rgba(37, 99, 235, ${alpha})`;
}

function formatHeatmapDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(parsed);
}

function intervalLabel(intervalIndex: number): string {
  const minutes = intervalIndex * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
