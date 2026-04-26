import React from "react";
import ReactDOM from "react-dom/client";
import { ArrowDown, ArrowUp, BarChart3, CalendarClock, ShieldCheck, Swords, Target, Wrench } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AdminWarPayload,
  checkHealth,
  createWar,
  deleteWar,
  endActiveWar,
  getStats,
  getWar,
  getWarMemberAttacks,
  getWars,
  importWar,
  MemberAttack,
  MemberStats,
  previewImportWar,
  rebuildStats,
  runIngestion,
  WarDetailResponse,
  WarSummary,
  WarType,
} from "./api";
import "./styles.css";

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

function App() {
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<"war" | "members" | "admin">("war");
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState<string | null>(null);
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
  const [overallWars, setOverallWars] = React.useState(0);
  const [memberSort, setMemberSort] = React.useState<MemberSort>({
    key: "enemy_attacks_successful",
    direction: "desc",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [isLoadingWars, setIsLoadingWars] = React.useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<MemberStats | null>(null);
  const [memberAttacks, setMemberAttacks] = React.useState<MemberAttack[]>([]);
  const [isLoadingMemberAttacks, setIsLoadingMemberAttacks] = React.useState(false);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWars() {
    setIsLoadingWars(true);
    setError(null);

    try {
      const [warsResponse, statsResponse] = await Promise.all([
        getWars(warType),
        getStats(warType),
      ]);

      if (cancelled) return;

      setWars(warsResponse.wars);
      setOverallWars(statsResponse.overall.total_wars);

      setSelectedWarName((currentSelectedWarName) => {
        const selectedStillVisible = warsResponse.wars.some(
          (war) => war.name === currentSelectedWarName,
        );

        return selectedStillVisible
          ? currentSelectedWarName
          : warsResponse.wars[0]?.name ?? null;
      });
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelled) {
        setIsLoadingWars(false);
      }
    }
  }

  loadWars();

  return () => {
    cancelled = true;
  };
}, [warType]);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWarDetail() {
    if (!selectedWarName) {
      setWarDetail(null);
      return;
    }

    setWarDetail(null);
    setIsLoadingDetail(true);
    setError(null);

    try {
      const detail = await getWar(selectedWarName);
      if (!cancelled) {
        setWarDetail(detail);
      }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelled) {
        setIsLoadingDetail(false);
      }
    }
  }

  loadWarDetail();

  return () => {
    cancelled = true;
  };
}, [selectedWarName]);

  React.useEffect(() => {
    setSelectedMember(null);
    setMemberAttacks([]);
  }, [selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberAttacks() {
      if (!selectedWarName || !selectedMember) {
        setMemberAttacks([]);
        return;
      }

      setIsLoadingMemberAttacks(true);
      setError(null);

      try {
        const response = await getWarMemberAttacks(selectedWarName, selectedMember.member_id);
        if (!cancelled) {
          setMemberAttacks(response.attacks);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemberAttacks(false);
        }
      }
    }

    loadMemberAttacks();
    return () => {
      cancelled = true;
    };
  }, [selectedWarName, selectedMember]);

  const selectedWar = warDetail?.war ?? wars.find((war) => war.name === selectedWarName) ?? null;
  const members = sortMembers(warDetail?.members ?? [], memberSort);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Buttgrass Inc - test01</p>
          <h1>Torn faction attacks</h1>
        </div>
      </header>

      {error ? <div className="error-panel">{error}</div> : null}

      <div className="dashboard-layout">
        <aside className="sidebar panel">
          <PanelHeader
            title="Recorded wars"
            aside={isLoadingWars ? "Loading" : `${wars.length}`}
            control={<WarTypeSelect value={warType} onChange={setWarType} />}
          />
          <SidebarLink
            active={view === "members"}
            icon={<BarChart3 size={18} />}
            label="Member performance"
            onClick={() => setView("members")}
          />
          <SidebarLink
            active={view === "admin"}
            icon={<Wrench size={18} />}
            label="Admin controls"
            onClick={() => setView("admin")}
          />
          <WarNav
            wars={wars}
            selectedWarName={selectedWarName}
            onSelect={(name) => {
              setSelectedWarName(name);
              setView("war");
            }}
          />
        </aside>

        <section className="main-content">
          {view === "admin" ? (
            <AdminControls />
          ) : view === "members" ? (
            <MembersOverview warType={warType} />
          ) : selectedWar ? (
            <>
              <section className="hero-panel">
                <div>
                  <p className="eyebrow">{selectedWar.status}</p>
                  <h2>{selectedWar.name}</h2>
                  <p>
                    {(selectedWar.war_type ?? "real").toUpperCase()} · {formatDate(selectedWar.start_time)}
                  </p>
                </div>
                {selectedWar.war_type === "termed" ? (
                  <TermProgress
                    war={selectedWar}
                    observedRespect={detailNumber(
                      warDetail?.summary?.total_respect_gain,
                      selectedWar.total_respect_gain,
                    )}
                  />
                ) : null}
              </section>

              <section className="status-grid war-status-grid">
                <MetricCard
                  label="Respect gained"
                  value={formatNumber(detailNumber(warDetail?.summary?.total_respect_gain, selectedWar.total_respect_gain))}
                  icon={<Target size={18} />}
                />
                <MetricCard
                  label="Successful attacks"
                  value={formatNumber(sumMembers(members, "enemy_attacks_successful"))}
                  icon={<Swords size={18} />}
                />
                <MetricCard
                  label="Victory / loss"
                  value={warOutcome(selectedWar, detailNumber(warDetail?.summary?.total_respect_gain, selectedWar.total_respect_gain), detailNumber(warDetail?.summary?.total_respect_lost, selectedWar.total_respect_lost))}
                  icon={<CalendarClock size={18} />}
                />
              </section>

              <section className="content-grid">
                <section className="panel chart-panel">
                  <PanelHeader
                    title="Attacks"
                    aside={isLoadingDetail ? "Loading" : `${members.length} members`}
                  />
                  <AttackChart members={members.slice(0, 10)} />
                </section>

                <section className="panel">
                  <PanelHeader title="War totals" />
                  <div className="metric-list">
                    <InlineMetric label="Respect gained" value={detailNumber(warDetail?.summary?.total_respect_gain, selectedWar.total_respect_gain)} />
                    <InlineMetric label="Successful attacks" value={sumMembers(members, "enemy_attacks_successful")} />
                    <InlineMetric label="Assists" value={sumMembers(members, "enemy_assists")} />
                  </div>
                </section>
              </section>

              <section className="panel table-panel">
                <PanelHeader title="Member leaderboard" />
                <MemberTable
                  members={members}
                  sort={memberSort}
                  onSortChange={setMemberSort}
                  selectedMemberId={selectedMember?.member_id ?? null}
                  onMemberSelect={setSelectedMember}
                />
              </section>

              {selectedMember ? (
                <section className="panel table-panel">
                  <PanelHeader
                    title={`${displayMember(selectedMember)} attacks`}
                    aside={isLoadingMemberAttacks ? "Loading" : `${memberAttacks.length} rows`}
                  />
                  <MemberAttackList attacks={memberAttacks} />
                </section>
              ) : null}
            </>
          ) : (
            <section className="panel">
              <EmptyState text="No wars to show" />
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function WarTypeSelect({
  value,
  onChange,
}: {
  value: WarType;
  onChange: (value: WarType) => void;
}) {
  return (
    <select
      className="war-type-select"
      value={value}
      aria-label="Filter recorded wars"
      onChange={(event) => onChange(event.target.value as WarType)}
    >
      <option value="all">All</option>
      <option value="real">Real</option>
      <option value="termed">Termed</option>
      <option value="other">Other</option>
    </select>
  );
}

function SidebarLink({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "sidebar-link active" : "sidebar-link"} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WarNav({
  wars,
  selectedWarName,
  onSelect,
}: {
  wars: WarSummary[];
  selectedWarName: string | null;
  onSelect: (name: string) => void;
}) {
  if (wars.length === 0) {
    return <EmptyState text="No wars recorded" />;
  }

  return (
    <nav className="war-nav">
      {wars.map((war) => (
        <button
          key={war.id}
          type="button"
          className={war.name === selectedWarName ? "selected" : ""}
          onClick={() => onSelect(war.name)}
        >
          <span className="war-nav-main">
            <strong>{war.name}</strong>
            <small>
              {war.status} · {formatDate(war.start_time)}
            </small>
          </span>
          <span className="war-nav-type">{war.war_type ?? "real"}</span>
        </button>
      ))}
    </nav>
  );
}

function TermProgress({
  war,
  observedRespect,
}: {
  war: WarSummary;
  observedRespect: number;
}) {
  if (!war.faction_respect_limit) {
    return null;
  }

  const observed = Math.max(observedRespect, war.last_observed_respect ?? 0);
  const progress = Math.min(100, (observed / war.faction_respect_limit) * 100);

  return (
    <div className="progress-block hero-progress">
      <div className="progress-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>
        {formatNumber(observed)} / {formatNumber(war.faction_respect_limit)} respect
      </small>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="panel-kicker">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

function PanelHeader({
  icon,
  title,
  aside,
  control,
}: {
  icon?: React.ReactNode;
  title: string;
  aside?: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2>
        {icon}
        {title}
      </h2>
      {control ?? (aside ? <span>{aside}</span> : null)}
    </div>
  );
}

function AttackChart({ members }: { members: MemberStats[] }) {
  if (members.length === 0) {
    return <EmptyState text="No member data yet" />;
  }

  const data = members.map((member) => ({
    name: displayMember(member),
    successful: Number(member.enemy_attacks_successful ?? 0),
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-45}
            textAnchor="end"
            interval={0}
            height={80}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Bar dataKey="successful" name="Attacks" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={`successful-${index}`} fill="#2563eb" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type MemberSortKey =
  | "member_name"
  | "enemy_attacks_successful"
  | "defends_total"
  | "enemy_respect_gained"
  | "enemy_assists";

type MemberSort = {
  key: MemberSortKey;
  direction: "asc" | "desc";
};

function MemberTable({
  members,
  sort,
  onSortChange,
  selectedMemberId,
  onMemberSelect,
}: {
  members: MemberStats[];
  sort: MemberSort;
  onSortChange: (sort: MemberSort) => void;
  selectedMemberId?: number | null;
  onMemberSelect?: (member: MemberStats) => void;
}) {
  if (members.length === 0) {
    return <EmptyState text="No members to show" />;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <SortableHeader label="Member" sortKey="member_name" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Attacks" sortKey="enemy_attacks_successful" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Defends" sortKey="defends_total" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Respect gained" sortKey="enemy_respect_gained" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Assists" sortKey="enemy_assists" sort={sort} onSortChange={onSortChange} />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.member_id} className={member.member_id === selectedMemberId ? "selected-member-row" : ""}>
              <td>
                {onMemberSelect ? (
                  <button
                    type="button"
                    className="member-link"
                    onClick={() => onMemberSelect(member)}
                  >
                    {displayMember(member)}
                  </button>
                ) : (
                  displayMember(member)
                )}
              </td>
              <td>
                <AttackBreakdown member={member} />
              </td>
              <td>
                <DefendBreakdown member={member} />
              </td>
              <td>{formatNumber(member.enemy_respect_gained)}</td>
              <td>{formatNumber(member.enemy_assists)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberAttackList({ attacks }: { attacks: MemberAttack[] }) {
  if (attacks.length === 0) {
    return <EmptyState text="No attacks for this member" />;
  }

  return (
    <div className="table-scroll">
      <table className="attack-log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Attacker</th>
            <th>Defender</th>
            <th>Result</th>
            <th>Respect</th>
          </tr>
        </thead>
        <tbody>
          {attacks.map((attack) => (
            <tr key={attack.id} className={`attack-row ${attack.classification}`}>
              <td>{formatDate(attack.started)}</td>
              <td>{classificationLabel(attack.classification)}</td>
              <td>{attack.attacker_name ?? `#${attack.attacker_id ?? "-"}`}</td>
              <td>{attack.defender_name ?? `#${attack.defender_id ?? "-"}`}</td>
              <td>{attack.result ?? "-"}</td>
              <td>{formatNumber(attack.respect_gain ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttackBreakdown({ member }: { member: MemberStats }) {
  const leaves = Math.max(
    0,
    member.enemy_attacks_successful -
      member.enemy_hospitalizations -
      member.enemy_mugs,
  );
  const hasBreakdown =
    member.enemy_hospitalizations > 0 ||
    member.enemy_mugs > 0 ||
    (leaves > 0 && leaves !== member.enemy_attacks_successful);

  if (!hasBreakdown) {
    return <>{formatNumber(member.enemy_attacks_successful)}</>;
  }

  return (
    <span
      className="tooltip-value"
      title={`Hospitalizations: ${formatNumber(member.enemy_hospitalizations)} | Mugs: ${formatNumber(member.enemy_mugs)} | Leaves: ${formatNumber(leaves)}`}
    >
      {formatNumber(member.enemy_attacks_successful)}
    </span>
  );
}

function DefendBreakdown({ member }: { member: MemberStats }) {
  const defendsLost = Math.max(0, member.defends_total - member.defends_won);

  if (member.defends_total === 0) {
    return <>0</>;
  }

  return (
    <span
      className="tooltip-value"
      title={`Won: ${formatNumber(member.defends_won)} | Lost: ${formatNumber(defendsLost)}`}
    >
      {formatNumber(member.defends_total)}
    </span>
  );
}

type AdminAction = {
  label: string;
  run: () => Promise<unknown>;
  tone?: "danger";
};

function AdminControls() {
  const [createForm, setCreateForm] = React.useState<AdminWarFormState>(() => defaultWarForm());
  const [importForm, setImportForm] = React.useState<AdminWarFormState>(() => ({
    ...defaultWarForm(),
    finishTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    finishEpoch: String(Math.floor(Date.now() / 1000)),
  }));
  const [deleteForm, setDeleteForm] = React.useState({ id: "", name: "" });
  const [isBusy, setIsBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);

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

      <section className="hero-panel admin-hero">
        <div>
          <p className="eyebrow">Testing tools</p>
          <h2>Admin controls</h2>
          <p>Trigger ingestion, rebuild derived stats, and manage war records from one place.</p>
        </div>
        <ShieldCheck size={42} />
      </section>

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
                  id: deleteForm.id.trim() ? Number(deleteForm.id) : undefined,
                  name: deleteForm.name.trim() || undefined,
                }),
              );
            }}
          >
            <label>
              <span>War ID</span>
              <input
                inputMode="numeric"
                value={deleteForm.id}
                onChange={(event) => setDeleteForm({ ...deleteForm, id: event.target.value })}
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

        <section className="panel admin-result-panel">
          <PanelHeader title="Latest API response" />
          <pre>{result ? JSON.stringify(result, null, 2) : "No action run yet."}</pre>
        </section>
      </section>
    </>
  );
}

type AdminWarFormState = {
  name: string;
  timeMode: "datetime" | "epoch";
  startTime: string;
  startEpoch: string;
  finishTime: string;
  finishEpoch: string;
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
  showAutoEnd?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: (payload: AdminWarPayload) => void;
}) {
  const canUseTermFields = form.warType === "termed";

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
        <label>
          <span>Name</span>
          <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
        </label>
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
          <span>Start time</span>
          {form.timeMode === "epoch" ? (
            <input inputMode="numeric" value={form.startEpoch} onChange={(event) => update("startEpoch", event.target.value)} required />
          ) : (
            <input type="datetime-local" value={form.startTime} onChange={(event) => updateDateTime(form, onChange, "start", event.target.value)} required />
          )}
        </label>
        {requireFinishTime ? (
          <label>
            <span>Finish time</span>
            {form.timeMode === "epoch" ? (
              <input inputMode="numeric" value={form.finishEpoch} onChange={(event) => update("finishEpoch", event.target.value)} required />
            ) : (
              <input type="datetime-local" value={form.finishTime} onChange={(event) => updateDateTime(form, onChange, "finish", event.target.value)} required />
            )}
          </label>
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

function ProjectTodoPanel() {
  const items = [
    "Add security",
    "Filter out chain bonuses",
    "Confirmation prompts",
    "per member attack breakdown",
    "early start for real wars to include hosps",
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
    timeMode: "datetime",
    startTime: dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000)),
    startEpoch: String(Math.floor(Date.now() / 1000)),
    finishTime: "",
    finishEpoch: "",
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
    name: form.name.trim(),
    start_time: secondsFromFormTime(form, "start"),
    war_type: form.warType,
  };

  if (includeFinishTime) {
    payload.finish_time = secondsFromFormTime(form, "finish");
  }

  setOptionalNumber(payload, "faction_id", form.factionId);
  setOptionalNumber(payload, "torn_war_id", form.tornWarId);

  if (form.warType === "termed") {
    payload.auto_end_enabled = form.autoEndEnabled;
    setOptionalNumber(payload, "faction_respect_limit", form.factionRespectLimit);
    setOptionalNumber(payload, "member_respect_limit", form.memberRespectLimit);
  }

  return payload;
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
    });
    return;
  }

  onChange({
    ...form,
    timeMode,
    startTime: dateTimeLocalFromSeconds(Number(form.startEpoch || 0)),
    finishTime: form.finishEpoch ? dateTimeLocalFromSeconds(Number(form.finishEpoch)) : "",
  });
}

function updateDateTime(
  form: AdminWarFormState,
  onChange: (form: AdminWarFormState) => void,
  field: "start" | "finish",
  value: string,
) {
  if (field === "start") {
    onChange({ ...form, startTime: value, startEpoch: String(secondsFromDateTimeLocal(value)) });
    return;
  }

  onChange({ ...form, finishTime: value, finishEpoch: String(secondsFromDateTimeLocal(value)) });
}

function secondsFromFormTime(form: AdminWarFormState, field: "start" | "finish"): number {
  if (form.timeMode === "epoch") {
    return Number(field === "start" ? form.startEpoch : form.finishEpoch);
  }

  return secondsFromDateTimeLocal(field === "start" ? form.startTime : form.finishTime);
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

function secondsFromDateTimeLocal(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function dateTimeLocalFromSeconds(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function MembersOverview({ warType }: { warType: WarType }) {
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [sort, setSort] = React.useState<MemberSort>({
    key: "enemy_attacks_successful",
    direction: "desc",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getStats(warType);
        if (!cancelled) {
          setStats(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [warType]);

  const members = sortMembers(stats?.top_members ?? [], sort);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{warType === "all" ? "All events" : warType}</p>
          <h2>Member performance</h2>
          <p>Combined member results across the selected event type.</p>
        </div>
      </section>

      <section className="status-grid war-status-grid">
        <MetricCard
          label="Respect gained"
          value={formatNumber(stats?.overall.total_respect_gain ?? 0)}
          icon={<Target size={18} />}
        />
        <MetricCard
          label="Successful attacks"
          value={formatNumber(sumMembers(members, "enemy_attacks_successful"))}
          icon={<Swords size={18} />}
        />
        <MetricCard
          label="Wars"
          value={formatNumber(stats?.overall.total_wars ?? 0)}
          icon={<CalendarClock size={18} />}
        />
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Member leaderboard" aside={isLoading ? "Loading" : `${members.length} members`} />
        <MemberTable members={members} sort={sort} onSortChange={setSort} />
      </section>
    </>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSortChange,
}: {
  label: string;
  sortKey: MemberSortKey;
  sort: MemberSort;
  onSortChange: (sort: MemberSort) => void;
}) {
  const isActive = sort.key === sortKey;
  const nextDirection = isActive && sort.direction === "desc" ? "asc" : "desc";

  return (
    <th>
      <button
        type="button"
        className={isActive ? "sort-button active" : "sort-button"}
        onClick={() => onSortChange({ key: sortKey, direction: nextDirection })}
      >
        {label}
        {isActive ? (
          sort.direction === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />
        ) : null}
      </button>
    </th>
  );
}

function InlineMetric({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "inline-metric muted" : "inline-metric"}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function displayMember(member: MemberStats): string {
  return member.member_name ?? `#${member.member_id}`;
}

function sortMembers(members: MemberStats[], sort: MemberSort): MemberStats[] {
  return [...members].sort((a, b) => {
    const direction = sort.direction === "desc" ? -1 : 1;
    const aValue = sortValue(a, sort.key);
    const bValue = sortValue(b, sort.key);

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue) * direction;
    }

    if (aValue < bValue) {
      return -1 * direction;
    }

    if (aValue > bValue) {
      return 1 * direction;
    }

    return (
      b.enemy_attacks_successful - a.enemy_attacks_successful ||
      b.enemy_respect_gained - a.enemy_respect_gained
    );
  });
}

function sortValue(member: MemberStats, key: MemberSortKey): string | number {
  if (key === "member_name") {
    return displayMember(member).toLowerCase();
  }

  return Number(member[key] ?? 0);
}

function warOutcome(war: WarSummary, gained: number, lost: number): string {
  if (war.status !== "ended") {
    return "In progress";
  }

  if (gained === lost) {
    return "Draw";
  }

  return gained > lost ? "Victory" : "Loss";
}

function classificationLabel(classification: MemberAttack["classification"]): string {
  switch (classification) {
    case "enemy_success":
      return "Enemy hit";
    case "enemy_assist":
      return "Assist";
    case "outside":
      return "Outside";
    case "defend_lost":
      return "Defend lost";
    case "defend_won":
      return "Defend won";
    case "enemy_attempt":
      return "Attempt";
    default:
      return "Other";
  }
}

function sumMembers(members: MemberStats[], key: keyof MemberStats): number {
  return members.reduce((total, member) => {
    const value = member[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function detailNumber(value: number | null | undefined, fallback: number | null | undefined): number {
  return Number(value ?? fallback ?? 0);
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
