import React from "react";
import {
  AdminDiscordAlertSettingsResponse,
  ChainWatchAlertSetting,
  clearDiscordTravelTrackerTarget,
  DiscordTravelTrackerTargetResponse,
  EnemyPushAlertSetting,
  RetaliationBoardAlertSetting,
  setDiscordTravelTrackerTarget,
  ShopliftingAlertSetting,
  syncDiscordTravelTracker,
  updateAdminChainWatchDiscordAlert,
  updateAdminEnemyPushDiscordAlert,
  updateAdminRetaliationBoardDiscordAlert,
  updateAdminShopliftingDiscordAlert,
  updateDiscordTravelTrackerSettings,
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
  isLoadingDiscordAlertSettings,
  setDiscordTravelTargetForm,
  setError,
  applyDiscordAlertSettingsResponse,
  runAdminAction,
}: DiscordAdminControlsProps) {
  const discordAlertStatus = isLoadingDiscordAlertSettings
    ? "Loading"
    : shopliftingAlerts.length > 0 || enemyPushAlert || chainWatchAlert || retaliationBoardAlert
      ? `${[
          ...(chainWatchAlert ? [chainWatchAlert.enabled] : []),
          ...(retaliationBoardAlert ? [retaliationBoardAlert.enabled] : []),
          ...shopliftingAlerts.map((alert) => alert.enabled),
          ...(enemyPushAlert ? [enemyPushAlert.enabled] : []),
        ].filter(Boolean).length}/${
          shopliftingAlerts.length +
          (enemyPushAlert ? 1 : 0) +
          (chainWatchAlert ? 1 : 0) +
          (retaliationBoardAlert ? 1 : 0)
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
      <section className="panel admin-panel-discord-travel">
        <PanelHeader title="Discord travel tracker" aside={discordTravelTrackerStatus} />
        <div className="admin-metric-list admin-form-wide">
          <MetricLine
            label="Active source"
            value={formatDiscordTravelSource(discordTravelTarget?.active_source)}
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
            label="War target"
            value={discordTravelTarget?.war_target
              ? `${discordTravelTarget.war_target.name} (${discordTravelTarget.war_target.faction_id})`
              : "None"}
          />
          <MetricLine
            label="Manual target"
            value={discordTravelTarget?.manual_target
              ? `${discordTravelTarget.manual_target.faction_name || "Unnamed"} (${discordTravelTarget.manual_target.faction_id})`
              : "None"}
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
            <span>Enemy/manual travel tracker</span>
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
            <span>Home travel tracker</span>
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

      <section className="panel admin-panel-shoplifting-alerts">
        <PanelHeader title="Discord alerts" aside={discordAlertStatus} />
        <div className="admin-form">
          {chainWatchAlert ? (
            <label className="checkbox-row admin-form-wide">
              <input
                type="checkbox"
                checked={chainWatchAlert.enabled}
                disabled={isBusy !== null || isLoadingDiscordAlertSettings}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  runAdminAction("Update chain watch alert", () =>
                    updateAdminChainWatchDiscordAlert({ enabled }).then((response) => {
                      applyDiscordAlertSettingsResponse(response);
                      return response;
                    }),
                  );
                }}
              />
              <span>{chainWatchAlert.name}</span>
            </label>
          ) : null}
          {retaliationBoardAlert ? (
            <label className="checkbox-row admin-form-wide">
              <input
                type="checkbox"
                checked={retaliationBoardAlert.enabled}
                disabled={isBusy !== null || isLoadingDiscordAlertSettings}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  runAdminAction("Update retaliation board alert", () =>
                    updateAdminRetaliationBoardDiscordAlert({ enabled }).then((response) => {
                      applyDiscordAlertSettingsResponse(response);
                      return response;
                    }),
                  );
                }}
              />
              <span>{retaliationBoardAlert.name}</span>
            </label>
          ) : null}
          {enemyPushAlert ? (
            <label className="checkbox-row admin-form-wide">
              <input
                type="checkbox"
                checked={enemyPushAlert.enabled}
                disabled={isBusy !== null || isLoadingDiscordAlertSettings}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  runAdminAction("Update enemy push alert", () =>
                    updateAdminEnemyPushDiscordAlert({ enabled }).then((response) => {
                      applyDiscordAlertSettingsResponse(response);
                      return response;
                    }),
                  );
                }}
              />
              <span>{enemyPushAlert.name}</span>
            </label>
          ) : null}
          {shopliftingAlerts.map((alert) => (
            alert.configurable ? (
              <label className="checkbox-row admin-form-wide" key={alert.shop_key}>
                <input
                  type="checkbox"
                  checked={alert.enabled}
                  disabled={isBusy !== null || isLoadingDiscordAlertSettings}
                  onChange={(event) => {
                    const enabled = event.target.checked;
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
                <span>{alert.shop_name}</span>
              </label>
            ) : (
              <div className="admin-form-wide" key={alert.shop_key}>
                <MetricLine label={alert.shop_name} value={alert.enabled ? "Active" : "Paused"} />
              </div>
            )
          ))}
        </div>
      </section>
    </>
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

function formatOptionalUnixTime(value: number | null): string {
  return value ? formatLongDateTime(value) : "Never";
}
