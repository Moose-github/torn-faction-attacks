import React from "react";
import { Radio } from "lucide-react";
import type { ChainWatchLiveResponse } from "../../../shared/chainWatchLive";
import { WATCH_HOUR, type ChainWatchScheduleResponse, type ChainWatchSlot } from "../../../shared/chainWatchSchedule";
import { getChainWatchLive } from "../api/chainWatchSchedule";
import { PanelHeader } from "../components/Common";
import { chainWatchLiveDisplay } from "../utils/chainWatchLive";
import { formatNumber } from "../utils/format";

export function ChainWatchLivePanel({ schedule, refreshKey }: {
  schedule: ChainWatchScheduleResponse | null; refreshKey: number;
}) {
  const [data, setData] = React.useState<ChainWatchLiveResponse | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [now, setNow] = React.useState(Math.floor(Date.now() / 1000));
  const offset = React.useRef(0);

  React.useEffect(() => {
    let version = 0;
    let disposed = false;
    const tick = () => setNow(Math.floor(Date.now() / 1000) + offset.current);
    async function refresh() {
      const request = ++version;
      try {
        const next = await getChainWatchLive();
        if (disposed || request !== version) return;
        offset.current = next.now - Math.floor(Date.now() / 1000);
        setData(next);
        setFailed(false);
        tick();
      } catch {
        if (!disposed && request === version) setFailed(true);
      }
    }
    const wake = () => { if (!document.hidden) { tick(); void refresh(); } };
    void refresh();
    const poll = window.setInterval(wake, 15_000);
    const clock = window.setInterval(() => { if (!document.hidden) tick(); }, 1000);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refreshKey]);

  const state = data?.state;
  const display = chainWatchLiveDisplay(data, now, failed);
  const watch = schedule?.watch;
  const sameWatch = Boolean(watch && data?.demand.watch_id === watch.id);
  const upcomingWatch = Boolean(watch && !data?.demand.watch_id && watch.start_at > now);
  const relevantSlots = sameWatch || upcomingWatch ? (schedule?.slots ?? []).filter((slot) => !slot.cancelled) : [];
  const current = relevantSlots.find((slot) => slot.start_at <= now && slot.start_at + WATCH_HOUR > now);
  const next = relevantSlots.find((slot) => slot.start_at > now);
  const differentWatch = Boolean(data?.demand.watch_id && watch && !sameWatch);
  const source = state?.source === "live_confirm" ? "Torn check" : state?.source === "stored" ? "Attack feed" : "Monitor";
  const checked = display.checkedAge === null ? "Not checked yet" : display.checkedAge < 60
    ? `Checked ${display.checkedAge}s ago` : `Checked ${Math.floor(display.checkedAge / 60)}m ago`;

  return <section className={`panel watch-live-panel watch-live-${display.tone}`} aria-label="Live chain">
    <PanelHeader title="Live chain" icon={<Radio size={20} />} control={
      <span className="watch-live-status" role="status"><span aria-hidden="true" />{display.status}</span>
    } />
    <div className="watch-live-grid">
      <div className="chain-watch-primary">
        <span>{display.current ? "Current chain" : "Last known chain"}</span>
        <strong>{state?.current_chain == null ? "—" : formatNumber(state.current_chain)}</strong>
      </div>
      <div className="chain-watch-primary watch-live-countdown">
        <span>Time left</span><strong>{display.countdown}</strong>
      </div>
      <div className="chain-watch-detail">
        <span>On watch</span><strong>{differentWatch ? "See current watch" : watcherName(current, "No shift active")}</strong>
        <small>{current ? slotTime(current) : "—"}</small>
      </div>
      <div className="chain-watch-detail">
        <span>Next watcher</span><strong>{differentWatch ? "See current watch" : watcherName(next, "No upcoming slot")}</strong>
        <small>{next ? slotTime(next) : "—"}</small>
      </div>
    </div>
    <div className="watch-live-footer">
      <div><span className="watch-muted">Last hit</span><strong>{state?.last_hit_at
        ? `${state.last_hit_attacker_name ?? "Unknown"} → ${state.last_hit_defender_name ?? "Unknown"}` : "No hit recorded"}</strong>
        {state?.last_hit_at ? <small>{utcTime(state.last_hit_at)}</small> : null}</div>
      <p className="watch-muted" title={state?.last_checked_at ? utcTime(state.last_checked_at) : undefined}>
        {checked}{state?.last_checked_at ? ` · ${source}` : ""}
      </p>
    </div>
    <p className="watch-live-detail">{display.detail}</p>
    {differentWatch ? <p className="watch-muted">Live status is for the current faction chain. <a href="/chain-watch">Open the current watch</a> to see its assignments.</p> : null}
  </section>;
}

function watcherName(slot: ChainWatchSlot | undefined, empty: string): string {
  return !slot ? empty : slot.assigned_to ? slot.member_name ?? `Player ${slot.assigned_to}` : "Unassigned";
}
function utcTime(at: number): string {
  return `${new Date(at * 1000).toISOString().slice(11, 19)} UTC`;
}
function slotTime(slot: ChainWatchSlot): string {
  return `${new Date(slot.start_at * 1000).toISOString().slice(11, 16)}–${new Date((slot.start_at + WATCH_HOUR) * 1000).toISOString().slice(11, 16)} UTC`;
}
