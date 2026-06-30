import React from "react";
import { Bell, Link2 } from "lucide-react";
import {
  AuthSession,
  DiscordMemberAlertSubscriptionsResponse,
  getDiscordMemberAlertSubscriptions,
  updateDiscordMemberAlertSubscription,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";

export function Settings({ authSession }: { authSession: AuthSession }) {
  const [data, setData] = React.useState<DiscordMemberAlertSubscriptionsResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getDiscordMemberAlertSubscriptions();
        if (!cancelled) {
          setData(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleAlert(alertKey: string, enabled: boolean) {
    setSavingKey(alertKey);
    setError(null);
    try {
      setData(await updateDiscordMemberAlertSubscription({ alert_key: alertKey, enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  const linked = data?.discord_link.linked ?? false;
  const linkedDiscordId = data?.discord_link.discord_user_id ?? null;

  return (
    <div className="settings-page">
      <section className="panel settings-profile-panel">
        <PanelHeader title="Settings" aside={authSession.user.name ?? `Torn user ${authSession.user.id}`} icon={<Bell size={18} />} />
        <div className="settings-profile-grid">
          <div>
            <span>Torn user</span>
            <strong>{authSession.user.name ?? `Torn user ${authSession.user.id}`}</strong>
          </div>
          <div>
            <span>Discord link</span>
            <strong>{linkedDiscordId ? `<@${linkedDiscordId}>` : "Not linked"}</strong>
          </div>
        </div>
      </section>

      <section className="panel settings-alerts-panel">
        <PanelHeader
          title="Discord notifications"
          aside={isLoading ? "Loading" : data ? `${data.alerts.filter((alert) => alert.enabled).length}/${data.alerts.length} on` : "Unavailable"}
          icon={<Link2 size={18} />}
        />
        {error ? <p className="form-error">{error}</p> : null}
        {!linked && !isLoading ? (
          <div className="settings-link-notice" role="status">
            <strong>Discord link needed</strong>
            <span>Ask an admin to sync Discord links before you turn on personal notifications.</span>
          </div>
        ) : null}
        {isLoading ? (
          <EmptyState text="Loading notification settings" />
        ) : data && data.alerts.length > 0 ? (
          <div className="settings-alert-list">
            {data.alerts.map((alert) => (
              <label className="settings-alert-row" key={alert.key}>
                <input
                  type="checkbox"
                  checked={alert.enabled}
                  disabled={!linked || savingKey !== null}
                  onChange={(event) => toggleAlert(alert.key, event.target.checked)}
                />
                <span>
                  <strong>{alert.name}</strong>
                  <small>{alert.description}</small>
                </span>
                {savingKey === alert.key ? <em>Saving</em> : null}
              </label>
            ))}
          </div>
        ) : (
          <EmptyState text="No subscribable Discord alerts are available" />
        )}
      </section>
    </div>
  );
}
