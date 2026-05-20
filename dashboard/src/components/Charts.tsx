import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
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
import {
  activityLabel,
  displayMember,
  memberDefendsLost,
  memberNonHospitalizedDefendsLost,
  MemberSortKey,
} from "../utils/members";
import {
  SCOUTING_BATTLE_STATS_BUCKETS,
  SCOUTING_NETWORTH_BUCKETS,
  ScoutingComparisonMetric,
} from "../../../shared/scoutingBuckets";

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
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-45}
            textAnchor="end"
            interval={0}
            height={80}
            tickLine={false}
            axisLine={false}
            {...chartAxisProps}
          />
          <YAxis tickLine={false} axisLine={false} width={44} {...chartAxisProps} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} {...chartTooltipProps} />
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

const chartAxisProps = {
  tick: { fill: "var(--chart-axis)" },
};

const chartTooltipProps = {
  contentStyle: {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    borderRadius: "8px",
    color: "var(--text-main)",
    boxShadow: "var(--shadow-panel)",
  },
  labelStyle: { color: "var(--text-strong)", fontWeight: 800 },
  itemStyle: { color: "var(--text-main)" },
};

const chartLegendProps = {
  wrapperStyle: { color: "var(--text-muted)", fontWeight: 700 },
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
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} {...chartAxisProps} />
          <YAxis tickLine={false} axisLine={false} width={44} {...chartAxisProps} />
          <Tooltip
            formatter={(value, name) => [
              formatNumber(Number(value)),
              activityLabel(String(name)),
            ]}
            labelFormatter={(label) => `Time ${label}`}
            {...chartTooltipProps}
          />
          <Legend formatter={(value) => activityLabel(String(value))} {...chartLegendProps} />
          {keys.map((key) => (
            <Bar key={key} dataKey={key} stackId="activity" fill={activityColors[key]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type MemberPointMetric = {
  label: string;
  value: (member: MemberStats) => number | null | undefined;
};

type MemberPointGraph = {
  title: string;
  x: MemberPointMetric;
  y: MemberPointMetric;
  color: string;
};

type MemberPointDatum = {
  fill: string;
  memberId: number;
  name: string;
  x: number;
  y: number;
  xLabel: string;
  yLabel: string;
};

const memberPointHighlightColors: Record<number, string> = {
  1875013: "#f47fff",
  2807909: "#ff8a00",
  1874922: "#384298",
  2905276: "#ffef0f",
  2169883: "#00a86b",
};

const baseMemberPointGraphs: MemberPointGraph[] = [
  {
    title: "Adjusted respect gained vs successful attacks",
    x: {
      label: "Successful attacks",
      value: (member) => member.attacks_vs_enemy_successful,
    },
    y: {
      label: "Adjusted respect gained",
      value: (member) => member.respect_gained,
    },
    color: "#2563eb",
  },
  {
    title: "Average fair fight vs successful attacks",
    x: {
      label: "Successful attacks",
      value: (member) => member.attacks_vs_enemy_successful,
    },
    y: {
      label: "Average fair fight",
      value: (member) => member.average_fair_fight,
    },
    color: "#4f46e5",
  },
  {
    title: "Adjusted respect gained vs adjusted respect lost",
    x: {
      label: "Adjusted respect lost",
      value: (member) => member.respect_lost,
    },
    y: {
      label: "Adjusted respect gained",
      value: (member) => member.respect_gained,
    },
    color: "#16a34a",
  },
  {
    title: "Adjusted respect gained vs non-hosp respect lost",
    x: {
      label: "Non-hosp respect lost",
      value: (member) => member.respect_lost_non_hospitalized,
    },
    y: {
      label: "Adjusted respect gained",
      value: (member) => member.respect_gained,
    },
    color: "#0d9488",
  },
  {
    title: "Successful attacks vs outside hits",
    x: {
      label: "Outside hits",
      value: (member) => member.outside_hits,
    },
    y: {
      label: "Successful attacks",
      value: (member) => member.attacks_vs_enemy_successful,
    },
    color: "#a855f7",
  },
  {
    title: "Successful attacks vs defends lost",
    x: {
      label: "Defends lost",
      value: memberDefendsLost,
    },
    y: {
      label: "Successful attacks",
      value: (member) => member.attacks_vs_enemy_successful,
    },
    color: "#dc2626",
  },
  {
    title: "Average fair fight vs adjusted respect gained",
    x: {
      label: "Average fair fight",
      value: (member) => member.average_fair_fight,
    },
    y: {
      label: "Adjusted respect gained",
      value: (member) => member.respect_gained,
    },
    color: "#7c3aed",
  },
  {
    title: "Adjusted respect lost vs defends lost",
    x: {
      label: "Defends lost",
      value: memberDefendsLost,
    },
    y: {
      label: "Adjusted respect lost",
      value: (member) => member.respect_lost,
    },
    color: "#ef4444",
  },
  {
    title: "Defends lost vs non-hosp defends lost",
    x: {
      label: "Defends lost",
      value: memberDefendsLost,
    },
    y: {
      label: "Non-hosp defends lost",
      value: memberNonHospitalizedDefendsLost,
    },
    color: "#f97316",
  },
];

const termedMemberPointGraph: MemberPointGraph = {
  title: "Average fair fight vs member respect limit %",
  x: {
    label: "Average fair fight",
    value: (member) => member.average_fair_fight,
  },
  y: {
    label: "Member respect limit %",
    value: (member) => member.member_respect_limit_percent,
  },
  color: "#0891b2",
};

const tacendaJokePoint: MemberPointDatum = {
  fill: memberPointHighlightColors[2807909],
  memberId: 2807909,
  name: "Tacenda (#2807909)",
  x: 72,
  y: 91,
  xLabel: "Plot density",
  yLabel: "Tacenda factor",
};

const tacendaJokeTicks = [0, 25, 50, 75, 100];
const tacendaJokeXAxisLabels: Record<number, string> = {
  0: "Rumour",
  25: "Whisper",
  50: "Scheme",
  75: "Lore",
  100: "Canon",
};
const tacendaJokeYAxisLabels: Record<number, string> = {
  0: "Calm",
  25: "Noted",
  50: "Suspicious",
  75: "Mythic",
  100: "Tacenda",
};

export function MemberPointGraphs({
  members,
  showTermedGraph,
}: {
  members: MemberStats[];
  showTermedGraph: boolean;
}) {
  const listId = React.useId();
  const [focusedMemberInput, setFocusedMemberInput] = React.useState("");
  const graphs = showTermedGraph
    ? [...baseMemberPointGraphs.slice(0, 3), termedMemberPointGraph, ...baseMemberPointGraphs.slice(3)]
    : baseMemberPointGraphs;
  const memberOptions = React.useMemo(
    () =>
      members.map((member) => ({
        id: member.member_id,
        name: displayMember(member),
        label: `${displayMember(member)} (#${member.member_id})`,
      })),
    [members],
  );
  const focusedMemberId = resolveFocusedMemberId(focusedMemberInput, memberOptions);

  if (members.length === 0) {
    return <EmptyState text="No member data yet" />;
  }

  return (
    <div className="member-point-graphs">
      <div className="member-point-focus-control">
        <label htmlFor={listId}>Focus member</label>
        <div>
          <input
            id={listId}
            list={`${listId}-members`}
            placeholder="Search member"
            value={focusedMemberInput}
            onChange={(event) => setFocusedMemberInput(event.target.value)}
          />
          <datalist id={`${listId}-members`}>
            {memberOptions.map((member) => (
              <option key={member.id} value={member.label} />
            ))}
          </datalist>
          <button
            type="button"
            className="panel-action-button"
            disabled={!focusedMemberInput}
            onClick={() => setFocusedMemberInput("")}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="member-point-graph-grid">
        {graphs.map((graph) => (
          <MemberPointGraphCard
            key={graph.title}
            graph={graph}
            members={members}
            focusedMemberId={focusedMemberId}
          />
        ))}
        <TacendaJokeGraphCard focusedMemberId={focusedMemberId} />
      </div>
    </div>
  );
}

function MemberPointGraphCard({
  graph,
  members,
  focusedMemberId,
}: {
  graph: MemberPointGraph;
  members: MemberStats[];
  focusedMemberId: number | null;
}) {
  const data = members
    .map((member) => {
      const x = numberOrNull(graph.x.value(member));
      const y = numberOrNull(graph.y.value(member));
      if (x === null || y === null) {
        return null;
      }
      return {
        fill: memberPointHighlightColors[member.member_id] ?? graph.color,
        memberId: member.member_id,
        name: displayMember(member),
        x,
        y,
        xLabel: graph.x.label,
        yLabel: graph.y.label,
      };
    })
    .filter((point): point is MemberPointDatum => point !== null);
  return (
    <div className="member-point-chart-card">
      <div className="member-point-chart-header">
        <strong>{graph.title}</strong>
        <span>{formatNumber(data.length)} members</span>
      </div>
      {data.length === 0 ? (
        <EmptyState text="No comparable member values" />
      ) : (
        <div className="member-point-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name={graph.x.label}
                tickLine={false}
                axisLine={false}
                width={44}
                {...chartAxisProps}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={graph.y.label}
                tickLine={false}
                axisLine={false}
                width={54}
                {...chartAxisProps}
              />
              <Tooltip
                content={<MemberPointTooltip />}
                {...chartTooltipProps}
              />
              <Scatter
                data={data}
                fillOpacity={0.78}
                shape={(props: unknown) => (
                  <MemberPointDot
                    {...(props as MemberPointDotProps)}
                    focusedMemberId={focusedMemberId}
                  />
                )}
              >
                {data.map((point) => (
                  <Cell key={`${graph.title}-${point.name}`} fill={point.fill} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TacendaJokeGraphCard({ focusedMemberId }: { focusedMemberId: number | null }) {
  return (
    <div className="member-point-chart-card">
      <div className="member-point-chart-header">
        <strong>Tacenda</strong>
        <span>1 member</span>
      </div>
      <div className="member-point-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={tacendaJokePoint.xLabel}
              domain={[0, 100]}
              ticks={tacendaJokeTicks}
              tickFormatter={(value) => tacendaJokeXAxisLabels[Number(value)] ?? String(value)}
              tickLine={false}
              axisLine={false}
              width={44}
              {...chartAxisProps}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={tacendaJokePoint.yLabel}
              domain={[0, 100]}
              ticks={tacendaJokeTicks}
              tickFormatter={(value) => tacendaJokeYAxisLabels[Number(value)] ?? String(value)}
              tickLine={false}
              axisLine={false}
              width={72}
              {...chartAxisProps}
            />
            <Tooltip
              content={<MemberPointTooltip />}
              {...chartTooltipProps}
            />
            <Scatter
              data={[tacendaJokePoint]}
              fillOpacity={0.78}
              shape={(props: unknown) => (
                <MemberPointDot
                  {...(props as MemberPointDotProps)}
                  focusedMemberId={focusedMemberId}
                />
              )}
            >
              <Cell fill={tacendaJokePoint.fill} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type MemberPointDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  height?: number;
  left?: number;
  payload?: MemberPointDatum;
  top?: number;
  width?: number;
  xAxis?: {
    x?: number;
    width?: number;
  };
  yAxis?: {
    height?: number;
    y?: number;
  };
};

function MemberPointDot({
  cx,
  cy,
  fill,
  focusedMemberId,
  height,
  left,
  payload,
  top,
  width,
  xAxis,
  yAxis,
}: MemberPointDotProps & { focusedMemberId: number | null }) {
  if (typeof cx !== "number" || typeof cy !== "number") {
    return null;
  }

  const isFocused = focusedMemberId !== null && payload?.memberId === focusedMemberId;
  const hasChartBounds =
    typeof left === "number" &&
    typeof top === "number" &&
    typeof width === "number" &&
    typeof height === "number";
  const hasAxisBounds =
    typeof xAxis?.x === "number" &&
    typeof xAxis.width === "number" &&
    typeof yAxis?.y === "number" &&
    typeof yAxis.height === "number";
  const axisLeft = hasAxisBounds ? Number(xAxis?.x) : null;
  const axisWidth = hasAxisBounds ? Number(xAxis?.width) : null;
  const axisTop = hasAxisBounds ? Number(yAxis?.y) : null;
  const axisHeight = hasAxisBounds ? Number(yAxis?.height) : null;
  const lineX1 = axisLeft ?? (hasChartBounds ? left : 0);
  const lineX2 = axisLeft !== null && axisWidth !== null ? axisLeft + axisWidth : hasChartBounds ? left + width : cx;
  const lineY1 = axisTop ?? (hasChartBounds ? top : 0);
  const lineY2 = axisTop !== null && axisHeight !== null ? axisTop + axisHeight : hasChartBounds ? top + height : cy;
  return (
    <g>
      {isFocused ? (
        <>
          <line
            x1={lineX1}
            x2={lineX2}
            y1={cy}
            y2={cy}
            stroke="var(--member-point-reference-line)"
            strokeDasharray="4 4"
            strokeWidth={1.25}
          />
          <line
            x1={cx}
            x2={cx}
            y1={lineY1}
            y2={lineY2}
            stroke="var(--member-point-reference-line)"
            strokeDasharray="4 4"
            strokeWidth={1.25}
          />
        </>
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill ?? payload?.fill ?? "#2563eb"}
        stroke={isFocused ? "var(--text-strong)" : "transparent"}
        strokeWidth={isFocused ? 1.25 : 0}
      />
    </g>
  );
}

function resolveFocusedMemberId(
  input: string,
  members: Array<{ id: number; label: string; name: string }>,
): number | null {
  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }

  const exactMatch = members.find(
    (member) =>
      member.label.toLowerCase() === value ||
      member.name.toLowerCase() === value ||
      String(member.id) === value,
  );
  if (exactMatch) {
    return exactMatch.id;
  }

  const partialMatches = members.filter((member) => member.name.toLowerCase().includes(value));
  return partialMatches.length === 1 ? partialMatches[0].id : null;
}

function MemberPointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MemberPointDatum }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="chart-tooltip-card">
      <strong>{point.name}</strong>
      <span>
        {point.xLabel}: {formatNumber(point.x)}
      </span>
      <span>
        {point.yLabel}: {formatNumber(point.y)}
      </span>
    </div>
  );
}

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
  metric?: ScoutingComparisonMetric;
  metricLabel?: string;
}) {
  const homeEstimated = homeMembers.filter((member) => hasScoutingMetric(member, metric));
  const enemyEstimated = enemyMembers.filter((member) => hasScoutingMetric(member, metric));

  if (homeEstimated.length === 0 && enemyEstimated.length === 0) {
    return <EmptyState text={`No ${metricLabel} loaded yet`} />;
  }

  const buckets = metric === "networth" ? SCOUTING_NETWORTH_BUCKETS : SCOUTING_BATTLE_STATS_BUCKETS;
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
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} {...chartAxisProps} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} {...chartAxisProps} />
          <Tooltip formatter={(value) => [formatNumber(Number(value)), "Members"]} {...chartTooltipProps} />
          <Legend {...chartLegendProps} />
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

function numberOrNull(value: number | null | undefined): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function hasScoutingMetric(
  member: EnemyFactionMember,
  metric: ScoutingComparisonMetric,
): boolean {
  return Number.isFinite(Number(member[metric])) && Number(member[metric]) > 0;
}

function countBucket(
  members: EnemyFactionMember[],
  min: number,
  max: number,
  metric: ScoutingComparisonMetric,
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
    return "var(--heatmap-empty-cell)";
  }

  const magnitude = Math.min(1, Math.abs(difference) / 0.35);
  if (magnitude < 0.05) {
    return "var(--heatmap-neutral-cell)";
  }

  const alpha = 0.16 + magnitude * 0.72;
  return difference >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}

function heatmapColor(color: "blue" | "red", intensity: number, hasSample: boolean): string {
  if (!hasSample) {
    return "var(--heatmap-empty-cell)";
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
