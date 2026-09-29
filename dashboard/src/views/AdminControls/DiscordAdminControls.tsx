import React from "react";
import {
  AdminDiscordAlertSettingsResponse,
  clearDiscordTravelTrackerTarget,
  DiscordAlertRouteSummary,
  DiscordTravelTrackerTargetResponse,
  setDiscordTravelTrackerTarget,
  syncDiscordTravelTracker,
  testAdminDiscordAlertRoute,
  updateAdminDiscordAlert,
  updateDiscordTravelTrackerSettings,
} from "../../api";
import { PanelHeader } from "../../components/Common";
import { formatLongDateTime } from "../../utils/format";
import { discordAlertByKey, DISCORD_DEFAULT_ALERT_ROUTE_KEY as DEFAULT_DISCORD_ALERT_ROUTE_KEY } from "../../../../shared/discordAlertCatalog";
import type { DiscordAlertSettingsMap } from "../../../../shared/discordAlertSettings";
import { discordAlertRows, discordAlertStatus } from "./discordAlertRows";
import { DiscordMessageDelete } from "./DiscordMessageDelete";
import { DiscordMessageCompose } from "./DiscordMessageCompose";
import { DiscordAlertMentionEditor, useDiscordMentionSettings } from "./DiscordAlertMentionEditor";
import { DiscordRouteActions } from "./DiscordRouteActions";
import { DiscordSubscriptionToggle, useDiscordSubscriptionSettings } from "./DiscordSubscriptionToggle";

export type DiscordTravelTargetForm = {
  factionId: string;
  factionName: string;
};

type DiscordAdminControlsProps = {
  isBusy: string | null;
  discordTravelTargetForm: DiscordTravelTargetForm;
  discordTravelTarget: DiscordTravelTrackerTargetResponse | null;
  isLoadingDiscordTravelTarget: boolean;
  discordAlertSettings: DiscordAlertSettingsMap;
  discordAlertRoutes: Record<string, DiscordAlertRouteSummary | null>;
  isLoadingDiscordAlertSettings: boolean;
  setDiscordTravelTargetForm: React.Dispatch<React.SetStateAction<DiscordTravelTargetForm>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  applyDiscordAlertSettingsResponse: (response: AdminDiscordAlertSettingsResponse) => void;
  refreshTravelTarget: () => Promise<void>;
  runAdminAction: (label: string, action: () => Promise<unknown>, options?: { refresh?: Array<() => Promise<void>> }) => void;
};

export function DiscordAdminControls({
  isBusy,
  discordTravelTargetForm,
  discordTravelTarget,
  isLoadingDiscordTravelTarget,
  discordAlertSettings,
  discordAlertRoutes,
  isLoadingDiscordAlertSettings,
  setDiscordTravelTargetForm,
  setError,
  applyDiscordAlertSettingsResponse,
  refreshTravelTarget,
  runAdminAction,
}: DiscordAdminControlsProps) {
  function runTravelAction(label: string, action: () => Promise<unknown>) {
    runAdminAction(label, action, { refresh: [refreshTravelTarget] });
  }
  const mentionControls = useDiscordMentionSettings();
  const subscriptionControls = useDiscordSubscriptionSettings();
  const discordTravelTrackerStatus = isLoadingDiscordTravelTarget
    ? "Loading"
    : discordTravelTarget
      ? `${discordTravelTarget.target_tracker.enabled ? "Target on" : "Target off"} / ${discordTravelTarget.home_tracker.enabled ? "Home on" : "Home off"}`
      : "Unavailable";
  const canSetDiscordTravelTarget =
    isBusy === null &&
    Number.isInteger(Number(discordTravelTargetForm.factionId)) &&
    Number(discordTravelTargetForm.factionId) > 0;
  const alertRows = discordAlertRows(discordAlertSettings, isLoadingDiscordAlertSettings, (key, enabled) => {
    runAdminAction(`Update ${discordAlertByKey(key)!.admin.label} messages`, () => updateAdminDiscordAlert(key, enabled).then(response => {
      applyDiscordAlertSettingsResponse(response);
      return response;
    }));
  });

  return (
    <>
      <section className="panel admin-panel-shoplifting-alerts">
        <PanelHeader title="Discord alerts" aside={discordAlertStatus(discordAlertSettings, isLoadingDiscordAlertSettings)} />
        <p>Choose which Discord alerts are sent, where they appear, who they mention, and whether members can subscribe.</p>
        <p className="admin-mention-help">
          <strong>Status</strong>: Controls if the alert is sent; does not affect functionality.<br />
          <strong>Allow subscriptions</strong>: Allows users to subscribe themselves to the alert.<br />
          <strong>Mentions</strong>: Admin set server/role level notifications.
        </p>
        <p className="admin-mention-help">Enable <strong>Allow subscriptions</strong> to show an alert in member Settings and <code>/alerts manage</code>. Turning it off hides the option in both places and pauses personal mentions. Saved subscriptions resume when you enable it again.</p>
        <p className="admin-mention-help">Role mentions and assigned watcher pings work independently of subscriptions. Tracking continues when messages are off. Status boards notify on new posts; edits stay silent.</p>
        {subscriptionControls.error ? <p role="alert" className="admin-mention-error admin-subscription-load-error">{subscriptionControls.error}
          <button type="button" className="admin-alert-route-test" disabled={subscriptionControls.loading || subscriptionControls.saving !== null} onClick={() => void subscriptionControls.load()}>Retry subscriptions</button>
        </p> : null}
        {mentionControls.error || mentionControls.data?.roles_error ? <p role="alert" className="admin-mention-error">{mentionControls.error || mentionControls.data?.roles_error}</p> : null}
        <button type="button" className="admin-alert-route-test" disabled={mentionControls.loading} onClick={() => void mentionControls.load()}>{mentionControls.loading ? "Loading roles…" : "Refresh roles"}</button>
        <div className="admin-alert-route-grid admin-alert-mention-grid">
          <div className="admin-alert-route-heading">Alert</div>
          <div className="admin-alert-route-heading">Status</div>
          <div className="admin-alert-route-heading">Current route</div>
          <div className="admin-alert-route-heading">Mentions</div>
          <div className="admin-alert-route-heading">Allow subscriptions</div>
          {alertRows.map((alert) => (
            <React.Fragment key={alert.key}>
              <div className="admin-alert-route-copy">
                <strong>{alert.label}</strong>
                <small>{alert.description}</small>
              </div>
              {alert.kind === "status" ? (
                <AlertRouteStatus label={alert.statusLabel} />
              ) : (
                <AlertToggle
                  label={alert.label}
                  checked={alert.checked}
                  disabled={!alert.configurable || isBusy !== null || isLoadingDiscordAlertSettings}
                  onChange={alert.onChange}
                />
              )}
              <AlertRoute
                alertKey={alert.key}
                label={alert.label}
                route={discordAlertRoutes[alert.key] ?? null}
                fallbackRoute={alert.key === DEFAULT_DISCORD_ALERT_ROUTE_KEY
                  ? null
                  : discordAlertRoutes[DEFAULT_DISCORD_ALERT_ROUTE_KEY] ?? null}
                testBusy={isBusy === `Test ${alert.label}`}
                testDisabled={isBusy !== null || isLoadingDiscordAlertSettings}
                onSaved={applyDiscordAlertSettingsResponse}
                runAdminAction={runAdminAction}
                onTest={() =>
                  runAdminAction(`Test ${alert.label}`, () => testAdminDiscordAlertRoute(alert.key))
                }
              />
              {alert.key === DEFAULT_DISCORD_ALERT_ROUTE_KEY ? <div className="admin-alert-mentions"><span className="admin-mention-summary">Set mentions per alert below.</span></div> :
                <DiscordAlertMentionEditor alertKey={alert.key} label={alert.label} controls={mentionControls} />}
              {alert.key === DEFAULT_DISCORD_ALERT_ROUTE_KEY ? <div className="admin-subscription-toggle"><small>Not applicable</small></div> :
                <DiscordSubscriptionToggle alertKey={alert.key} label={alert.label} controls={subscriptionControls} disabled={isBusy !== null} />}
            </React.Fragment>
          ))}
        </div>
      </section>

      <DiscordMessageDelete />

      <section className="panel admin-panel-discord-travel">
        <PanelHeader title="Travel tracker" aside={discordTravelTrackerStatus} />
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const factionId = Number(discordTravelTargetForm.factionId);
            if (!Number.isInteger(factionId) || factionId <= 0) {
              setError("Enter a valid faction ID.");
              return;
            }
            runTravelAction("Set Discord travel target", () =>
              setDiscordTravelTrackerTarget({
                faction_id: factionId,
                faction_name: discordTravelTargetForm.factionName.trim() || undefined,
              }),
            );
          }}
        >
          <label className="checkbox-row admin-form-wide">
            <input
              type="checkbox"
              checked={discordTravelTarget?.target_tracker.enabled ?? true}
              disabled={isBusy !== null || isLoadingDiscordTravelTarget}
              onChange={(event) =>
                runTravelAction("Update target travel tracker", () =>
                  updateDiscordTravelTrackerSettings({ target_enabled: event.target.checked }),
                )}
            />
            <span className="admin-alert-toggle-text">
              <strong>Target faction travel tracker</strong>
              <small>Tracks the current war enemy or the manual faction below.</small>
            </span>
          </label>
          <label className="checkbox-row admin-form-wide">
            <input
              type="checkbox"
              checked={discordTravelTarget?.home_tracker.enabled ?? false}
              disabled={isBusy !== null || isLoadingDiscordTravelTarget}
              onChange={(event) =>
                runTravelAction("Update home travel tracker", () =>
                  updateDiscordTravelTrackerSettings({ home_enabled: event.target.checked }),
                )}
            />
            <span className="admin-alert-toggle-text">
              <strong>Home travel tracker</strong>
              <small>Updates the home faction travel tracker message.</small>
            </span>
          </label>
          <label>
            <span>Faction ID</span>
            <input
              type="number"
              min="1"
              step="1"
              value={discordTravelTargetForm.factionId}
              onChange={(event) =>
                setDiscordTravelTargetForm((current) => ({
                  ...current,
                  factionId: event.target.value,
                }))}
              placeholder="12345"
            />
          </label>
          <label>
            <span>Faction name</span>
            <input
              type="text"
              value={discordTravelTargetForm.factionName}
              onChange={(event) =>
                setDiscordTravelTargetForm((current) => ({
                  ...current,
                  factionName: event.target.value,
                }))}
              placeholder="Optional"
            />
          </label>
          <button
            type="submit"
            className="admin-button primary"
            disabled={!canSetDiscordTravelTarget}
          >
            {isBusy === "Set Discord travel target" ? "Setting" : "Set target"}
          </button>
          <button
            type="button"
            className="admin-button"
            disabled={isBusy !== null || !discordTravelTarget?.manual_target}
            onClick={() =>
              runTravelAction("Clear Discord travel target", () =>
                clearDiscordTravelTrackerTarget().then((response) => {
                  setDiscordTravelTargetForm({ factionId: "", factionName: "" });
                  return response;
                }),
              )}
          >
            {isBusy === "Clear Discord travel target" ? "Clearing" : "Clear target"}
          </button>
          <button
            type="button"
            className="admin-button admin-form-wide"
            disabled={isBusy !== null}
            onClick={() => runTravelAction("Sync Discord travel tracker", syncDiscordTravelTracker)}
          >
            {isBusy === "Sync Discord travel tracker" ? "Syncing tracker" : "Sync tracker now"}
          </button>
        </form>
        <PanelHeader title="Current travel tracker status" />
        <div className="admin-metric-list admin-form-wide">
          <MetricLine
            label="Active source"
            value={formatDiscordTravelSource(discordTravelTarget?.active_source)}
          />
          <MetricLine
            label="Current target"
            value={formatDiscordTravelTarget(discordTravelTarget)}
          />
          <MetricLine
            label="Target tracker"
            value={discordTravelTarget?.target_tracker.enabled ? "Enabled" : "Disabled"}
          />
          <MetricLine
            label="Home tracker"
            value={discordTravelTarget?.home_tracker.enabled ? "Enabled" : "Disabled"}
          />
          <MetricLine
            label="Manual refreshed"
            value={formatOptionalUnixTime(discordTravelTarget?.manual_target?.last_refreshed_at ?? null)}
          />
          <MetricLine
            label="Target synced"
            value={formatOptionalUnixTime(discordTravelTarget?.target_tracker.last_synced_at ?? null)}
          />
          <MetricLine
            label="Home synced"
            value={formatOptionalUnixTime(discordTravelTarget?.home_tracker.last_synced_at ?? null)}
          />
        </div>
      </section>
      <DiscordMessageCompose disabled={isBusy !== null} />
    </>
  );
}

function AlertToggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="checkbox-row admin-alert-route-toggle">
      <input
        type="checkbox"
        aria-label={`${label} messages`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{checked ? "On" : "Off"}</span>
    </label>
  );
}

function AlertRouteStatus({ label }: { label: string }) {
  return (
    <div className="admin-alert-route-status">
      <span>{label}</span>
    </div>
  );
}

function AlertRoute({
  alertKey,
  label,
  route,
  fallbackRoute,
  testBusy,
  testDisabled,
  onSaved,
  runAdminAction,
  onTest,
}: {
  alertKey: string;
  label: string;
  route: DiscordAlertRouteSummary | null;
  fallbackRoute: DiscordAlertRouteSummary | null;
  testBusy: boolean;
  testDisabled: boolean;
  onSaved: (response: AdminDiscordAlertSettingsResponse) => void;
  runAdminAction: (label: string, action: () => Promise<unknown>) => void;
  onTest: () => void;
}) {
  const effectiveRoute = route ?? fallbackRoute;
  const actions = <DiscordRouteActions alertKey={alertKey} label={label} route={route}
    disabled={testDisabled} testBusy={testBusy} onTest={onTest} onSaved={onSaved} runAdminAction={runAdminAction} />;
  if (!effectiveRoute) {
    return (
      <div className="admin-alert-route-target is-unset">
        <strong>Unset</strong>
        <small>No bot channel route</small>
        {actions}
      </div>
    );
  }

  return (
    <div className="admin-alert-route-target">
      <strong title={effectiveRoute.thread_id
        ? `Thread ID: ${effectiveRoute.thread_id}; Channel ID: ${effectiveRoute.channel_id}`
        : `Channel ID: ${effectiveRoute.channel_id}`}>
        {!route
          ? "Using default fallback"
          : effectiveRoute.thread_id
            ? effectiveRoute.thread_name ?? `Thread ${effectiveRoute.thread_id}`
            : effectiveRoute.channel_name ? `#${effectiveRoute.channel_name}` : `Channel ${effectiveRoute.channel_id}`}
      </strong>
      <small>
        {effectiveRoute.thread_id
          ? effectiveRoute.channel_name ? `In #${effectiveRoute.channel_name}` : `Parent ${effectiveRoute.channel_id}`
          : "Channel"}
        {effectiveRoute.updated_at ? ` - ${formatLongDateTime(effectiveRoute.updated_at)}` : ""}
      </small>
      {actions}
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDiscordTravelSource(source: DiscordTravelTrackerTargetResponse["active_source"] | undefined): string {
  if (source === "war") return "War";
  if (source === "manual") return "Manual";
  if (source === "inactive") return "Inactive";
  return "Unknown";
}

function formatDiscordTravelTarget(target: DiscordTravelTrackerTargetResponse | null): string {
  if (target?.active_source === "war" && target.war_target) {
    return `${target.war_target.name} (${target.war_target.faction_id})`;
  }
  if (target?.active_source === "manual" && target.manual_target) {
    return `${target.manual_target.faction_name || "Unnamed"} (${target.manual_target.faction_id})`;
  }
  return "None";
}

function formatOptionalUnixTime(value: number | null): string {
  return value ? formatLongDateTime(value) : "Never";
}
