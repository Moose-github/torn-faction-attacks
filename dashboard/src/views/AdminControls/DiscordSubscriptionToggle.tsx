import React from "react";
import type { AdminDiscordSubscriptionSettingsResponse } from "../../../../shared/discordSubscriptionSettings";
import { getAdminDiscordSubscriptionSettings, updateAdminDiscordSubscriptionSetting } from "../../api/admin";
import "./DiscordSubscriptionToggle.css";

export function useDiscordSubscriptionSettings() {
  const [data, setData] = React.useState<AdminDiscordSubscriptionSettingsResponse | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await getAdminDiscordSubscriptionSettings()); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load subscription settings."); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  async function save(alertKey: string, subscribable: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(alertKey);
    try {
      const response = await updateAdminDiscordSubscriptionSetting(alertKey, subscribable);
      setData(current => current ? { ...current, alerts: { ...current.alerts, [alertKey]: response.setting } } : current);
    } finally { inFlight.current = false; setSaving(null); }
  }
  return { data, error, loading, saving, load, save };
}

export function DiscordSubscriptionToggle({ alertKey, label, controls, disabled }: {
  alertKey: string; label: string; controls: ReturnType<typeof useDiscordSubscriptionSettings>; disabled: boolean;
}) {
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const setting = controls.data?.alerts[alertKey];
  async function toggle(subscribable: boolean) {
    setError(""); setNotice("");
    try {
      await controls.save(alertKey, subscribable);
      setNotice(subscribable ? "Subscriptions allowed." : "Subscriptions paused; member choices kept.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save subscription settings."); }
  }
  return <div className="admin-subscription-toggle" role="group" aria-label={`${label} subscriptions`}>
    <label>
      <input type="checkbox" aria-label={`Allow subscriptions for ${label}`} checked={setting?.subscribable ?? false}
        disabled={disabled || !setting || controls.loading || controls.saving !== null}
        onChange={event => void toggle(event.target.checked)} />
      <span>Allow subscriptions</span>
    </label>
    <small>{controls.saving === alertKey ? "Saving…" : setting
      ? `${setting.subscriber_count} ${setting.subscriber_count === 1 ? "subscriber" : "subscribers"}${setting.subscribable ? "" : " · paused"}`
      : controls.loading ? "Loading subscriptions…" : "Subscriptions unavailable"}</small>
    {error ? <small role="alert" className="admin-mention-error">{error}</small> : null}
    {notice ? <small role="status">{notice}</small> : null}
  </div>;
}
