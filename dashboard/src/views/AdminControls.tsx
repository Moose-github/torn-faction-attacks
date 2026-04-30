import React from "react";
import {
  AdminWarPayload,
  AuthSession,
  authenticateTornKey,
  checkHealth,
  clearStoredAuthSession,
  createWar,
  deleteWar,
  endActiveWar,
  exportWarAttacksCsv,
  fetchTornWarReport,
  getWars,
  getStoredAuthSession,
  importWar,
  previewImportWar,
  previewRelinkAttacks,
  pullAttackWindow,
  rebuildStats,
  refreshAuthSession,
  relinkAttacks,
  runIngestion,
  updateWar,
  WarSummary,
  WarType,
} from "../api";
import { PanelHeader } from "../components/Common";

type AdminAction = {
  label: string;
  run: () => Promise<unknown>;
  tone?: "danger";
};

export function AdminControls() {
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );
  const [tornKey, setTornKey] = React.useState("");
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<AdminWarFormState>(() => defaultWarForm());
  const [importForm, setImportForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
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
  const [editForm, setEditForm] = React.useState<AdminWarFormState>(() => defaultWarForm());
  const [selectedEditWarId, setSelectedEditWarId] = React.useState("");
  const [exportForm, setExportForm] = React.useState({
    warName: "",
    scope: "war_relevant" as "all" | "outgoing" | "war_relevant",
    window: "official" as "official" | "practical",
    linkedStatus: "linked" as "linked" | "matching" | "unlinked",
    columns: "standard" as "standard" | "debug",
    overrideStart: false,
    overrideFinish: false,
    customStartTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    customFinishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
  });
  const [reportForm, setReportForm] = React.useState({ tornWarId: "" });
  const [attackWindowForm, setAttackWindowForm] = React.useState({
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) - 3600),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    limit: "100",
  });
  const [isBusy, setIsBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);

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
        setExportForm((current) => ({
          ...current,
          warName: current.warName || response.wars[0]?.name || "",
        }));
        setSelectedEditWarId((current) => current || String(response.wars[0]?.id ?? ""));
        setEditForm((current) =>
          selectedEditWarId || response.wars.length === 0
            ? current
            : warToForm(response.wars[0]),
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
  }, [authSession?.access_level]);

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

  async function runAdminAction(label: string, action: () => Promise<unknown>) {
    setIsBusy(label);
    setError(null);

    try {
      setResult(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(null);
    }
  }

  const actions: AdminAction[] = [
    { label: "Health check", run: checkHealth },
    { label: "Run ingestion", run: runIngestion },
    { label: "Rebuild stats", run: rebuildStats },
    { label: "End active war", run: endActiveWar, tone: "danger" },
  ];

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <h2>Admin controls</h2>
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
      ) : (
        <section className="panel admin-auth-panel">
          <PanelHeader
            title="Admin session"
            aside={authSession.user.name ?? `Torn user ${authSession.user.id}`}
          />
          <button type="button" className="admin-button" onClick={logout}>
            Sign out
          </button>
        </section>
      )}

      {authSession?.access_level === "admin" ? (
      <section className="admin-grid">
        <section className="panel">
          <PanelHeader title="API actions" />
          <div className="admin-action-grid">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={action.tone === "danger" ? "admin-button danger" : "admin-button"}
                disabled={isBusy !== null}
                onClick={() => runAdminAction(action.label, action.run)}
              >
                {isBusy === action.label ? "Working" : action.label}
              </button>
            ))}
          </div>
        </section>

        <ProjectTodoPanel />

        <section className="panel">
          <PanelHeader title="Edit existing war" />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Update war", () =>
                updateWar(toWarEditPayload(Number(selectedEditWarId), editForm)).then((response) => {
                  const updatedWar = (response as { war?: WarSummary }).war;
                  if (updatedWar) {
                    setWars((current) =>
                      current.map((war) => (war.id === updatedWar.id ? { ...war, ...updatedWar } : war)),
                    );
                    setEditForm(warToForm(updatedWar));
                    setExportForm((current) =>
                      current.warName === updatedWar.name
                        ? current
                        : { ...current, warName: updatedWar.name },
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
                value={selectedEditWarId}
                onChange={(event) => {
                  const war = wars.find((candidate) => candidate.id === Number(event.target.value));
                  setSelectedEditWarId(event.target.value);
                  if (war) {
                    setEditForm(warToForm(war));
                  }
                }}
                required
              >
                <option value="" disabled>
                  Select war
                </option>
                {wars.map((war) => (
                  <option value={war.id} key={war.id}>
                    {war.name}
                    {war.torn_war_id ? ` / Torn #${war.torn_war_id}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <WarFields
              form={editForm}
              onChange={setEditForm}
              showFinishTimes
              showStatus
            />
            <button
              type="submit"
              className="admin-button primary admin-form-wide"
              disabled={isBusy !== null || !selectedEditWarId}
            >
              Confirm changes
            </button>
          </form>
        </section>

        <section className="panel">
          <PanelHeader title="Export attacks CSV" />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Export attacks CSV", async () => {
                await exportWarAttacksCsv({
                  warName: exportForm.warName,
                  scope: exportForm.scope,
                  window: exportForm.window,
                  linkedStatus: exportForm.linkedStatus,
                  columns: exportForm.columns,
                  customStart: exportForm.overrideStart
                    ? secondsFromDateTimeLocal(exportForm.customStartTime)
                    : undefined,
                  customFinish: exportForm.overrideFinish
                    ? secondsFromDateTimeLocal(exportForm.customFinishTime)
                    : undefined,
                });
                return { ok: true, exported: exportForm.warName };
              });
            }}
          >
            <label className="admin-form-wide">
              <span>War</span>
              <select
                value={exportForm.warName}
                onChange={(event) =>
                  setExportForm({ ...exportForm, warName: event.target.value })
                }
                required
              >
                <option value="" disabled>
                  Select war
                </option>
                {wars.map((war) => (
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
              <span>Time window</span>
              <select
                value={exportForm.window}
                onChange={(event) =>
                  setExportForm({
                    ...exportForm,
                    window: event.target.value as typeof exportForm.window,
                  })
                }
              >
                <option value="official">Official Torn window</option>
                <option value="practical">Buttgrass practical window</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={exportForm.overrideStart}
                onChange={(event) =>
                  setExportForm({ ...exportForm, overrideStart: event.target.checked })
                }
              />
              <span>Choose export start</span>
            </label>
            <label>
              <span>Export start</span>
              <input
                type="datetime-local"
                value={exportForm.customStartTime}
                disabled={!exportForm.overrideStart}
                onChange={(event) =>
                  setExportForm({ ...exportForm, customStartTime: event.target.value })
                }
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={exportForm.overrideFinish}
                onChange={(event) =>
                  setExportForm({ ...exportForm, overrideFinish: event.target.checked })
                }
              />
              <span>Choose export finish</span>
            </label>
            <label>
              <span>Export finish</span>
              <input
                type="datetime-local"
                value={exportForm.customFinishTime}
                disabled={!exportForm.overrideFinish}
                onChange={(event) =>
                  setExportForm({ ...exportForm, customFinishTime: event.target.value })
                }
              />
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
                <option value="linked">Linked to selected war</option>
                <option value="matching">Matching rules, even if not linked</option>
                <option value="unlinked">Unlinked only</option>
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
          title="Create active or scheduled war"
          form={createForm}
          onChange={setCreateForm}
          isBusy={isBusy !== null}
          onSubmit={(payload) => runAdminAction("Create war", () => createWar(payload))}
        />

        <WarForm
          title="Import historical war"
          form={importForm}
          onChange={setImportForm}
          isBusy={isBusy !== null}
          requireFinishTime
          hideName
          showAutoEnd={false}
          secondaryActionLabel="Preview import window"
          onSecondaryAction={(payload) =>
            runAdminAction("Preview import window", () => previewImportWar(payload))
          }
          onSubmit={(payload) => runAdminAction("Import war", () => importWar(payload))}
        />

        <section className="panel">
          <PanelHeader title="Delete war" />
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
              <span>War name</span>
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

        <section className="panel">
          <PanelHeader title="Relink attacks" />
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
              <span>War name</span>
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
                runAdminAction("Preview relink attacks", () =>
                  previewRelinkAttacks(toRelinkPayload(relinkForm)),
                )
              }
            >
              Preview relink attacks
            </button>
            <button
              type="button"
              className="admin-button primary admin-form-wide"
              disabled={isBusy !== null}
              onClick={() =>
                runAdminAction("Relink attacks", () => relinkAttacks(toRelinkPayload(relinkForm)))
              }
            >
              Relink attacks
            </button>
          </form>
        </section>

        <section className="panel">
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

        <section className="panel">
          <PanelHeader title="Pull attack window" />
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              runAdminAction("Pull attack window", () =>
                pullAttackWindow({
                  practical_start_time: secondsFromDateTimeLocal(attackWindowForm.startTime),
                  practical_finish_time: secondsFromDateTimeLocal(attackWindowForm.finishTime),
                  limit: attackWindowForm.limit.trim() ? Number(attackWindowForm.limit) : undefined,
                }),
              );
            }}
          >
            <label>
              <span>Start time</span>
              <input
                type="datetime-local"
                value={attackWindowForm.startTime}
                onChange={(event) =>
                  setAttackWindowForm({ ...attackWindowForm, startTime: event.target.value })
                }
                required
              />
            </label>
            <label>
              <span>Finish time</span>
              <input
                type="datetime-local"
                value={attackWindowForm.finishTime}
                onChange={(event) =>
                  setAttackWindowForm({ ...attackWindowForm, finishTime: event.target.value })
                }
                required
              />
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
              Pull attack window
            </button>
          </form>
        </section>

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

function WarForm({
  title,
  form,
  onChange,
  onSubmit,
  isBusy,
  requireFinishTime = false,
  hideName = false,
  showAutoEnd = true,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  onSubmit: (payload: AdminWarPayload) => void;
  isBusy: boolean;
  requireFinishTime?: boolean;
  hideName?: boolean;
  showAutoEnd?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: (payload: AdminWarPayload) => void;
}) {
  const canUseTermFields = form.warType === "termed";
  const practicalTimesDisabled = requireFinishTime && form.warType === "real";

  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(toWarPayload(form, requireFinishTime));
  }

  return (
    <section className="panel">
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
            <option value="real">Real</option>
            <option value="termed">Termed</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span>Time input</span>
          <select value={form.timeMode} onChange={(event) => updateTimeMode(form, onChange, event.target.value as AdminWarFormState["timeMode"])}>
            <option value="datetime">Date and time</option>
            <option value="epoch">Epoch seconds</option>
          </select>
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
            <label>
              <span>Official start time</span>
              {form.timeMode === "epoch" ? (
                <input inputMode="numeric" value={form.officialStartEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("officialStartEpoch", event.target.value)} />
              ) : (
                <input type="datetime-local" value={form.officialStartTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "officialStart", event.target.value)} />
              )}
            </label>
            <label>
              <span>Official finish time</span>
              {form.timeMode === "epoch" ? (
                <input inputMode="numeric" value={form.officialFinishEpoch} disabled={practicalTimesDisabled} onChange={(event) => update("officialFinishEpoch", event.target.value)} />
              ) : (
                <input type="datetime-local" value={form.officialFinishTime} disabled={practicalTimesDisabled} onChange={(event) => updateDateTime(form, onChange, "officialFinish", event.target.value)} />
              )}
            </label>
          </>
        ) : null}
        <label>
          <span>Enemy faction ID</span>
          <input inputMode="numeric" value={form.factionId} onChange={(event) => update("factionId", event.target.value)} />
        </label>
        <label>
          <span>Torn war ID</span>
          <input inputMode="numeric" value={form.tornWarId} onChange={(event) => update("tornWarId", event.target.value)} />
        </label>
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
  showFinishTimes = false,
  showStatus = false,
}: {
  form: AdminWarFormState;
  onChange: (form: AdminWarFormState) => void;
  showFinishTimes?: boolean;
  showStatus?: boolean;
}) {
  const canUseTermFields = form.warType === "termed";

  function update<K extends keyof AdminWarFormState>(key: K, value: AdminWarFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <>
      <label>
        <span>Name</span>
        <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
      </label>
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
          <option value="real">Real</option>
          <option value="termed">Termed</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        <span>Time input</span>
        <select value={form.timeMode} onChange={(event) => updateTimeMode(form, onChange, event.target.value as AdminWarFormState["timeMode"])}>
          <option value="datetime">Date and time</option>
          <option value="epoch">Epoch seconds</option>
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
          <label>
            <span>Official start time</span>
            {form.timeMode === "epoch" ? (
              <input inputMode="numeric" value={form.officialStartEpoch} onChange={(event) => update("officialStartEpoch", event.target.value)} />
            ) : (
              <input type="datetime-local" value={form.officialStartTime} onChange={(event) => updateDateTime(form, onChange, "officialStart", event.target.value)} />
            )}
          </label>
          <label>
            <span>Official finish time</span>
            {form.timeMode === "epoch" ? (
              <input inputMode="numeric" value={form.officialFinishEpoch} onChange={(event) => update("officialFinishEpoch", event.target.value)} />
            ) : (
              <input type="datetime-local" value={form.officialFinishTime} onChange={(event) => updateDateTime(form, onChange, "officialFinish", event.target.value)} />
            )}
          </label>
        </>
      ) : null}
      <label>
        <span>Enemy faction ID</span>
        <input inputMode="numeric" value={form.factionId} onChange={(event) => update("factionId", event.target.value)} />
      </label>
      <label>
        <span>Torn war ID</span>
        <input inputMode="numeric" value={form.tornWarId} onChange={(event) => update("tornWarId", event.target.value)} />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.autoEndEnabled}
          disabled={!canUseTermFields}
          onChange={(event) => update("autoEndEnabled", event.target.checked)}
        />
        <span>Auto-end termed war</span>
      </label>
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
    </>
  );
}

function ProjectTodoPanel() {
  const items = [
    "Add better admin controls",
    "Add better security-fix endpoints",
    "Add Caching",
    "UI stuff",
  ];

  return (
    <section className="panel todo-panel">
      <PanelHeader title="To-do" />
      <ol>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </section>
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

function updateTimeMode(
  form: AdminWarFormState,
  onChange: (form: AdminWarFormState) => void,
  timeMode: AdminWarFormState["timeMode"],
) {
  if (timeMode === form.timeMode) {
    return;
  }

  if (timeMode === "epoch") {
    onChange({
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
    });
    return;
  }

  onChange({
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
  });
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

function dateTimeLocalFromSeconds(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}
