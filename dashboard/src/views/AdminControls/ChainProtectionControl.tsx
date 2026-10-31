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

  return <section className="panel" aria-busy={busy}>
    <PanelHeader title="Manual chain protection" />
    <div className="admin-chain-protection">
    <label className="checkbox-row">
      <input type="checkbox" role="switch" aria-describedby="manual-chain-protection-description" checked={data?.demand.manual_enabled ?? false}
        disabled={disabled || busy || !data} onChange={event => void change(event.target.checked)} />
      <span>Protect any active chain</span>
    </label>
    <p id="manual-chain-protection-description" className="panel-description">Enable protection independently of wars, events, and scheduled watches.</p>
    {error ? <p role="alert">{error} <button type="button" className="admin-button" disabled={disabled || busy} onClick={() => void load()}>Retry</button></p> : null}
    </div>
  </section>;
}
