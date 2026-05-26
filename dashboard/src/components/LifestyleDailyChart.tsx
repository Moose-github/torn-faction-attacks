import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  MemberLifestyleDailyChartSeries,
  MemberLifestyleDailyMetric,
} from "../api";
import { EmptyState } from "./Common";
import { formatNumber } from "../utils/format";

const CHART_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#f97316"];

const METRIC_UNITS: Record<MemberLifestyleDailyMetric, string> = {
  xantaken: "Xanax",
  overdosed: "ODs",
  refills: "Refills",
  useractivity: "Hours",
  gymenergy: "Energy",
  gymstrength: "Strength",
  gymspeed: "Speed",
  gymdefense: "Defense",
  gymdexterity: "Dexterity",
  networth: "Networth",
};

type ChartRow = {
  date: string;
  [seriesKey: string]: string | number | null;
};

export function LifestyleDailyChart({
  metric,
  series,
}: {
  metric: MemberLifestyleDailyMetric;
  series: MemberLifestyleDailyChartSeries[];
}) {
  if (series.length === 0) {
    return <EmptyState text="Select up to 5 members to chart" />;
  }

  const data = buildChartRows(series);
  const hasValues = data.some((row) =>
    series.some((memberSeries) => row[seriesKey(memberSeries.member_id)] !== null),
  );

  if (!hasValues) {
    return <EmptyState text="No daily chart data for this range" />;
  }

  return (
    <div className="lifestyle-daily-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 12 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tickLine={false}
            axisLine={false}
            minTickGap={18}
            tick={{ fill: "var(--chart-axis)" }}
          />
          <YAxis
            tickFormatter={(value) => formatNumber(Number(value))}
            tickLine={false}
            axisLine={false}
            width={58}
            tick={{ fill: "var(--chart-axis)" }}
          />
          <Tooltip
            formatter={(value, name) => [
              value === null ? "-" : formatNumber(Number(value)),
              name,
            ]}
            labelFormatter={(label) => `${label} | ${METRIC_UNITS[metric]}`}
            contentStyle={{
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--chart-tooltip-border)",
              borderRadius: "8px",
              color: "var(--text-main)",
              boxShadow: "var(--shadow-panel)",
            }}
            labelStyle={{ color: "var(--text-strong)", fontWeight: 800 }}
            itemStyle={{ color: "var(--text-main)" }}
          />
          <Legend wrapperStyle={{ color: "var(--text-muted)", fontWeight: 700 }} />
          {series.map((memberSeries, index) => (
            <Line
              key={memberSeries.member_id}
              type="monotone"
              dataKey={seriesKey(memberSeries.member_id)}
              name={memberSeries.member_name ?? `#${memberSeries.member_id}`}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildChartRows(series: MemberLifestyleDailyChartSeries[]): ChartRow[] {
  const dateSet = new Set<string>();
  for (const memberSeries of series) {
    for (const point of memberSeries.points) {
      dateSet.add(point.date);
    }
  }

  return Array.from(dateSet).sort().map((date) => {
    const row: ChartRow = { date };
    for (const memberSeries of series) {
      row[seriesKey(memberSeries.member_id)] =
        memberSeries.points.find((point) => point.date === date)?.value ?? null;
    }
    return row;
  });
}

function seriesKey(memberId: number): string {
  return `member_${memberId}`;
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}
