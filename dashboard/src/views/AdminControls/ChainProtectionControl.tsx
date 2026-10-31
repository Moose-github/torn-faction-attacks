import React from "react";
import { getManualChainProtection, setManualChainProtection } from "../../api/chainWatchSchedule";
import { PanelHeader } from "../../components/Common";
import type { ChainWatchLiveResponse } from "../../../../shared/chainWatchLive";

export function ChainProtectionControl({ disabled = false }: { disabled?: boolean }) {
  const [data, setData] = React.useState<ChainWatchLiveResponse | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  async function load() {
    setBusy(true);
    setError(null);
    try { setData(await getManualChainProtection()); }
    catch { setData(null); setError("Unable to load chain protection. Try again."); }
    finally { setBusy(false); }
  }

  React.useEffect(() => { void load(); }, []);

  async function change(enabled: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { setData(await setManualChainProtection(enabled)); }
    catch {
      // A refresh can fail after the setting was saved. Read the saved value
      // rather than presenting the previous checkbox value as authoritative.
      try { setData(await getManualChainProtection()); }
      catch { setData(null); }
      setError("The protection update could not be completed. Check the saved setting and try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="panel">
    <PanelHeader title="Manual chain protection" aside={busy ? "Loading…" : !data ? "Unavailable" : data.demand.manual_enabled ? "On" : "Off"} />
    <p>Keep faction chain monitoring on independently of wars, events, and scheduled watches. This setting stays on until an admin turns it off.</p>
    <label className="checkbox-row">
      <input type="checkbox" role="switch" checked={data?.demand.manual_enabled ?? false}
        disabled={disabled || busy || !data} onChange={event => void change(event.target.checked)} />
      <span>Protect any active chain</span>
    </label>
    <p className="panel-description">Warnings apply above 100 hits, at 60 and 30 seconds remaining, using the existing Discord alert settings. Turning this off leaves war, event, and scheduled watch protection in place.</p>
    {data ? <p role="status">{data.computed.active
      ? "Chain monitoring is active."
      : data.demand.active ? "Waiting for the monitor to start." : "Chain monitoring is stopped."}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="admin-button" disabled={disabled || busy} onClick={() => void load()}>Refresh protection status</button>
  </section>;
}
