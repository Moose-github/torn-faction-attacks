import React from "react";
import { Info } from "lucide-react";
import { getWarProgress, type WarSummary } from "../api";
import { CollapsiblePanel, EmptyState } from "./Common";
import { useCurrentTimeMs } from "../utils/time";
import { formatRelativeTime } from "../utils/format";
import {
  previewFinalScore, rankedFinishAt, rankedTargetAt, RANKED_WAR_MAX_HOURS,
  WAR_SCORE_INTERVAL_SECONDS, type WarProgressResponse, type WarScorePoint,
} from "../../../shared/warProgress";
import "./warProgress.css";

const number = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const date = (value: number) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(value * 1000) + " TCT";
const countdown = (seconds: number) => {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(minutes / 1440);
  return `${days > 0 ? `${days}d ` : ""}${Math.floor(minutes % 1440 / 60)}h ${minutes % 60}m`;
};

export function WarProgressPanel({ war }: { war: WarSummary }) {
  const [data, setData] = React.useState<WarProgressResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  // Null means untouched: initialize from the saved targets. Once edited,
  // drafts survive polling and collapsing, but not a refresh or war switch.
  const [homeDraft, setHomeDraft] = React.useState<string | null>(null);
  const [enemyDraft, setEnemyDraft] = React.useState<string | null>(null);
  const now = Math.floor(useCurrentTimeMs() / 1000);

  React.useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let completed = false;
    async function refresh() {
      if (inFlight || completed) return;
      inFlight = true;
      try {
        const response = await getWarProgress(war.name);
        if (!cancelled) {
          setData(response);
          setError(null);
          completed = response.war.official_end_time !== null || response.latest?.ended_at != null;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [war.name]);

  const record = data?.war ?? war;
  const latest = data?.latest ?? null;
  const endedAt = record.official_end_time ?? latest?.ended_at ?? null;
  const start = record.official_start_time ?? latest?.official_start_time ?? null;
  const original = latest?.original_target ?? null;
  const homeScore = endedAt ? record.official_home_score ?? latest?.home_score ?? null : latest?.home_score ?? record.official_home_score;
  const enemyScore = endedAt ? record.official_enemy_score ?? latest?.enemy_score ?? null : latest?.enemy_score ?? record.official_enemy_score;
  const homeName = latest?.home_name || "Our faction";
  const enemyName = latest?.enemy_name || war.name;
  const homeInput = homeDraft ?? (record.faction_respect_limit == null ? "" : String(record.faction_respect_limit));
  const enemyInput = enemyDraft ?? (record.enemy_target_respect == null ? "" : String(record.enemy_target_respect));
  const plannedHome = homeScore == null ? null : previewFinalScore(homeScore, homeInput);
  const plannedEnemy = enemyScore == null ? null : previewFinalScore(enemyScore, enemyInput);
  const valid = plannedHome !== null && plannedEnemy !== null;
  const currentLead = homeScore == null || enemyScore == null ? null : homeScore - enemyScore;
  const plannedLead = valid ? plannedHome - plannedEnemy : null;
  const currentFinish = start === null || currentLead === null ? null : rankedFinishAt(original, start, currentLead, now);
  const plannedFinish = start === null || plannedLead === null ? null : rankedFinishAt(original, start, plannedLead, now);
  const scheduled = start !== null && now < start;
  const stale = !endedAt && latest !== null && now - latest.observed_at > 5 * 60;
  const belowCurrent = (homeInput.trim() !== "" && homeScore != null && Number(homeInput) < homeScore) ||
    (enemyInput.trim() !== "" && enemyScore != null && Number(enemyInput) < enemyScore);
  const canDraw = start !== null && (latest !== null || Boolean(data?.history.length));
  const points = React.useMemo(() => {
    if (!data || !latest) return data?.history ?? [];
    const observed = Math.min(latest.observed_at, endedAt ?? latest.observed_at);
    if (observed < latest.official_start_time) return data.history;
    return [...data.history.filter((point) => point.observed_at < observed), {
      bucket_start: Math.floor(observed / WAR_SCORE_INTERVAL_SECONDS) * WAR_SCORE_INTERVAL_SECONDS,
      observed_at: observed, home_score: homeScore ?? latest.home_score,
      enemy_score: enemyScore ?? latest.enemy_score, target: latest.target,
    }];
  }, [data, latest, endedAt, homeScore, enemyScore]);

  return (
    <CollapsiblePanel title="War progress" collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}
      className="war-progress-panel" aside={endedAt ? "Completed" : latest ? `Updated ${formatRelativeTime(latest.observed_at)}` : undefined}>
      {!data && !error ? <EmptyState text="Loading war progress…" /> : null}
      {error ? <p className="war-progress-notice" role="status">Unable to refresh war progress. {latest ? "Showing the last recorded scores." : error}</p> : null}
      {data ? <>
        <div className="war-progress-scores">
          <div className="war-progress-home">
            <span className="war-progress-faction-name">{homeName}</span>
            <div className="war-progress-metrics">
              <div className="war-progress-current-score"><strong>{homeScore == null ? "—" : number(homeScore)}</strong><small>{endedAt ? "Final respect" : "Current respect"}</small></div>
              {!endedAt ? <label className="war-progress-target"><input type="number" min="0" step="any" value={homeInput}
                aria-label={`${homeName} target respect`} placeholder={homeScore == null ? "Not set" : number(homeScore)}
                aria-invalid={homeScore != null && plannedHome === null} onChange={(event) => setHomeDraft(event.target.value)} /><span>Target</span></label> : null}
            </div>
          </div>
          <div className="war-progress-enemy">
            <span className="war-progress-faction-name">{enemyName}</span>
            <div className="war-progress-metrics">
              {!endedAt ? <label className="war-progress-target"><input type="number" min="0" step="any" value={enemyInput}
                aria-label={`${enemyName} target respect`} placeholder={enemyScore == null ? "Not set" : number(enemyScore)}
                aria-invalid={enemyScore != null && plannedEnemy === null} onChange={(event) => setEnemyDraft(event.target.value)} /><span>Target</span></label> : null}
              <div className="war-progress-current-score"><strong>{enemyScore == null ? "—" : number(enemyScore)}</strong><small>{endedAt ? "Final respect" : "Current respect"}</small></div>
            </div>
          </div>
        </div>
        {!endedAt && homeScore != null && enemyScore != null && !valid ? <p className="war-progress-notice" role="alert">Enter non-negative target respect.</p> : null}
        {!endedAt && valid && belowCurrent ? <p className="war-progress-notice">Targets below current respect use the current score.</p> : null}
        {stale ? <p className="war-progress-notice">Scores have not updated for over five minutes. Finish times assume these last recorded scores.</p> : null}
        {scheduled ? <p className="war-progress-notice">War starts {date(start!)}.</p> : null}
        {canDraw && !scheduled ?
          <WarProgressChart points={points} start={start!} original={original} now={now} endedAt={endedAt}
            currentLead={currentLead} plannedLead={plannedLead} currentFinish={currentFinish} plannedFinish={plannedFinish}
            homeName={homeName} enemyName={enemyName} /> : null}
        {!latest && !endedAt ? <EmptyState text="Waiting for the next Torn score update. History begins when score collection starts." /> : null}
        {latest && original === null && !endedAt ? <p className="war-progress-notice">The original winning target is unavailable, so finish times cannot be calculated yet.</p> : null}
        {endedAt ? <div className="war-progress-finish"><div><small>War ended</small><strong>{date(endedAt)}</strong><span>{record.winner_faction_id ? `${record.winner_faction_id === record.enemy_faction_id ? enemyName : homeName} won` : "Final result recorded"}</span></div></div> :
          latest && !scheduled ? <div className="war-progress-finish">
            <FinishResult label="Current scores" finish={currentFinish} lead={currentLead} now={now} original={original} />
            <FinishResult label="Planned scores" finish={plannedFinish} lead={plannedLead} now={now} original={original} planned />
          </div> : null}
      </> : null}
    </CollapsiblePanel>
  );
}

function FinishResult({ label, finish, lead, now, original, planned = false }: {
  label: string; finish: number | null; lead: number | null; now: number; original: number | null;
  planned?: boolean;
}) {
  let title = "Unavailable", detail = "Waiting for score and target data";
  if (lead === null) { title = "—"; detail = "Enter valid targets when scores are available"; }
  else if (lead === 0) { title = "Tied scores"; detail = "No winning side projected"; }
  else if (original !== null && finish !== null) {
    title = finish <= now ? (planned ? "Target already low enough" : "Target already reached") : date(finish);
    detail = finish <= now ? (planned ? "Ends when those scores are reached" : "Awaiting Torn’s result") : `In ${countdown(finish - now)}`;
  }
  return <div className={planned ? "planned-result" : ""}><small><i />{label}</small><strong>{title}</strong><span>{detail}</span></div>;
}

function WarProgressChart({ points, start, original, now, endedAt, currentLead, plannedLead, currentFinish, plannedFinish, homeName, enemyName }: {
  points: WarScorePoint[]; start: number; original: number | null; now: number; endedAt: number | null;
  currentLead: number | null; plannedLead: number | null; currentFinish: number | null; plannedFinish: number | null;
  homeName: string; enemyName: string;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  const id = React.useId().replace(/:/g, "");
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 220, left = 62, right = 14, top = 26, bottom = height - 42;
  const endAt = endedAt ?? Math.max(now, currentFinish ?? now, plannedFinish ?? now);
  const duration = Math.max(3600, endAt - start);
  const endHours = endedAt ? duration / 3600 : Math.max((now - start) / 3600, Math.min(RANKED_WAR_MAX_HOURS, duration / 3600 + 8));
  const end = start + endHours * 3600;
  const values = points.flatMap((point) => [point.home_score - point.enemy_score, point.target]);
  const limit = Math.max(1, original ?? 0, ...values.map(Math.abs), Math.abs(currentLead ?? 0), endedAt ? 0 : Math.abs(plannedLead ?? 0));
  const max = limit * 1.12;
  const x = (at: number) => left + 6 + (at - start) / (end - start) * (width - left - right - 12);
  const y = (score: number) => top + (max - score) / (2 * max) * (bottom - top);
  const boundaries = original !== null ? [1, -1].map((sign) => {
    let path = `M ${x(start)} ${y(sign * original)}`;
    for (let hour = 1; hour <= Math.floor(endHours); hour++) path += ` H ${x(start + hour * 3600)} V ${y(sign * rankedTargetAt(original, start, start + hour * 3600))}`;
    return path + ` H ${x(end)}`;
  }) : [];
  const segments: string[] = [];
  const gaps: Array<[number, number]> = [];
  let previous: WarScorePoint | undefined;
  for (const point of points) {
    if (point.observed_at < start || point.observed_at > end) continue;
    const gap = previous && point.bucket_start - previous.bucket_start > WAR_SCORE_INTERVAL_SECONDS;
    if (gap) gaps.push([previous!.observed_at, point.observed_at]);
    if (!previous || gap) segments.push(`M ${x(point.observed_at)} ${y(point.home_score - point.enemy_score)}`);
    else segments[segments.length - 1] += ` H ${x(point.observed_at)} V ${y(point.home_score - point.enemy_score)}`;
    previous = point;
  }
  if (points.length && points[0].observed_at > start + WAR_SCORE_INTERVAL_SECONDS) gaps.unshift([start, points[0].observed_at]);
  if (previous && endAt - previous.observed_at > 2 * WAR_SCORE_INTERVAL_SECONDS) gaps.push([previous.observed_at, Math.min(endAt, now)]);
  const tickStep = width < 430 ? Math.max(1, Math.ceil(endHours / 3)) : Math.max(1, Math.ceil(endHours / 6));
  const ticks = Array.from({ length: Math.floor(endHours / tickStep) + 1 }, (_, index) => index * tickStep);
  const compact = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(value));
  const scenarios = endedAt ? [] : [
    { score: currentLead, finish: currentFinish, planned: false },
    { score: plannedLead, finish: plannedFinish, planned: true },
  ];
  const leadLabel = (lead: number | null) => lead === null ? "Lead unavailable" : lead === 0 ? "Scores tied" : `${lead > 0 ? homeName : enemyName} leads by ${number(Math.abs(lead))} respect`;
  return <div ref={container} className="war-progress-chart">
    <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`War net score over time. ${homeName} above zero, ${enemyName} below zero.${endedAt ? " Final recorded history." : " Dotted lines hold current and planned scores unchanged."}`}>
      <defs>
        <linearGradient id={`${id}-home`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--war-progress-home)" stopOpacity=".26" /><stop offset="100%" stopColor="var(--panel-muted-bg)" /></linearGradient>
        <linearGradient id={`${id}-enemy`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--panel-muted-bg)" /><stop offset="100%" stopColor="var(--war-progress-enemy)" stopOpacity=".28" /></linearGradient>
        <pattern id={`${id}-gap`} width="7" height="7" patternUnits="userSpaceOnUse"><path d="M 0 7 L 7 0" stroke="var(--chart-grid)" strokeWidth="1" /></pattern>
        <clipPath id={`${id}-clip`}><rect x={left} y={top} width={width - left - right} height={bottom - top} /></clipPath>
      </defs>
      <rect x={left} y={top} width={width - left - right} height={y(0) - top} fill={`url(#${id}-home)`} />
      <rect x={left} y={y(0)} width={width - left - right} height={bottom - y(0)} fill={`url(#${id}-enemy)`} />
      {[limit, limit / 2, 0, -limit / 2, -limit].map((value) => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="progress-grid" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>)}
      {ticks.map((hour) => <g key={hour}><line x1={x(start + hour * 3600)} x2={x(start + hour * 3600)} y1={top} y2={bottom} className="progress-grid" /><text x={x(start + hour * 3600)} y={bottom + 19} textAnchor={hour === 0 ? "start" : "middle"}>{hour}</text></g>)}
      <text x={(left + width - right) / 2} y={height - 5} textAnchor="middle">Hours since start</text>
      <g clipPath={`url(#${id}-clip)`}>
        {gaps.map(([from, to], index) => <rect key={index} x={x(from)} y={top} width={Math.max(0, x(to) - x(from))} height={bottom - top} fill={`url(#${id}-gap)`}><title>No score history recorded for this period</title></rect>)}
        {boundaries.map((d, index) => <path key={index} d={d} className={index ? "enemy-boundary" : "home-boundary"} />)}
        {width > 520 ? <><text x={x(start + Math.min(20, endHours / 4) * 3600)} y={y(limit * .67)} textAnchor="middle" className="progress-team">{homeName}</text><text x={x(start + Math.min(20, endHours / 4) * 3600)} y={y(-limit * .65)} textAnchor="middle" className="progress-team">{enemyName}</text></> : null}
        {segments.map((d, index) => <path key={index} d={d} className="progress-score" />)}
        {points.map((point) => <circle key={point.observed_at} cx={x(point.observed_at)} cy={y(point.home_score - point.enemy_score)} r={2} className="progress-point"><title>{date(point.observed_at)} · {number(point.home_score)} vs {number(point.enemy_score)}</title></circle>)}
        {!endedAt ? <line x1={x(now)} x2={x(now)} y1={top} y2={bottom} className="progress-now" /> : null}
        {scenarios.map(({ score, finish, planned }) => score === null || original === null ? null : <g key={String(planned)} className={planned ? "progress-planned" : "progress-current"}>
          <line x1={x(now)} x2={x(finish === null ? end : Math.max(finish, Math.min(end, now + 3600)))} y1={y(score)} y2={y(score)} className="progress-held" />
          {finish !== null ? <><line x1={x(finish)} x2={x(finish)} y1={y(score)} y2={bottom} className="progress-finish-guide" />
            {planned ? <rect x={x(finish) - 4} y={y(score) - 4} width="8" height="8" className="progress-marker"><title>{leadLabel(score)} · {date(finish)}</title></rect> : <circle cx={x(finish)} cy={y(score)} r="5" className="progress-marker"><title>{leadLabel(score)} · {date(finish)}</title></circle>}
          </> : null}
        </g>)}
      </g>
      <rect x={left} y={top} width={width - left - right} height={bottom - top} fill="none" stroke="var(--border-solid)" />
      {!endedAt ? <text x={x(now)} y={16} textAnchor="middle">Now</text> : null}
    </svg>
    <div className="war-progress-legend">
      <span title={leadLabel(currentLead)}><i />Actual</span>
      {!endedAt ? <><span title={leadLabel(currentLead)}><i className="current" />Current</span><span title={leadLabel(plannedLead)}><i className="planned" />Planned</span></> : null}
      {gaps.length ? <details className="war-progress-history-note"><summary aria-label="Score history information" title="Score history information"><Info size={14} aria-hidden="true" /></summary><small>Hatched areas have no recorded score history.</small></details> : null}
    </div>
  </div>;
}
