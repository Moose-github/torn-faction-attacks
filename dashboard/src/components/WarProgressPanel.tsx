import { startPolling, type PollContext } from "../utils/polling";
import React from "react";
import { Info } from "lucide-react";
import { getWarProgress, type WarSummary } from "../api";
import { CollapsiblePanel, EmptyState } from "./Common";
import { WarTargetOffsetControl } from "./WarTargetOffsetControl";
import { useCurrentTimeMs } from "../utils/time";
import { formatRelativeTime } from "../utils/format";
import {
  previewFinalScore, previewTargetsForLead, rankedFinishAt, rankedTargetAt, RANKED_WAR_MAX_HOURS,
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
const warLength = (seconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days} day${days === 1 ? "" : "s"}` : "",
    hours || !days && !minutes ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
};
const warEndDate = (value: number) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(value * 1000) + " TCT";

export function WarProgressPanel({ war, requireHistory = false, showCompletedResult = true }: {
  war: WarSummary; requireHistory?: boolean; showCompletedResult?: boolean;
}) {
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
    async function refresh({ signal, isCurrent }: PollContext) {
      try {
        const response = await getWarProgress(war.name, signal);
        if (isCurrent() && !cancelled) {
          setData(response);
          setError(null);
          if (response.war.official_end_time !== null || response.latest?.ended_at != null) return false as const;
        }
      } catch (err) {
        if (isCurrent() && !cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    const poll = startPolling(refresh, { intervalMs: 60_000 });
    return () => { cancelled = true; poll.stop(); };
  }, [war.name, war.status, war.official_start_time, war.official_end_time, war.practical_revision]);

  const record = data?.war ?? war;
  const latest = data?.latest ?? null;
  const endedAt = war.official_end_time ?? record.official_end_time ?? latest?.ended_at ?? null;
  const start = record.official_start_time ?? latest?.official_start_time ?? null;
  const scheduled = start !== null && now < start;
  const original = latest?.original_target ?? null;
  const homeScore = endedAt ? record.official_home_score ?? latest?.home_score ?? null : latest?.home_score ?? record.official_home_score ?? (scheduled ? 0 : null);
  const enemyScore = endedAt ? record.official_enemy_score ?? latest?.enemy_score ?? null : latest?.enemy_score ?? record.official_enemy_score ?? (scheduled ? 0 : null);
  const homeName = latest?.home_name || "Our faction";
  const enemyName = latest?.enemy_name || war.name;
  const savedHomeInput = record.faction_respect_limit == null ? (scheduled ? "0" : "") : String(record.faction_respect_limit);
  const savedEnemyInput = record.enemy_target_respect == null ? (scheduled ? "0" : "") : String(record.enemy_target_respect);
  const homeInput = homeDraft ?? savedHomeInput;
  const enemyInput = enemyDraft ?? savedEnemyInput;
  const targetsChanged = homeInput !== savedHomeInput || enemyInput !== savedEnemyInput;
  const plannedHome = homeScore == null ? null : previewFinalScore(homeScore, homeInput);
  const plannedEnemy = enemyScore == null ? null : previewFinalScore(enemyScore, enemyInput);
  const valid = plannedHome !== null && plannedEnemy !== null;
  const currentLead = homeScore == null || enemyScore == null ? null : homeScore - enemyScore;
  const plannedLead = valid ? plannedHome - plannedEnemy : null;
  const currentFinish = start === null || currentLead === null ? null : rankedFinishAt(original, start, currentLead, now);
  const plannedFinish = start === null || plannedLead === null ? null : rankedFinishAt(original, start, plannedLead, now);
  const displayedFinish = endedAt ?? plannedFinish;
  const stale = !endedAt && latest !== null && now - latest.observed_at > 5 * 60;
  const belowCurrent = (homeInput.trim() !== "" && homeScore != null && Number(homeInput) < homeScore) ||
    (enemyInput.trim() !== "" && enemyScore != null && Number(enemyInput) < enemyScore);
  const canDraw = start !== null && (scheduled || latest !== null || Boolean(data?.history.length));
  const showScoreFinishes = !endedAt && latest !== null && !scheduled;
  const canAdjustTargets = canDraw && !endedAt && homeScore !== null && enemyScore !== null && plannedHome !== null && plannedEnemy !== null;
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

  // Recorded war pages only show the panel once saved score history is available.
  if (requireHistory && (!canDraw || !data?.history.length)) return null;

  const progressStatus = endedAt ? "Completed" : latest ? `Updated ${formatRelativeTime(latest.observed_at)}` : undefined;
  return (
    <CollapsiblePanel title="War progress" collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}
      className="war-progress-panel" aside={progressStatus}>
      {!data && !error ? <EmptyState text="Loading war progress…" /> : null}
      {error ? <p className="war-progress-notice" role="status">Unable to refresh war progress. {latest ? "Showing the last recorded scores." : error}</p> : null}
      {data ? <>
        <div className={`war-progress-scores${canAdjustTargets ? " war-progress-scores-with-control" : ""}`}>
          <div className="war-progress-home">
            <span className="war-progress-faction-name">{homeName}</span>
            <div className="war-progress-metrics">
              <div className="war-progress-current-score"><strong>{homeScore == null ? "—" : number(homeScore)}</strong><small>{endedAt ? "Final respect" : "Current respect"}</small></div>
              {!endedAt ? <label className="war-progress-target"><input type="number" min="0" step="any" value={homeInput}
                aria-label={`${homeName} target respect`} placeholder={homeScore == null ? "Not set" : number(homeScore)}
                aria-invalid={homeScore != null && plannedHome === null} onChange={(event) => setHomeDraft(event.target.value)} /><span>Target</span></label> : null}
            </div>
          </div>
          {canAdjustTargets ?
            <WarTargetOffsetControl homeScore={homeScore!} enemyScore={enemyScore!} plannedHome={plannedHome!} plannedEnemy={plannedEnemy!}
              onChange={(home, enemy) => { setHomeDraft(String(home)); setEnemyDraft(String(enemy)); }} /> : null}
          <div className="war-progress-enemy">
            <span className="war-progress-faction-name">{enemyName}</span>
            <div className="war-progress-metrics">
              {!endedAt ? <label className="war-progress-target"><input type="number" min="0" step="any" value={enemyInput}
                aria-label={`${enemyName} target respect`} placeholder={enemyScore == null ? "Not set" : number(enemyScore)}
                aria-invalid={enemyScore != null && plannedEnemy === null} onChange={(event) => setEnemyDraft(event.target.value)} /><span>Target</span></label> : null}
              <div className="war-progress-current-score"><strong>{enemyScore == null ? "—" : number(enemyScore)}</strong><small>{endedAt ? "Final respect" : "Current respect"}</small></div>
            </div>
          </div>
          {war.war_type === "termed" && !endedAt && targetsChanged ?
            <button type="button" className="panel-action-button war-progress-target-reset" title="Restore the saved targets for both factions"
              onClick={() => { setHomeDraft(null); setEnemyDraft(null); }}>Reset targets</button> : null}
        </div>
        {!endedAt && homeScore != null && enemyScore != null && !valid ? <p className="war-progress-notice" role="alert">Enter non-negative target respect.</p> : null}
        {!endedAt && valid && belowCurrent ? <p className="war-progress-notice">Targets below current respect use the current score.</p> : null}
        {stale ? <p className="war-progress-notice">Scores have not updated for over five minutes. Finish times assume these last recorded scores.</p> : null}
        {scheduled ? <p className="war-progress-notice">War starts {date(start!)}.</p> : null}
        {canDraw ?
          <WarProgressChart points={points} start={start!} original={original} now={now} endedAt={endedAt}
            currentLead={currentLead} plannedLead={plannedLead} currentFinish={currentFinish} plannedFinish={plannedFinish}
            homeScore={homeScore ?? null} enemyScore={enemyScore ?? null} plannedHome={plannedHome} plannedEnemy={plannedEnemy}
            onTargetsChange={(home, enemy) => { setHomeDraft(String(home)); setEnemyDraft(String(enemy)); }}
            homeName={homeName} enemyName={enemyName} /> : null}
        {canDraw && !showScoreFinishes ? <dl className="war-progress-timing" aria-label={endedAt ? "Recorded war timing" : "Planned war timing"}>
          <div><dt>War length:</dt><dd>{displayedFinish !== null && start !== null ? warLength(displayedFinish - start) : "—"}</dd></div>
          <div><dt>War end:</dt><dd>{displayedFinish !== null ? warEndDate(displayedFinish) : plannedLead === 0 ? "No winning side" : "Unavailable"}</dd></div>
        </dl> : null}
        {!latest && !endedAt ? <EmptyState text="Waiting for the next Torn score update. History begins when score collection starts." /> : null}
        {latest && original === null && !endedAt ? <p className="war-progress-notice">The original winning target is unavailable, so finish times cannot be calculated yet.</p> : null}
        {endedAt && showCompletedResult ? <div className="war-progress-finish"><div><small>War ended</small><strong>{date(endedAt)}</strong><span>{record.winner_faction_id ? `${record.winner_faction_id === record.enemy_faction_id ? enemyName : homeName} won` : "Final result recorded"}</span></div></div> : null}
        {showScoreFinishes ? <div className="war-progress-finish">
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

type ProgressTooltip = {
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  x: number;
  y: number;
  pointIndex?: number;
  marker?: { x: number; y: number; planned?: boolean; color: string };
};

function WarProgressChart({ points, start, original, now, endedAt, currentLead, plannedLead, currentFinish, plannedFinish, homeName, enemyName, homeScore, enemyScore, plannedHome, plannedEnemy, onTargetsChange }: {
  points: WarScorePoint[]; start: number; original: number | null; now: number; endedAt: number | null;
  currentLead: number | null; plannedLead: number | null; currentFinish: number | null; plannedFinish: number | null;
  homeName: string; enemyName: string;
  homeScore: number | null; enemyScore: number | null; plannedHome: number | null; plannedEnemy: number | null;
  onTargetsChange: (home: number, enemy: number) => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const svgElement = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ pointerId: number; startY: number; lead: number; homeTarget: number; enemyTarget: number; respectPerPixel: number; minimum: number; maximum: number; moved: boolean } | null>(null);
  // Keep the line under the pointer while its changing score recalculates the finish.
  const [dragScale, setDragScale] = React.useState<{ limit: number; endHours: number } | null>(null);
  const tooltipElement = React.useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = React.useState<ProgressTooltip | null>(null);
  const [tooltipSize, setTooltipSize] = React.useState({ width: 280, height: 170 });
  const [width, setWidth] = React.useState(600);
  const id = React.useId().replace(/:/g, "");
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, entry.contentRect.width));
      setTooltip(null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useLayoutEffect(() => {
    if (!tooltipElement.current) return;
    const { width, height } = tooltipElement.current.getBoundingClientRect();
    setTooltipSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
  }, [tooltip]);
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setTooltip(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const height = width < 430 ? 290 : 330, left = 62, right = 14, top = 30, bottom = height - 46;
  const scheduled = now < start;
  const scenarioStart = Math.max(start, now);
  const endAt = endedAt ?? Math.max(now, currentFinish ?? now, plannedFinish ?? now);
  const duration = Math.max(3600, endAt - start);
  const endHours = dragScale?.endHours ?? (endedAt ? duration / 3600 : scheduled ? RANKED_WAR_MAX_HOURS : Math.max((now - start) / 3600, Math.min(RANKED_WAR_MAX_HOURS, duration / 3600 + 8)));
  const end = start + endHours * 3600;
  const values = points.flatMap((point) => [point.home_score - point.enemy_score, point.target]);
  const limit = dragScale?.limit ?? Math.max(1, original ?? 0, ...values.map(Math.abs), Math.abs(currentLead ?? 0), endedAt ? 0 : Math.abs(plannedLead ?? 0));
  const max = limit * 1.12;
  const canDrag = !endedAt && original !== null && homeScore !== null && enemyScore !== null && plannedHome !== null && plannedEnemy !== null;
  const minimumLead = Math.max(-Math.floor(max), (homeScore ?? 0) - Number.MAX_SAFE_INTEGER);
  const maximumLead = Math.min(Math.floor(max), Number.MAX_SAFE_INTEGER - (enemyScore ?? 0));
  React.useEffect(() => {
    if (!canDrag && drag.current) stopDrag();
  }, [canDrag]);
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
  const leadValue = (lead: number | null) => lead === null ? "Unavailable" : lead === 0 ? "Tied" : `${number(Math.abs(lead))} · ${lead > 0 ? homeName : enemyName}`;
  function showPoint(index: number, pointer?: { x: number; y: number }) {
    const point = points[index];
    if (!point) return;
    const marker = { x: x(point.observed_at), y: y(point.home_score - point.enemy_score), color: "var(--war-progress-home)" };
    setTooltip({ title: date(point.observed_at), pointIndex: index, x: pointer?.x ?? marker.x, y: pointer?.y ?? marker.y, marker, rows: [
      { label: homeName, value: number(point.home_score), color: "var(--war-progress-home)" },
      { label: enemyName, value: number(point.enemy_score), color: "var(--war-progress-enemy)" },
    ] });
  }
  function showScenario(scenario: typeof scenarios[number], pointer?: { x: number; y: number }) {
    const { score, finish, planned } = scenario;
    const marker = score !== null && finish !== null ? {
      x: x(finish), y: y(score), planned, color: planned ? "var(--war-progress-plan)" : "var(--text-main)",
    } : undefined;
    setTooltip({ title: planned ? "Planned scores" : "Current scores", x: pointer?.x ?? marker?.x ?? x(scenarioStart), y: pointer?.y ?? marker?.y ?? top, marker, rows: [
      { label: "Net lead", value: leadValue(score) },
      { label: "Finish", value: finish === null ? (score === 0 ? "No winning side" : "Unavailable") : finish <= now ? (planned ? "Target already low enough" : "Target already reached") : date(finish) },
    ] });
  }
  function hoverChart(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current) { moveDrag(event); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height };
    if (pointer.x < left || pointer.x > width - right || pointer.y < top || pointer.y > bottom) { setTooltip(null); return; }
    if (event.target instanceof Element) {
      const scenarioType = event.target.getAttribute("data-scenario");
      const scenario = scenarios.find(({ planned }) => scenarioType === (planned ? "planned" : "current"));
      if (scenario) { showScenario(scenario, pointer); return; }
      const pointIndex = event.target.getAttribute("data-point-index");
      if (pointIndex !== null) { showPoint(Number(pointIndex), pointer); return; }
    }
    const at = start + (pointer.x - left - 6) / (width - left - right - 12) * (end - start);
    const gap = gaps.find(([from, to]) => at > from && at < to);
    // Keep the actual endpoint selectable where it meets the forecast, including
    // a small allowance for rounding pointer coordinates at either end of the line.
    const endpoint = [0, points.length - 1].find((index) => {
      const point = points[index];
      return point && Math.hypot(pointer.x - x(point.observed_at), pointer.y - y(point.home_score - point.enemy_score)) <= 6;
    });
    if (endpoint !== undefined) { showPoint(endpoint, pointer); return; }
    if (!gap && points.length && at >= points[0].observed_at && at <= points[points.length - 1].observed_at) {
      // A horizontal step holds the preceding recorded scores, never the next
      // observation's scores. The tooltip timestamp identifies that recording.
      const next = points.findIndex((point) => point.observed_at > at);
      showPoint(next === -1 ? points.length - 1 : next - 1, pointer);
      return;
    }
    if (gap) {
      setTooltip({ title: "No recorded score history", ...pointer, rows: [{ label: "From", value: date(gap[0]) }, { label: "To", value: date(gap[1]) }] });
      return;
    }
    setTooltip(null);
  }
  function startDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    if (event.pointerType === "mouse") event.preventDefault();
    hoverChart(event);
    if (!canDrag || !(event.target instanceof Element) || !event.target.closest("[data-plan-drag]")) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, startY: event.clientY, lead: plannedLead!, homeTarget: plannedHome!, enemyTarget: plannedEnemy!,
      respectPerPixel: 2 * max / (bottom - top) * height / bounds.height, minimum: minimumLead, maximum: maximumLead, moved: false };
    setDragScale({ limit, endHours });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !canDrag) return;
    const delta = active.startY - event.clientY;
    // Clicking a marker, or grabbing the wider touch area, must not move the line.
    if (!active.moved && Math.abs(delta) < 3) return;
    active.moved = true;
    setTooltip(null);
    const lead = Math.max(active.minimum, Math.min(active.maximum, Math.round(active.lead + delta * active.respectPerPixel)));
    const targets = previewTargetsForLead(homeScore!, enemyScore!, active.homeTarget, active.enemyTarget, lead);
    onTargetsChange(targets.home, targets.enemy);
  }
  function stopDrag() {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setDragScale(null);
    if (svgElement.current?.hasPointerCapture(active.pointerId)) svgElement.current.releasePointerCapture(active.pointerId);
  }
  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    moveDrag(event);
    stopDrag();
  }
  function adjustPlan(event: React.KeyboardEvent<SVGGElement>) {
    if (!canDrag || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 1000 : 100;
    const lead = Math.max(minimumLead, Math.min(maximumLead, event.key === "Home" ? minimumLead : event.key === "End" ? maximumLead : plannedLead! + (event.key === "ArrowUp" ? step : -step)));
    const targets = previewTargetsForLead(homeScore!, enemyScore!, plannedHome!, plannedEnemy!, lead);
    onTargetsChange(targets.home, targets.enemy);
    showScenario({ score: lead, finish: rankedFinishAt(original, start, lead, now), planned: true });
  }
  function legendPointer(event: React.PointerEvent<HTMLElement>) {
    const bounds = container.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: height - 12 };
  }
  function clearPointerTooltip(event: React.PointerEvent) {
    if (!drag.current && event.pointerType !== "touch") setTooltip(null);
  }
  const tooltipLeft = tooltip ? Math.max(4, Math.min(width - tooltipSize.width - 4, tooltip.x + 12 + tooltipSize.width <= width - 4 ? tooltip.x + 12 : tooltip.x - tooltipSize.width - 12)) : 0;
  const tooltipTop = tooltip ? Math.max(4, Math.min(height - tooltipSize.height - 4, tooltip.y + 12 + tooltipSize.height <= height - 4 ? tooltip.y + 12 : tooltip.y - tooltipSize.height - 12)) : 0;
  return <div ref={container} className="war-progress-chart" onPointerLeave={clearPointerTooltip}
    onKeyDown={(event) => { if (event.key === "Escape") setTooltip(null); }}>
    <svg ref={svgElement} viewBox={`0 0 ${width} ${height}`} height={height} role="group" tabIndex={0} className={dragScale ? "progress-dragging" : undefined}
      aria-label={`War net score over time. ${homeName} above zero, ${enemyName} below zero.${endedAt ? " Final recorded history." : " Dotted lines hold current and planned scores unchanged."} Use left and right arrow keys to inspect score history.`}
      aria-describedby={tooltip ? `${id}-tooltip` : undefined}
      onPointerMove={hoverChart} onPointerDown={startDrag} onPointerUp={endDrag}
      onPointerCancel={(event) => { if (!drag.current || drag.current.pointerId === event.pointerId) { stopDrag(); setTooltip(null); } }} onLostPointerCapture={stopDrag}
      onPointerLeave={clearPointerTooltip}
      onFocus={(event) => { if (event.target === event.currentTarget && !tooltip) showPoint(points.length - 1); }} onBlur={() => setTooltip(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { stopDrag(); setTooltip(null); return; }
        if (event.target !== event.currentTarget) return;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
        event.preventDefault();
        const index = tooltip?.pointIndex ?? points.length - 1;
        showPoint(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
      }}>
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
        {gaps.map(([from, to], index) => <rect key={index} x={x(from)} y={top} width={Math.max(0, x(to) - x(from))} height={bottom - top} fill={`url(#${id}-gap)`} />)}
        {boundaries.map((d, index) => <path key={index} d={d} className={index ? "enemy-boundary" : "home-boundary"} />)}
        {width > 520 ? <><text x={x(start + Math.min(20, endHours / 4) * 3600)} y={y(limit * .67)} textAnchor="middle" className="progress-team">{homeName}</text><text x={x(start + Math.min(20, endHours / 4) * 3600)} y={y(-limit * .65)} textAnchor="middle" className="progress-team">{enemyName}</text></> : null}
        {segments.map((d, index) => <path key={index} d={d} className="progress-score" />)}
        {points.map((point, index) => <circle key={point.observed_at} data-point-index={index} cx={x(point.observed_at)} cy={y(point.home_score - point.enemy_score)} r={2} className="progress-point" />)}
        {!endedAt && !scheduled ? <line x1={x(now)} x2={x(now)} y1={top} y2={bottom} className="progress-now" /> : null}
        {canDrag ? <line x1={x(scenarioStart)} x2={x(plannedFinish === null ? end : Math.max(plannedFinish, Math.min(end, scenarioStart + 3600)))} y1={y(plannedLead!)} y2={y(plannedLead!)} className="progress-plan-hit" data-plan-drag="true" /> : null}
        {scenarios.map(({ score, finish, planned }) => score === null ? null : <g key={String(planned)} className={planned ? "progress-planned" : "progress-current"}
          tabIndex={planned && canDrag ? 0 : undefined} role={planned && canDrag ? "slider" : undefined}
          aria-label={planned && canDrag ? "Planned net respect lead" : undefined}
          aria-orientation={planned && canDrag ? "vertical" : undefined}
          aria-valuemin={planned && canDrag ? minimumLead : undefined} aria-valuemax={planned && canDrag ? maximumLead : undefined}
          aria-valuenow={planned && canDrag ? plannedLead! : undefined}
          aria-valuetext={planned && canDrag ? leadValue(plannedLead) : undefined}
          aria-description={planned && canDrag ? `Drag up to favour ${homeName} or down to favour ${enemyName}. Targets stay at or above current scores. Arrow keys change the lead by 100; hold Shift for 1,000.` : undefined}
          onKeyDown={planned ? adjustPlan : undefined}
          onFocus={(event) => { if (planned && event.target === event.currentTarget) showScenario({ score, finish, planned }); }}
          onBlur={() => setTooltip(null)}>
          <line x1={x(scenarioStart)} x2={x(finish === null ? end : Math.max(finish, Math.min(end, scenarioStart + 3600)))} y1={y(score)} y2={y(score)} className="progress-held" data-plan-drag={planned && canDrag ? "true" : undefined} />
          {finish !== null ? <><line x1={x(finish)} x2={x(finish)} y1={y(score)} y2={bottom} className="progress-finish-guide" />
            <g tabIndex={planned && canDrag ? undefined : 0} role={planned && canDrag ? undefined : "img"} aria-label={`${planned ? "Planned" : "Current"} scores finish marker`}
              aria-describedby={tooltip ? `${id}-tooltip` : undefined}
              onFocus={() => showScenario({ score, finish, planned })} onBlur={() => setTooltip(null)}>
              {planned ? <rect x={x(finish) - 4} y={y(score) - 4} width="8" height="8" className="progress-marker" data-scenario="planned" data-plan-drag={canDrag ? "true" : undefined} /> : <circle cx={x(finish)} cy={y(score)} r="5" className="progress-marker" data-scenario="current" />}
            </g>
          </> : null}
        </g>)}
        {tooltip?.marker ? <g className="progress-hover" style={{ color: tooltip.marker.color }}>
          <line x1={tooltip.marker.x} x2={tooltip.marker.x} y1={top} y2={bottom} />
          {tooltip.marker.planned ? <rect x={tooltip.marker.x - 5} y={tooltip.marker.y - 5} width={10} height={10} /> : <circle cx={tooltip.marker.x} cy={tooltip.marker.y} r={5} />}
        </g> : null}
      </g>
      <rect x={left} y={top} width={width - left - right} height={bottom - top} fill="none" stroke="var(--border-solid)" />
      {!endedAt && !scheduled ? <text x={x(now)} y={16} textAnchor="middle">Now</text> : null}
    </svg>
    <div className="war-progress-legend">
      <button type="button" aria-describedby={tooltip ? `${id}-tooltip` : undefined} onPointerMove={(event) => showPoint(points.length - 1, legendPointer(event))}
        onPointerLeave={clearPointerTooltip} onClick={() => showPoint(points.length - 1)} onFocus={() => showPoint(points.length - 1)} onBlur={() => setTooltip(null)}><i />Actual</button>
      {scenarios.map((scenario) => <span key={String(scenario.planned)}><i className={scenario.planned ? "planned" : "current"} />{scenario.planned ? "Planned" : "Current"}</span>)}
      {gaps.length ? <details className="war-progress-history-note"><summary aria-label="Score history information" title="Score history information" onClick={() => setTooltip(null)}><Info size={14} aria-hidden="true" /></summary><small>Hatched areas have no recorded score history.</small></details> : null}
    </div>
    {tooltip ? <div ref={tooltipElement} id={`${id}-tooltip`} role="tooltip" className="chart-tooltip-card war-progress-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
      <strong>{tooltip.title}</strong>
      {tooltip.rows.map((row) => <div className="war-progress-tooltip-row" key={row.label}><span>{row.color ? <i style={{ background: row.color }} /> : null}{row.label}</span><span>{row.value}</span></div>)}
    </div> : null}
  </div>;
}
