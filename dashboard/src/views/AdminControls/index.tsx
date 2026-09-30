import { useAuth } from "../../auth/AuthProvider";
import { PracticalPhases } from "../../components/PracticalPhases";
import React from "react";
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import {
  AdminWarPayload,
  cancelMemberLifestyleRepairJob,
  createEvent,
  createMemberLifestyleRepairJob,
  AdminDiscordAlertSettingsResponse,
  DiscordAlertRouteSummary,
  DiscordTravelTrackerTargetResponse,
  EnemyStatsImagePreviewType,
  endActiveWar,
  exportWarAttacksCsv,
  fetchTornWarReport,
  getDiscordTravelTrackerTarget,
  getAdminXanaxCompetition,
  getAdminDiscordAlertSettings,
  getHomeFactionReportExemptions,
  getMemberLifestyleRepairJobs,
  getWars,
  grantAdminAccess,
  revokeAdminAccess,
  AdminUser,
  importEvent,
  importWar,
  listAdminUsers,
  previewEnemyStatsImage,
  previewImportEvent,
  previewImportWar,
  previewRelinkAttacks,
  previewXanaxCompetitionImage,
  pullAttackWindow,
  recordAdminXanaxCompetitionClaim,
  rebuildStats,
  refreshMemberAchievements,
  resetEnemyStatsImageLatches,
  restartLiveEnemyTracking,
  relinkAttacks,
  runIngestion,
  updateAdminXanaxCompetitionSettings,
  updateHomeFactionReportExemption,
  updateOfficialWar,
  updateEvent,
  AdminXanaxCompetitionResponse,
  HomeFactionReportExemptionMember,
  MemberLifestyleRepairJob,
  WarSummary,
  WarType,
} from "../../api";
import { PanelHeader } from "../../components/Common";
import { formatLongDateTime, formatNumber } from "../../utils/format";
import { DiscordAdminControls, DiscordTravelTargetForm } from "./DiscordAdminControls";

import type { DiscordAlertSettingsMap } from "../../../../shared/discordAlertSettings";
import { discordAlertSettingsFromResponse } from "../../../../shared/discordAlertSettingsCompatibility";

type AdminTabKey = "operations" | "discord" | "wars" | "reporting" | "maintenance";

const ADMIN_TABS: Array<{ key: AdminTabKey; label: string }> = [
  { key: "operations", label: "Access management" },
  { key: "discord", label: "Discord" },
  { key: "wars", label: "Wars & Events" },
  { key: "reporting", label: "Reporting" },
  { key: "maintenance", label: "Maintenance" },
];

export function AdminControls() {
  const { session: authSession, signIn, signOut } = useAuth();
  const [useEpochTime, setUseEpochTime] = React.useState(false);
  const [tornKey, setTornKey] = React.useState("");
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [importWarForm, setImportWarForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
  }));
  const [createEventForm, setCreateEventForm] = React.useState<AdminWarFormState>(() =>
    defaultEventForm(),
  );
  const [eventImportForm, setEventImportForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultEventForm(),
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    startEpoch: String(Math.floor(Date.now() / 1000) - 3600),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
    status: "ended",
  }));
  const [eventImportFetchMissing, setEventImportFetchMissing] = React.useState(false);
  const [relinkForm, setRelinkForm] = React.useState({
    scope: "selected" as "selected" | "all",
    warId: "",
    fetchMissing: false,
  });
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [currentWarEditForm, setCurrentWarEditForm] = React.useState<AdminWarFormState>(() =>
    defaultWarForm(),
  );
  const [historicalWarEditForm, setHistoricalWarEditForm] = React.useState<AdminWarFormState>(() =>
    defaultWarForm(),
  );
  const [selectedHistoricalWarId, setSelectedHistoricalWarId] = React.useState("");
  const [eventEditForm, setEventEditForm] = React.useState<AdminWarFormState>(() =>
    defaultEventForm(),
  );
  const [selectedEventId, setSelectedEventId] = React.useState("");
  const [exportForm, setExportForm] = React.useState<AdminExportFormState>({
    warName: "",
    scope: "war_relevant" as "all" | "outgoing" | "war_relevant",
    startWindow: "official" as ExportBoundaryWindow,
    finishWindow: "official" as ExportBoundaryWindow,
    linkedStatus: "linked" as "linked" | "matching" | "unlinked",
    columns: "standard" as "standard" | "debug",
    customStartTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    customFinishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    customStartEpoch: String(Math.floor(Date.now() / 1000) - 3600),
    customFinishEpoch: String(Math.floor(Date.now() / 1000)),
  });
  const [reportForm, setReportForm] = React.useState({ tornWarId: "" });
  const [adminGrantForm, setAdminGrantForm] = React.useState({ tornUserId: "" });
  const [adminUsers, setAdminUsers] = React.useState<AdminUser[]>([]);
  const [adminUsersError, setAdminUsersError] = React.useState<string | null>(null);
  const [isLoadingAdmins, setIsLoadingAdmins] = React.useState(false);
  const [discordTravelTargetForm, setDiscordTravelTargetForm] = React.useState<DiscordTravelTargetForm>({
    factionId: "",
    factionName: "",
  });
  const [discordTravelTarget, setDiscordTravelTarget] =
    React.useState<DiscordTravelTrackerTargetResponse | null>(null);
  const [isLoadingDiscordTravelTarget, setIsLoadingDiscordTravelTarget] = React.useState(false);
  const [xanaxCompetition, setXanaxCompetition] =
    React.useState<AdminXanaxCompetitionResponse | null>(null);
  const [isLoadingXanaxCompetition, setIsLoadingXanaxCompetition] = React.useState(false);
  const [discordAlertSettings, setDiscordAlertSettings] = React.useState<DiscordAlertSettingsMap>({});
  const [discordAlertRoutes, setDiscordAlertRoutes] =
    React.useState<Record<string, DiscordAlertRouteSummary | null>>({});
  const [isLoadingDiscordAlertSettings, setIsLoadingDiscordAlertSettings] = React.useState(false);
  const [xanaxSettingsForm, setXanaxSettingsForm] = React.useState({
    enabled: true,
    basePrize: "10000000",
    rolloverCount: "0",
  });
  const [xanaxClaimForm, setXanaxClaimForm] = React.useState({
    memberId: "",
    monthKey: currentMonthKey(),
    prizePaid: "",
  });
  const [rebuildWarId, setRebuildWarId] = React.useState("");
  const [restartTrackingWarId, setRestartTrackingWarId] = React.useState("");
  const [statsImagePreviewType, setStatsImagePreviewType] =
    React.useState<EnemyStatsImagePreviewType>("comparison");
  const [attackWindowForm, setAttackWindowForm] = React.useState({
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    startEpoch: String(Math.floor(Date.now() / 1000) - 3600),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
    limit: "100",
  });
  const [lifestyleRepairForm, setLifestyleRepairForm] = React.useState({
    startDate: utcDateFromDaysAgo(7),
    endDate: utcDateFromDaysAgo(0),
    memberId: "",
    callsPerMinutePerKey: "35",
  });
  const [lifestyleRepairJobs, setLifestyleRepairJobs] = React.useState<MemberLifestyleRepairJob[]>([]);
  const [isLoadingLifestyleRepairJobs, setIsLoadingLifestyleRepairJobs] = React.useState(false);
  const [reportExemptionMembers, setReportExemptionMembers] = React.useState<HomeFactionReportExemptionMember[]>([]);
  const [reportExemptionsError, setReportExemptionsError] = React.useState<string | null>(null);
  const [reportExemptionForm, setReportExemptionForm] = React.useState({
    memberId: "",
    reason: "",
  });
  const [isBusy, setIsBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ label: string; data: unknown; warning?: string } | null>(null);
  const actionInFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeAdminTab, setActiveAdminTab] = React.useState<AdminTabKey>("operations");
  const adminTimeMode: AdminWarFormState["timeMode"] = useEpochTime ? "epoch" : "datetime";

  React.useEffect(() => {
    let cancelled = false;

    async function loadWars() {
      if (authSession?.access_level !== "admin") {
        return;
      }

      try {
        const response = await getWars("all");
        if (cancelled) {
          return;
        }

        applyLoadedWars(response.wars);
      } catch {
        if (!cancelled) {
          setWars([]);
        }
      }
    }

    loadWars();
    window.addEventListener("practical-phases-changed", loadWars);
    return () => {
      cancelled = true;
      window.removeEventListener("practical-phases-changed", loadWars);
    };
  }, [authSession?.access_level, adminTimeMode]);

  function applyLoadedWars(loadedWars: WarSummary[]) {
    setWars(loadedWars);

    const firstExportableWar = loadedWars.find(isExportableWar);
    setExportForm((current) => ({
      ...exportFormForWar(
        current,
        loadedWars.find((war) => war.name === current.warName) ?? firstExportableWar,
      ),
    }));

    const currentOfficialWar = loadedWars.find(isCurrentOfficialWar);
    setCurrentWarEditForm((current) =>
      currentOfficialWar
        ? convertWarFormTimeMode(warToForm(currentOfficialWar), adminTimeMode)
        : current,
    );
    setRestartTrackingWarId((current) => {
      const currentStillValid = loadedWars.some(
        (war) => String(war.id) === current && war.enemy_faction_id !== null,
      );
      if (currentStillValid) {
        return current;
      }

      const firstTrackingWar =
        loadedWars.find((war) => isCurrentOfficialWar(war) && war.enemy_faction_id !== null) ??
        loadedWars.find((war) => war.enemy_faction_id !== null);
      return firstTrackingWar ? String(firstTrackingWar.id) : "";
    });

    const firstHistoricalWar = loadedWars.find(isHistoricalOfficialWar);
    const selectedHistoricalWar =
      loadedWars.find((war) => war.id === Number(selectedHistoricalWarId) && isHistoricalOfficialWar(war)) ??
      firstHistoricalWar;
    setSelectedHistoricalWarId(selectedHistoricalWar ? String(selectedHistoricalWar.id) : "");
    setHistoricalWarEditForm((current) =>
      selectedHistoricalWar
        ? convertWarFormTimeMode(warToForm(selectedHistoricalWar), adminTimeMode)
        : current,
    );

    const loadedEvents = loadedWars.filter(isEventWar);
    const firstEvent = loadedEvents[0] ?? null;
    const selectedEvent =
      loadedEvents.find((war) => war.id === Number(selectedEventId)) ?? firstEvent;
    setSelectedEventId(selectedEvent ? String(selectedEvent.id) : "");
    setEventEditForm((current) =>
      selectedEvent
        ? convertWarFormTimeMode(warToForm(selectedEvent), adminTimeMode)
        : current,
    );

  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthenticating(true);
    setError(null);

    try {
      await signIn(tornKey);
      setTornKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAuthenticating(false);
    }
  }

  function logout() {
    signOut();
    setResult(null);
  }

  function setGlobalTimeMode(useEpoch: boolean) {
    const timeMode: AdminWarFormState["timeMode"] = useEpoch ? "epoch" : "datetime";
    setUseEpochTime(useEpoch);
    setImportWarForm((current) => convertWarFormTimeMode(current, timeMode));
    setCreateEventForm((current) => convertWarFormTimeMode(current, timeMode));
    setEventImportForm((current) => convertWarFormTimeMode(current, timeMode));
    setEventEditForm((current) => convertWarFormTimeMode(current, timeMode));
    setCurrentWarEditForm((current) => convertWarFormTimeMode(current, timeMode));
    setHistoricalWarEditForm((current) => convertWarFormTimeMode(current, timeMode));
    setExportForm((current) => convertExportFormTimeMode(current, timeMode));
    setAttackWindowForm((current) => convertAttackWindowFormTimeMode(current, timeMode));
  }

  async function runAdminAction(label: string, action: () => Promise<unknown>, options: { refresh?: Array<() => Promise<void>> } = {}) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setIsBusy(label);
    setError(null);
    setResult(null);

    try {
      const data = await action();
      setResult({ label, data });
      const refreshed = await Promise.allSettled((options.refresh ?? []).map(refresh => refresh()));
      if (refreshed.some(refresh => refresh.status === "rejected")) {
        setResult({ label, data, warning: "The action completed, but refreshed data could not be loaded. Reload the page before continuing." });
      }
    } catch (err) {
      setError(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      actionInFlight.current = false;
      setIsBusy(null);
    }
  }

  async function loadAdminUsers() {
    setIsLoadingAdmins(true); setAdminUsersError(null);
    try { setAdminUsers((await listAdminUsers()).admins); }
    catch (err) { setAdminUsersError(err instanceof Error ? err.message : String(err)); }
    finally { setIsLoadingAdmins(false); }
  }

  async function refreshWarOptions() {
    const loaded = (await getWars("all")).wars;
    setWars(loaded);
    setRelinkForm(current => loaded.some(war => String(war.id) === current.warId) ? current : { ...current, warId: "" });
    setRebuildWarId(current => loaded.some(war => String(war.id) === current) ? current : "");
    setRestartTrackingWarId(current => loaded.some(war => String(war.id) === current) ? current : "");
    setExportForm(current => loaded.some(war => war.name === current.warName) ? current : exportFormForWar({ ...current, warName: "" }, undefined));
    const nextOpen = loaded.find(isCurrentOfficialWar);
    if (nextOpen && nextOpen.id !== currentOfficialWar?.id) setCurrentWarEditForm(convertWarFormTimeMode(warToForm(nextOpen), adminTimeMode));
    if (!loaded.some(war => war.id === Number(selectedHistoricalWarId))) {
      const next = loaded.find(isHistoricalOfficialWar);
      setSelectedHistoricalWarId(next ? String(next.id) : "");
      if (next) setHistoricalWarEditForm(convertWarFormTimeMode(warToForm(next), adminTimeMode));
    }
    if (!loaded.some(war => war.id === Number(selectedEventId))) {
      const next = loaded.find(isEventWar);
      setSelectedEventId(next ? String(next.id) : "");
      setEventEditForm(next ? convertWarFormTimeMode(warToForm(next), adminTimeMode) : defaultEventForm());
    }
  }

  function runWarAction(label: string, action: () => Promise<unknown>) {
    return runAdminAction(label, action, { refresh: [refreshWarOptions] });
  }

  function runRepairAction(label: string, action: () => Promise<unknown>) {
    return runAdminAction(label, action, { refresh: [loadLifestyleRepairJobs] });
  }

  function runExemptionAction(label: string, action: () => Promise<unknown>) {
    return runAdminAction(label, action, { refresh: [loadReportExemptions] });
  }

  function runAccessAction(label: string, action: () => Promise<unknown>) {
    return runAdminAction(label, action, { refresh: [loadAdminUsers] });
  }

  function handleAdminTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tabKey: AdminTabKey) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const currentIndex = ADMIN_TABS.findIndex((tab) => tab.key === tabKey);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % ADMIN_TABS.length
      : (currentIndex - 1 + ADMIN_TABS.length) % ADMIN_TABS.length;
    setActiveAdminTab(ADMIN_TABS[nextIndex].key);
    document.getElementById(`admin-tab-${ADMIN_TABS[nextIndex].key}`)?.focus();
  }

  function confirmRebuildAllStats(): boolean {
    if (rebuildWarId.trim() !== "") {
      return true;
    }

    return window.confirm("Rebuild stats for all wars? This can take longer than rebuilding a selected war.");
  }

  function applyEventResponse(response: unknown) {
    const updatedWar = (response as { war?: WarSummary }).war;
    if (!updatedWar) {
      return;
    }

    setWars((current) => {
      const existing = current.some((war) => war.id === updatedWar.id);
      return existing
        ? current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war))
        : [updatedWar, ...current];
    });
    setSelectedEventId(String(updatedWar.id));
    setEventEditForm(convertWarFormTimeMode(warToForm(updatedWar), adminTimeMode));
    setExportForm((current) =>
      current.warName === updatedWar.name || current.warName === ""
        ? exportFormForWar({ ...current, warName: updatedWar.name }, updatedWar)
        : current,
    );
  }

  async function loadLifestyleRepairJobs() {
    setIsLoadingLifestyleRepairJobs(true);
    try {
      const response = await getMemberLifestyleRepairJobs();
      setLifestyleRepairJobs(response.jobs);
    } catch {
      setLifestyleRepairJobs([]);
    } finally {
      setIsLoadingLifestyleRepairJobs(false);
    }
  }

  async function loadReportExemptions() {
    setReportExemptionsError(null);
    try {
      const response = await getHomeFactionReportExemptions();
      setReportExemptionMembers(response.members);
      const availableMemberIds = new Set(
        response.members
          .filter((member) => member.is_current === 1 && member.report_exempt === 0)
          .map((member) => String(member.member_id)),
      );
      setReportExemptionForm((current) => ({
        ...current,
        memberId: availableMemberIds.has(current.memberId)
          ? current.memberId
          : String(response.members.find((member) => member.is_current === 1 && member.report_exempt === 0)?.member_id ?? ""),
      }));
    } catch (err) {
      setReportExemptionsError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadXanaxCompetition(updateForm = true) {
    setIsLoadingXanaxCompetition(true);
    try {
      const response = await getAdminXanaxCompetition();
      setXanaxCompetition(response);
      if (updateForm) setXanaxSettingsForm({
        enabled: response.settings.enabled,
        basePrize: String(response.settings.base_prize),
        rolloverCount: String(response.settings.rollover_count),
      });
      setXanaxClaimForm((current) => ({
        ...current,
        monthKey: response.settings.month_key,
        prizePaid: current.prizePaid || String(response.settings.current_prize),
      }));
    } catch {
      setXanaxCompetition(null);
    } finally {
      setIsLoadingXanaxCompetition(false);
    }
  }

  function applyDiscordAlertSettingsResponse(response: AdminDiscordAlertSettingsResponse) {
    setDiscordAlertSettings(discordAlertSettingsFromResponse(response));
    setDiscordAlertRoutes(response.routes ?? {});
  }

  async function loadDiscordAlertSettings() {
    setIsLoadingDiscordAlertSettings(true);
    try {
      const response = await getAdminDiscordAlertSettings();
      applyDiscordAlertSettingsResponse(response);
    } catch {
      setDiscordAlertSettings({});
      setDiscordAlertRoutes({});
    } finally {
      setIsLoadingDiscordAlertSettings(false);
    }
  }

  async function loadDiscordTravelTarget() {
    setIsLoadingDiscordTravelTarget(true);
    try {
      const response = await getDiscordTravelTrackerTarget();
      setDiscordTravelTarget(response);
      setDiscordTravelTargetForm((current) => ({
        factionId: current.factionId || String(response.manual_target?.faction_id ?? ""),
        factionName: current.factionName || (response.manual_target?.faction_name ?? ""),
      }));
    } catch {
      setDiscordTravelTarget(null);
    } finally {
      setIsLoadingDiscordTravelTarget(false);
    }
  }

  React.useEffect(() => {
    if (authSession?.access_level === "admin") {
      loadAdminUsers();
      loadLifestyleRepairJobs();
      loadReportExemptions();
      loadDiscordAlertSettings();
      loadDiscordTravelTarget();
      loadXanaxCompetition();
    }
  }, [authSession?.access_level]);

  React.useEffect(() => { setResult(null); setError(null); }, [activeAdminTab]);

  const canRelink = isBusy === null && (relinkForm.scope === "all" || wars.some(war => String(war.id) === relinkForm.warId));
  const exportableWars = wars.filter(isExportableWar);
  const officialWars = wars.filter(isOfficialWar);
  const events = wars.filter(isEventWar);
  const currentOfficialWar = officialWars.find(isCurrentOfficialWar) ?? null;
  const historicalOfficialWars = officialWars.filter(isHistoricalOfficialWar);
  const currentEvent = events.find((war) => war.status === "active") ?? null;
  const selectedEvent = events.find((war) => war.id === Number(selectedEventId)) ?? null;
  const historicalEvents = events.filter((war) => war.status === "ended");
  const currentReportableMembers = reportExemptionMembers.filter(
    (member) => member.is_current === 1 && member.report_exempt === 0,
  );
  return (
    <>
      {error ? <div className="error-panel" role="alert">{error}</div> : null}

      <section className="hero-panel compact-hero-panel admin-header-panel">
        <h2>Admin controls</h2>
        {authSession?.access_level === "admin" ? (
          <div className="admin-header-controls">
            <span>{authSession.user.name ?? `Torn user ${authSession.user.id}`}</span>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={useEpochTime}
                onChange={(event) => setGlobalTimeMode(event.target.checked)}
              />
              <span>Epoch time</span>
            </label>
          </div>
        ) : null}
      </section>

      {!authSession ? (
        <section className="panel admin-auth-panel">
          <PanelHeader title="Admin sign in" />
          <form className="admin-form" onSubmit={login}>
            <label className="admin-form-wide">
              <span>Torn API key</span>
              <input
                type="password"
                value={tornKey}
                onChange={(event) => setTornKey(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button
              type="submit"
              className="admin-button primary admin-form-wide"
              disabled={isAuthenticating}
            >
              {isAuthenticating ? "Checking" : "Sign in"}
            </button>
          </form>
        </section>
      ) : authSession.access_level !== "admin" ? (
        <section className="panel admin-auth-panel">
          <PanelHeader title="Admin access required" />
          <p>
            Signed in as {authSession.user.name ?? `Torn user ${authSession.user.id}`}, but this
            Torn user ID is not in the D1 admin allowlist.
          </p>
          <button type="button" className="admin-button" onClick={logout}>
            Sign out
          </button>
        </section>
      ) : null}

      {authSession?.access_level === "admin" ? (
      <>
      <nav className="admin-tabs" role="tablist" aria-label="Admin control sections">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            id={`admin-tab-${tab.key}`}
            className="admin-tab-button"
            role="tab"
            disabled={isBusy !== null}
            aria-selected={activeAdminTab === tab.key}
            aria-controls={`admin-panel-${tab.key}`}
            tabIndex={activeAdminTab === tab.key ? 0 : -1}
            onClick={() => setActiveAdminTab(tab.key)}
            onKeyDown={(event) => handleAdminTabKeyDown(event, tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {isBusy ? <p role="status" className="admin-action-notice">{isBusy}…</p> : null}
      {result ? <AdminActionResult result={result} /> : null}
      <section
        id={`admin-panel-${activeAdminTab}`}
        className="admin-grid admin-tab-workspace"
        role="tabpanel"
        aria-labelledby={`admin-tab-${activeAdminTab}`}
      >
        {activeAdminTab === "operations" ? (
        <>
        <section className="panel admin-panel-access">
          <PanelHeader title="Admin access" />
          <div className="admin-metric-list admin-form-wide">
            <MetricLine
              label="Signed in"
              value={authSession.user.name ?? `Torn user ${authSession.user.id}`}
            />
            <MetricLine label="Access level" value={authSession.access_level} />
          </div>
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAccessAction("Grant admin access", () =>
                grantAdminAccess(Number(adminGrantForm.tornUserId.trim())),
              );
            }}
          >
            <label>
              <span>Torn user ID</span>
              <input
                inputMode="numeric"
                value={adminGrantForm.tornUserId}
                onChange={(event) => setAdminGrantForm({ tornUserId: event.target.value })}
                placeholder="1234567"
                required
              />
            </label>
            <button
              type="submit"
              className="admin-button primary"
              disabled={isBusy !== null || adminGrantForm.tornUserId.trim().length === 0}
            >
              Grant admin
            </button>
            <button
              type="button"
              className="admin-button admin-form-wide"
              disabled={isBusy !== null}
              onClick={loadAdminUsers}
            >
              {isLoadingAdmins ? "Loading admins" : "Refresh admin list"}
            </button>
            <button
              type="button"
              className="admin-button admin-form-wide"
              disabled={isBusy !== null}
              onClick={logout}
            >
              Sign out
            </button>
          </form>
          {adminUsersError ? <p role="alert" className="error-panel">{adminUsersError}</p> : null}
          <div className="stock-status-table-wrap">
            <table className="stock-status-table" aria-label="Current administrators">
              <thead><tr><th>Admin</th><th>Granted</th><th>Action</th></tr></thead>
              <tbody>{adminUsers.map(admin => <tr key={admin.torn_user_id}>
                <td>{admin.name ?? "Torn user"} [{admin.torn_user_id}]</td>
                <td>{formatLongDateTime(admin.created_at)}</td>
                <td>{admin.torn_user_id === authSession.user.id ? "You" : <button type="button" className="admin-button danger"
                  disabled={isBusy !== null || isLoadingAdmins || adminUsers.length < 2}
                  onClick={() => {
                    if (window.confirm("Revoke admin access for " + (admin.name ?? admin.torn_user_id) + "? Existing sessions will lose admin access. They will remain a member until access is granted again.")) {
                      runAccessAction("Revoke admin access", () => revokeAdminAccess(admin.torn_user_id));
                    }
                  }}>Revoke access</button>}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!isLoadingAdmins && !adminUsersError && adminUsers.length === 0 ? <p>No administrators found.</p> : null}
          <p className="panel-description">Revoked users keep member access. Only another admin can restore their admin access.</p>

        </section>

        </>
        ) : null}

        {activeAdminTab === "discord" ? (
          <DiscordAdminControls
            isBusy={isBusy}
            discordTravelTargetForm={discordTravelTargetForm}
            discordTravelTarget={discordTravelTarget}
            isLoadingDiscordTravelTarget={isLoadingDiscordTravelTarget}
            discordAlertSettings={discordAlertSettings}
            discordAlertRoutes={discordAlertRoutes}
            isLoadingDiscordAlertSettings={isLoadingDiscordAlertSettings}
            setDiscordTravelTargetForm={setDiscordTravelTargetForm}
            setError={setError}
            applyDiscordAlertSettingsResponse={applyDiscordAlertSettingsResponse}
            refreshTravelTarget={loadDiscordTravelTarget}
            runAdminAction={runAdminAction}
          />
        ) : null}

        {activeAdminTab === "wars" ? (
        <>
        <AdminSettingsSection section="wars" title="Wars" description="Official ranked and termed war records">

        {currentOfficialWar ? (
          <section className="panel admin-panel-edit-official">
            <PanelHeader title="Edit open war" aside={currentOfficialWar.name} />
            <PracticalPhases key={currentOfficialWar.id} war={currentOfficialWar} admin />
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                runAdminAction("Update open war", () =>
                  updateOfficialWar(toPracticalWarEditPayload(currentOfficialWar.id, currentWarEditForm)).then((response) => {
                    const updatedWar = (response as { war?: WarSummary }).war;
                    if (updatedWar) {
                      setWars((current) =>
                        current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war)),
                      );
                      setCurrentWarEditForm(convertWarFormTimeMode(warToForm(updatedWar), adminTimeMode));
                      setExportForm((current) =>
                        current.warName === updatedWar.name
                          ? exportFormForWar(current, updatedWar)
                          : exportFormForWar({ ...current, warName: updatedWar.name }, updatedWar),
                      );
                    }
                    return response;
                  }),
                );
              }}
            >
              <WarFields
                form={currentWarEditForm}
                onChange={setCurrentWarEditForm}
                practicalOnly
                allowedWarTypes={["real", "termed"]}
              />
              {!currentWarEditForm.phasesManaged && <>
              <button
                type="button"
                className="admin-button"
                disabled={isBusy !== null}
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000);
                  setCurrentWarEditForm((current) => {
                    const next = {
                      ...current,
                      startTime: dateTimeLocalFromSeconds(now),
                      startEpoch: String(now),
                    };
                    return convertWarFormTimeMode(next, adminTimeMode);
                  });
                }}
              >
                Set practical start now
              </button>
              <button
                type="button"
                className="admin-button"
                disabled={isBusy !== null}
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000);
                  setCurrentWarEditForm((current) => {
                    const next = {
                      ...current,
                      finishTime: dateTimeLocalFromSeconds(now),
                      finishEpoch: String(now),
                    };
                    return convertWarFormTimeMode(next, adminTimeMode);
                  });
                }}
              >
                Set practical finish now
              </button>
              </>}
              <button
                type="submit"
                className="admin-button primary admin-form-wide"
                disabled={isBusy !== null}
              >
                Confirm changes
              </button>
            </form>
          </section>
        ) : null}

        <AdminSettingsSection section="historical-wars" title="Historical wars" description="Edit / import">
          <div className="admin-event-grid">
            <section className="panel admin-event-command">
              <PanelHeader title="Edit historical war" />
              {historicalOfficialWars.find((war) => war.id === Number(selectedHistoricalWarId)) && <PracticalPhases key={selectedHistoricalWarId} war={historicalOfficialWars.find((war) => war.id === Number(selectedHistoricalWarId))!} admin />}
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Update historical war", () =>
                    updateOfficialWar(toPracticalWarEditPayload(Number(selectedHistoricalWarId), historicalWarEditForm)).then((response) => {
                      const updatedWar = (response as { war?: WarSummary }).war;
                      if (updatedWar) {
                        setWars((current) =>
                          current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war)),
                        );
                        setHistoricalWarEditForm(convertWarFormTimeMode(warToForm(updatedWar), adminTimeMode));
                        setExportForm((current) =>
                          current.warName === updatedWar.name
                            ? exportFormForWar(current, updatedWar)
                            : current,
                        );
                      }
                      return response;
                    }),
                  );
                }}
              >
                <label className="admin-form-wide">
                  <span>War</span>
                  <select
                    value={selectedHistoricalWarId}
                    onChange={(event) => {
                      const war = historicalOfficialWars.find((candidate) => candidate.id === Number(event.target.value));
                      setSelectedHistoricalWarId(event.target.value);
                      if (war) {
                        setHistoricalWarEditForm(convertWarFormTimeMode(warToForm(war), adminTimeMode));
                      }
                    }}
                    required
                  >
                    <option value="" disabled>
                      Select war
                    </option>
                    {historicalOfficialWars.map((war) => (
                      <option value={war.id} key={war.id}>
                        {war.name}
                        {war.torn_war_id ? ` / Torn #${war.torn_war_id}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <WarFields
                  form={historicalWarEditForm}
                  onChange={setHistoricalWarEditForm}
                  practicalOnly
                  allowedWarTypes={["real", "termed"]}
                />
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null || !selectedHistoricalWarId}
                >
                  Confirm changes
                </button>
              </form>
            </section>

            <WarForm
              title="Import historical war"
              panelClassName="admin-event-command"
              form={importWarForm}
              onChange={setImportWarForm}
              isBusy={isBusy !== null}
              requireFinishTime
              hideName
              allowedWarTypes={["real", "termed"]}
              secondaryActionLabel="Preview import window"
              onSecondaryAction={(payload) =>
                runAdminAction("Preview import window", () => previewImportWar(payload))
              }
              onSubmit={(payload) => runWarAction("Import war", () => importWar(payload))}
            />
          </div>
        </AdminSettingsSection>

        </AdminSettingsSection>

        <AdminSettingsSection section="events" title="Events" description="Manual attack and defend tracking windows">

        <section className="admin-event-grid admin-event-controls-grid">
          <section className="panel admin-event-command">
            <PanelHeader
              title="Edit event"
              aside={events.length === 0 ? "No events" : currentEvent ? `Active: ${currentEvent.name}` : `${events.length} events`}
            />
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                runAdminAction("Update event", () =>
                  updateEvent(toEventPayload(eventEditForm, {
                    id: Number(selectedEventId),
                  })).then((response) => {
                    applyEventResponse(response);
                    return response;
                  }),
                );
              }}
            >
              <label className="admin-form-wide">
                <span>Event</span>
                <select
                  value={selectedEventId}
                  disabled={isBusy !== null}
                  onChange={(event) => {
                    const selected = events.find((candidate) => candidate.id === Number(event.target.value));
                    setSelectedEventId(event.target.value);
                    if (selected) {
                      setEventEditForm(convertWarFormTimeMode(warToForm(selected), adminTimeMode));
                    }
                  }}
                  required
                >
                  <option value="" disabled>
                    Select event
                  </option>
                  {events.map((eventWar) => (
                    <option value={eventWar.id} key={eventWar.id}>
                      {eventWar.name} / {eventWar.status}
                    </option>
                  ))}
                </select>
              </label>
              <WarFields
                form={eventEditForm}
                onChange={setEventEditForm}
                showStatus
                showFinishTimes
                showTornFields={false}
                breakAfterWarType
                allowedWarTypes={["event"]}
              />
              <label className="checkbox-row admin-form-wide">
                <input
                  type="checkbox"
                  checked={eventEditForm.chainWatchEnabled}
                  onChange={(event) =>
                    setEventEditForm((current) => ({
                      ...current,
                      chainWatchEnabled: event.target.checked,
                    }))
                  }
                />
                <span>Enable Chain Watch</span>
              </label>
              <button
                type="button"
                className="admin-button"
                disabled={isBusy !== null || !selectedEventId}
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000);
                  setEventEditForm((current) =>
                    convertWarFormTimeMode({
                      ...current,
                      status: "active",
                      startTime: dateTimeLocalFromSeconds(now),
                      startEpoch: String(now),
                    }, adminTimeMode),
                  );
                }}
              >
                Start selected now
              </button>
              <button
                type="button"
                className="admin-button danger with-icon"
                disabled={isBusy !== null || selectedEvent?.status !== "active"}
                onClick={() => {
                  if (!selectedEvent || selectedEvent.status !== "active" || !window.confirm(
                    `Finish ${selectedEvent.name} now? This ends tracking immediately. Unsaved edits will not be applied.`,
                  )) {
                    return;
                  }
                  runAdminAction("Finish event now", () =>
                    endActiveWar({ war_id: selectedEvent.id }).then((response) => {
                      applyEventResponse({
                        war: {
                          ...selectedEvent,
                          status: "ended",
                          practical_finish_time: response.practical_finish_time,
                        },
                      });
                      return response;
                    }),
                  );
                }}
              >
                <Square size={16} aria-hidden="true" />
                {isBusy === "Finish event now" ? "Finishing event" : "Finish event now"}
              </button>
              <button
                type="submit"
                className="admin-button primary admin-form-wide"
                disabled={isBusy !== null || !selectedEventId}
              >
                Save event
              </button>
            </form>
          </section>

          <section className="panel admin-event-command">
            <PanelHeader title="Create event" aside="Schedule or start" />
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                runAdminAction("Create event", () =>
                  createEvent(toEventPayload(createEventForm)).then((response) => {
                    applyEventResponse(response);
                    return response;
                  }),
                );
              }}
            >
              <WarFields
                form={createEventForm}
                onChange={setCreateEventForm}
                showStatus
                showFinishTimes
                showTornFields={false}
                breakAfterWarType
                allowedWarTypes={["event"]}
              />
              <label className="checkbox-row admin-form-wide">
                <input
                  type="checkbox"
                  checked={createEventForm.chainWatchEnabled}
                  onChange={(event) =>
                    setCreateEventForm((current) => ({
                      ...current,
                      chainWatchEnabled: event.target.checked,
                    }))
                  }
                />
                <span>Enable Chain Watch</span>
              </label>
              <button
                type="button"
                className="admin-button"
                disabled={isBusy !== null}
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000);
                  setCreateEventForm((current) =>
                    convertWarFormTimeMode({
                      ...current,
                      status: "active",
                      startTime: dateTimeLocalFromSeconds(now),
                      startEpoch: String(now),
                    }, adminTimeMode),
                  );
                }}
              >
                Start now
              </button>
              <button
                type="submit"
                className="admin-button primary admin-form-wide"
                disabled={isBusy !== null}
              >
                Create event
              </button>
            </form>
          </section>

          <section className="panel admin-event-command">
            <PanelHeader
              title="Import historical event"
              aside={historicalEvents.length > 0 ? `${historicalEvents.length} saved` : "Past window"}
            />
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                runAdminAction("Import historical event", () =>
                  importEvent(toEventPayload(eventImportForm, {
                    status: "ended",
                    fetchMissing: eventImportFetchMissing,
                  })).then((response) => {
                    applyEventResponse(response);
                    return response;
                  }),
                );
              }}
            >
              <WarFields
                form={eventImportForm}
                onChange={setEventImportForm}
                showFinishTimes
                showTornFields={false}
                breakAfterWarType
                allowedWarTypes={["event"]}
              />
              <label className="checkbox-row admin-form-wide">
                <input
                  type="checkbox"
                  checked={eventImportFetchMissing}
                  onChange={(event) => setEventImportFetchMissing(event.target.checked)}
                />
                <span>Fetch missing attacks from Torn before linking</span>
              </label>
              <button
                type="button"
                className="admin-button admin-form-wide"
                disabled={isBusy !== null}
                onClick={() =>
                  runAdminAction("Preview event import", () =>
                    previewImportEvent(toEventPayload(eventImportForm, {
                      status: "ended",
                      fetchMissing: eventImportFetchMissing,
                    })),
                  )
                }
              >
                Preview event import
              </button>
              <button
                type="submit"
                className="admin-button primary admin-form-wide"
                disabled={isBusy !== null}
              >
                Import historical event
              </button>
            </form>
          </section>
        </section>

        </AdminSettingsSection>

        <AdminSettingsSection section="competitions" title="Competitions" description="Competition settings and prize claims">
        <section className="panel admin-panel-xanax-competition">
          <PanelHeader
            title="Xanax competition"
            aside={isLoadingXanaxCompetition ? "Loading" : xanaxCompetition ? formatPrize(xanaxCompetition.settings.current_prize) : "Unavailable"}
          />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Update Xanax competition", () =>
                updateAdminXanaxCompetitionSettings({
                  enabled: xanaxSettingsForm.enabled,
                  base_prize: Number(xanaxSettingsForm.basePrize),
                  rollover_count: Number(xanaxSettingsForm.rolloverCount),
                }),
                { refresh: [() => loadXanaxCompetition()] },
              );
            }}
          >
            <label className="checkbox-row admin-form-wide">
              <input
                type="checkbox"
                checked={xanaxSettingsForm.enabled}
                onChange={(event) => setXanaxSettingsForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>Competition enabled</span>
            </label>
            <label>
              <span>Base prize</span>
              <input
                inputMode="numeric"
                value={xanaxSettingsForm.basePrize}
                onChange={(event) => setXanaxSettingsForm((current) => ({ ...current, basePrize: event.target.value }))}
              />
            </label>
            <label>
              <span>Rollovers</span>
              <input
                inputMode="numeric"
                value={xanaxSettingsForm.rolloverCount}
                onChange={(event) => setXanaxSettingsForm((current) => ({ ...current, rolloverCount: event.target.value }))}
              />
            </label>
            <button
              type="submit"
              className="admin-button primary admin-form-wide"
              disabled={isBusy !== null}
            >
              {isBusy === "Update Xanax competition" ? "Saving" : "Save competition settings"}
            </button>
            <button
              type="button"
              className="admin-button admin-form-wide"
              disabled={isBusy !== null}
              onClick={() =>
                runAdminAction("Preview Xanax competition image", () => previewXanaxCompetitionImage())
              }
            >
              {isBusy === "Preview Xanax competition image" ? "Opening" : "Preview competition image"}
            </button>
          </form>

          <form
            className="admin-form admin-subform"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Record Xanax claim", () =>
                recordAdminXanaxCompetitionClaim({
                  member_id: Number(xanaxClaimForm.memberId),
                  month_key: xanaxClaimForm.monthKey.trim() || undefined,
                  prize_paid: xanaxClaimForm.prizePaid.trim()
                    ? Number(xanaxClaimForm.prizePaid)
                    : undefined,
                }),
                { refresh: [() => loadXanaxCompetition(false)] },
              );
            }}
          >
            <label>
              <span>Claiming member</span>
              <select
                value={xanaxClaimForm.memberId}
                onChange={(event) => setXanaxClaimForm((current) => ({ ...current, memberId: event.target.value }))}
              >
                <option value="">Select eligible member</option>
                {(xanaxCompetition?.leaderboard ?? [])
                  .filter((row) => row.eligible)
                  .map((row) => (
                    <option key={row.member_id} value={row.member_id}>
                      {row.member_name ?? `#${row.member_id}`} ({formatNumber(row.monthly_xanax)})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Month</span>
              <input
                value={xanaxClaimForm.monthKey}
                placeholder="YYYY-MM"
                onChange={(event) => setXanaxClaimForm((current) => ({ ...current, monthKey: event.target.value }))}
              />
            </label>
            <label>
              <span>Prize paid</span>
              <input
                inputMode="numeric"
                value={xanaxClaimForm.prizePaid}
                onChange={(event) => setXanaxClaimForm((current) => ({ ...current, prizePaid: event.target.value }))}
              />
            </label>
            <button
              type="submit"
              className="admin-button primary admin-form-wide"
              disabled={isBusy !== null || xanaxClaimForm.memberId.trim().length === 0}
            >
              {isBusy === "Record Xanax claim" ? "Recording" : "Record claim"}
            </button>
          </form>

          <div className="admin-xanax-summary">
            <MetricLine
              label="Displayed month"
              value={xanaxCompetition?.settings.month_key ?? currentMonthKey()}
            />
            <MetricLine
              label="Eligible now"
              value={formatNumber((xanaxCompetition?.leaderboard ?? []).filter((row) => row.eligible).length)}
            />
            <MetricLine
              label="Latest data"
              value={xanaxCompetition?.latest_snapshot_date ?? "-"}
            />
          </div>
          {(xanaxCompetition?.claims ?? []).length > 0 ? (
            <div className="admin-xanax-claims">
              {xanaxCompetition!.claims.slice(0, 4).map((claim) => (
                <div key={claim.id}>
                  <strong>{claim.member_name ?? `#${claim.member_id}`}</strong>
                  <span>{claim.month_key} | {formatPrize(claim.prize_paid)}</span>
                  <small>{formatLongDateTime(claim.claimed_at)}</small>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        </AdminSettingsSection>

        </>
        ) : null}

        {activeAdminTab === "reporting" ? <div className="admin-settings-content">
<section className="admin-tool-section admin-tool-section-wide">
              <PanelHeader title="Export attacks CSV" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Export attacks CSV", async () => {
                    await exportWarAttacksCsv({
                      warName: exportForm.warName,
                      scope: exportForm.scope,
                      startWindow: exportForm.startWindow,
                      finishWindow: exportForm.finishWindow,
                      linkedStatus: exportForm.linkedStatus,
                      columns: exportForm.columns,
                      customStart: exportForm.startWindow === "custom"
                        ? exportSecondsFromForm(exportForm, adminTimeMode, "start")
                        : undefined,
                      customFinish: exportForm.finishWindow === "custom"
                        ? exportSecondsFromForm(exportForm, adminTimeMode, "finish")
                        : undefined,
                    });
                    return { ok: true, exported: exportForm.warName };
                  });
                }}
              >
                <label className="admin-form-wide">
                  <span>War/event</span>
                  <select
                    value={exportForm.warName}
                    onChange={(event) => {
                      const war = exportableWars.find((candidate) => candidate.name === event.target.value);
                      setExportForm(exportFormForWar({ ...exportForm, warName: event.target.value }, war));
                    }}
                    required
                  >
                    <option value="" disabled>
                      Select war
                    </option>
                    {exportableWars.map((war) => (
                      <option value={war.name} key={war.id}>
                        {war.name}
                        {war.torn_war_id ? ` / Torn #${war.torn_war_id}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Attack scope</span>
                  <select
                    value={exportForm.scope}
                    onChange={(event) =>
                      setExportForm({
                        ...exportForm,
                        scope: event.target.value as typeof exportForm.scope,
                      })
                    }
                  >
                    <option value="all">All attacks in time period</option>
                    <option value="outgoing">Outgoing only</option>
                    <option value="war_relevant">Outgoing + incoming from enemy</option>
                  </select>
                </label>
                <label>
                  <span>Export start</span>
                  <select
                    value={exportForm.startWindow}
                    onChange={(event) => {
                      const nextForm = {
                        ...exportForm,
                        startWindow: event.target.value as ExportBoundaryWindow,
                      };
                      const war = exportableWars.find((candidate) => candidate.name === nextForm.warName);
                      setExportForm(exportFormForWar(nextForm, war));
                    }}
                  >
                    <option value="official">Torn official start</option>
                    <option value="practical">Buttgrass practical start</option>
                    <option value="custom">Custom start</option>
                  </select>
                </label>
                <label>
                  <span>Custom start</span>
                  {adminTimeMode === "epoch" ? (
                    <input
                      inputMode="numeric"
                      value={exportForm.customStartEpoch}
                      disabled={exportForm.startWindow !== "custom"}
                      onChange={(event) =>
                        setExportForm(updateExportEpoch(exportForm, "start", event.target.value))
                      }
                    />
                  ) : (
                    <input
                      type="datetime-local"
                      value={exportForm.customStartTime}
                      disabled={exportForm.startWindow !== "custom"}
                      onChange={(event) =>
                        setExportForm(updateExportDateTime(exportForm, "start", event.target.value))
                      }
                    />
                  )}
                </label>
                <label>
                  <span>Export finish</span>
                  <select
                    value={exportForm.finishWindow}
                    onChange={(event) => {
                      const nextForm = {
                        ...exportForm,
                        finishWindow: event.target.value as ExportBoundaryWindow,
                      };
                      const war = exportableWars.find((candidate) => candidate.name === nextForm.warName);
                      setExportForm(exportFormForWar(nextForm, war));
                    }}
                  >
                    <option value="official">Torn official finish</option>
                    <option value="practical">Buttgrass practical finish</option>
                    <option value="custom">Custom finish</option>
                  </select>
                </label>
                <label>
                  <span>Custom finish</span>
                  {adminTimeMode === "epoch" ? (
                    <input
                      inputMode="numeric"
                      value={exportForm.customFinishEpoch}
                      disabled={exportForm.finishWindow !== "custom"}
                      onChange={(event) =>
                        setExportForm(updateExportEpoch(exportForm, "finish", event.target.value))
                      }
                    />
                  ) : (
                    <input
                      type="datetime-local"
                      value={exportForm.customFinishTime}
                      disabled={exportForm.finishWindow !== "custom"}
                      onChange={(event) =>
                        setExportForm(updateExportDateTime(exportForm, "finish", event.target.value))
                      }
                    />
                  )}
                </label>
                <label>
                  <span>Linked status</span>
                  <select
                    value={exportForm.linkedStatus}
                    onChange={(event) =>
                      setExportForm({
                        ...exportForm,
                        linkedStatus: event.target.value as typeof exportForm.linkedStatus,
                      })
                    }
                  >
                    <option value="linked">Only attacks already linked to this war/event</option>
                    <option value="matching">All attacks in this time period that match selected scope</option>
                    <option value="unlinked">Only attacks not currently linked to any war/event</option>
                  </select>
                </label>
                <label>
                  <span>Columns</span>
                  <select
                    value={exportForm.columns}
                    onChange={(event) =>
                      setExportForm({
                        ...exportForm,
                        columns: event.target.value as typeof exportForm.columns,
                      })
                    }
                  >
                    <option value="standard">Standard export</option>
                    <option value="debug">Debug export</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null || !exportForm.warName}
                >
                  Export CSV
                </button>
              </form>
            </section>
<section className="admin-tool-section">
              <PanelHeader title="Report exemptions" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const memberId = Number(reportExemptionForm.memberId);
                  runExemptionAction("Add report exemption", () =>
                    updateHomeFactionReportExemption({
                      member_id: memberId,
                      report_exempt: true,
                      reason: reportExemptionForm.reason.trim() || undefined,
                    }),
                  );
                }}
              >
                <label>
                  <span>Member</span>
                  <select
                    value={reportExemptionForm.memberId}
                    onChange={(event) =>
                      setReportExemptionForm({ ...reportExemptionForm, memberId: event.target.value })
                    }
                    required
                  >
                    <option value="">Select member</option>
                    {currentReportableMembers.map((member) => (
                      <option key={member.member_id} value={member.member_id}>
                        {member.name} [{member.member_id}]
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Reason</span>
                  <input
                    value={reportExemptionForm.reason}
                    maxLength={240}
                    onChange={(event) =>
                      setReportExemptionForm({ ...reportExemptionForm, reason: event.target.value })
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null || !reportExemptionForm.memberId}
                >
                  {isBusy === "Add report exemption" ? "Saving" : "Exclude from reports"}
                </button>
              </form>

              {reportExemptionsError ? <p role="alert" className="error-panel">{reportExemptionsError}</p> : null}
              <button type="button" className="admin-button" disabled={isBusy !== null} onClick={loadReportExemptions}>Refresh exemptions</button>
              <div className="stock-status-table-wrap">
                <table className="stock-status-table" aria-label="Excluded members">
                  <thead><tr><th>Member</th><th>Reason</th><th>Action</th></tr></thead>
                  <tbody>{reportExemptionMembers.filter(member => member.report_exempt === 1).map(member => <tr key={member.member_id}>
                    <td>{member.name} [{member.member_id}]</td><td>{member.report_exempt_reason || "No reason supplied"}</td>
                    <td><button type="button" className="admin-button" disabled={isBusy !== null}
                      onClick={() => runExemptionAction("Restore member to reports", () => updateHomeFactionReportExemption({ member_id: member.member_id, report_exempt: false }))}>
                      Restore to reports
                    </button></td>
                  </tr>)}</tbody>
                </table>
              </div>
              {!reportExemptionsError && !reportExemptionMembers.some(member => member.report_exempt === 1) ? <p>No members are excluded from reports.</p> : null}
            </section>
        </div> : null}
        {activeAdminTab === "maintenance" ? <div className="admin-settings-content">
<AdminSettingsSection section="diagnostics" title="Diagnostics" description="Refresh status, API usage and saved keys">
<p className="panel-description">View refresh timings, API usage, key health and errors in Data health.</p><a className="admin-button" href="/data-health">Open Data health</a>
</AdminSettingsSection>
<AdminSettingsSection section="repairs" title="Repairs" description="Ingestion, statistics, historical data and member repairs">
<div className="admin-repair-grid"><section className="admin-tool-section admin-maintenance-backfill">
              <PanelHeader title="Attack ingestion and statistics" />
              <button
                type="button"
                className="admin-button primary"
                disabled={isBusy !== null}
                onClick={() => runWarAction("Run ingestion", runIngestion)}
              >
                {isBusy === "Run ingestion" ? "Working" : "Run ingestion"}
              </button>
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!confirmRebuildAllStats()) {
                    return;
                  }
                  const warId = Number(rebuildWarId);
                  runWarAction("Rebuild stats", () =>
                    rebuildStats(rebuildWarId.trim() === "" ? undefined : warId),
                  );
                }}
              >
                <label className="admin-form-wide">
                  Rebuild one war
                  <select
                    value={rebuildWarId}
                    onChange={(event) => setRebuildWarId(event.target.value)}
                  >
                    <option value="">All wars</option>
                    {wars.map((war) => (
                      <option key={war.id} value={war.id}>
                        #{war.id} {war.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null}
                >
                  {isBusy === "Rebuild stats" ? "Working" : rebuildWarId ? "Rebuild selected war" : "Rebuild all stats"}
                </button>
              </form>
</section>
<section className="admin-tool-section admin-maintenance-repair">
              <PanelHeader title="Reassign attacks to wars/events" />
              <form className="admin-form" onSubmit={event => {
                event.preventDefault();
                if (!canRelink) return;
                if (relinkForm.scope === "all" && !window.confirm("Reassign attacks and rebuild statistics for ALL wars and events?")) return;
                runWarAction("Reassign attacks to wars/events", () => relinkAttacks(toRelinkPayload(relinkForm)));
              }}>
                <label className="admin-form-wide"><span>Reassignment scope</span>
                  <select value={relinkForm.scope} disabled={isBusy !== null} onChange={event => setRelinkForm({ ...relinkForm, scope: event.target.value as "selected" | "all" })}>
                    <option value="selected">Selected war/event</option><option value="all">All wars and events</option>
                  </select>
                </label>
                {relinkForm.scope === "selected" ? <label className="admin-form-wide"><span>War/event to reassign</span>
                  <select value={relinkForm.warId} required disabled={isBusy !== null} onChange={event => setRelinkForm({ ...relinkForm, warId: event.target.value })}>
                    <option value="">Select a war/event</option>
                    {wars.map(war => <option key={war.id} value={war.id}>#{war.id} {war.name}</option>)}
                  </select>
                </label> : <p className="panel-description admin-form-wide">This will process every war and event and rebuild their statistics.</p>}
                <label className="checkbox-row admin-form-wide"><input type="checkbox" checked={relinkForm.fetchMissing}
                  disabled={isBusy !== null} onChange={event => setRelinkForm({ ...relinkForm, fetchMissing: event.target.checked })} />
                  <span>Fetch missing attacks first</span>
                </label>
                <p className="panel-description admin-form-wide">Preview checks stored attacks without making changes. If fetching is enabled, the final totals may include additional attacks.</p>
                <button type="button" className="admin-button admin-form-wide" disabled={!canRelink}
                  onClick={() => runAdminAction("Preview attack reassignment", () => previewRelinkAttacks(toRelinkPayload(relinkForm)))}>Preview reassignment</button>
                <button type="submit" className="admin-button primary admin-form-wide" disabled={!canRelink}>
                  {relinkForm.scope === "all" ? "Reassign all wars and events" : "Reassign selected war/event"}
                </button>
              </form>
            </section>
<section className="admin-tool-section admin-maintenance-backfill">
              <PanelHeader title="Manual Torn report fetch" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runWarAction("Manual Torn report fetch", () =>
                    fetchTornWarReport(Number(reportForm.tornWarId)),
                  );
                }}
              >
                <label>
                  <span>Torn war ID</span>
                  <input
                    inputMode="numeric"
                    value={reportForm.tornWarId}
                    onChange={(event) => setReportForm({ tornWarId: event.target.value })}
                    required
                  />
                </label>
                <button type="submit" className="admin-button primary admin-form-wide" disabled={isBusy !== null}>
                  Fetch Torn report
                </button>
              </form>
            </section>
<section className="admin-tool-section admin-maintenance-backfill">
              <PanelHeader title="Inspect Torn attacks by time range" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Inspect Torn attacks", () =>
                    pullAttackWindow({
                      practical_start_time: attackWindowSecondsFromForm(
                        attackWindowForm,
                        adminTimeMode,
                        "start",
                      ),
                      practical_finish_time: attackWindowSecondsFromForm(
                        attackWindowForm,
                        adminTimeMode,
                        "finish",
                      ),
                      limit: attackWindowForm.limit.trim() ? Number(attackWindowForm.limit) : undefined,
                    }),
                  );
                }}
              >
                <label>
                  <span>Start time</span>
                  {adminTimeMode === "epoch" ? (
                    <input
                      inputMode="numeric"
                      value={attackWindowForm.startEpoch}
                      onChange={(event) =>
                        setAttackWindowForm(
                          updateAttackWindowEpoch(attackWindowForm, "start", event.target.value),
                        )
                      }
                      required
                    />
                  ) : (
                    <input
                      type="datetime-local"
                      value={attackWindowForm.startTime}
                      onChange={(event) =>
                        setAttackWindowForm(
                          updateAttackWindowDateTime(attackWindowForm, "start", event.target.value),
                        )
                      }
                      required
                    />
                  )}
                </label>
                <label>
                  <span>Finish time</span>
                  {adminTimeMode === "epoch" ? (
                    <input
                      inputMode="numeric"
                      value={attackWindowForm.finishEpoch}
                      onChange={(event) =>
                        setAttackWindowForm(
                          updateAttackWindowEpoch(attackWindowForm, "finish", event.target.value),
                        )
                      }
                      required
                    />
                  ) : (
                    <input
                      type="datetime-local"
                      value={attackWindowForm.finishTime}
                      onChange={(event) =>
                        setAttackWindowForm(
                          updateAttackWindowDateTime(attackWindowForm, "finish", event.target.value),
                        )
                      }
                      required
                    />
                  )}
                </label>
                <label>
                  <span>Returned attacks</span>
                  <input
                    inputMode="numeric"
                    value={attackWindowForm.limit}
                    onChange={(event) =>
                      setAttackWindowForm({ ...attackWindowForm, limit: event.target.value })
                    }
                  />
                </label>
                <button type="submit" className="admin-button primary admin-form-wide" disabled={isBusy !== null}>
                  Inspect attacks
                </button>
              </form>
            </section>
<section className="admin-tool-section admin-tool-section-wide admin-maintenance-repair">
              <PanelHeader title="Member lifestyle repair" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runRepairAction("Create lifestyle repair", () =>
                    createMemberLifestyleRepairJob({
                      start_date: lifestyleRepairForm.startDate,
                      end_date: lifestyleRepairForm.endDate,
                      calls_per_minute_per_key: Number(lifestyleRepairForm.callsPerMinutePerKey || 35),
                      member_id: lifestyleRepairForm.memberId.trim()
                        ? Number(lifestyleRepairForm.memberId.trim())
                        : undefined,
                    }),
                  );
                }}
              >
                <label>
                  <span>Start date</span>
                  <input
                    type="date"
                    value={lifestyleRepairForm.startDate}
                    onChange={(event) =>
                      setLifestyleRepairForm({ ...lifestyleRepairForm, startDate: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  <span>End date</span>
                  <input
                    type="date"
                    value={lifestyleRepairForm.endDate}
                    onChange={(event) =>
                      setLifestyleRepairForm({ ...lifestyleRepairForm, endDate: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  <span>Member ID</span>
                  <input
                    inputMode="numeric"
                    placeholder="All current members"
                    value={lifestyleRepairForm.memberId}
                    onChange={(event) =>
                      setLifestyleRepairForm({ ...lifestyleRepairForm, memberId: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Calls/min/key</span>
                  <input
                    inputMode="numeric"
                    value={lifestyleRepairForm.callsPerMinutePerKey}
                    onChange={(event) =>
                      setLifestyleRepairForm({ ...lifestyleRepairForm, callsPerMinutePerKey: event.target.value })
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null}
                >
                  {isBusy === "Create lifestyle repair" ? "Creating" : "Create repair job"}
                </button>
              </form>
              <div className="admin-inline-actions">
                <button
                  type="button"
                  className="admin-button"
                  disabled={isBusy !== null || isLoadingLifestyleRepairJobs}
                  onClick={loadLifestyleRepairJobs}
                >
                  {isLoadingLifestyleRepairJobs ? "Loading" : "Refresh repair jobs"}
                </button>
              </div>
              {lifestyleRepairJobs.length > 0 ? (
                <div className="stock-status-table-wrap">
                  <table className="stock-status-table">
                    <thead>
                      <tr>
                        <th>Range</th>
                        <th>Status</th>
                        <th>Member</th>
                        <th>Progress</th>
                        <th>Keys</th>
                        <th>Updated</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lifestyleRepairJobs.map((job) => (
                        <tr key={job.id}>
                          <td>
                            {job.start_date} - {job.end_date}
                          </td>
                          <td>{job.status}</td>
                          <td>{job.member_id ?? "All current"}</td>
                          <td>
                            {formatNumber(job.completed_items)} / {formatNumber(job.total_items)}
                            {job.failed_items > 0 ? ` (${formatNumber(job.failed_items)} failed)` : ""}
                          </td>
                          <td>{formatNumber(job.active_key_count)}</td>
                          <td>{formatLongDateTime(job.updated_at)}</td>
                          <td>
                            {job.status === "queued" || job.status === "running" ? (
                              <button
                                type="button"
                                className="admin-button danger"
                                disabled={isBusy !== null}
                                onClick={() =>
                                  runRepairAction("Cancel lifestyle repair", () =>
                                    cancelMemberLifestyleRepairJob(job.id),
                                  )
                                }
                              >
                                Cancel
                              </button>
                            ) : (
                              job.last_error ?? "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-description">
                  No lifestyle repair jobs have been created yet.
                </p>
              )}
            </section>
<section className="admin-tool-section admin-tool-section-wide admin-maintenance-repair">
              <PanelHeader title="Member highlights" />
              <p className="panel-description">
                Recompute dashboard member highlight podiums from the latest complete lifestyle and attack data.
              </p>
              <button
                type="button"
                className="admin-button primary"
                disabled={isBusy !== null}
                onClick={() => runAdminAction("Refresh member highlights", refreshMemberAchievements)}
              >
                {isBusy === "Refresh member highlights" ? "Refreshing" : "Refresh member highlights"}
              </button>
            </section></div>
</AdminSettingsSection>
<AdminSettingsSection section="recovery" title="Discord and tracking recovery" description="Image delivery and enemy tracker recovery">
<section className="admin-tool-section">
<PanelHeader title="Discord images and enemy tracking" />
              <button
                type="button"
                className="admin-button"
                disabled={isBusy !== null}
                onClick={() =>
                  runAdminAction("Queue Discord stats image resend", resetEnemyStatsImageLatches)
                }
              >
                {isBusy === "Queue Discord stats image resend" ? "Working" : "Queue Discord stats image resend"}
              </button>
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const warId = Number(restartTrackingWarId);
                  runAdminAction("Restart live enemy tracking", () => restartLiveEnemyTracking(warId));
                }}
              >
                <label className="admin-form-wide">
                  <span>Restart travel/status tracker</span>
                  <select
                    value={restartTrackingWarId}
                    onChange={(event) => setRestartTrackingWarId(event.target.value)}
                  >
                    <option value="">Select a war</option>
                    {wars
                      .filter((war) => war.enemy_faction_id !== null)
                      .map((war) => (
                        <option key={war.id} value={war.id}>
                          #{war.id} {war.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="panel-description admin-form-wide">
                  Clears cached enemy status, travel timing, push-pressure samples, and the last scouting check for the selected war.
                </p>
                <button
                  type="submit"
                  className="admin-button admin-form-wide"
                  disabled={isBusy !== null || !restartTrackingWarId}
                >
                  {isBusy === "Restart live enemy tracking" ? "Working" : "Restart live enemy tracking"}
                </button>
              </form>
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Preview stats image", () =>
                    previewEnemyStatsImage(statsImagePreviewType),
                  );
                }}
              >
                <label className="admin-form-wide">
                  <span>Preview Discord image</span>
                  <select
                    value={statsImagePreviewType}
                    onChange={(event) =>
                      setStatsImagePreviewType(event.target.value as EnemyStatsImagePreviewType)
                    }
                  >
                    <option value="comparison">Stats comparison</option>
                    <option value="members">Enemy member stats</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="admin-button admin-form-wide"
                  disabled={isBusy !== null}
                >
                  {isBusy === "Preview stats image" ? "Opening" : "Preview image"}
                </button>
              </form>
            </section>
</AdminSettingsSection>
        </div> : null}
      </section>
      </>
      ) : null}
    </>
  );
}

function AdminSettingsSection({ section, title, description, children }: {
  section: "wars" | "historical-wars" | "events" | "competitions" | "diagnostics" | "repairs" | "recovery";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const headingId = `admin-settings-${section}-heading`;
  const contentId = `admin-settings-${section}-content`;

  return (
    <section className="admin-settings-section" aria-labelledby={headingId}>
      <h2 className="admin-settings-heading">
        <button
          type="button"
          id={headingId}
          className={`admin-section-divider admin-section-divider-${section}`}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={() => setIsCollapsed((current) => !current)}
        >
          {isCollapsed ? <ChevronRight size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
          <span className="admin-settings-heading-copy">
            <strong>{title}</strong>
            <span>{description}</span>
          </span>
        </button>
      </h2>
      <div id={contentId} className="admin-settings-content" hidden={isCollapsed}>
        {children}
      </div>
    </section>
  );
}

function AdminActionResult({ result }: { result: { label: string; data: unknown; warning?: string } }) {
  const summary = summarizeAdminAction(result.label, result.data);
  return <section className="panel admin-result-panel" aria-label="Action result">
    <p role="status"><strong>{result.label}: completed.</strong> {summary}</p>
    {result.warning ? <p role="alert">{result.warning}</p> : null}
    <details><summary>Technical details</summary><pre>{JSON.stringify(result.data, null, 2)}</pre></details>
  </section>;
}

function summarizeAdminAction(label: string, data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const value = data as Record<string, unknown>;
  if (typeof value.wars_processed === "number") return String(value.wars_processed) + " war/event records processed; " + (value.total_matching_attacks ?? 0) + " matching attacks.";
  if (typeof value.matching_attack_count === "number") return String(value.matching_attack_count) + " attacks found; " + (value.returned_attack_count ?? 0) + " returned.";
  if (label === "Export attacks CSV") return "Your CSV download is ready.";
  if (label.startsWith("Preview")) return "The preview is ready. Expand technical details for returned data.";
  if (label === "Queue Discord stats image resend") return "A Discord stats image resend has been queued for the current scouting war.";
  return "";
}

type AdminWarFormState = {
  practicalRevision?: number;
  phasesManaged?: boolean;
  name: string;
  status: string;
  timeMode: "datetime" | "epoch";
  startTime: string;
  startEpoch: string;
  finishTime: string;
  finishEpoch: string;
  officialStartTime: string;
  officialStartEpoch: string;
  officialFinishTime: string;
  officialFinishEpoch: string;
  factionId: string;
  warType: Exclude<WarType, "all">;
  tornWarId: string;
  chainWatchEnabled: boolean;
  eventType: "general" | "elimination" | "halloween";
  competitionRefreshHours: 6 | 12;
  competitionLocked: boolean;
  factionRespectLimit: string;
  enemyTargetRespect: string;
  memberRespectLimit: string;
};

type AdminExportFormState = {
  warName: string;
  scope: "all" | "outgoing" | "war_relevant";
  startWindow: ExportBoundaryWindow;
  finishWindow: ExportBoundaryWindow;
  linkedStatus: "linked" | "matching" | "unlinked";
  columns: "standard" | "debug";
  customStartTime: string;
  customFinishTime: string;
  customStartEpoch: string;
  customFinishEpoch: string;
};

type ExportBoundaryWindow = "official" | "practical" | "custom";

type AdminAttackWindowFormState = {
  startTime: string;
  finishTime: string;
  startEpoch: string;
  finishEpoch: string;
  limit: string;
};

function WarForm({
  title,
  panelClassName,
  form,
  onChange,
  onSubmit,
  isBusy,
  requireFinishTime = false,
  hideName = false,
  allowedWarTypes,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  panelClassName?: string;
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  onSubmit: (payload: AdminWarPayload) => void;
  isBusy: boolean;
  requireFinishTime?: boolean;
  hideName?: boolean;
  allowedWarTypes?: Array<Exclude<WarType, "all">>;
  secondaryActionLabel?: string;
  onSecondaryAction?: (payload: AdminWarPayload) => void;
}) {
  const canUseTermFields = form.warType === "termed";
  const practicalTimesDisabled = requireFinishTime && form.warType === "real";
  const warTypeOptions = allowedWarTypes ?? ["real", "termed", "event"];
  const startTimeLabel = form.warType === "event"
    ? "Event start time"
    : requireFinishTime
      ? "Practical start time"
      : "Start time";
  const finishTimeLabel = form.warType === "event" ? "Event finish time" : "Practical finish time";

  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(toWarPayload(form, requireFinishTime));
  }

  return (
    <section className={["panel", panelClassName].filter(Boolean).join(" ")}>
      <PanelHeader title={title} />
      <form className="admin-form" onSubmit={submit}>
        {hideName ? null : (
          <label>
            <span>Name</span>
            <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
          </label>
        )}
        <label>
          <span>War type</span>
          <select value={form.warType} onChange={(event) => update("warType", event.target.value as Exclude<WarType, "all">)}>
            {warTypeOptions.map((warType) => (
              <option value={warType} key={warType}>
                {warTypeLabel(warType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Torn war ID</span>
          <input inputMode="numeric" value={form.tornWarId} onChange={(event) => update("tornWarId", event.target.value)} />
        </label>
        <label>
          <span>{startTimeLabel}</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("startEpoch", event.target.value)} required={!practicalTimesDisabled} />
          ) : (
            <input type="datetime-local" value={form.startTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required={!practicalTimesDisabled} />
          )}
        </label>
        {requireFinishTime ? (
          <>
            <label>
              <span>{finishTimeLabel}</span>
              {form.timeMode === "epoch" ? (
                <input inputMode="numeric" value={form.finishEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("finishEpoch", event.target.value)} required={!practicalTimesDisabled} />
              ) : (
                <input type="datetime-local" value={form.finishTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} required={!practicalTimesDisabled} />
              )}
            </label>
          </>
        ) : null}
        <label>
          <span>Faction respect limit</span>
          <input
            inputMode="decimal"
            value={form.factionRespectLimit}
            disabled={!canUseTermFields}
            onChange={(event) => update("factionRespectLimit", event.target.value)}
          />
        </label>
        <label>
          <span>Member respect limit</span>
          <input
            inputMode="decimal"
            value={form.memberRespectLimit}
            disabled={!canUseTermFields}
            onChange={(event) => update("memberRespectLimit", event.target.value)}
          />
        </label>
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            type="button"
            className="admin-button admin-form-wide"
            disabled={isBusy}
            onClick={() => onSecondaryAction(toWarPayload(form, requireFinishTime))}
          >
            {secondaryActionLabel}
          </button>
        ) : null}
        <button type="submit" className="admin-button primary admin-form-wide" disabled={isBusy}>
          {title}
        </button>
      </form>
    </section>
  );
}

function WarFields({
  form,
  onChange,
  practicalOnly = false,
  showName = true,
  showFinishTimes = false,
  showTornFields = true,
  showOfficialTimes = showTornFields,
  showEnemyFaction = showTornFields,
  showTornWarId = showTornFields,
  showStatus = false,
  breakAfterWarType = false,
  allowedWarTypes,
}: {
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  practicalOnly?: boolean;
  showName?: boolean;
  showFinishTimes?: boolean;
  showTornFields?: boolean;
  showOfficialTimes?: boolean;
  showEnemyFaction?: boolean;
  showTornWarId?: boolean;
  showStatus?: boolean;
  breakAfterWarType?: boolean;
  allowedWarTypes?: Array<Exclude<WarType, "all">>;
}) {
  const canUseTermFields = form.warType === "termed";
  const canEditTornFields = form.warType === "event";
  const warTypeOptions = allowedWarTypes ?? ["real", "termed", "event"];
  const startTimeLabel = form.warType === "event" ? "Event start time" : "Practical start time";
  const finishTimeLabel = form.warType === "event" ? "Event finish time" : "Practical finish time";

  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  if (practicalOnly) {
    return (
      <>
        <label>
          <span>War type</span>
          <select disabled={form.phasesManaged} value={form.warType} onChange={(event) => update("warType", event.target.value as Exclude<WarType, "all">)}>
            {warTypeOptions.map((warType) => (
              <option value={warType} key={warType}>
                {warTypeLabel(warType)}
              </option>
            ))}
          </select>
        </label>
        {canUseTermFields ? (
          <>
            <label>
              <span>Faction score goal</span>
              <input
                inputMode="decimal"
                disabled={form.phasesManaged} value={form.factionRespectLimit}
                onChange={(event) => update("factionRespectLimit", event.target.value)}
              />
            </label>
            <label>
              <span>Member score goal</span>
              <input
                inputMode="decimal"
                value={form.memberRespectLimit}
                onChange={(event) => update("memberRespectLimit", event.target.value)}
              />
            </label>
            <label>
              <span>Enemy target respect (optional)</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Not set"
                value={form.enemyTargetRespect}
                onChange={(event) => update("enemyTargetRespect", event.target.value)}
              />
            </label>
          </>
        ) : null}
        {!form.phasesManaged && <>
        <label>
          <span>{startTimeLabel}</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
          ) : (
            <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
          )}
        </label>
        <label>
          <span>{finishTimeLabel}</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.finishEpoch} onChange={(event) => update("finishEpoch", event.target.value)} />
          ) : (
            <input type="datetime-local" value={form.finishTime} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} />
          )}
        </label>
        </>}
      </>
    );
  }

  return (
    <>
      {showName ? (
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
        </label>
      ) : null}
      {showStatus ? (
        <label>
          <span>Status</span>
          <select value={form.status} onChange={(event) => update("status", event.target.value)}>
            <option value="scheduled">Scheduled</option>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
          </select>
        </label>
      ) : null}
      <label>
        <span>War type</span>
        <select value={form.warType} onChange={(event) => update("warType", event.target.value as Exclude<WarType, "all">)}>
          {warTypeOptions.map((warType) => (
            <option value={warType} key={warType}>
              {warTypeLabel(warType)}
            </option>
          ))}
        </select>
      </label>
      {breakAfterWarType ? <div className="admin-form-spacer" aria-hidden="true" /> : null}
      {form.warType === "event" ? (
        <>
          <label>
            <span>Event type</span>
            <select value={form.eventType} disabled={form.competitionLocked}
              title={form.competitionLocked ? "Collection has started" : undefined}
              onChange={(event) => update("eventType", event.target.value as AdminWarFormState["eventType"])}>
              <option value="general">General</option>
              <option value="elimination">Elimination</option>
              <option value="halloween">Halloween</option>
            </select>
          </label>
          {form.eventType === "halloween" ? (
            <label>
              <span>Treats refresh</span>
              <select value={form.competitionRefreshHours}
                onChange={(event) => update("competitionRefreshHours", Number(event.target.value) as 6 | 12)}>
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}
      <label>
        <span>{startTimeLabel}</span>
        {form.timeMode === "epoch" ? (
          <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
        ) : (
          <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
        )}
      </label>
      {showFinishTimes ? (
        <>
          <label>
            <span>{finishTimeLabel}</span>
            {form.timeMode === "epoch" ? (
              <input inputMode="numeric" value={form.finishEpoch} onChange={(event) => update("finishEpoch", event.target.value)} />
            ) : (
              <input type="datetime-local" value={form.finishTime} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} />
            )}
          </label>
          {showOfficialTimes ? (
            <>
              <label>
                <span>Official start time</span>
                {form.timeMode === "epoch" ? (
                  <input inputMode="numeric" value={form.officialStartEpoch} disabled={!canEditTornFields} onChange={(event) => update("officialStartEpoch", event.target.value)} />
                ) : (
                  <input type="datetime-local" value={form.officialStartTime} disabled={!canEditTornFields} onChange={(event) => updateDateTime(form, onChange, "officialStart", event.target.value)} />
                )}
              </label>
              <label>
                <span>Official finish time</span>
                {form.timeMode === "epoch" ? (
                  <input inputMode="numeric" value={form.officialFinishEpoch} disabled={!canEditTornFields} onChange={(event) => update("officialFinishEpoch", event.target.value)} />
                ) : (
                  <input type="datetime-local" value={form.officialFinishTime} disabled={!canEditTornFields} onChange={(event) => updateDateTime(form, onChange, "officialFinish", event.target.value)} />
                )}
              </label>
            </>
          ) : null}
        </>
      ) : null}
      {showEnemyFaction || showTornWarId ? (
        <>
          {showEnemyFaction ? (
            <label>
              <span>Enemy faction ID</span>
              <input inputMode="numeric" value={form.factionId} disabled={!canEditTornFields} onChange={(event) => update("factionId", event.target.value)} />
            </label>
          ) : null}
          {showTornWarId ? (
            <label>
              <span>Torn war ID</span>
              <input inputMode="numeric" value={form.tornWarId} disabled={!canEditTornFields} onChange={(event) => update("tornWarId", event.target.value)} />
            </label>
          ) : null}
        </>
      ) : null}
      {canUseTermFields ? (
        <>
          <label>
            <span>Faction respect limit</span>
            <input
              inputMode="decimal"
              value={form.factionRespectLimit}
              onChange={(event) => update("factionRespectLimit", event.target.value)}
            />
          </label>
          <label>
            <span>Member respect limit</span>
            <input
              inputMode="decimal"
              value={form.memberRespectLimit}
              onChange={(event) => update("memberRespectLimit", event.target.value)}
            />
          </label>
        </>
      ) : null}
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

function defaultWarForm(): AdminWarFormState {
  return {
    name: "",
    status: "active",
    timeMode: "datetime",
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    startEpoch: String(Math.floor(Date.now() / 1000)),
    finishTime: "",
    finishEpoch: "",
    officialStartTime: "",
    officialStartEpoch: "",
    officialFinishTime: "",
    officialFinishEpoch: "",
    factionId: "",
    warType: "real",
    tornWarId: "",
    chainWatchEnabled: true,
    eventType: "general",
    competitionRefreshHours: 6,
    competitionLocked: false,
    factionRespectLimit: "",
    enemyTargetRespect: "",
    memberRespectLimit: "",
  };
}

function defaultEventForm(): AdminWarFormState {
  return {
    ...defaultWarForm(),
    status: "active",
    warType: "event",
    chainWatchEnabled: false,
  };
}

function toWarPayload(form: AdminWarFormState, includeFinishTime: boolean): AdminWarPayload {
  const payload: AdminWarPayload = {
    war_type: form.warType,
  };

  if (form.name.trim() !== "") {
    payload.name = form.name.trim();
  }

  if (!includeFinishTime || form.warType !== "real") {
    payload.practical_start_time = secondsFromFormTime(form, "start");
  }

  if (includeFinishTime && form.warType !== "real") {
    payload.practical_finish_time = secondsFromFormTime(form, "finish");
    setOptionalTime(payload, "official_start_time", form, "officialStart");
    setOptionalTime(payload, "official_end_time", form, "officialFinish");
  }

  setOptionalNumber(payload, "enemy_faction_id", form.factionId);
  setOptionalNumber(payload, "torn_war_id", form.tornWarId);

  if (form.warType === "termed") {
    setOptionalNumber(payload, "faction_respect_limit", form.factionRespectLimit);
    setOptionalNumber(payload, "member_respect_limit", form.memberRespectLimit);
  }

  return payload;
}

function toEventPayload(
  form: AdminWarFormState,
  options: {
    id?: number;
    status?: "scheduled" | "active" | "ended";
    fetchMissing?: boolean;
  } = {},
): AdminWarPayload {
  const payload: AdminWarPayload = {
    war_type: "event",
    status: options.status ?? form.status,
    practical_start_time: secondsFromFormTime(form, "start"),
    practical_finish_time: optionalSecondsFromFormTime(form, "finish"),
    chain_watch_enabled: form.chainWatchEnabled,
    event_type: form.eventType,
    competition_refresh_hours: form.competitionRefreshHours,
  };

  if (options.id !== undefined) {
    payload.id = options.id;
  }

  if (form.name.trim() !== "") {
    payload.name = form.name.trim();
  }

  if (options.fetchMissing !== undefined) {
    payload.fetch_missing = options.fetchMissing;
  }

  return payload;
}

function isOfficialWar(war: WarSummary): boolean {
  return war.war_type !== "event";
}

function isEventWar(war: WarSummary): boolean {
  return war.war_type === "event";
}

function isCurrentOfficialWar(war: WarSummary): boolean {
  return isOfficialWar(war) && war.official_end_time === null;
}

function isHistoricalOfficialWar(war: WarSummary): boolean {
  return isOfficialWar(war) && war.official_end_time !== null;
}

function warTypeLabel(warType: Exclude<WarType, "all">): string {
  if (warType === "real") {
    return "Real";
  }

  if (warType === "termed") {
    return "Termed";
  }

  return "Event";
}

export function warToForm(war: WarSummary): AdminWarFormState {
  const form = defaultWarForm();
  return {
    ...form,
    practicalRevision: war.practical_revision,
    phasesManaged: war.war_type === "termed",
    name: war.name,
    status: war.status,
    startTime: dateTimeLocalFromSeconds(war.practical_start_time),
    startEpoch: String(war.practical_start_time),
    finishTime: war.practical_finish_time ? dateTimeLocalFromSeconds(war.practical_finish_time) : "",
    finishEpoch: war.practical_finish_time ? String(war.practical_finish_time) : "",
    officialStartTime: war.official_start_time ? dateTimeLocalFromSeconds(war.official_start_time) : "",
    officialStartEpoch: war.official_start_time ? String(war.official_start_time) : "",
    officialFinishTime: war.official_end_time ? dateTimeLocalFromSeconds(war.official_end_time) : "",
    officialFinishEpoch: war.official_end_time ? String(war.official_end_time) : "",
    factionId: war.enemy_faction_id === null ? "" : String(war.enemy_faction_id),
    warType: war.war_type ?? "real",
    tornWarId: war.torn_war_id === null ? "" : String(war.torn_war_id),
    chainWatchEnabled: Boolean(war.chain_watch_enabled),
    eventType: war.event_type ?? "general",
    competitionRefreshHours: war.competition_refresh_hours ?? 6,
    competitionLocked: Boolean(war.competition_started_at),
    factionRespectLimit: war.faction_respect_limit === null ? "" : String(war.faction_respect_limit),
    enemyTargetRespect: war.enemy_target_respect == null ? "" : String(war.enemy_target_respect),
    memberRespectLimit: war.member_respect_limit === null ? "" : String(war.member_respect_limit),
  };
}

function isExportableWar(war: WarSummary): boolean {
  return Boolean(war.official_end_time ?? war.practical_finish_time);
}

function exportFormForWar(
  form: AdminExportFormState,
  war: WarSummary | undefined,
): AdminExportFormState {
  if (!war) {
    return { ...form, warName: "" };
  }

  const start = exportBoundaryTime(war, form.startWindow, "start");
  const finish = exportBoundaryTime(war, form.finishWindow, "finish");
  return {
    ...form,
    warName: war.name,
    customStartTime:
      form.startWindow === "custom" ? form.customStartTime : dateTimeLocalFromSeconds(start),
    customFinishTime:
      form.finishWindow === "custom" ? form.customFinishTime : dateTimeLocalFromSeconds(finish),
    customStartEpoch: form.startWindow === "custom" ? form.customStartEpoch : String(start),
    customFinishEpoch: form.finishWindow === "custom" ? form.customFinishEpoch : String(finish),
  };
}

function exportBoundaryTime(
  war: WarSummary,
  window: ExportBoundaryWindow,
  boundary: "start" | "finish",
): number {
  if (window === "custom") {
    return boundary === "start"
      ? Number(war.official_start_time ?? war.practical_start_time)
      : Number(war.official_end_time ?? war.practical_finish_time ?? war.practical_start_time);
  }

  if (boundary === "start") {
    return window === "official"
      ? (war.official_start_time ?? war.practical_start_time)
      : war.practical_start_time;
  }

  return window === "official"
    ? (war.official_end_time ?? war.practical_finish_time ?? war.practical_start_time)
    : (war.practical_finish_time ?? war.official_end_time ?? war.practical_start_time);
}

export function toPracticalWarEditPayload(id: number, form: AdminWarFormState): AdminWarPayload {
  const payload: AdminWarPayload = {
    id,
    practical_revision: form.practicalRevision,
    war_type: form.warType,
  };

  if (!form.phasesManaged) {
    payload.practical_start_time = secondsFromFormTime(form, "start");
    payload.practical_finish_time = optionalSecondsFromFormTime(form, "finish");
  }

  if (form.warType === "termed") {
    payload.enemy_target_respect = form.enemyTargetRespect.trim() === ""
      ? null
      : Number(form.enemyTargetRespect);
    if (!form.phasesManaged) setOptionalNumber(payload, "faction_respect_limit", form.factionRespectLimit);
    setOptionalNumber(payload, "member_respect_limit", form.memberRespectLimit);
  }

  return payload;
}

function toRelinkPayload(form: { scope: "selected" | "all"; warId: string; fetchMissing: boolean }) {
  return { scope: form.scope, war_id: form.scope === "selected" ? Number(form.warId) : undefined, fetch_missing: form.fetchMissing };
}

function convertWarFormTimeMode(
  form: AdminWarFormState,
  timeMode: AdminWarFormState["timeMode"],
): AdminWarFormState {
  if (timeMode === form.timeMode) {
    return form;
  }

  if (timeMode === "epoch") {
    return {
      ...form,
      timeMode,
      startEpoch: String(secondsFromDateTimeLocal(form.startTime)),
      finishEpoch: form.finishTime ? String(secondsFromDateTimeLocal(form.finishTime)) : "",
      officialStartEpoch: form.officialStartTime
        ? String(secondsFromDateTimeLocal(form.officialStartTime))
        : "",
      officialFinishEpoch: form.officialFinishTime
        ? String(secondsFromDateTimeLocal(form.officialFinishTime))
        : "",
    };
  }

  return {
    ...form,
    timeMode,
    startTime: dateTimeLocalFromSeconds(Number(form.startEpoch || 0)),
    finishTime: form.finishEpoch ? dateTimeLocalFromSeconds(Number(form.finishEpoch)) : "",
    officialStartTime: form.officialStartEpoch
      ? dateTimeLocalFromSeconds(Number(form.officialStartEpoch))
      : "",
    officialFinishTime: form.officialFinishEpoch
      ? dateTimeLocalFromSeconds(Number(form.officialFinishEpoch))
      : "",
  };
}

function convertExportFormTimeMode(
  form: AdminExportFormState,
  timeMode: AdminWarFormState["timeMode"],
): AdminExportFormState {
  if (timeMode === "epoch") {
    return {
      ...form,
      customStartEpoch: String(secondsFromDateTimeLocal(form.customStartTime)),
      customFinishEpoch: String(secondsFromDateTimeLocal(form.customFinishTime)),
    };
  }

  return {
    ...form,
    customStartTime: dateTimeLocalFromSeconds(Number(form.customStartEpoch || 0)),
    customFinishTime: dateTimeLocalFromSeconds(Number(form.customFinishEpoch || 0)),
  };
}

function updateExportDateTime(
  form: AdminExportFormState,
  field: "start" | "finish",
  value: string,
): AdminExportFormState {
  if (field === "start") {
    return {
      ...form,
      customStartTime: value,
      customStartEpoch: String(secondsFromDateTimeLocal(value)),
    };
  }

  return {
    ...form,
    customFinishTime: value,
    customFinishEpoch: String(secondsFromDateTimeLocal(value)),
  };
}

function updateExportEpoch(
  form: AdminExportFormState,
  field: "start" | "finish",
  value: string,
): AdminExportFormState {
  if (field === "start") {
    return {
      ...form,
      customStartEpoch: value,
      customStartTime: dateTimeLocalFromSeconds(Number(value || 0)),
    };
  }

  return {
    ...form,
    customFinishEpoch: value,
    customFinishTime: dateTimeLocalFromSeconds(Number(value || 0)),
  };
}

function exportSecondsFromForm(
  form: AdminExportFormState,
  timeMode: AdminWarFormState["timeMode"],
  field: "start" | "finish",
): number {
  if (timeMode === "epoch") {
    return Number(field === "start" ? form.customStartEpoch : form.customFinishEpoch);
  }

  return secondsFromDateTimeLocal(field === "start" ? form.customStartTime : form.customFinishTime);
}

function convertAttackWindowFormTimeMode(
  form: AdminAttackWindowFormState,
  timeMode: AdminWarFormState["timeMode"],
): AdminAttackWindowFormState {
  if (timeMode === "epoch") {
    return {
      ...form,
      startEpoch: String(secondsFromDateTimeLocal(form.startTime)),
      finishEpoch: String(secondsFromDateTimeLocal(form.finishTime)),
    };
  }

  return {
    ...form,
    startTime: dateTimeLocalFromSeconds(Number(form.startEpoch || 0)),
    finishTime: dateTimeLocalFromSeconds(Number(form.finishEpoch || 0)),
  };
}

function updateAttackWindowDateTime(
  form: AdminAttackWindowFormState,
  field: "start" | "finish",
  value: string,
): AdminAttackWindowFormState {
  if (field === "start") {
    return {
      ...form,
      startTime: value,
      startEpoch: String(secondsFromDateTimeLocal(value)),
    };
  }

  return {
    ...form,
    finishTime: value,
    finishEpoch: String(secondsFromDateTimeLocal(value)),
  };
}

function updateAttackWindowEpoch(
  form: AdminAttackWindowFormState,
  field: "start" | "finish",
  value: string,
): AdminAttackWindowFormState {
  if (field === "start") {
    return {
      ...form,
      startEpoch: value,
      startTime: dateTimeLocalFromSeconds(Number(value || 0)),
    };
  }

  return {
    ...form,
    finishEpoch: value,
    finishTime: dateTimeLocalFromSeconds(Number(value || 0)),
  };
}

function attackWindowSecondsFromForm(
  form: AdminAttackWindowFormState,
  timeMode: AdminWarFormState["timeMode"],
  field: "start" | "finish",
): number {
  if (timeMode === "epoch") {
    return Number(field === "start" ? form.startEpoch : form.finishEpoch);
  }

  return secondsFromDateTimeLocal(field === "start" ? form.startTime : form.finishTime);
}

function updateDateTime(
  form: AdminWarFormState,
  onChange: (form: AdminWarFormState) => void,
  field: "start" | "finish" | "officialStart" | "officialFinish",
  value: string,
) {
  if (field === "start") {
    onChange({ ...form, startTime: value, startEpoch: String(secondsFromDateTimeLocal(value)) });
    return;
  }

  if (field === "finish") {
    onChange({ ...form, finishTime: value, finishEpoch: String(secondsFromDateTimeLocal(value)) });
    return;
  }

  if (field === "officialStart") {
    onChange({
      ...form,
      officialStartTime: value,
      officialStartEpoch: value ? String(secondsFromDateTimeLocal(value)) : "",
    });
    return;
  }

  onChange({
    ...form,
    officialFinishTime: value,
    officialFinishEpoch: value ? String(secondsFromDateTimeLocal(value)) : "",
  });
}

function secondsFromFormTime(
  form: AdminWarFormState,
  field: "start" | "finish" | "officialStart" | "officialFinish",
): number {
  if (form.timeMode === "epoch") {
    if (field === "start") {
      return Number(form.startEpoch);
    }
    if (field === "finish") {
      return Number(form.finishEpoch);
    }
    if (field === "officialStart") {
      return Number(form.officialStartEpoch);
    }
    return Number(form.officialFinishEpoch);
  }

  if (field === "start") {
    return secondsFromDateTimeLocal(form.startTime);
  }
  if (field === "finish") {
    return secondsFromDateTimeLocal(form.finishTime);
  }
  if (field === "officialStart") {
    return secondsFromDateTimeLocal(form.officialStartTime);
  }
  return secondsFromDateTimeLocal(form.officialFinishTime);
}

function setOptionalTime<T extends "official_start_time" | "official_end_time">(
  payload: AdminWarPayload,
  key: T,
  form: AdminWarFormState,
  field: "officialStart" | "officialFinish",
) {
  const raw =
    form.timeMode === "epoch"
      ? field === "officialStart"
        ? form.officialStartEpoch
        : form.officialFinishEpoch
      : field === "officialStart"
        ? form.officialStartTime
        : form.officialFinishTime;

  if (raw.trim() !== "") {
    payload[key] = secondsFromFormTime(form, field) as AdminWarPayload[T];
  }
}

function setOptionalNumber<T extends keyof AdminWarPayload>(
  payload: AdminWarPayload,
  key: T,
  value: string,
) {
  if (value.trim() !== "") {
    payload[key] = Number(value) as AdminWarPayload[T];
  }
}

function optionalSecondsFromFormTime(
  form: AdminWarFormState,
  field: "finish" | "officialStart" | "officialFinish",
): number | null {
  const raw =
    form.timeMode === "epoch"
      ? field === "finish"
        ? form.finishEpoch
        : field === "officialStart"
          ? form.officialStartEpoch
          : form.officialFinishEpoch
      : field === "finish"
        ? form.finishTime
        : field === "officialStart"
          ? form.officialStartTime
          : form.officialFinishTime;

  return raw.trim() === "" ? null : secondsFromFormTime(form, field);
}

function secondsFromDateTimeLocal(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function formatPrize(value: number): string {
  if (value >= 1_000_000) {
    return `$${formatNumber(value / 1_000_000)}mil`;
  }

  return `$${formatNumber(value)}`;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function dateTimeLocalFromSeconds(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function utcDateFromDaysAgo(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return date.toISOString().slice(0, 10);
}
