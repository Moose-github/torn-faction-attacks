import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
import { formatNetworth, formatNumber } from "../utils/format";

const CHART_COLORS = ["#2563eb", "#16a34a", "#9333ea", "#f97316", "#0891b2"];
const OVERDOSE_COLOR = "#dc2626";

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

type TooltipFormatterItem = {
  dataKey?: string | number;
  payload?: ChartRow;
};

type DotProps = {
  cx?: number;
  cy?: number;
};

export function LifestyleDailyChart({
  metric,
  series,
  overdoseSeries = [],
}: {
  metric: MemberLifestyleDailyMetric;
  series: MemberLifestyleDailyChartSeries[];
  overdoseSeries?: MemberLifestyleDailyChartSeries[];
}) {
  if (series.length === 0) {
    return <EmptyState text="Select up to 5 members to chart" />;
  }

  const hasOverdoseOverlay = metric === "xantaken" && overdoseSeries.length > 0;
  const data = buildChartRows(series, hasOverdoseOverlay ? overdoseSeries : []);
  const hasValues = data.some((row) =>
    series.some((memberSeries) => row[seriesKey(memberSeries.member_id)] !== null),
  );

  if (!hasValues) {
    return <EmptyState text="No daily chart data for this range" />;
  }

  return (
    <div className="lifestyle-daily-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 12 }}>
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
            tickFormatter={(value) => formatChartValue(metric, Number(value))}
            tickLine={false}
            axisLine={false}
            width={58}
            tick={{ fill: "var(--chart-axis)" }}
          />
          <Tooltip
            formatter={(value, name, item) =>
              formatTooltipValue(metric, value, name, item as TooltipFormatterItem)
            }
            labelFormatter={(label) => `${label} | ${tooltipUnitLabel(metric, hasOverdoseOverlay)}`}
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
          {hasOverdoseOverlay && series.length === 1 ? (
            <Line
              key={`${series[0].member_id}-overdoses`}
              type="monotone"
              dataKey={overdoseLineKey(series[0].member_id)}
              name="ODs"
              stroke={OVERDOSE_COLOR}
              strokeWidth={2}
              dot={{ r: 3, fill: OVERDOSE_COLOR, stroke: OVERDOSE_COLOR }}
              activeDot={{ r: 5, fill: OVERDOSE_COLOR, stroke: OVERDOSE_COLOR }}
              connectNulls={false}
            />
          ) : null}
          {hasOverdoseOverlay && series.length > 1
            ? series.map((memberSeries) => (
                <Line
                  key={`${memberSeries.member_id}-overdose-marker`}
                  dataKey={overdoseMarkerKey(memberSeries.member_id)}
                  name={`${memberSeries.member_name ?? `#${memberSeries.member_id}`} OD`}
                  stroke="transparent"
                  strokeWidth={0}
                  dot={<OverdoseMarkerDot />}
                  activeDot={<OverdoseMarkerDot />}
                  legendType="none"
                  connectNulls={false}
                />
              ))
            : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildChartRows(
  series: MemberLifestyleDailyChartSeries[],
  overdoseSeries: MemberLifestyleDailyChartSeries[],
): ChartRow[] {
  const dateSet = new Set<string>();
  for (const memberSeries of series) {
    for (const point of memberSeries.points) {
      dateSet.add(point.date);
    }
  }
  for (const memberSeries of overdoseSeries) {
    for (const point of memberSeries.points) {
      dateSet.add(point.date);
    }
  }

  const overdosesByMember = new Map(overdoseSeries.map((memberSeries) => [memberSeries.member_id, memberSeries]));
  const singleMemberOverlay = series.length === 1;

  return Array.from(dateSet).sort().map((date) => {
    const row: ChartRow = { date };
    for (const memberSeries of series) {
      const memberValue = memberSeries.points.find((point) => point.date === date)?.value ?? null;
      const overdoseValue =
        overdosesByMember.get(memberSeries.member_id)?.points.find((point) => point.date === date)?.value ?? null;

      row[seriesKey(memberSeries.member_id)] = memberValue;
      row[overdoseCountKey(memberSeries.member_id)] = overdoseValue;
      row[overdoseLineKey(memberSeries.member_id)] = singleMemberOverlay ? overdoseValue : null;
      row[overdoseMarkerKey(memberSeries.member_id)] =
        !singleMemberOverlay && overdoseValue !== null && overdoseValue > 0 ? memberValue : null;
    }
    return row;
  });
}

function seriesKey(memberId: number): string {
  return `member_${memberId}`;
}

function overdoseLineKey(memberId: number): string {
  return `member_${memberId}_overdoses`;
}

function overdoseMarkerKey(memberId: number): string {
  return `member_${memberId}_overdose_marker`;
}

function overdoseCountKey(memberId: number): string {
  return `member_${memberId}_overdose_count`;
}

function formatChartValue(metric: MemberLifestyleDailyMetric, value: number): string {
  return metric === "networth" ? formatNetworth(value) : formatNumber(value);
}

function formatTooltipValue(
  metric: MemberLifestyleDailyMetric,
  value: string | number | Array<string | number>,
  name: string | number,
  item: TooltipFormatterItem,
): [string, string | number] {
  const dataKey = String(item.dataKey ?? "");
  if (dataKey.includes("_overdose_marker")) {
    const memberId = Number(dataKey.replace("member_", "").replace("_overdose_marker", ""));
    const overdoseValue = Number(item.payload?.[overdoseCountKey(memberId)] ?? 0);
    return [formatNumber(overdoseValue), name];
  }

  if (dataKey.includes("_overdoses")) {
    return [formatNumber(Number(value)), name];
  }

  return [value === null ? "-" : formatChartValue(metric, Number(value)), name];
}

function tooltipUnitLabel(metric: MemberLifestyleDailyMetric, hasOverdoseOverlay: boolean): string {
  return hasOverdoseOverlay ? "Xanax + ODs" : METRIC_UNITS[metric];
}

function OverdoseMarkerDot({ cx, cy }: DotProps) {
  if (typeof cx !== "number" || typeof cy !== "number") {
    return null;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={OVERDOSE_COLOR}
      stroke="#ffffff"
      strokeWidth={2}
    />
  );
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}
