import React from "react";
import { Bell, KeyRound, Link2, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  AuthSession,
  DiscordMemberAlertSubscriptionsResponse,
  getDiscordMemberAlertSubscriptions,
  getMyTornKeyPool,
  submitMyTornKeyPoolKey,
  updateDiscordMemberAlertSubscription,
  updateMyTornKeyPoolKey,
  deleteMyTornKeyPoolKey,
  type MyTornKeyPoolResponse,
  type TornKeyMetadata,
  type TornKeyPoolFeature,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";

export function Settings({ authSession }: { authSession: AuthSession }) {
  const [data, setData] = React.useState<DiscordMemberAlertSubscriptionsResponse | null>(null);
  const [keyPool, setKeyPool] = React.useState<MyTornKeyPoolResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(true);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [savingPoolKey, setSavingPoolKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [keyPoolError, setKeyPoolError] = React.useState<string | null>(null);
  const [newKey, setNewKey] = React.useState("");
  const [newKeyLabel, setNewKeyLabel] = React.useState("");
  const [newKeyRateLimit, setNewKeyRateLimit] = React.useState("");
  const [newKeyFeatures, setNewKeyFeatures] = React.useState<TornKeyPoolFeature[]>([]);

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

  React.useEffect(() => {
    void loadKeyPool();
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

  async function loadKeyPool() {
    setIsLoadingKeys(true);
    setKeyPoolError(null);
    try {
      const response = await getMyTornKeyPool();
      setKeyPool(response);
      setNewKeyFeatures(response.default_allowed_features);
    } catch (err) {
      setKeyPoolError(err instanceof Error ? err.message : String(err));
      setKeyPool(null);
    } finally {
      setIsLoadingKeys(false);
    }
  }

  async function submitKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPoolKey("new");
    setKeyPoolError(null);
    try {
      await submitMyTornKeyPoolKey({
        key: newKey,
        label: newKeyLabel || null,
        allowed_features: newKeyFeatures,
        max_requests_per_minute: rateLimitFromInput(newKeyRateLimit),
      });
      setNewKey("");
      setNewKeyLabel("");
      setNewKeyRateLimit("");
      await loadKeyPool();
    } catch (err) {
      setKeyPoolError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPoolKey(null);
    }
  }

  async function saveExistingKey(key: TornKeyMetadata, patch: Partial<TornKeyMetadata>) {
    setSavingPoolKey(key.id);
    setKeyPoolError(null);
    try {
      await updateMyTornKeyPoolKey(key.id, {
        label: patch.label ?? key.label,
        status: (patch.status ?? key.status) === "disabled" ? "disabled" : "active",
        allowed_features: patch.allowed_features ?? key.allowed_features,
        max_requests_per_minute: patch.max_requests_per_minute ?? key.max_requests_per_minute,
      });
      await loadKeyPool();
    } catch (err) {
      setKeyPoolError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPoolKey(null);
    }
  }

  async function disableExistingKey(key: TornKeyMetadata) {
    setSavingPoolKey(key.id);
    setKeyPoolError(null);
    try {
      await deleteMyTornKeyPoolKey(key.id);
      await loadKeyPool();
    } catch (err) {
      setKeyPoolError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPoolKey(null);
    }
  }

  const linked = data?.discord_link.linked ?? false;
  const linkedDiscordId = data?.discord_link.discord_user_id ?? null;
  const tornUserDisplay = authSession.user.name ? `${authSession.user.name} ${authSession.user.id}` : String(authSession.user.id);

  return (
    <div className="settings-page">
      <section className="panel settings-profile-panel">
        <PanelHeader title="Settings" aside={tornUserDisplay} icon={<Bell size={18} />} />
        <div className="settings-profile-grid">
          <div>
            <span>Torn user</span>
            <strong>{tornUserDisplay}</strong>
          </div>
          <div>
            <span>Discord link</span>
            <strong>{linkedDiscordId ? "Linked" : "Not linked"}</strong>
            {linkedDiscordId ? <small>Discord ID {linkedDiscordId}</small> : null}
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

      <section className="panel settings-alerts-panel">
        <PanelHeader
          title="Torn key pool"
          aside={isLoadingKeys ? "Loading" : keyPool ? `${keyPool.keys.filter((key) => key.status === "active").length}/${keyPool.keys.length} active` : "Unavailable"}
          icon={<KeyRound size={18} />}
        />
        {keyPoolError ? <p className="form-error">{keyPoolError}</p> : null}

        <form className="trade-scout-form" onSubmit={submitKey}>
          <label>
            <span>Key label</span>
            <input value={newKeyLabel} onChange={(event) => setNewKeyLabel(event.target.value)} placeholder="Main key" />
          </label>
          <label>
            <span>Torn API key</span>
            <input
              type="password"
              value={newKey}
              autoComplete="off"
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="Submitted encrypted to the shared pool"
            />
          </label>
          <label>
            <span>Max requests per minute</span>
            <input
              inputMode="numeric"
              value={newKeyRateLimit}
              onChange={(event) => setNewKeyRateLimit(event.target.value)}
              placeholder="No personal cap"
            />
          </label>
          <div className="settings-alert-list">
            {(keyPool?.features ?? []).map((feature) => (
              <label className="settings-alert-row" key={feature.key}>
                <input
                  type="checkbox"
                  checked={newKeyFeatures.includes(feature.key)}
                  onChange={(event) => setNewKeyFeatures(toggleFeature(newKeyFeatures, feature.key, event.target.checked))}
                />
                <span>
                  <strong>{feature.label}</strong>
                  <small>{feature.key === "hospital_monitor" ? "Opt in only. Active monitoring can make frequent requests." : "Allowed to use this key when selected."}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="trade-scout-form-actions">
            <button type="submit" className="panel-action-button primary-action" disabled={savingPoolKey !== null || !newKey.trim()}>
              {savingPoolKey === "new" ? <RefreshCw size={14} className="spinning-icon" /> : <KeyRound size={14} />}
              {savingPoolKey === "new" ? "Submitting" : "Submit key"}
            </button>
          </div>
        </form>

        {isLoadingKeys ? (
          <EmptyState text="Loading Torn keys" />
        ) : keyPool && keyPool.keys.length > 0 ? (
          <div className="settings-alert-list">
            {keyPool.keys.map((key) => (
              <KeyPoolRow
                key={key.id}
                poolKey={key}
                features={keyPool.features}
                isSaving={savingPoolKey === key.id}
                onSave={saveExistingKey}
                onDisable={disableExistingKey}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No Torn keys submitted yet" />
        )}
      </section>
    </div>
  );
}

function KeyPoolRow({
  poolKey,
  features,
  isSaving,
  onSave,
  onDisable,
}: {
  poolKey: TornKeyMetadata;
  features: MyTornKeyPoolResponse["features"];
  isSaving: boolean;
  onSave: (key: TornKeyMetadata, patch: Partial<TornKeyMetadata>) => void;
  onDisable: (key: TornKeyMetadata) => void;
}) {
  const [label, setLabel] = React.useState(poolKey.label ?? "");
  const [rateLimit, setRateLimit] = React.useState(poolKey.max_requests_per_minute?.toString() ?? "");
  const [allowedFeatures, setAllowedFeatures] = React.useState<TornKeyPoolFeature[]>(poolKey.allowed_features);
  const [status, setStatus] = React.useState(poolKey.status);

  React.useEffect(() => {
    setLabel(poolKey.label ?? "");
    setRateLimit(poolKey.max_requests_per_minute?.toString() ?? "");
    setAllowedFeatures(poolKey.allowed_features);
    setStatus(poolKey.status);
  }, [poolKey]);

  return (
    <div className="settings-alert-row">
      <span>
        <strong>{poolKey.owner_name ?? poolKey.owner_torn_user_id ?? "Submitted key"}</strong>
        <small>
          {poolKey.status} - {poolKey.allowed_features.join(", ")} - last used {poolKey.last_used_at ? formatUnix(poolKey.last_used_at) : "never"}
        </small>
      </span>
      <label>
        <span>Label</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label>
        <span>Max/min</span>
        <input inputMode="numeric" value={rateLimit} onChange={(event) => setRateLimit(event.target.value)} />
      </label>
      <label>
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>
      <div className="settings-alert-list">
        {features.map((feature) => (
          <label className="settings-alert-row" key={feature.key}>
            <input
              type="checkbox"
              checked={allowedFeatures.includes(feature.key)}
              onChange={(event) => setAllowedFeatures(toggleFeature(allowedFeatures, feature.key, event.target.checked))}
            />
            <span>
              <strong>{feature.label}</strong>
              <small>{feature.key === "hospital_monitor" ? "Opt in to active monitor use." : "Allowed feature"}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="trade-scout-form-actions">
        <button
          type="button"
          className="panel-action-button primary-action"
          disabled={isSaving}
          onClick={() => onSave(poolKey, {
            label: label || null,
            status,
            allowed_features: allowedFeatures,
            max_requests_per_minute: rateLimitFromInput(rateLimit),
          })}
        >
          {isSaving ? <RefreshCw size={14} className="spinning-icon" /> : <Save size={14} />}
          Save
        </button>
        <button type="button" className="panel-action-button" disabled={isSaving} onClick={() => onDisable(poolKey)}>
          <Trash2 size={14} />
          Disable
        </button>
      </div>
    </div>
  );
}

function toggleFeature(features: TornKeyPoolFeature[], feature: TornKeyPoolFeature, enabled: boolean): TornKeyPoolFeature[] {
  if (enabled) {
    return Array.from(new Set([...features, feature]));
  }
  return features.filter((item) => item !== feature);
}

function rateLimitFromInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Math.floor(Number(trimmed));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatUnix(value: number): string {
  return new Date(value * 1000).toLocaleString();
}
