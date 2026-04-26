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
import { MemberStats, WarActivityBucket } from "../api";
import { EmptyState } from "./Common";
import { formatNumber, formatTime } from "../utils/format";
import { activityLabel, displayMember } from "../utils/members";

export function AttackChart({ members }: { members: MemberStats[] }) {
  if (members.length === 0) {
    return <EmptyState text="No member data yet" />;
  }

  const data = members.map((member) => ({
    name: displayMember(member),
    successful: Number(member.enemy_attacks_successful ?? 0),
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
          <Bar dataKey="successful" name="Attacks" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={`successful-${index}`} fill="#2563eb" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
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
