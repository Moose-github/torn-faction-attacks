import React from "react";
import { CalendarClock, Check, ExternalLink, LockKeyhole, RefreshCw } from "lucide-react";
import { createsLongWatchRun, nextWatchHour, watchDate, watchUtc, watchSlotStatus, WATCH_DAY, WATCH_HOUR, type ChainWatchScheduleResponse, type ChainWatchSlot } from "../../../shared/chainWatchSchedule";
import { changeChainWatchSlot, finishChainWatch, getChainWatchSchedule, overrideChainWatchSlot } from "../api/chainWatchSchedule";
import { PanelHeader } from "../components/Common";
import { ChainWatchLivePanel } from "./ChainWatchLivePanel";
import { ChainWatchSheetBrowser } from "./ChainWatchSheetBrowser";
import { ChainWatchSummary } from "./ChainWatchSummary";
import "./ChainWatchSchedule.css";

export function ChainWatchSchedule({ currentUserId, isAdmin }: { currentUserId: number; isAdmin: boolean }) {
  const requestedId = React.useMemo(() => new URLSearchParams(window.location.search).get("watch"), []);
  const [data, setData] = React.useState<ChainWatchScheduleResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(Math.floor(Date.now() / 1000));
  const [showAdmin, setShowAdmin] = React.useState(false);
  const [finish, setFinish] = React.useState("");
  const [pendingFinish, setPendingFinish] = React.useState<string | null>(null);
  const [liveRefreshKey, setLiveRefreshKey] = React.useState(0);
  const requestVersion = React.useRef(0);
  const clockOffset = React.useRef(0);
  const busyRef = React.useRef(false);

  function accept(next: ChainWatchScheduleResponse) {
    clockOffset.current = next.now - Math.floor(Date.now() / 1000);
    setNow(next.now);
    setData(next);
  }

  const refresh = React.useCallback(async () => {
    if (busyRef.current) return;
    const version = ++requestVersion.current;
    try {
      const next = await getChainWatchSchedule(requestedId);
      if (version !== requestVersion.current) return;
      accept(next);
      setError(null);
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : String(err)); }
  }, [requestedId]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    const clock = window.setInterval(() => setNow(Math.floor(Date.now() / 1000) + clockOffset.current), 1000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { ++requestVersion.current; window.clearInterval(timer); window.clearInterval(clock); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  async function run(action: () => Promise<ChainWatchScheduleResponse>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    ++requestVersion.current;
    setBusy(true);
    setError(null);
    setNotice("");
    try { accept(await action()); setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { busyRef.current = false; setBusy(false); setLiveRefreshKey((key) => key + 1); }
  }

  const watch = data?.watch;
  const slots = data?.slots ?? [];
  const myHours = data?.slots.filter((slot) => !slot.cancelled && slot.assigned_to === currentUserId).map((slot) => slot.start_at) ?? [];
  const activeSlots = slots.filter((slot) => !slot.cancelled);
  const unfinished = Boolean(watch?.is_open && (!watch.finish_at || watch.finish_at > now));
  const isHistory = Boolean(watch && !unfinished);

  return <div className="watch-schedule-page">
    <section className="panel watch-schedule-heading">
      <PanelHeader title="Chain watch sign-ups" icon={<CalendarClock size={20} />} aside="UTC" />
      <p>Reserve an hour to keep the chain running. Take at least one hour off after two consecutive slots.</p>
      <div className="watch-toolbar">
        <ChainWatchSheetBrowser watchId={watch?.id ?? requestedId} busy={busy} refreshKey={liveRefreshKey} />
        <button type="button" className="panel-action-button" disabled={busy} onClick={() => { void refresh(); setLiveRefreshKey((key) => key + 1); }}><RefreshCw size={14} /> Refresh</button>
        {isAdmin && watch ? <button type="button" className="panel-action-button" aria-pressed={showAdmin} onClick={() => setShowAdmin(!showAdmin)}><LockKeyhole size={14} /> {showAdmin ? "Hide admin controls" : "Admin controls"}</button> : null}
        {requestedId ? <a href="/chain-watch">Current watch</a> : null}
      </div>
    </section>

    <ChainWatchLivePanel schedule={data} refreshKey={liveRefreshKey} />

    {error ? <div className="error-panel" role="alert">{error}</div> : null}
    {notice ? <div className="watch-notice" role="status"><Check size={16} /> {notice}</div> : null}
    {!data && !error ? <section className="panel"><p>Loading the watch…</p></section> : null}
    {data && !watch ? <section className="panel"><h2>No watch scheduled</h2><p>Create a named watch in the faction Discord with <code>/chain-watch create</code>.</p></section> : null}

    {watch ? <>
      <section className="panel">
        <div className="watch-title-row"><h2>{watch.name}</h2><span className="watch-status">{isHistory ? "Finished" : watch.start_at > now ? "Scheduled" : "Active"}</span></div>
        <p>{watchUtc(watch.start_at)} → {watch.finish_at ? watchUtc(watch.finish_at) : "Ongoing"}</p>
        {!watch.finish_at ? <p className="watch-muted">Tomorrow's slots are published at 12:00 UTC each day.</p> : null}
      </section>

      {isAdmin && showAdmin ? <section className="panel watch-admin-panel">
        <h3>Admin controls</h3>
        <p>You can replace any assignment, edit started slots, and override the break rule. Cancelled slots stay locked.</p>
        {unfinished ? <form onSubmit={(event) => { event.preventDefault(); setPendingFinish(finish || new Date(nextWatchHour(now) * 1000).toISOString().slice(0, 16)); }}>
          <label>Finish (UTC)<input type="datetime-local" step="3600" value={finish} onChange={(event) => setFinish(event.target.value)} /></label>
          <button type="submit" className="panel-action-button" disabled={busy}>Set finish</button>
          <small>Leave empty to finish at {watchUtc(nextWatchHour(now))}.</small>
        </form> : null}
        {pendingFinish !== null ? <div className="watch-finish-confirm" role="alert">
          <p>Finish at <strong>{watchUtc(Date.parse(`${pendingFinish}Z`) / 1000)}</strong>? Slots starting then or later will be cancelled, including assigned slots. Earlier assignments stay in place.</p>
          <button type="button" className="panel-action-button" disabled={busy} onClick={() => void run(async () => { const next = await finishChainWatch(watch.id, pendingFinish); setPendingFinish(null); return next; }, "Watch finish updated.")}>Confirm finish</button>
          <button type="button" className="panel-action-button" disabled={busy} onClick={() => setPendingFinish(null)}>Cancel</button>
        </div> : null}
      </section> : null}

      {isHistory ? <ChainWatchSummary slots={slots} now={now} isAdmin={isAdmin} /> : null}

      <section className="panel watch-slots-panel">
        <div className="watch-title-row"><h3>Hourly slots</h3><span>{activeSlots.filter((slot) => slot.assigned_to).length} / {activeSlots.length} filled</span></div>
        <div className="watch-slot-list">
          {slots.map((slot, index) => {
            const started = slot.start_at <= now;
            const ended = slot.start_at + WATCH_HOUR <= now;
            const status = watchSlotStatus(slot, now);
            const current = status.current;
            const mine = slot.assigned_to === currentUserId;
            const breaksRule = !slot.assigned_to && createsLongWatchRun(myHours, slot.start_at);
            const startsDay = index === 0 || Math.floor(slot.start_at / WATCH_DAY) !== Math.floor(slots[index - 1].start_at / WATCH_DAY);
            const sheet = startsDay ? data!.sheets.find((item) => item.id === slot.sheet_id) : undefined;
            return <React.Fragment key={slot.start_at}>
              {startsDay ? <div className="watch-day-divider">
                <h4>{watchDate(slot.start_at)} · UTC</h4>
                {sheet?.discord_message_id ? <a className="watch-discord-link" href={`https://discord.com/channels/${watch.guild_id}/${watch.channel_id}/${sheet.discord_message_id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open in Discord</a> : null}
              </div> : null}
              <div className={`watch-slot${mine ? " watch-slot-mine" : ""}${current ? " watch-slot-current" : ""}${slot.cancelled || ended ? " watch-slot-muted" : ""}`} aria-current={current ? "time" : undefined}>
              <div><strong>{new Date(slot.start_at * 1000).toISOString().slice(11, 16)}–{(slot.start_at + WATCH_HOUR) % WATCH_DAY === 0 ? "24:00" : new Date((slot.start_at + WATCH_HOUR) * 1000).toISOString().slice(11, 16)} UTC</strong>{current ? <small className="watch-current-label">Current hour</small> : null}</div>
              <div><strong>{slot.assigned_to ? slot.member_name ?? `Player ${slot.assigned_to}` : current ? "Unfilled" : "Available"}{mine ? " · You" : ""}</strong>
                <small className={`watch-coverage watch-coverage-${status.tone}`}>{status.icon ? <span aria-hidden="true">{status.icon} </span> : null}{status.label}</small>
                {!slot.cancelled && !started && breaksRule ? <small>An hour's break is required</small> : null}
              </div>
              <div className="watch-slot-actions">
                {isAdmin && showAdmin ? <WatchAdminAssignment slot={slot} members={data!.members} disabled={busy || Boolean(slot.cancelled)} onSave={(target) => run(() => overrideChainWatchSlot(watch.id, slot.start_at, target), "Assignment updated.")} /> :
                  <button type="button" className="panel-action-button" disabled={busy || Boolean(slot.cancelled) || started || (!mine && Boolean(slot.assigned_to)) || Boolean(breaksRule)} onClick={() => void run(() => changeChainWatchSlot(watch.id, [slot.start_at], mine ? "leave" : "claim"), mine ? "You left the slot." : "Your slot is reserved.")}>{slot.cancelled ? "Cancelled" : started ? "Locked" : mine ? "Leave slot" : slot.assigned_to ? "Taken" : "Sign up"}</button>}
              </div>
              </div>
            </React.Fragment>;
          })}
        </div>
        <p className="watch-muted">Updates from Discord appear automatically. Started slots can only be changed by an admin on this page.</p>
      </section>
    </> : null}
  </div>;
}

function WatchAdminAssignment({ slot, members, disabled, onSave }: {
  slot: ChainWatchSlot; members: ChainWatchScheduleResponse["members"]; disabled: boolean; onSave: (target: number | null) => Promise<void>;
}) {
  const [selected, setSelected] = React.useState(String(slot.assigned_to ?? ""));
  React.useEffect(() => setSelected(String(slot.assigned_to ?? "")), [slot.assigned_to]);
  return <form onSubmit={(event) => { event.preventDefault(); void onSave(selected ? Number(selected) : null); }}>
    <select aria-label={`Assign ${watchUtc(slot.start_at)}`} disabled={disabled} value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="">Unassigned</option>
      {slot.assigned_to && !members.some((member) => member.member_id === slot.assigned_to) ? <option value={slot.assigned_to}>{slot.member_name ?? slot.assigned_to} (former member)</option> : null}
      {members.map((member) => <option key={member.member_id} value={member.member_id}>{member.name}</option>)}
    </select>
    <button type="submit" className="panel-action-button" disabled={disabled || selected === String(slot.assigned_to ?? "")}>Save</button>
  </form>;
}
