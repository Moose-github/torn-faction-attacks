import React from "react";
import { ArrowDown, ArrowUp, Candy, Flag, RefreshCw, Shield } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WarSummary } from "../api";
import { getEventCompetition, updateEliminationTeamStatus, type CompetitionMember, type EventCompetition } from "../api/competition";
import { EmptyState, PanelHeader } from "./Common";
import { formatDate, formatLongDateTime, formatNumber } from "../utils/format";
import { eliminationRowStatus } from "../utils/eventCompetition";
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
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      const startedRevision = revision.current;
      try {
        const response = await getEventCompetition(war.name);
        if (!cancelled && revision.current === startedRevision) setResult({ name: war.name, data: response.competition, error: null });
      } catch {
        if (!cancelled && revision.current === startedRevision) setResult(previous => ({ name: war.name, data: previous.name === war.name ? previous.data : null, error: "Competition data could not be loaded" }));
      } finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
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

export function EventCompetitionPanel({ war, data, error, compact = false }: {
  war: WarSummary; data: EventCompetition | null; error: string | null; compact?: boolean;
}) {
  const halloween = war.event_type === "halloween";
  const [team, setTeam] = React.useState("all");
  const [sort, setSort] = React.useState<{ key: "name" | "team" | "treats" | "eliminated"; descending: boolean }>({ key: halloween ? "treats" : "eliminated", descending: halloween });
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
    if (halloween && sort.key === "treats") {
      if (a.treats_gained === null) return b.treats_gained === null ? a.member_name.localeCompare(b.member_name) : 1;
      if (b.treats_gained === null) return -1;
      return (sort.descending ? -1 : 1) * (a.treats_gained - b.treats_gained) || a.member_name.localeCompare(b.member_name);
    }
    return (sort.descending && sort.key === "name" ? -1 : 1) * a.member_name.localeCompare(b.member_name);
  });
  const observed = members.filter(member => halloween ? member.baseline_at !== null : member.captured_at !== null).length;
  const incomplete = members.filter(member => ["incomplete", "stale", "unavailable"].includes(member.status)).length;
  const lastUpdate = Math.max(0, ...members.map(member => member.updated_at ?? 0));
  const baselines = members.flatMap(member => member.baseline_at === null ? [] : [member.baseline_at]);
  const firstBaseline = baselines.length ? Math.min(...baselines) : null;
  function changeSort(key: "name" | "team" | "treats" | "eliminated") {
    setSort(current => ({ key, descending: current.key === key ? !current.descending : key === "treats" }));
  }
  const sortIcon = (key: "name" | "team" | "treats" | "eliminated") => sort.key !== key ? null : sort.descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />;
  return <section className="panel event-competition-panel">
    <PanelHeader icon={halloween ? <Candy size={17} /> : <Flag size={17} />}
      title={halloween ? "Halloween treats" : "Elimination participation"}
      aside={halloween ? `Every ${data?.refresh_hours ?? war.competition_refresh_hours ?? 6} hours` : "Captured once"} />
    {error ? <p className="event-competition-warning" role="status">{error}</p> : null}
    {!data ? <EmptyState text={error ? "Data unavailable" : "Loading competition data"} /> : data.initialized_at === null ? (
      <EmptyState text={war.status === "scheduled" ? "Collection starts with the event" : war.status === "ended" ? "No competition snapshots saved for this event" : "Awaiting initial collection"} />
    ) : <>
      <div className="event-competition-summary">
        {halloween ? <div><span>Treats gained</span><strong>{data.total_treats_gained === null ? "Unavailable" : formatNumber(data.total_treats_gained)}</strong></div>
          : <div><span>Participating</span><strong>{members.filter(member => member.participation === "participating").length}</strong></div>}
        <div><span>Members captured</span><strong>{observed} / {members.length}</strong></div>
        {!halloween ? <div><span>Not participating</span><strong>{members.filter(member => member.participation === "not_participating").length}</strong></div> : null}
        <div><span>{halloween && firstBaseline !== null ? "Tracked since" : "Collection started"}</span><span>{formatLongDateTime(firstBaseline ?? data.initialized_at)}</span></div>
        <div><span>Last reading</span><span>{lastUpdate ? formatLongDateTime(lastUpdate) : "Awaiting data"}</span></div>
        {halloween && war.status === "active" && data.next_refresh_at ? <div><span>Next collection</span><span>{formatLongDateTime(data.next_refresh_at)}</span></div> : null}
      </div>
      {incomplete ? <p className="event-competition-warning">{incomplete} member {incomplete === 1 ? "reading is" : "readings are"} incomplete or unavailable. Totals use the last valid readings.</p> : null}
      {members.some(member => member.status === "finishing") ? <p className="event-competition-note"><RefreshCw size={14} /> Final collection pending</p> : null}
      {halloween && war.practical_finish_time !== null && lastUpdate > war.practical_finish_time ? <p className="event-competition-warning">Final readings were collected after the event finish and may include later treats.</p> : null}
      {compact && !halloween ? <div className="event-team-counts">{teams.map(name => <div key={name}><span>{name}</span><strong>{members.filter(member => competitionTeam(member) === name).length}</strong></div>)}</div> : null}
      {!compact && halloween && data.history.length > 1 ? <div className="event-treat-chart" aria-label="Treats gained over time">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data.history} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="observed_at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => formatDate(value)} minTickGap={50} tick={{ fontSize: 12, fill: "var(--chart-axis)" }} />
          <YAxis allowDecimals={false} width={55} tick={{ fontSize: 12, fill: "var(--chart-axis)" }} />
          <Tooltip labelFormatter={value => formatLongDateTime(Number(value))} formatter={value => [formatNumber(Number(value)), "Treats gained"]} />
          <Line dataKey="treats_gained" type="stepAfter" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>
      </div> : null}
      {!compact ? <>
        {!halloween ? <label className="event-team-filter"><span>Team</span><select value={team} onChange={event => setTeam(event.target.value)}>
          <option value="all">All members</option>{teams.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label> : null}
        <div className="table-scroll"><table className="event-competition-table">
          <thead><tr>
            <th aria-sort={sort.key === "name" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("name")}>Member {sortIcon("name")}</button></th>
            {halloween ? <><th aria-sort={sort.key === "treats" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("treats")}>Treats gained {sortIcon("treats")}</button></th><th>Basket</th><th>Baseline captured</th></> : <th aria-sort={sort.key === "team" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("team")}>Team {sortIcon("team")}</button></th>}
            {halloween ? <th>Last reading</th> : <th aria-sort={sort.key === "eliminated" ? sort.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => changeSort("eliminated")}>Eliminated {sortIcon("eliminated")}</button></th>}<th>Status</th>
          </tr></thead>
          <tbody>{visible.map(member => <tr key={member.member_id}
            className={eliminationRowStatus(data, member) ? "event-inactive-row" : undefined}>
            <td><a className="member-link" href={`https://www.torn.com/profiles.php?XID=${member.member_id}`} target="_blank" rel="noreferrer">{member.member_name}</a></td>
            {halloween ? <><td>{member.treats_gained === null ? "Unavailable" : formatNumber(member.treats_gained)}</td><td>{member.basket_name ?? "Unavailable"}</td><td>{member.baseline_at ? formatLongDateTime(member.baseline_at) : "Awaiting baseline"}</td></> : <td>{competitionTeam(member)}</td>}
            {halloween ? <td>{member.updated_at ? formatLongDateTime(member.updated_at) : "Awaiting data"}</td>
              : <td>{eliminationRowStatus(data, member) === "Eliminated" ? "Yes" : member.participation === "participating" ? "No" : "-"}</td>}
            <td title={member.last_error ?? undefined}>{eliminationRowStatus(data, member) ?? (member.status === "complete" ? "Captured" : member.status === "tracking" ? "Tracking" : member.status === "pending" ? "Pending" : member.status === "finishing" ? "Final pending" : member.status === "stale" ? "Stale" : member.status === "incomplete" ? "Incomplete" : "Unavailable")}</td>
          </tr>)}</tbody>
        </table></div>
        {!visible.length ? <EmptyState text="No members to show" /> : null}
      </> : null}
    </>}
  </section>;
}
