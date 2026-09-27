import React from "react";
import { RefreshCw } from "lucide-react";
import { refreshArmoryActivity } from "../api/armory";

export function ArmoryActivityRefresh({ fetchedAt, disabled, onRefresh }: {
  fetchedAt: number | null; disabled: boolean; onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [latest, setLatest] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil(((Math.max(fetchedAt ?? 0, latest ?? 0) + 300) * 1000 - now) / 1000));
  async function refresh() {
    if (busy || disabled || remaining > 0) return;
    setBusy(true); setMessage("");
    try {
      const result = await refreshArmoryActivity();
      setLatest(result.activity_fetched_at); setNow(Date.now());
      setMessage(result.status === "busy" ? "Faction activity is already refreshing."
        : result.status === "cached" ? "Faction activity was fetched less than five minutes ago." : "Faction activity refreshed.");
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh faction activity. Please retry.");
    } finally { setBusy(false); }
  }
  return <div className="armory-activity-refresh">
    <button type="button" disabled={disabled || busy || remaining > 0} onClick={() => void refresh()}
      title={remaining > 0 ? `Available in ${Math.floor(remaining / 60)}m ${remaining % 60}s, when faction activity is five minutes old.` : "Refresh faction online status and last actions"}>
      <RefreshCw size={15} />{busy ? "Refreshing activity…" : "Refresh faction activity"}
    </button>
    {message ? <small role="status">{message}</small> : null}
  </div>;
}
