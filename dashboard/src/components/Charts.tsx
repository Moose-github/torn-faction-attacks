import {
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
import { EnemyFactionMember, MemberStats, WarActivityBucket } from "../api";
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
            labelFormatter={(label) => `Bucket ${label}`}
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
  { label: "100m-1b", min: 100_000_000, max: 1_000_000_000 },
  { label: "1b-10b", min: 1_000_000_000, max: 10_000_000_000 },
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
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(value) => [formatNumber(Number(value)), "Members"]} />
          <Legend />
          <Bar dataKey="Buttgrass" fill="#2563eb" radius={[4, 4, 0, 0]} />
          <Bar dataKey={enemyName} fill="#f97316" radius={[4, 4, 0, 0]} />
        </BarChart>
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
