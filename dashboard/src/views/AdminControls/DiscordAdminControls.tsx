import React from "react";
import {
  AdminDiscordAlertSettingsResponse,
  ChainWatchAlertSetting,
  clearDiscordTravelTrackerTarget,
  DiscordAlertRouteSummary,
  DiscordTravelTrackerTargetResponse,
  EnemyScoutingReportAlertSetting,
  EnemyPushAlertSetting,
  RetaliationBoardAlertSetting,
  setDiscordTravelTrackerTarget,
  ShopliftingAlertSetting,
  syncDiscordTravelTracker,
  updateAdminChainWatchDiscordAlert,
  updateAdminEnemyPushDiscordAlert,
  updateAdminEnemyScoutingReportDiscordAlert,
  updateAdminRetaliationBoardDiscordAlert,
  updateAdminShopliftingDiscordAlert,
  updateAdminTermedWarAutoEndDiscordAlert,
  updateAdminXanaxCompetitionDiscordAlert,
  updateDiscordTravelTrackerSettings,
  TermedWarAutoEndAlertSetting,
  XanaxCompetitionAlertSetting,
} from "../../api";
import { PanelHeader } from "../../components/Common";
import { formatLongDateTime } from "../../utils/format";

export type DiscordTravelTargetForm = {
  factionId: string;
  factionName: string;
};

type DiscordAdminControlsProps = {
  isBusy: string | null;
  discordTravelTargetForm: DiscordTravelTargetForm;
  discordTravelTarget: DiscordTravelTrackerTargetResponse | null;
  isLoadingDiscordTravelTarget: boolean;
  chainWatchAlert: ChainWatchAlertSetting | null;
  retaliationBoardAlert: RetaliationBoardAlertSetting | null;
  shopliftingAlerts: ShopliftingAlertSetting[];
  enemyPushAlert: EnemyPushAlertSetting | null;
  enemyScoutingReportAlert: EnemyScoutingReportAlertSetting | null;
  xanaxCompetitionAlert: XanaxCompetitionAlertSetting | null;
  termedWarAutoEndAlert: TermedWarAutoEndAlertSetting | null;
  discordAlertRoutes: Record<string, DiscordAlertRouteSummary | null>;
  isLoadingDiscordAlertSettings: boolean;
  setDiscordTravelTargetForm: React.Dispatch<React.SetStateAction<DiscordTravelTargetForm>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  applyDiscordAlertSettingsResponse: (response: AdminDiscordAlertSettingsResponse) => void;
  runAdminAction: (label: string, action: () => Promise<unknown>) => void;
};

export function DiscordAdminControls({
  isBusy,
  discordTravelTargetForm,
  discordTravelTarget,
  isLoadingDiscordTravelTarget,
  chainWatchAlert,
  retaliationBoardAlert,
  shopliftingAlerts,
  enemyPushAlert,
  enemyScoutingReportAlert,
  xanaxCompetitionAlert,
  termedWarAutoEndAlert,
  discordAlertRoutes,
  isLoadingDiscordAlertSettings,
  setDiscordTravelTargetForm,
  setError,
  applyDiscordAlertSettingsResponse,
  runAdminAction,
}: DiscordAdminControlsProps) {
  const discordAlertStatus = isLoadingDiscordAlertSettings
    ? "Loading"
    : shopliftingAlerts.length > 0 || enemyPushAlert || chainWatchAlert || retaliationBoardAlert
      || enemyScoutingReportAlert || xanaxCompetitionAlert || termedWarAutoEndAlert
      ? `${[
          ...(chainWatchAlert ? [chainWatchAlert.enabled] : []),
          ...(retaliationBoardAlert ? [retaliationBoardAlert.enabled] : []),
          ...shopliftingAlerts.map((alert) => alert.enabled),
          ...(enemyPushAlert ? [enemyPushAlert.enabled] : []),
          ...(enemyScoutingReportAlert ? [enemyScoutingReportAlert.enabled] : []),
          ...(xanaxCompetitionAlert ? [xanaxCompetitionAlert.enabled] : []),
          ...(termedWarAutoEndAlert ? [termedWarAutoEndAlert.enabled] : []),
        ].filter(Boolean).length}/${
          shopliftingAlerts.length +
          (enemyPushAlert ? 1 : 0) +
          (chainWatchAlert ? 1 : 0) +
          (retaliationBoardAlert ? 1 : 0) +
          (enemyScoutingReportAlert ? 1 : 0) +
          (xanaxCompetitionAlert ? 1 : 0) +
          (termedWarAutoEndAlert ? 1 : 0)
        } active`
      : "Unavailable";
  const discordTravelTrackerStatus = isLoadingDiscordTravelTarget
    ? "Loading"
    : discordTravelTarget
      ? `${discordTravelTarget.target_tracker.enabled ? "Target on" : "Target off"} / ${discordTravelTarget.home_tracker.enabled ? "Home on" : "Home off"}`
      : "Unavailable";
  const canSetDiscordTravelTarget =
    isBusy === null &&
    Number.isInteger(Number(discordTravelTargetForm.factionId)) &&
    Number(discordTravelTargetForm.factionId) > 0;
  const discordAlertRows = [
    chainWatchAlert
      ? {
          key: chainWatchAlert.key,
          checked: chainWatchAlert.enabled,
          configurable: chainWatchAlert.configurable,
          description: "Controls the persistent Chain Watch status message; warning and drop routes still decide where mention pings go.",
          label: chainWatchAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update chain watch alert", () =>
              updateAdminChainWatchDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    retaliationBoardAlert
      ? {
          key: retaliationBoardAlert.key,
          checked: retaliationBoardAlert.enabled,
          configurable: retaliationBoardAlert.configurable,
          description: "Controls the persistent retaliation opportunity board updates sent to Discord.",
          label: retaliationBoardAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update retaliation board alert", () =>
              updateAdminRetaliationBoardDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    enemyPushAlert
      ? {
          key: enemyPushAlert.key,
          checked: enemyPushAlert.enabled,
          configurable: enemyPushAlert.configurable,
          description: "Sends pressure warnings when enemy activity looks likely to become, or is already, a push.",
          label: enemyPushAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update enemy push alert", () =>
              updateAdminEnemyPushDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    enemyScoutingReportAlert
      ? {
          key: enemyScoutingReportAlert.key,
          checked: enemyScoutingReportAlert.enabled,
          configurable: enemyScoutingReportAlert.configurable,
          description: "Sends the war matchup scouting report and stats images when enemy scouting is ready.",
          label: enemyScoutingReportAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update enemy scouting report alert", () =>
              updateAdminEnemyScoutingReportDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    xanaxCompetitionAlert
      ? {
          key: xanaxCompetitionAlert.key,
          checked: xanaxCompetitionAlert.enabled,
          configurable: xanaxCompetitionAlert.configurable,
          description: "Sends the monthly Xanax competition Discord reminder image when the competition is active.",
          label: xanaxCompetitionAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update Xanax competition Discord alert", () =>
              updateAdminXanaxCompetitionDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    termedWarAutoEndAlert
      ? {
          key: termedWarAutoEndAlert.key,
          checked: termedWarAutoEndAlert.enabled,
          configurable: termedWarAutoEndAlert.configurable,
          description: "Sends a Discord notice when a termed war score limit has been reached.",
          label: termedWarAutoEndAlert.name,
          onChange: (enabled: boolean) => {
            runAdminAction("Update termed war auto-end alert", () =>
              updateAdminTermedWarAutoEndDiscordAlert({ enabled }).then((response) => {
                applyDiscordAlertSettingsResponse(response);
                return response;
              }),
            );
          },
        }
      : null,
    ...shopliftingAlerts.map((alert) => ({
      key: `shoplifting_security_alert:${alert.shop_key}`,
      checked: alert.enabled,
      configurable: alert.configurable,
      description: `Sends a Discord warning when both ${alert.shop_name} shoplifting security obstacles are down.`,
      label: alert.shop_name,
      onChange: (enabled: boolean) => {
        runAdminAction("Update shoplifting alert", () =>
          updateAdminShopliftingDiscordAlert({
            shop_key: alert.shop_key,
            enabled,
          }).then((response) => {
            applyDiscordAlertSettingsResponse(response);
            return response;
          }),
        );
      },
    })),
  ].filter((row): row is {
    key: string;
    checked: boolean;
    configurable: boolean;
    description: string;
    label: string;
    onChange: (enabled: boolean) => void;
  } => Boolean(row));

  return (
    <>
      <section className="panel admin-panel-shoplifting-alerts">
        <PanelHeader title="Discord alerts" aside={discordAlertStatus} />
        <div className="admin-alert-route-grid">
          <div className="admin-alert-route-heading">Alert</div>
          <div className="admin-alert-route-heading">Status</div>
          <div className="admin-alert-route-heading">Current route</div>
          {discordAlertRows.map((alert) => (
            <React.Fragment key={alert.key}>
              <div className="admin-alert-route-copy">
                <strong>{alert.label}</strong>
                <small>{alert.description}</small>
              </div>
              <AlertToggle
                checked={alert.checked}
                disabled={!alert.configurable || isBusy !== null || isLoadingDiscordAlertSettings}
                onChange={alert.onChange}
              />
              <AlertRoute route={discordAlertRoutes[alert.key] ?? null} />
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="panel admin-panel-discord-travel">
        <PanelHeader title="Travel tracker controls" aside={discordTravelTrackerStatus} />
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const factionId = Number(discordTravelTargetForm.factionId);
            if (!Number.isInteger(factionId) || factionId <= 0) {
              setError("Enter a valid faction ID.");
              return;
            }
            runAdminAction("Set Discord travel target", () =>
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
                runAdminAction("Update target travel tracker", () =>
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
                runAdminAction("Update home travel tracker", () =>
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
              runAdminAction("Clear Discord travel target", () =>
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
            onClick={() => runAdminAction("Sync Discord travel tracker", syncDiscordTravelTracker)}
          >
            {isBusy === "Sync Discord travel tracker" ? "Syncing tracker" : "Sync tracker now"}
          </button>
        </form>
      </section>

      <section className="panel admin-panel-discord-travel-status">
        <PanelHeader title="Travel tracker status" />
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
    </>
  );
}

function AlertToggle({ checked, disabled, onChange }: {
  checked: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="checkbox-row admin-alert-route-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{checked ? "On" : "Off"}</span>
    </label>
  );
}

function AlertRoute({ route }: { route: DiscordAlertRouteSummary | null }) {
  if (!route) {
    return (
      <div className="admin-alert-route-target is-unset">
        <strong>Unset</strong>
        <small>No bot channel route</small>
      </div>
    );
  }

  return (
    <div className="admin-alert-route-target">
      <strong>{route.thread_id ? `Thread ${route.thread_id}` : `Channel ${route.channel_id}`}</strong>
      <small>
        {route.thread_id ? `Parent ${route.channel_id}` : `Target ${route.target_id}`}
        {route.updated_at ? ` - ${formatLongDateTime(route.updated_at)}` : ""}
      </small>
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
