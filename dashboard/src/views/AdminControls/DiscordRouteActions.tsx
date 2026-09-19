import React from "react";
import { getAdminDiscordRouteDestinations, updateAdminDiscordRoute } from "../../api/admin";
import type { AdminDiscordAlertSettingsResponse, DiscordAlertRouteSummary } from "../../api/types";
import type { DiscordRouteDestinationsResponse } from "../../../../shared/discordRouteAdmin";
import "./DiscordRouteActions.css";

export function DiscordRouteActions({ alertKey, label, route, disabled, testBusy, onTest, onSaved, runAdminAction }: {
  alertKey: string;
  label: string;
  route: DiscordAlertRouteSummary | null;
  disabled: boolean;
  testBusy: boolean;
  onTest: () => void;
  onSaved: (response: AdminDiscordAlertSettingsResponse) => void;
  runAdminAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState("");
  const [data, setData] = React.useState<DiscordRouteDestinationsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [notice, setNotice] = React.useState("");
  const inFlight = React.useRef(false);
  const formId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(""); setData(null);
    getAdminDiscordRouteDestinations().then(response => { if (active) setData(response); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load channels."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, reload]);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || inFlight.current || selected === (route?.target_id ?? "")) return;
    inFlight.current = true; setError("");
    runAdminAction(`Change ${label} route`, async () => {
      try {
        const response = await updateAdminDiscordRoute(alertKey, selected || null);
        onSaved(response); setOpen(false); setNotice("Route saved.");
        return response;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save the route.");
        throw err;
      } finally { inFlight.current = false; }
    });
  }

  const options = data?.destinations ?? [];
  const unlistedCurrent = route && !options.some(option => option.id === route.target_id);
  return <>
    <div className="admin-alert-route-actions">
      <button type="button" className="admin-alert-route-test" disabled={disabled} onClick={onTest} title={`Test ${label}`}>
        {testBusy ? "Testing" : "Test"}
      </button>
      <button type="button" className="admin-alert-route-test" disabled={disabled || open}
        aria-expanded={open} aria-controls={formId} aria-label={`Change route for ${label}`}
        onClick={() => { setSelected(route?.target_id ?? ""); setNotice(""); setOpen(true); }}>
        Change route
      </button>
    </div>
    {notice ? <small role="status">{notice}</small> : null}
    {open ? <form id={formId} className="admin-alert-route-form" onSubmit={save} aria-label={`Change route for ${label}`}>
      <label>
        <span>Send to</span>
        <select autoFocus aria-label={`Destination for ${label}`} value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}>
          <option value="">{alertKey === "default" ? "No default route" : "Use default fallback"}</option>
          {unlistedCurrent ? <option value={route.target_id} disabled>
            Current: {route.thread_name ?? route.channel_name ?? route.target_id}{loading ? "" : " (not listed)"}
          </option> : null}
          {options.map(option => <option key={option.id} value={option.id}>
            {option.kind === "thread" ? `${option.name}${option.parent_name ? ` — #${option.parent_name}` : " (thread)"}` : `#${option.name}`}
          </option>)}
        </select>
      </label>
      {loading ? <small role="status">Loading channels…</small> : null}
      {data?.threads_error ? <small>{data.threads_error}</small> : null}
      {data && options.length === 0 ? <small>No channels or active threads are available.</small> : null}
      {error ? <small role="alert">{error}</small> : null}
      <div className="admin-alert-route-actions">
        <button type="submit" className="admin-alert-route-test" disabled={disabled || selected === (route?.target_id ?? "")}>Save route</button>
        <button type="button" className="admin-alert-route-test" disabled={disabled} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="admin-alert-route-test" disabled={disabled || loading} onClick={() => setReload(value => value + 1)}>Refresh channels</button>
      </div>
    </form> : null}
  </>;
}
