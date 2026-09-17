import React from "react";
import { CalendarClock, Check, ExternalLink, LockKeyhole, RefreshCw } from "lucide-react";
import { createsLongWatchRun, nextWatchHour, watchUtc, WATCH_HOUR, type ChainWatchScheduleResponse, type ChainWatchSlot } from "../../../shared/chainWatchSchedule";
import { changeChainWatchSlot, finishChainWatch, getChainWatchSchedule, overrideChainWatchSlot } from "../api/chainWatchSchedule";
import { PanelHeader } from "../components/Common";
import "./ChainWatchSchedule.css";

export function ChainWatchSchedule({ currentUserId, isAdmin }: { currentUserId: number; isAdmin: boolean }) {
  const requestedId = React.useMemo(() => new URLSearchParams(window.location.search).get("watch"), []);
  const [data, setData] = React.useState<ChainWatchScheduleResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(Math.floor(Date.now() / 1000));
  const [sheetId, setSheetId] = React.useState<string | null>(null);
  const [showAdmin, setShowAdmin] = React.useState(false);
  const [finish, setFinish] = React.useState("");
  const [pendingFinish, setPendingFinish] = React.useState<string | null>(null);
  const requestVersion = React.useRef(0);
  const clockOffset = React.useRef(0);
  const busyRef = React.useRef(false);

  function accept(next: ChainWatchScheduleResponse) {
    clockOffset.current = next.now - Math.floor(Date.now() / 1000);
    setNow(next.now);
    setData(next);
    setSheetId((current) => next.sheets.some((sheet) => sheet.id === current) ? current :
      (next.sheets.find((sheet) => sheet.end_at > next.now) ?? next.sheets[next.sheets.length - 1])?.id ?? null);
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
    finally { busyRef.current = false; setBusy(false); }
  }

  const watch = data?.watch;
  const sheet = data?.sheets.find((item) => item.id === sheetId);
  const slots = data?.slots.filter((slot) => slot.sheet_id === sheetId) ?? [];
  const myHours = data?.slots.filter((slot) => !slot.cancelled && slot.assigned_to === currentUserId).map((slot) => slot.start_at) ?? [];
  const activeSlots = slots.filter((slot) => !slot.cancelled);
  const unfinished = Boolean(watch && (!watch.finish_at || watch.finish_at > now));
  const isHistory = Boolean(watch && watch.finish_at && watch.finish_at <= now);

  return <div className="watch-schedule-page">
    <section className="panel watch-schedule-heading">
      <PanelHeader title="Chain watch sign-ups" icon={<CalendarClock size={20} />} aside="UTC" />
      <p>Reserve an hour to keep the chain running. Take at least one hour off after two consecutive slots.</p>
      <div className="watch-toolbar">
        <button type="button" className="panel-action-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>
        {isAdmin && watch ? <button type="button" className="panel-action-button" aria-pressed={showAdmin} onClick={() => setShowAdmin(!showAdmin)}><LockKeyhole size={14} /> {showAdmin ? "Hide admin controls" : "Admin controls"}</button> : null}
        {requestedId ? <a href="/chain-watch">Current watch</a> : null}
      </div>
    </section>

    {error ? <div className="error-panel" role="alert">{error}</div> : null}
    {notice ? <div className="watch-notice" role="status"><Check size={16} /> {notice}</div> : null}
    {!data && !error ? <section className="panel"><p>Loading the watch…</p></section> : null}
    {data && !watch ? <section className="panel"><h2>No watch scheduled</h2><p>Create a named watch in the faction Discord with <code>/chain-watch create</code>.</p></section> : null}

    {watch ? <>
      <section className="panel">
        <div className="watch-title-row"><h2>{watch.name}</h2><span className="watch-status">{isHistory ? "Finished" : watch.start_at > now ? "Scheduled" : "Active"}</span></div>
        <p>{watchUtc(watch.start_at)} → {watch.finish_at ? watchUtc(watch.finish_at) : "Ongoing"}</p>
        {!watch.finish_at ? <p className="watch-muted">The next 24-hour sheet opens 12 hours before the current sheet ends.</p> : null}
        <div className="watch-toolbar">
          <label>Sheet <select value={sheetId ?? ""} onChange={(event) => setSheetId(event.target.value)}>
            {data!.sheets.map((item) => <option key={item.id} value={item.id}>{watchUtc(item.start_at)}{item.end_at <= now ? " · ended" : item.start_at > now ? " · upcoming" : " · current"}</option>)}
          </select></label>
          {sheet?.discord_message_id ? <a className="watch-discord-link" href={`https://discord.com/channels/${watch.guild_id}/${watch.channel_id}/${sheet.discord_message_id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open in Discord</a> : null}
        </div>
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
          <p>Finish at <strong>{pendingFinish.replace("T", " ")} UTC</strong>? Slots starting then or later will be cancelled, including assigned slots. Earlier assignments stay in place.</p>
          <button type="button" className="panel-action-button" disabled={busy} onClick={() => void run(async () => { const next = await finishChainWatch(watch.id, pendingFinish); setPendingFinish(null); return next; }, "Watch finish updated.")}>Confirm finish</button>
          <button type="button" className="panel-action-button" disabled={busy} onClick={() => setPendingFinish(null)}>Cancel</button>
        </div> : null}
      </section> : null}

      <section className="panel watch-slots-panel">
        <div className="watch-title-row"><h3>Hourly slots</h3><span>{activeSlots.filter((slot) => slot.assigned_to).length} / {activeSlots.length} filled</span></div>
        <div className="watch-slot-list">
          {slots.map((slot) => {
            const started = slot.start_at <= now;
            const ended = slot.start_at + WATCH_HOUR <= now;
            const mine = slot.assigned_to === currentUserId;
            const breaksRule = !slot.assigned_to && createsLongWatchRun(myHours, slot.start_at);
            return <div className={`watch-slot${mine ? " watch-slot-mine" : ""}${slot.cancelled || ended ? " watch-slot-muted" : ""}`} key={slot.start_at}>
              <div><strong>{new Date(slot.start_at * 1000).toISOString().slice(11, 16)}–{new Date((slot.start_at + WATCH_HOUR) * 1000).toISOString().slice(11, 16)} UTC</strong><small>{new Date(slot.start_at * 1000).toISOString().slice(0, 10)}</small></div>
              <div><strong>{slot.assigned_to ? slot.member_name ?? `Player ${slot.assigned_to}` : "Available"}{mine ? " · You" : ""}</strong><small>{slot.cancelled ? "Cancelled" : ended ? "Ended" : started ? "On watch · locked" : breaksRule ? "An hour's break is required" : slot.assigned_to ? "Reserved" : "Open for sign-up"}</small></div>
              <div className="watch-slot-actions">
                {isAdmin && showAdmin ? <WatchAdminAssignment slot={slot} members={data!.members} disabled={busy || Boolean(slot.cancelled)} onSave={(target) => run(() => overrideChainWatchSlot(watch.id, slot.start_at, target), "Assignment updated.")} /> :
                  <button type="button" className="panel-action-button" disabled={busy || Boolean(slot.cancelled) || started || (!mine && Boolean(slot.assigned_to)) || Boolean(breaksRule)} onClick={() => void run(() => changeChainWatchSlot(watch.id, [slot.start_at], mine ? "leave" : "claim"), mine ? "You left the slot." : "Your slot is reserved.")}>{slot.cancelled ? "Cancelled" : started ? "Locked" : mine ? "Leave slot" : slot.assigned_to ? "Taken" : "Sign up"}</button>}
              </div>
            </div>;
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
