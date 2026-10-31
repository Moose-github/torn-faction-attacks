import { startPolling, type PollContext } from "../utils/polling";
import React from "react";
import { ArrowDown, ArrowUp, Candy, Flag, RefreshCw, Shield } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MemberStats, WarSummary } from "../api";
import { getEventCompetition, updateEliminationTeamStatus, type CompetitionMember, type EventCompetition } from "../api/competition";
import { EmptyState, PanelHeader } from "./Common";
import { RespectAdjustmentCell } from "./MemberTables";
import { EventCompetitionChartTooltip } from "./EventCompetitionChartTooltip";
import { formatDate, formatLongDateTime, formatNumber } from "../utils/format";
import { eliminationRowStatus } from "../utils/eventCompetition";
import { eventCompetitionChartData } from "../utils/eventCompetitionChart";
import "./eventCompetition.css";

export function useEventCompetition(war: WarSummary) {
  const [result, setResult] = React.useState<{ name: string; data: EventCompetition | null; error: string | null }>({ name: "", data: null, error: null });
  const revision = React.useRef(0);
  const activeName = React.useRef(war.name);
  activeName.current = war.name;
  const applyUpdate = React.useCallback((data: EventCompetition) => {
    if (activeName.current !== war.name) return;
    revision.current += 1;
    setResult({ name: war.name, data, error: null });
  }, [war.name]);
  const enabled = war.war_type === "event" && Boolean(war.event_type && war.event_type !== "general");
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function refresh({ signal, isCurrent }: PollContext) {
      const startedRevision = revision.current;
      try {
        const response = await getEventCompetition(war.name, signal);
        if (isCurrent() && !cancelled && revision.current === startedRevision) setResult({ name: war.name, data: response.competition, error: null });
      } catch {
        if (isCurrent() && !cancelled && revision.current === startedRevision) setResult(previous => ({ name: war.name, data: previous.name === war.name ? previous.data : null, error: "Competition data could not be loaded" }));
      }
    }
    const poll = startPolling(refresh, { intervalMs: 60_000 });
    return () => { cancelled = true; poll.stop(); };
  }, [enabled, war.name, war.event_type, war.status, war.practical_start_time, war.practical_finish_time, war.competition_refresh_hours]);
  return { enabled, data: enabled && result.name === war.name ? result.data : null, error: enabled && result.name === war.name ? result.error : null, applyUpdate };
}

export function EliminationTeamAdmin({ war, data, onUpdate }: {
  war: WarSummary; data: EventCompetition | null; onUpdate: (data: EventCompetition) => void;
}) {
  const [team, setTeam] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const teams = [...new Set((data?.members ?? []).flatMap(member =>
    member.participation === "participating" && member.team_name ? [member.team_name] : []))].sort();
  const selectedTeam = teams.includes(team) ? team : teams[0] ?? "";
  const eliminated = data?.eliminated_teams?.includes(selectedTeam) ?? false;
  async function save(value: boolean) {
    if (saving || !selectedTeam) return;
    setSaving(true); setError(null); setMessage("");
    try {
      const response = await updateEliminationTeamStatus(war.name, selectedTeam, value);
      onUpdate(response.competition);
      setMessage(`${selectedTeam} ${value ? "marked eliminated" : "restored"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Team status could not be saved");
    } finally { setSaving(false); }
  }
  return <section className="event-team-admin" aria-label="Elimination team controls">
    <PanelHeader icon={<Shield size={17} />} title="Elimination team status" aside="Admin only" />
    <div className="event-team-admin-form">
      <label><span>Team status</span><select value={selectedTeam} disabled={saving || !teams.length}
        onChange={event => { setTeam(event.target.value); setError(null); setMessage(""); }}>
        {!teams.length ? <option value="">No teams captured</option> : null}
        {teams.map(name => <option key={name} value={name}>{name}{data?.eliminated_teams?.includes(name) ? " (Eliminated)" : ""}</option>)}
      </select></label>
      <label className="event-team-eliminated-toggle"><input type="checkbox" checked={eliminated}
        disabled={saving || !selectedTeam} onChange={event => void save(event.target.checked)} />Eliminated</label>
      <span className="event-team-save-status" role="status">{saving ? "Saving..." : message}</span>
    </div>
    {error ? <p className="event-competition-warning" role="alert">{error}</p> : null}
  </section>;
}

export function TreatsLeaderboardTile({ data }: { data: EventCompetition | null }) {
  const leaders = [...(data?.members ?? [])].filter(member => member.treats_gained !== null && member.treats_gained > 0)
    .sort((a, b) => b.treats_gained! - a.treats_gained! || a.member_name.localeCompare(b.member_name)).slice(0, 3);
  return <article className="dashboard-highlight-tile event-leaderboard-tile">
    <div className="dashboard-highlight-heading">
      <span>Treats gained</span>
      <strong>{leaders[0]?.member_name ?? "No leader yet"}</strong>
      <small>{leaders[0] ? `${formatNumber(leaders[0].treats_gained!)} treats` : "treats"}</small>
    </div>
    <div className="dashboard-podium-list">
      {leaders.length ? leaders.map((member, index) => <div key={member.member_id} className={`dashboard-podium-row rank-${index + 1}`}>
        <span className="dashboard-rank-chip">{index + 1}</span><strong title={member.member_name}>{member.member_name}</strong>
        <small>{formatNumber(member.treats_gained!)} treats</small>
      </div>) : <EmptyState text="No podium yet" />}
    </div>
  </article>;
}

export function competitionTeam(member: CompetitionMember): string {
  return member.participation === "not_participating" ? "Not participating" : member.team_name ?? "Unavailable";
}

export function EventRoomCompetition({ war }: { war: WarSummary }) {
  const state = useEventCompetition(war);
  return state.enabled ? <EventCompetitionPanel key={war.id} war={war} data={state.data} error={state.error} compact /> : null;
}

type ScaleTitlePart = [text: string, color: string];

/** Rotated scale title whose words take the colours of the lines they describe. */
function ScaleTitle({ viewBox, side, parts }: {
  viewBox?: { x: number; y: number; width: number; height: number }; side: "left" | "right"; parts: ScaleTitlePart[];
}) {
  if (!viewBox) return null;
  const x = side === "left" ? viewBox.x + 10 : viewBox.x + viewBox.width - 10;
  const y = viewBox.y + viewBox.height / 2;
  return <text x={x} y={y} transform={`rotate(${side === "left" ? -90 : 90}, ${x}, ${y})`} textAnchor="middle" dominantBaseline="central" fontSize={12}>
    {parts.map(([text, color]) => <tspan key={text} fill={color}>{text}</tspan>)}
  </text>;
}

type CompetitionSortKey = "name" | "team" | "treats" | "attacks" | "respect" | "basket" | "days" | "eliminated";

function competitionBasket(member: CompetitionMember): string | null {
  return member.basket_name?.replace(/^Halloween Basket\s*:\s*/i, "") ?? (member.baseline_at != null ? "No basket" : null);
}

export function EventCompetitionPanel({ war, data, error, compact = false, memberStats = [] }: {
  war: WarSummary; data: EventCompetition | null; error: string | null; compact?: boolean; memberStats?: MemberStats[];
}) {
  const halloween = war.event_type === "halloween";
  const [team, setTeam] = React.useState("all");
  const [chartWidth, setChartWidth] = React.useState(0);
  // Narrow charts drop the scale titles and name the right scale in the legend instead.
  const narrowChart = chartWidth > 0 && chartWidth < 480;
  const rightScaleParts: ScaleTitlePart[] = [["Chain", "var(--event-chain-color)"],
    ...(data?.successful_attack_history?.length ? [[" & ", "var(--chart-axis)"], ["attacks", "var(--event-attacks-color)"]] as ScaleTitlePart[] : [])];
  const rightScaleNote = narrowChart ? " (right scale)" : "";
  const [sort, setSort] = React.useState<{ key: CompetitionSortKey; descending: boolean }>({ key: halloween ? "treats" : "eliminated", descending: halloween });
  const statsByMember = new Map(memberStats.map(member => [member.member_id, member]));
  const members = data?.members ?? [];
  const teams = [...new Set(members.map(competitionTeam))].sort();
  const visible = members.filter(member => halloween || (team === "all"
    ? member.participation !== "not_participating" : competitionTeam(member) === team)).sort((a, b) => {
    if (!halloween && sort.key === "eliminated") {
      const eliminatedOrder = Number(eliminationRowStatus(data, a) === "Eliminated") - Number(eliminationRowStatus(data, b) === "Eliminated");
      return (sort.descending ? -1 : 1) * eliminatedOrder
        || competitionTeam(a).localeCompare(competitionTeam(b)) || a.member_name.localeCompare(b.member_name);
    }
    if (!halloween && sort.key === "team") {
      return (sort.descending ? -1 : 1) * competitionTeam(a).localeCompare(competitionTeam(b)) || a.member_name.localeCompare(b.member_name);
    }
    if (halloween && sort.key === "basket") {
      const aBasket = competitionBasket(a);
      const bBasket = competitionBasket(b);
      if (aBasket === null) return bBasket === null ? a.member_name.localeCompare(b.member_name) : 1;
      if (bBasket === null) return -1;
      return (sort.descending ? -1 : 1) * aBasket.localeCompare(bBasket) || a.member_name.localeCompare(b.member_name);
    }
    if (halloween && (sort.key === "treats" || sort.key === "attacks" || sort.key === "respect" || sort.key === "days")) {
      const metric = (member: CompetitionMember) => sort.key === "treats" ? member.treats_gained
        : sort.key === "days" ? member.days_in_faction
        : sort.key === "attacks" ? statsByMember.get(member.member_id)?.attacks_vs_enemy_successful
        : statsByMember.get(member.member_id)?.respect_gained;
      const aValue = metric(a);
      const bValue = metric(b);
      if (aValue == null) return bValue == null ? a.member_name.localeCompare(b.member_name) : 1;
      if (bValue == null) return -1;
      return (sort.descending ? -1 : 1) * (aValue - bValue) || a.member_name.localeCompare(b.member_name);
    }
    return (sort.descending && sort.key === "name" ? -1 : 1) * a.member_name.localeCompare(b.member_name);
  });
  const observed = members.filter(member => halloween ? member.baseline_at !== null : member.captured_at !== null).length;
  const incomplete = members.filter(member => ["incomplete", "stale", "unavailable"].includes(member.status)).length;
  const lastUpdate = Math.max(0, ...members.map(member => member.updated_at ?? 0));
  const baselines = members.flatMap(member => member.baseline_at === null ? [] : [member.baseline_at]);
  const firstBaseline = baselines.length ? Math.min(...baselines) : null;
  const chartData = React.useMemo(() => data ? eventCompetitionChartData(data, war.practical_start_time, war.practical_finish_time) : [], [data, war.practical_start_time, war.practical_finish_time]);
  const chainTimes = data?.chain_history?.map(point => point.observed_at) ?? [];
  const tickInterval = Math.max(1, Math.ceil((chainTimes.length - 1) / 4));
  const chartTicks = chainTimes.length > 1
    ? chainTimes.filter((_, index) => index % tickInterval === 0 || index === chainTimes.length - 1) : undefined;
  function changeSort(key: CompetitionSortKey) {
    setSort(current => ({ key, descending: current.key === key ? !current.descending : key === "treats" || key === "attacks" || key === "respect" || key === "days" }));
  }
  const sortIcon = (key: CompetitionSortKey) => sort.key !== key ? null : sort.descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />;
  return <section className="panel event-competition-panel">
    <PanelHeader icon={halloween ? <Candy size={17} /> : <Flag size={17} />}
      title={halloween ? "Halloween treats" : "Elimination participation"}
      aside={halloween ? `Every ${data?.refresh_hours ?? war.competition_refresh_hours ?? 6} hours` : "Captured once"} />
    {error ? <p className="event-competition-warning" role="status">{error}</p> : null}
    {!data ? <EmptyState text={error ? "Data unavailable" : "Loading competition data"} /> : data.initialized_at === null ? (
      <EmptyState text={war.status === "scheduled" ? halloween ? "Awaiting baseline collection" : "Collection starts with the event" : war.status === "ended" ? "No competition snapshots saved for this event" : "Awaiting initial collection"} />
    ) : <>
      <div className={`event-competition-summary${halloween ? " event-competition-summary-halloween" : ""}`}>
        {halloween ? <div><span>Treats gained</span><strong>{data.total_treats_gained === null ? "Unavailable" : formatNumber(data.total_treats_gained)}</strong></div>
          : <div><span>Participating</span><strong>{members.filter(member => member.participation === "participating").length}</strong></div>}
        <div><span>Members captured</span><strong>{observed} / {members.length}</strong></div>
        {!halloween ? <div><span>Not participating</span><strong>{members.filter(member => member.participation === "not_participating").length}</strong></div> : null}
        <div><span>{halloween && firstBaseline !== null ? "Baseline captured" : "Collection started"}</span><span>{formatLongDateTime(firstBaseline ?? data.initialized_at)}</span></div>
        {halloween ? <div><span>Event start</span><span>{formatLongDateTime(war.practical_start_time)}</span></div> : null}
        <div><span>Last reading</span><span>{lastUpdate ? formatLongDateTime(lastUpdate) : "Awaiting data"}</span></div>
        {halloween && war.status !== "ended" && data.next_refresh_at ? <div><span>Next collection</span><span>{formatLongDateTime(data.next_refresh_at)}</span></div> : null}
      </div>
      {incomplete ? <p className="event-competition-warning">{incomplete} member {incomplete === 1 ? "reading is" : "readings are"} incomplete or unavailable. Totals use the last valid readings.</p> : null}
      {members.some(member => member.status === "finishing") ? <p className="event-competition-note"><RefreshCw size={14} /> Final collection pending</p> : null}
      {halloween && war.status === "scheduled" ? <p className="event-competition-note">Starting treats are collected when the event is created. Collection resumes at the event start; gains use each member’s saved baseline.</p> : null}
      {halloween && war.practical_finish_time !== null && lastUpdate > war.practical_finish_time ? <p className="event-competition-warning">Final readings were collected after the event finish and may include later treats.</p> : null}
      {compact && !halloween ? <div className="event-team-counts">{teams.map(name => <div key={name}><span>{name}</span><strong>{members.filter(member => competitionTeam(member) === name).length}</strong></div>)}</div> : null}
      {!compact && halloween && chartData.length > 0 ? <>
        <p className="event-chart-caption">Dots show the highest total from each {data.refresh_hours}-hour collection, joined by a line, on the left scale. Chain and successful attacks use the right scale. Chain gaps indicate no reliable reading.{data.successful_attack_history?.length ? ` Successful attacks count from event start, shown hourly from ${formatDate(data.successful_attack_history[0].observed_at)}.` : ""}</p>
        <div className="event-treat-chart" aria-label="Treats gained, chain and successful attacks over time">
        <ResponsiveContainer width="100%" height="100%" onResize={width => setChartWidth(width)}><LineChart accessibilityLayer data={chartData} margin={{ top: 12, right: 0, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="observed_at" type="number" domain={[war.practical_start_time, "dataMax"]} ticks={chartTicks} interval="preserveStartEnd" tickFormatter={(value: number) => formatDate(value)} minTickGap={50} tick={{ fontSize: 12, fill: "var(--chart-axis)" }} />
          <YAxis domain={[0, "auto"]} allowDataOverflow allowDecimals={false} width={narrowChart ? 64 : 80} label={narrowChart ? undefined : <ScaleTitle side="left" parts={[["Treats", "var(--accent)"]]} />} tickFormatter={formatNumber} tick={{ fontSize: 12, fill: "var(--accent)" }} />
          {/* Chain length and hit totals are far smaller than faction treat totals. */}
          <YAxis yAxisId="right" orientation="right" domain={[0, "auto"]} allowDecimals={false} width={narrowChart ? 56 : 80} label={narrowChart ? undefined : <ScaleTitle side="right" parts={rightScaleParts} />} tickFormatter={formatNumber} tick={{ fontSize: 12, fill: "var(--chart-axis)" }} />
          <Tooltip content={<EventCompetitionChartTooltip />} filterNull={false} isAnimationActive={false} offset={12} position={narrowChart ? { x: 0, y: 8 } : undefined} wrapperStyle={{ zIndex: 5, outline: "none" }} cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} />
          <Legend wrapperStyle={{ paddingTop: 10, fontSize: 13 }} />
          {/* Monotone interpolation never dips between rising totals or overshoots a reading. */}
          <Line name="Treats gained" dataKey="treats_point" type="monotoneX" legendType="circle" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: "var(--accent)" }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="right" name={`Chain${rightScaleNote}`} dataKey="chain" type="stepAfter" legendType="plainline" stroke="var(--event-chain-color)" strokeWidth={2} strokeDasharray="5 3" dot={props => props.payload.chain !== null && props.payload.chain_sampled_at === props.payload.observed_at
            ? <circle key={props.key} cx={props.cx} cy={props.cy} r={2} fill="var(--chart-tooltip-bg)" stroke="var(--event-chain-color)" /> : <g key={props.key} />} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          {data.successful_attack_history?.length ? <Line yAxisId="right" name={`Successful attacks${rightScaleNote}`} dataKey="successful_attacks" type="stepAfter" legendType="plainline" stroke="var(--event-attacks-color)" strokeWidth={2} dot={props => props.payload.successful_attacks !== null && props.payload.attacks_sampled_at === props.payload.observed_at
            ? <circle key={props.key} cx={props.cx} cy={props.cy} r={2} fill="var(--event-attacks-color)" /> : <g key={props.key} />} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} /> : null}
        </LineChart></ResponsiveContainer>
      </div></> : null}
      {!compact ? <>
        {!halloween ? <label className="event-team-filter"><span>Team</span><select value={team} onChange={event => setTeam(event.target.value)}>
          <option value="all">All members</option>{teams.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label> : null}
        <div className="table-scroll"><table className="event-competition-table">
          <thead><tr>
            <th aria-sort={sort.key === "name" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("name")}>Member {sortIcon("name")}</button></th>
            {halloween ? <>
              <th aria-sort={sort.key === "treats" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("treats")}>Treats gained {sortIcon("treats")}</button></th>
              <th aria-sort={sort.key === "attacks" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("attacks")}>Successful attacks {sortIcon("attacks")}</button></th>
              <th aria-sort={sort.key === "respect" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" title="Adjusted respect, with chain bonus hits counted at the member's average hit value." onClick={() => changeSort("respect")}>Respect gained {sortIcon("respect")}</button></th>
            </> : <th aria-sort={sort.key === "team" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("team")}>Team {sortIcon("team")}</button></th>}
            {!halloween ? <><th aria-sort={sort.key === "eliminated" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("eliminated")}>Eliminated {sortIcon("eliminated")}</button></th><th>Status</th></> : null}
            {halloween ? <>
              <th aria-sort={sort.key === "basket" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("basket")}>Basket {sortIcon("basket")}</button></th>
              <th aria-sort={sort.key === "days" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" title="Days in faction from the latest stored roster reading" onClick={() => changeSort("days")}>Days in faction {sortIcon("days")}</button></th>
            </> : null}
          </tr></thead>
          <tbody>{visible.map(member => {
            const stats = statsByMember.get(member.member_id);
            return <tr key={member.member_id}
            className={eliminationRowStatus(data, member) ? "event-inactive-row" : undefined}>
            <td><a className="member-link" href={`https://www.torn.com/profiles.php?XID=${member.member_id}`} target="_blank" rel="noreferrer">{member.member_name}</a></td>
            {halloween ? <>
              <td><span className="respect-adjustment-cell">
                <span className="respect-adjustment-value" title={`Last reading: ${member.updated_at ? formatLongDateTime(member.updated_at) : "Awaiting data"}`}>{member.treats_gained === null ? "Unavailable" : formatNumber(member.treats_gained)}</span>
                <span className="respect-adjustment-marker" title={`Baseline captured: ${member.baseline_at ? formatLongDateTime(member.baseline_at) : "Awaiting baseline"}`}>Starting treats: {member.baseline_treats == null ? "Unavailable" : formatNumber(member.baseline_treats)}</span>
              </span></td>
              <td>{stats?.attacks_vs_enemy_successful == null ? "Unavailable" : formatNumber(stats.attacks_vs_enemy_successful)}</td>
              <td>{stats?.respect_gained == null ? "Unavailable" : <RespectAdjustmentCell
                adjusted={stats.respect_gained}
                raw={stats.respect_gained_raw}
                chainHits={stats.chain_bonus_hits_vs_enemy}
                chainHitValues={stats.chain_bonus_hit_values_vs_enemy}
                chainHitDetails={stats.chain_bonus_hit_details_vs_enemy}
                respectRemoved={stats.chain_bonus_respect_removed}
                tooltipLabel="Respect gained"
                markerLabel="chain"
              />}</td>
            </> : <td>{competitionTeam(member)}</td>}
            {!halloween ? <td>{eliminationRowStatus(data, member) === "Eliminated" ? "Yes" : member.participation === "participating" ? "No" : "-"}</td> : null}
            {!halloween ? <td title={member.last_error ?? undefined}>{eliminationRowStatus(data, member) ?? (member.status === "complete" ? "Captured" : member.status === "tracking" ? "Tracking" : member.status === "pending" ? "Pending" : member.status === "finishing" ? "Final pending" : member.status === "stale" ? "Stale" : member.status === "incomplete" ? "Incomplete" : "Unavailable")}</td> : null}
            {halloween ? <td>{competitionBasket(member) ?? "Unavailable"}</td> : null}
            {halloween ? <td>{member.days_in_faction == null ? "Unavailable" : formatNumber(member.days_in_faction)}</td> : null}
          </tr>;
          })}</tbody>
        </table></div>
        {!visible.length ? <EmptyState text="No members to show" /> : null}
      </> : null}
    </>}
  </section>;
}
