import { usePollingResource } from "../hooks/usePollingResource";
import React from "react";
import type { WarSummary } from "../api";
import { getJson, postJson } from "../api/client";
import { practicalDuration, type PracticalPhase, type PracticalPhaseSummary } from "../../../shared/practicalPhases";
import { formatNumber } from "../utils/format";
import { CollapsiblePanel } from "./Common";
import "./practicalPhases.css";

type Response = PracticalPhaseSummary & { ok: boolean };
type Draft = { action: string; phase_id?: string; revision: number; target: string; start: string; finish: string };
const dateInput = (at: number | null) => at === null ? "" : new Date(at * 1000).toISOString().slice(0, 19);
const epoch = (value: string) => value ? Math.floor(new Date(`${value}Z`).getTime() / 1000) : null;
const time = (at: number | null) => at === null ? "—" : new Date(at * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
const duration = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;
const reasonLabel: Record<string, string> = {
  target_already_met: "Target already met before reopening",
  target_reached: "Cumulative target reached",
  awaiting_reconciliation: "Waiting for score and attack reconciliation",
  target_required: "A cumulative target is required",
  official_end: "War officially ended",
  admin_cancelled: "Cancelled by admin",
  history_correction: "Historical correction",
  manual: "Closed manually",
  legacy: "Original practical phase",
};

export function PracticalPhases({ war, admin = false, collapsible = false, onChanged }: { war: WarSummary; admin?: boolean; collapsible?: boolean; onChanged?: () => void }) {
  const [collapsed, setCollapsed] = React.useState(true);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [actionError, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(Math.floor(Date.now() / 1000));
  const path = `/api/wars/${encodeURIComponent(war.name)}/practical-phases`;
  const resource = usePollingResource(path, signal => getJson<Response>(path, true, signal), {
    enabled: war.war_type === "termed", intervalMs: 15_000,
  });
  const { data, setData } = resource;
  const error = actionError ?? (resource.error ? resource.error instanceof Error ? resource.error.message : String(resource.error) : null);
  React.useEffect(() => { setDraft(null); setError(null); }, [path]);
  React.useEffect(() => {
    const clock = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(clock);
  }, []);
  if (war.war_type !== "termed") return null;

  const phases = data?.practical_phases ?? [];
  const active = phases.find((p) => p.status === "active");
  const pending = data?.pending_practical_phase;
  function edit(action: string, phase?: PracticalPhase) {
    if (!data) return;
    setError(null);
    setDraft({ action, phase_id: phase?.id, revision: data.practical_revision,
      target: phase?.target == null ? "" : String(phase.target),
      start: dateInput(phase?.start_time ?? phase?.scheduled_start ?? (action === "add_history" ? now - 3600 : now + 3600)),
      finish: dateInput(phase?.finish_time ?? now) });
  }
  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      setData(await postJson<Response>(path, body));
      setDraft(null); onChanged?.();
      window.dispatchEvent(new Event("practical-phases-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      resource.invalidate();
    } finally { setBusy(false); }
  }
  const history = draft?.action.includes("history");
  const countedTime = `${duration(practicalDuration(phases, Math.min(now, war.official_end_time ?? now)))} counted`;
  const content = <>
    <p>Targets are cumulative across the whole war. Only attacks within practical windows count toward practical statistics.</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {!data && !error && <p>Loading phases…</p>}
    {!!data?.practical_rebuild_pending && <p role="status">Statistics are awaiting recalculation. {admin && <button disabled={busy} onClick={() => void mutate({ action: "retry", revision: data.practical_revision })}>Retry recalculation</button>}</p>}
    <div className="practical-phases-table"><table>
      <thead><tr><th>Phase</th><th>Overall target</th><th>Start / planned start</th><th>Finish</th><th>Practical time</th><th>Status</th>{admin && <th>Actions</th>}</tr></thead>
      <tbody>{phases.map((phase, index) => <tr key={phase.id}>
        <td>{index + 1}</td><td>{phase.target === null ? "Target needed" : formatNumber(phase.target)}</td>
        <td>{time(phase.start_time ?? phase.scheduled_start)}</td><td>{time(phase.finish_time)}</td>
        <td>{duration(practicalDuration([phase], Math.min(now, war.official_end_time ?? now)))}</td>
        <td><strong>{phase.status}</strong>{phase.reason && <small>{reasonLabel[phase.reason] ?? phase.reason}</small>}</td>
        {admin && <td className="practical-phase-actions">
          {phase.status === "scheduled" && <>
            <button disabled={busy} onClick={() => edit("update", phase)}>Edit</button>
            <button disabled={busy} onClick={() => void mutate({ action: "start_now", phase_id: phase.id, revision: data!.practical_revision })}>Start now</button>
            <button disabled={busy} onClick={() => void mutate({ action: "cancel", phase_id: phase.id, revision: data!.practical_revision })}>Cancel</button>
          </>}
          {phase.status === "active" && <button disabled={busy} onClick={() => edit("set_target", phase)}>Edit target</button>}
          {phase.status === "completed" && <>
            <button disabled={busy} onClick={() => edit("edit_history", phase)}>Correct</button>
            <button disabled={busy} onClick={() => edit("remove_history", phase)}>Remove</button>
          </>}
        </td>}
      </tr>)}</tbody>
    </table></div>
    {admin && data && <div className="practical-phase-actions">
      {!active && !pending && war.official_end_time === null && war.status === "active" && <>
        <button disabled={busy} onClick={() => edit("reopen")}>Reopen now</button>
        <button disabled={busy} onClick={() => edit("schedule")}>Schedule reopening</button>
      </>}
      <button disabled={busy} onClick={() => edit("add_history")}>Add past phase</button>
    </div>}
    {admin && draft && <form className="practical-phase-form" onSubmit={(event) => {
      event.preventDefault();
      void mutate({ action: draft.action, phase_id: draft.phase_id, revision: draft.revision,
        target: Number(draft.target), start_time: epoch(draft.start), finish_time: epoch(draft.finish) });
    }}>
      <h4>{draft.action === "remove_history" ? "Remove recorded phase" : history ? "Correct phase history" : draft.action === "reopen" ? "Reopen immediately" : draft.action === "set_target" ? "Change current cumulative target" : "Plan reopening"}</h4>
      {history && <p>Saving this correction recalculates which attacks count and updates practical statistics. The edit is recorded in history.</p>}
      {draft.action !== "remove_history" && <>
        <label>Cumulative faction target<input type="number" min="0.01" step="any" required value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} /></label>
        {!["reopen", "set_target"].includes(draft.action) && <label>Start (TCT / UTC)<input type="datetime-local" step="1" required value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label>}
        {history && <label>Finish (TCT / UTC)<input type="datetime-local" step="1" required value={draft.finish} onChange={(e) => setDraft({ ...draft, finish: e.target.value })} /></label>}
      </>}
      <div className="practical-phase-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </form>}
  </>;

  return collapsible ? <CollapsiblePanel
    title="Practical phases"
    aside={countedTime}
    collapsed={collapsed}
    onToggle={() => setCollapsed((current) => !current)}
    className="practical-phases"
  >
    {content}
  </CollapsiblePanel> : <section className="panel practical-phases" aria-label="Practical phases">
    <div className="practical-phases-heading">
      <div><p className="eyebrow">Termed war</p><h3>Practical phases</h3></div>
      <strong>{countedTime}</strong>
    </div>
    {content}
  </section>;
}
