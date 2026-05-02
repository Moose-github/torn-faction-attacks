import React from "react";
import {
  AdminWarPayload,
  AuthSession,
  authenticateTornKey,
  clearStoredAuthSession,
  createWar,
  deleteWar,
  exportWarAttacksCsv,
  fetchTornWarReport,
  getLatestIngestionRun,
  getWars,
  getStoredAuthSession,
  grantAdminAccess,
  IngestionRun,
  importEvent,
  importWar,
  listAdminUsers,
  previewImportEvent,
  previewImportWar,
  previewRelinkAttacks,
  pullAttackWindow,
  rebuildStats,
  refreshAuthSession,
  relinkAttacks,
  runIngestion,
  updateEvent,
  updateOfficialWar,
  WarSummary,
  WarType,
} from "../api";
import { CollapsiblePanel, PanelHeader } from "../components/Common";

export function AdminControls() {
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );
  const [useEpochTime, setUseEpochTime] = React.useState(false);
  const [tornKey, setTornKey] = React.useState("");
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    warType: "event",
  }));
  const [importWarForm, setImportWarForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
  }));
  const [importEventForm, setImportEventForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    warType: "event",
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
  }));
  const [deleteForm, setDeleteForm] = React.useState({ tornWarId: "", name: "" });
  const [relinkForm, setRelinkForm] = React.useState({
    tornWarId: "",
    name: "",
    fetchMissing: false,
  });
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [officialEditForm, setOfficialEditForm] = React.useState<AdminWarFormState>(() =>
    defaultWarForm(),
  );
  const [eventEditForm, setEventEditForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    warType: "event",
  }));
  const [selectedOfficialWarId, setSelectedOfficialWarId] = React.useState("");
  const [selectedEventWarId, setSelectedEventWarId] = React.useState("");
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
  const [attackWindowForm, setAttackWindowForm] = React.useState({
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    startEpoch: String(Math.floor(Date.now() / 1000) - 3600),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
    limit: "100",
  });
  const [isBusy, setIsBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isEventPanelCollapsed, setIsEventPanelCollapsed] = React.useState(true);
  const [isRepairPanelCollapsed, setIsRepairPanelCollapsed] = React.useState(true);
  const [ingestionRun, setIngestionRun] = React.useState<IngestionRun | null>(null);
  const [isLoadingIngestionRun, setIsLoadingIngestionRun] = React.useState(false);
  const adminTimeMode: AdminWarFormState["timeMode"] = useEpochTime ? "epoch" : "datetime";

  React.useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const session = await refreshAuthSession();
      if (!cancelled) {
        setAuthSession(session ?? getStoredAuthSession());
      }
    }

    if (authSession) {
      refresh();
    }

    return () => {
      cancelled = true;
    };
  }, []);

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

        setWars(response.wars);
        const firstExportableWar = response.wars.find(isExportableWar);
        setExportForm((current) => ({
          ...exportFormForWar(
            current,
            response.wars.find((war) => war.name === current.warName) ?? firstExportableWar,
          ),
        }));
        const firstOfficialWar = response.wars.find(isOfficialWar);
        const firstEvent = response.wars.find(isEvent);
        setSelectedOfficialWarId((current) => current || String(firstOfficialWar?.id ?? ""));
        setOfficialEditForm((current) =>
          firstOfficialWar && !selectedOfficialWarId
            ? convertWarFormTimeMode(warToForm(firstOfficialWar), adminTimeMode)
            : current,
        );
        setSelectedEventWarId((current) => current || String(firstEvent?.id ?? ""));
        setEventEditForm((current) =>
          firstEvent && !selectedEventWarId
            ? convertWarFormTimeMode(warToForm(firstEvent), adminTimeMode)
            : current,
        );
      } catch {
        if (!cancelled) {
          setWars([]);
        }
      }
    }

    loadWars();

    return () => {
      cancelled = true;
    };
  }, [authSession?.access_level, adminTimeMode]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthenticating(true);
    setError(null);

    try {
      const session = await authenticateTornKey(tornKey);
      setAuthSession(session);
      setTornKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAuthenticating(false);
    }
  }

  function logout() {
    clearStoredAuthSession();
    setAuthSession(null);
    setResult(null);
  }

  function setGlobalTimeMode(useEpoch: boolean) {
    const timeMode: AdminWarFormState["timeMode"] = useEpoch ? "epoch" : "datetime";
    setUseEpochTime(useEpoch);
    setCreateForm((current) => convertWarFormTimeMode(current, timeMode));
    setImportWarForm((current) => convertWarFormTimeMode(current, timeMode));
    setImportEventForm((current) => convertWarFormTimeMode(current, timeMode));
    setOfficialEditForm((current) => convertWarFormTimeMode(current, timeMode));
    setEventEditForm((current) => convertWarFormTimeMode(current, timeMode));
    setExportForm((current) => convertExportFormTimeMode(current, timeMode));
    setAttackWindowForm((current) => convertAttackWindowFormTimeMode(current, timeMode));
  }

  async function runAdminAction(label: string, action: () => Promise<unknown>) {
    setIsBusy(label);
    setError(null);

    try {
      setResult(await action());
      await loadLatestIngestionRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(null);
    }
  }

  async function loadLatestIngestionRun() {
    setIsLoadingIngestionRun(true);
    try {
      const response = await getLatestIngestionRun();
      setIngestionRun(response.run);
    } catch {
      setIngestionRun(null);
    } finally {
      setIsLoadingIngestionRun(false);
    }
  }

  React.useEffect(() => {
    if (authSession?.access_level === "admin") {
      loadLatestIngestionRun();
    }
  }, [authSession?.access_level]);

  const exportableWars = wars.filter(isExportableWar);
  const officialWars = wars.filter(isOfficialWar);
  const events = wars.filter(isEvent);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

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
      <section className="admin-grid">
        <section className="panel admin-panel-access">
          <PanelHeader title="Admin access" />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Grant admin access", () =>
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
              onClick={() => runAdminAction("List admin users", listAdminUsers)}
            >
              List current admins
            </button>
          </form>
        </section>

        <section className="panel admin-panel-edit-official">
          <PanelHeader title="Edit official war" />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Update official war", () =>
                updateOfficialWar(toWarEditPayload(Number(selectedOfficialWarId), officialEditForm)).then((response) => {
                  const updatedWar = (response as { war?: WarSummary }).war;
                  if (updatedWar) {
                    setWars((current) =>
                      current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war)),
                    );
                    setOfficialEditForm(convertWarFormTimeMode(warToForm(updatedWar), adminTimeMode));
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
            <label className="admin-form-wide">
              <span>War</span>
              <select
                value={selectedOfficialWarId}
                onChange={(event) => {
                  const war = officialWars.find((candidate) => candidate.id === Number(event.target.value));
                  setSelectedOfficialWarId(event.target.value);
                  if (war) {
                    setOfficialEditForm(convertWarFormTimeMode(warToForm(war), adminTimeMode));
                  }
                }}
                required
              >
                <option value="" disabled>
                  Select war
                </option>
                {officialWars.map((war) => (
                  <option value={war.id} key={war.id}>
                    {war.name}
                    {war.torn_war_id ? ` / Torn #${war.torn_war_id}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <WarFields
              form={officialEditForm}
              onChange={setOfficialEditForm}
              showName={false}
              showFinishTimes
              showTornFields={false}
              showStatus
              allowedWarTypes={["real", "termed"]}
            />
            <button
              type="submit"
              className="admin-button primary admin-form-wide"
              disabled={isBusy !== null || !selectedOfficialWarId}
            >
              Confirm changes
            </button>
          </form>
        </section>

        <CollapsiblePanel
          title="Event controls"
          aside="Create / edit / import"
          className="admin-panel-events"
          collapsed={isEventPanelCollapsed}
          onToggle={() => setIsEventPanelCollapsed((current) => !current)}
        >
          <div className="admin-event-grid">
            <EventForm
              title="Create active or scheduled event"
              panelClassName="admin-event-command"
              form={createForm}
              onChange={setCreateForm}
              isBusy={isBusy !== null}
              onSubmit={(payload) => runAdminAction("Create event", () => createWar(payload))}
            />

            <section className="panel admin-event-command">
              <PanelHeader title="Edit event" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Update event", () =>
                    updateEvent(toWarEditPayload(Number(selectedEventWarId), eventEditForm)).then((response) => {
                      const updatedWar = (response as { war?: WarSummary }).war;
                      if (updatedWar) {
                        setWars((current) =>
                          current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war)),
                        );
                        setEventEditForm(convertWarFormTimeMode(warToForm(updatedWar), adminTimeMode));
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
                  <span>Event</span>
                  <select
                    value={selectedEventWarId}
                    onChange={(event) => {
                      const war = events.find((candidate) => candidate.id === Number(event.target.value));
                      setSelectedEventWarId(event.target.value);
                      if (war) {
                        setEventEditForm(convertWarFormTimeMode(warToForm(war), adminTimeMode));
                      }
                    }}
                    required
                  >
                    <option value="" disabled>
                      Select event
                    </option>
                    {events.map((war) => (
                      <option value={war.id} key={war.id}>
                        {war.name}
                      </option>
                    ))}
                  </select>
                </label>
                <WarFields
                  form={eventEditForm}
                  onChange={setEventEditForm}
                  showName
                  showFinishTimes
                  showOfficialTimes={false}
                  showEnemyFaction
                  showTornWarId={false}
                  showStatus
                  allowedWarTypes={["event"]}
                />
                <button
                  type="submit"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null || !selectedEventWarId}
                >
                  Confirm changes
                </button>
              </form>
            </section>

            <HistoricalEventForm
              title="Import historical event"
              panelClassName="admin-event-command"
              form={importEventForm}
              onChange={setImportEventForm}
              isBusy={isBusy !== null}
              secondaryActionLabel="Preview import window"
              onSecondaryAction={(payload) =>
                runAdminAction("Preview event import window", () => previewImportEvent(payload))
              }
              onSubmit={(payload) => runAdminAction("Import event", () => importEvent(payload))}
            />
          </div>
        </CollapsiblePanel>

        <section className="panel admin-panel-export">
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

        <WarForm
          title="Import historical war"
          panelClassName="admin-panel-import-war"
          form={importWarForm}
          onChange={setImportWarForm}
          isBusy={isBusy !== null}
          requireFinishTime
          hideName
          allowedWarTypes={["real", "termed"]}
          showAutoEnd={false}
          secondaryActionLabel="Preview import window"
          onSecondaryAction={(payload) =>
            runAdminAction("Preview import window", () => previewImportWar(payload))
          }
          onSubmit={(payload) => runAdminAction("Import war", () => importWar(payload))}
        />

        <CollapsiblePanel
          title="Repair/debug tools"
          aside="Advanced"
          className="admin-panel-repair"
          collapsed={isRepairPanelCollapsed}
          onToggle={() => setIsRepairPanelCollapsed((current) => !current)}
        >
          <div className="admin-repair-grid">
            <section className="admin-tool-section admin-tool-section-wide">
              <PanelHeader
                title="Latest data refresh"
                aside={isLoadingIngestionRun ? "Loading" : ingestionRun?.status ?? "No runs"}
              />
              {ingestionRun ? (
                <div className="admin-metric-list">
                  <MetricLine label="Started" value={formatIngestionTime(ingestionRun.started_at)} />
                  <MetricLine label="Finished" value={formatIngestionTime(ingestionRun.finished_at)} />
                  <MetricLine
                    label="Total duration"
                    value={formatDuration(ingestionRun.started_at, ingestionRun.finished_at)}
                  />
                  <MetricLine
                    label="Torn/rankedwar checked"
                    value={formatDuration(ingestionRun.started_at, ingestionRun.ranked_war_checked_at)}
                  />
                  <MetricLine
                    label="Attacks fetched"
                    value={formatDuration(ingestionRun.started_at, ingestionRun.attacks_fetch_finished_at)}
                  />
                  <MetricLine
                    label="Stats ready"
                    value={formatDuration(ingestionRun.started_at, ingestionRun.stats_finished_at)}
                  />
                  <MetricLine
                    label="Fetched"
                    value={`${ingestionRun.fetched_attacks} attacks across ${ingestionRun.fetched_pages} pages`}
                  />
                  {ingestionRun.error ? <MetricLine label="Error" value={ingestionRun.error} /> : null}
                </div>
              ) : (
                <p className="panel-description">No ingestion run has been recorded yet.</p>
              )}
              <button
                type="button"
                className="admin-button"
                disabled={isLoadingIngestionRun}
                onClick={loadLatestIngestionRun}
              >
                Refresh baseline
              </button>
            </section>

            <section className="admin-tool-section">
              <PanelHeader title="Maintenance" />
              <button
                type="button"
                className="admin-button primary"
                disabled={isBusy !== null}
                onClick={() => runAdminAction("Run ingestion", runIngestion)}
              >
                {isBusy === "Run ingestion" ? "Working" : "Run ingestion"}
              </button>
              <button
                type="button"
                className="admin-button primary"
                disabled={isBusy !== null}
                onClick={() => runAdminAction("Rebuild stats", rebuildStats)}
              >
                {isBusy === "Rebuild stats" ? "Working" : "Rebuild stats"}
              </button>
            </section>

            <section className="admin-tool-section">
              <PanelHeader title="Delete war/event" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Delete war", () =>
                    deleteWar({
                      torn_war_id: deleteForm.tornWarId.trim()
                        ? Number(deleteForm.tornWarId)
                        : undefined,
                      name: deleteForm.name.trim() || undefined,
                    }),
                  );
                }}
              >
                <label>
                  <span>Torn war ID</span>
                  <input
                    inputMode="numeric"
                    value={deleteForm.tornWarId}
                    onChange={(event) =>
                      setDeleteForm({ ...deleteForm, tornWarId: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>War/event name</span>
                  <input
                    value={deleteForm.name}
                    onChange={(event) => setDeleteForm({ ...deleteForm, name: event.target.value })}
                  />
                </label>
                <button type="submit" className="admin-button danger admin-form-wide" disabled={isBusy !== null}>
                  Delete war
                </button>
              </form>
            </section>

            <section className="admin-tool-section">
              <PanelHeader title="Reassign attacks to wars/events" />
              <form className="admin-form">
                <label>
                  <span>Torn war ID</span>
                  <input
                    inputMode="numeric"
                    value={relinkForm.tornWarId}
                    onChange={(event) =>
                      setRelinkForm({ ...relinkForm, tornWarId: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>War/event name</span>
                  <input
                    value={relinkForm.name}
                    onChange={(event) => setRelinkForm({ ...relinkForm, name: event.target.value })}
                  />
                </label>
                <label className="checkbox-row admin-form-wide">
                  <input
                    type="checkbox"
                    checked={relinkForm.fetchMissing}
                    onChange={(event) =>
                      setRelinkForm({ ...relinkForm, fetchMissing: event.target.checked })
                    }
                  />
                  <span>Fetch missing attacks first</span>
                </label>
                <button
                  type="button"
                  className="admin-button admin-form-wide"
                  disabled={isBusy !== null}
                  onClick={() =>
                    runAdminAction("Preview attack reassignment", () =>
                      previewRelinkAttacks(toRelinkPayload(relinkForm)),
                    )
                  }
                >
                  Preview reassignment
                </button>
                <button
                  type="button"
                  className="admin-button primary admin-form-wide"
                  disabled={isBusy !== null}
                  onClick={() =>
                    runAdminAction("Reassign attacks to wars/events", () => relinkAttacks(toRelinkPayload(relinkForm)))
                  }
                >
                  Reassign attacks
                </button>
              </form>
            </section>

            <section className="admin-tool-section">
              <PanelHeader title="Fetch Torn report" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Fetch Torn report", () =>
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

            <section className="admin-tool-section">
              <PanelHeader title="Fetch attacks by time range" />
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAdminAction("Fetch attacks by time range", () =>
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
                  Fetch attacks
                </button>
              </form>
            </section>
          </div>
        </CollapsiblePanel>

        <section className="panel admin-result-panel">
          <PanelHeader title="Latest API response" />
          <pre>{result ? JSON.stringify(result, null, 2) : "No action run yet."}</pre>
        </section>
      </section>
      ) : null}
    </>
  );
}

type AdminWarFormState = {
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
  autoEndEnabled: boolean;
  factionRespectLimit: string;
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

function EventForm({
  title,
  panelClassName,
  form,
  onChange,
  onSubmit,
  isBusy,
}: {
  title: string;
  panelClassName?: string;
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  onSubmit: (payload: AdminWarPayload) => void;
  isBusy: boolean;
}) {
  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, warType: "event", [key]: value });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(toEventPayload(form));
  }

  return (
    <section className={["panel", panelClassName].filter(Boolean).join(" ")}>
      <PanelHeader title={title} />
      <form className="admin-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
        </label>
        <label>
          <span>Start time</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
          ) : (
            <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
          )}
        </label>
        <label>
          <span>Enemy faction ID</span>
          <input inputMode="numeric" value={form.factionId} onChange={(event) => update("factionId", event.target.value)} />
        </label>
        <button type="submit" className="admin-button primary admin-form-wide" disabled={isBusy}>
          {title}
        </button>
      </form>
    </section>
  );
}

function HistoricalEventForm({
  title,
  panelClassName,
  form,
  onChange,
  onSubmit,
  isBusy,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  panelClassName?: string;
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  onSubmit: (payload: AdminWarPayload) => void;
  isBusy: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: (payload: AdminWarPayload) => void;
}) {
  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, warType: "event", [key]: value });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(toHistoricalEventPayload(form));
  }

  return (
    <section className={["panel", panelClassName].filter(Boolean).join(" ")}>
      <PanelHeader title={title} />
      <form className="admin-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
        </label>
        <label>
          <span>Start time</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
          ) : (
            <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
          )}
        </label>
        <label>
          <span>Finish time</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.finishEpoch} onChange={(event) => update("finishEpoch", event.target.value)} required />
          ) : (
            <input type="datetime-local" value={form.finishTime} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} required />
          )}
        </label>
        <label>
          <span>Enemy faction ID</span>
          <input inputMode="numeric" value={form.factionId} onChange={(event) => update("factionId", event.target.value)} />
        </label>
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            type="button"
            className="admin-button admin-form-wide"
            disabled={isBusy}
            onClick={() => onSecondaryAction(toHistoricalEventPayload(form))}
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

function WarForm({
  title,
  panelClassName,
  form,
  onChange,
  onSubmit,
  isBusy,
  requireFinishTime = false,
  hideName = false,
  showAutoEnd = true,
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
  showAutoEnd?: boolean;
  allowedWarTypes?: Array<Exclude<WarType, "all">>;
  secondaryActionLabel?: string;
  onSecondaryAction?: (payload: AdminWarPayload) => void;
}) {
  const canUseTermFields = form.warType === "termed";
  const practicalTimesDisabled = requireFinishTime && form.warType === "real";
  const warTypeOptions = allowedWarTypes ?? ["real", "termed", "event"];

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
          <span>{requireFinishTime ? "Practical start time" : "Start time"}</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("startEpoch", event.target.value)} required={!practicalTimesDisabled} />
          ) : (
            <input type="datetime-local" value={form.startTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required={!practicalTimesDisabled} />
          )}
        </label>
        {requireFinishTime ? (
          <>
            <label>
              <span>Practical finish time</span>
              {form.timeMode === "epoch" ? (
                <input inputMode="numeric" value={form.finishEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("finishEpoch", event.target.value)} required={!practicalTimesDisabled} />
              ) : (
                <input type="datetime-local" value={form.finishTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} required={!practicalTimesDisabled} />
              )}
            </label>
          </>
        ) : null}
        {showAutoEnd ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.autoEndEnabled}
              disabled={!canUseTermFields}
              onChange={(event) => update("autoEndEnabled", event.target.checked)}
            />
            <span>Auto-end termed war</span>
          </label>
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
  showName = true,
  showFinishTimes = false,
  showTornFields = true,
  showOfficialTimes = showTornFields,
  showEnemyFaction = showTornFields,
  showTornWarId = showTornFields,
  showStatus = false,
  allowedWarTypes,
}: {
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  showName?: boolean;
  showFinishTimes?: boolean;
  showTornFields?: boolean;
  showOfficialTimes?: boolean;
  showEnemyFaction?: boolean;
  showTornWarId?: boolean;
  showStatus?: boolean;
  allowedWarTypes?: Array<Exclude<WarType, "all">>;
}) {
  const canUseTermFields = form.warType === "termed";
  const canEditTornFields = form.warType === "event";
  const warTypeOptions = allowedWarTypes ?? ["real", "termed", "event"];

  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, [key]: value });
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
      <label>
        <span>Practical start time</span>
        {form.timeMode === "epoch" ? (
          <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
        ) : (
          <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
        )}
      </label>
      {showFinishTimes ? (
        <>
          <label>
            <span>Practical finish time</span>
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.autoEndEnabled}
              onChange={(event) => update("autoEndEnabled", event.target.checked)}
            />
            <span>Auto-end termed war</span>
          </label>
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
    autoEndEnabled: false,
    factionRespectLimit: "",
    memberRespectLimit: "",
  };
}

function toEventPayload(form: AdminWarFormState): AdminWarPayload {
  const payload: AdminWarPayload = {
    war_type: "event",
    name: form.name.trim(),
    practical_start_time: secondsFromFormTime(form, "start"),
  };

  setOptionalNumber(payload, "enemy_faction_id", form.factionId);

  return payload;
}

function toHistoricalEventPayload(form: AdminWarFormState): AdminWarPayload {
  const payload: AdminWarPayload = {
    war_type: "event",
    name: form.name.trim(),
    practical_start_time: secondsFromFormTime(form, "start"),
    practical_finish_time: secondsFromFormTime(form, "finish"),
  };

  setOptionalNumber(payload, "enemy_faction_id", form.factionId);

  return payload;
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
    setOptionalTime(payload, "official_finish_time", form, "officialFinish");
  }

  setOptionalNumber(payload, "enemy_faction_id", form.factionId);
  setOptionalNumber(payload, "torn_war_id", form.tornWarId);

  if (form.warType === "termed") {
    payload.auto_end_enabled = form.autoEndEnabled;
    setOptionalNumber(payload, "faction_respect_limit", form.factionRespectLimit);
    setOptionalNumber(payload, "member_respect_limit", form.memberRespectLimit);
  }

  return payload;
}

function isOfficialWar(war: WarSummary): boolean {
  return war.war_type !== "event";
}

function isEvent(war: WarSummary): boolean {
  return war.war_type === "event";
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

function warToForm(war: WarSummary): AdminWarFormState {
  const form = defaultWarForm();
  return {
    ...form,
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
    autoEndEnabled: Boolean(war.auto_end_enabled),
    factionRespectLimit: war.faction_respect_limit === null ? "" : String(war.faction_respect_limit),
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

function toWarEditPayload(id: number, form: AdminWarFormState): AdminWarPayload {
  const payload: AdminWarPayload = {
    id,
    name: form.name.trim(),
    status: form.status,
    war_type: form.warType,
    practical_start_time: secondsFromFormTime(form, "start"),
    practical_finish_time: optionalSecondsFromFormTime(form, "finish"),
    official_start_time: optionalSecondsFromFormTime(form, "officialStart"),
    official_finish_time: optionalSecondsFromFormTime(form, "officialFinish"),
    enemy_faction_id: optionalNumberOrNull(form.factionId),
    torn_war_id: optionalNumberOrNull(form.tornWarId),
    auto_end_enabled: form.warType === "termed" ? form.autoEndEnabled : false,
    faction_respect_limit:
      form.warType === "termed" ? optionalNumberOrNull(form.factionRespectLimit) : null,
    member_respect_limit:
      form.warType === "termed" ? optionalNumberOrNull(form.memberRespectLimit) : null,
  };

  return payload;
}

function toRelinkPayload(form: { tornWarId: string; name: string; fetchMissing: boolean }): {
  torn_war_id?: number;
  name?: string;
  fetch_missing?: boolean;
} {
  return {
    torn_war_id: form.tornWarId.trim() ? Number(form.tornWarId) : undefined,
    name: form.name.trim() || undefined,
    fetch_missing: form.fetchMissing,
  };
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

function setOptionalTime<T extends "official_start_time" | "official_finish_time">(
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

function optionalNumberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
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

function formatIngestionTime(timestamp: number | null): string {
  if (!timestamp) {
    return "Not recorded";
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(start: number | null, finish: number | null): string {
  if (!start || !finish) {
    return "Not recorded";
  }

  const durationMs = Math.max(0, (finish - start) * 1000);
  if (durationMs < 1000) {
    return "<1s";
  }

  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function dateTimeLocalFromSeconds(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}


