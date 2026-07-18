import React from "react";
import {
  AdminDiscordAlertSettingsResponse,
  ChainWatchAlertSetting,
  clearDiscordTravelTrackerTarget,
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

  return (
    <>
      <section className="panel admin-panel-shoplifting-alerts">
        <PanelHeader title="Discord alerts" aside={discordAlertStatus} />
        <div className="admin-form">
          {chainWatchAlert ? (
            <AlertToggle
              checked={chainWatchAlert.enabled}
              description="Controls the persistent Chain Watch status message; warning and drop routes still decide where mention pings go."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={chainWatchAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update chain watch alert", () =>
                  updateAdminChainWatchDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {retaliationBoardAlert ? (
            <AlertToggle
              checked={retaliationBoardAlert.enabled}
              description="Controls the persistent retaliation opportunity board updates sent to Discord."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={retaliationBoardAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update retaliation board alert", () =>
                  updateAdminRetaliationBoardDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {enemyPushAlert ? (
            <AlertToggle
              checked={enemyPushAlert.enabled}
              description="Sends pressure warnings when enemy activity looks likely to become, or is already, a push."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={enemyPushAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update enemy push alert", () =>
                  updateAdminEnemyPushDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {enemyScoutingReportAlert ? (
            <AlertToggle
              checked={enemyScoutingReportAlert.enabled}
              description="Sends the war matchup scouting report and stats images when enemy scouting is ready."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={enemyScoutingReportAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update enemy scouting report alert", () =>
                  updateAdminEnemyScoutingReportDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {xanaxCompetitionAlert ? (
            <AlertToggle
              checked={xanaxCompetitionAlert.enabled}
              description="Sends the monthly Xanax competition Discord reminder image when the competition is active."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={xanaxCompetitionAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update Xanax competition Discord alert", () =>
                  updateAdminXanaxCompetitionDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {termedWarAutoEndAlert ? (
            <AlertToggle
              checked={termedWarAutoEndAlert.enabled}
              description="Sends a Discord notice when a termed war score limit has been reached."
              disabled={isBusy !== null || isLoadingDiscordAlertSettings}
              label={termedWarAutoEndAlert.name}
              onChange={(enabled) => {
                runAdminAction("Update termed war auto-end alert", () =>
                  updateAdminTermedWarAutoEndDiscordAlert({ enabled }).then((response) => {
                    applyDiscordAlertSettingsResponse(response);
                    return response;
                  }),
                );
              }}
            />
          ) : null}
          {shopliftingAlerts.map((alert) => (
            alert.configurable ? (
              <AlertToggle
                checked={alert.enabled}
                description={`Sends a Discord warning when both ${alert.shop_name} shoplifting security obstacles are down.`}
                disabled={isBusy !== null || isLoadingDiscordAlertSettings}
                key={alert.shop_key}
                label={alert.shop_name}
                onChange={(enabled) => {
                  runAdminAction("Update shoplifting alert", () =>
                    updateAdminShopliftingDiscordAlert({
                      shop_key: alert.shop_key,
                      enabled,
                    }).then((response) => {
                      applyDiscordAlertSettingsResponse(response);
                      return response;
                    }),
                  );
                }}
              />
            ) : (
              <div className="admin-form-wide" key={alert.shop_key}>
                <MetricLine label={alert.shop_name} value={alert.enabled ? "Active" : "Paused"} />
              </div>
            )
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

function AlertToggle({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="checkbox-row admin-form-wide">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="admin-alert-toggle-text">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
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
