import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  MessageSquare,
  Radar,
  Send,
  Swords,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import {
  getLatestIngestionRun,
  getLatestMaintenanceRun,
  getAdminSuggestions,
  getHomeFactionMemberSummary,
  getMemberAchievements,
  getRecentFactionAttacks,
  getTradeWatchlists,
  HomeFactionMemberSummary,
  IngestionRun,
  DailyStatsAttention,
  MaintenanceRun,
  MaintenanceTask,
  MemberAchievementSummary,
  MemberSuggestion,
  RecentFactionAttack,
  submitMemberSuggestion,
  TradeWatchlist,
  WarSummary,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatDate, formatNumber, formatRelativeTime } from "../utils/format";
import { displayWarStatus } from "../utils/members";
import type { AppView } from "../routes";

const RECENT_ATTACK_LIMIT = 10;
const RECENT_ATTACK_REFRESH_MS = 30_000;
const ADMIN_HEALTH_REFRESH_MS = 60_000;
const ATTACK_POLLING_RATE_LABEL = "About every minute during active tracking";
const ATTACK_POLLING_DETAIL = "When no live war is being tracked, attacks are checked less often.";
const HIGHLIGHT_ROTATE_MS = 6_000;
const HIGHLIGHT_REFRESH_MS = 5 * 60_000;
const HIGHLIGHT_GROUPS = [
  { key: "xanax", label: "Xanax" },
  { key: "gym_energy", label: "Gym energy" },
  { key: "mugs", label: "Mugs" },
] as const;
const HIGHLIGHT_METRIC_ORDER = [
  "xanax_yesterday",
  "xanax_average_7d",
  "gymenergy_yesterday",
  "gymenergy_7d",
  "mugs_yesterday",
  "mugs_7d",
];
const HIGHLIGHT_PERIODS = [
  { key: "yesterday", label: "24h stats" },
  { key: "last_7_completed_days", label: "Last 7 completed days" },
] as const;

type DashboardHomeProps = {
  activeWar: WarSummary | null;
  isAdmin: boolean;
  isLoadingWars: boolean;
  selectedWar: WarSummary | null;
  wars: WarSummary[];
  onOpenView: (view: AppView) => void;
  onOpenWar: (warName: string) => void;
};

export function DashboardHome({
  activeWar,
  isAdmin,
  isLoadingWars,
  selectedWar,
  wars,
  onOpenView,
  onOpenWar,
}: DashboardHomeProps) {
  const [ingestionRun, setIngestionRun] = React.useState<IngestionRun | null>(null);
  const [maintenanceRun, setMaintenanceRun] = React.useState<MaintenanceRun | null>(null);
  const [maintenanceTasks, setMaintenanceTasks] = React.useState<MaintenanceTask[]>([]);
  const [dailyStatsAttention, setDailyStatsAttention] = React.useState<DailyStatsAttention | null>(null);
  const [watchlists, setWatchlists] = React.useState<TradeWatchlist[]>([]);
  const [suggestions, setSuggestions] = React.useState<MemberSuggestion[]>([]);
  const [totalSuggestions, setTotalSuggestions] = React.useState(0);
  const [memberSummary, setMemberSummary] = React.useState<HomeFactionMemberSummary | null>(null);
  const [memberAchievements, setMemberAchievements] = React.useState<MemberAchievementSummary[]>([]);
  const [memberAchievementsLoaded, setMemberAchievementsLoaded] = React.useState(false);
  const [highlightRotation, setHighlightRotation] = React.useState(0);
  const [recentAttacks, setRecentAttacks] = React.useState<RecentFactionAttack[]>([]);
  const [recentAttacksLoaded, setRecentAttacksLoaded] = React.useState(false);
  const [recentAttacksError, setRecentAttacksError] = React.useState<string | null>(null);
  const [adminPanelCollapsed, setAdminPanelCollapsed] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberSummary() {
      const summary = await getHomeFactionMemberSummary().catch(() => null);
      if (!cancelled) {
        setMemberSummary(summary);
      }
    }

    loadMemberSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberAchievements() {
      const response = await getMemberAchievements().catch(() => null);
      if (!cancelled) {
        setMemberAchievements(response?.achievements ?? []);
        setMemberAchievementsLoaded(true);
      }
    }

    loadMemberAchievements();
    const timer = window.setInterval(loadMemberAchievements, HIGHLIGHT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(
      () => setHighlightRotation((current) => current + 1),
      HIGHLIGHT_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadRecentAttacks() {
      try {
        const response = await getRecentFactionAttacks({
          limit: RECENT_ATTACK_LIMIT,
        });
        if (!cancelled) {
          setRecentAttacks(response.attacks);
          setRecentAttacksError(null);
          setRecentAttacksLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setRecentAttacksError(error instanceof Error ? error.message : "Unable to load recent attacks");
          setRecentAttacksLoaded(true);
        }
      }
    }

    loadRecentAttacks();
    const timer = window.setInterval(loadRecentAttacks, RECENT_ATTACK_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!isAdmin) {
      setIngestionRun(null);
      setMaintenanceRun(null);
      setMaintenanceTasks([]);
      setDailyStatsAttention(null);
      setWatchlists([]);
      setSuggestions([]);
      setTotalSuggestions(0);
      return;
    }

    let cancelled = false;

    async function loadAdminHealth() {
      const [ingestion, maintenance, trade, suggestionsResponse] = await Promise.all([
        getLatestIngestionRun().catch(() => null),
        getLatestMaintenanceRun().catch(() => null),
        getTradeWatchlists().catch(() => null),
        getAdminSuggestions().catch(() => null),
      ]);

      if (cancelled) {
        return;
      }

      setIngestionRun(ingestion?.run ?? null);
      setMaintenanceRun(maintenance?.run ?? null);
      setMaintenanceTasks(maintenance?.tasks ?? []);
      setDailyStatsAttention(maintenance?.daily_stats_attention ?? null);
      setWatchlists(trade?.watchlists ?? []);
      setSuggestions(suggestionsResponse?.suggestions ?? []);
      setTotalSuggestions(suggestionsResponse?.total_suggestions ?? 0);
    }

    loadAdminHealth();
    const timer = window.setInterval(loadAdminHealth, ADMIN_HEALTH_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAdmin]);

  const primaryWar = activeWar ?? selectedWar ?? wars[0] ?? null;
  const missingReports = wars.filter((war) => war.status === "ended" && !war.torn_report_fetched_at).length;
  const dailyStatsAttentionCount =
    (dailyStatsAttention?.stale_personalstats ?? 0) + (dailyStatsAttention?.missing_donator_days ?? 0);
  const adminAttentionCount = missingReports + dailyStatsAttentionCount;

  const events = buildRecentEvents({
    activeWar,
    ingestionRun,
    maintenanceRun,
    maintenanceTasks,
    primaryWar,
    watchlists,
  });

  return (
    <>
      <section className="hero-panel compact-hero-panel dashboard-home-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Faction dashboard</h2>
          <p>A quick view of current wars, member status, recent attacks, and useful next steps.</p>
        </div>
      </section>

      {isAdmin && dailyStatsAttentionCount > 0 ? (
        <AdminDailyStatsAttentionAlert
          attention={dailyStatsAttention}
          onOpenAdmin={() => onOpenView("admin")}
        />
      ) : null}

      <section className="dashboard-home-grid">
        <DashboardCard
          icon={<Swords size={17} />}
          title="Current war"
          status={activeWar ? displayWarStatus(activeWar) : "No live war"}
          tone={activeWar ? "hot" : "quiet"}
          actionLabel={activeWar ? "Open war room" : primaryWar ? "Open latest war" : undefined}
          onAction={
            activeWar
              ? () => onOpenView("warRoom")
              : primaryWar
                ? () => onOpenWar(primaryWar.name)
                : undefined
          }
        >
          {primaryWar ? (
            <div className="dashboard-card-metrics">
              <MetricLine label="War" value={primaryWar.name} />
              <MetricLine
                label="Score"
                value={`${formatNumber(primaryWar.official_home_score ?? 0)} - ${formatNumber(primaryWar.official_enemy_score ?? 0)}`}
              />
              <MetricLine label="Started" value={formatDate(primaryWar.practical_start_time)} />
            </div>
          ) : (
            <EmptyState text={isLoadingWars ? "Loading wars" : "No wars recorded"} />
          )}
        </DashboardCard>

        <DashboardCard
          icon={<Radar size={17} />}
          title="Enemy tracking"
          status={activeWar?.enemy_faction_id ? "Tracking ready" : "Inactive"}
          tone={activeWar?.enemy_faction_id ? "good" : "quiet"}
          actionLabel={activeWar?.enemy_faction_id ? "Open tracking" : "Open war room"}
          onAction={() => onOpenView(activeWar?.enemy_faction_id ? "hospitalMonitor" : "warRoom")}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="Enemy faction" value={activeWar?.enemy_faction_id ? String(activeWar.enemy_faction_id) : "-"} />
            <MetricLine label="Scouting updated" value={formatRelativeTime(activeWar?.enemy_scouting_status_checked_at ?? null)} />
            <MetricLine label="Monitor" value={activeWar?.enemy_faction_id ? "Available in War room" : "No active target"} />
          </div>
        </DashboardCard>

        <DashboardCard
          icon={<Users size={17} />}
          title="Members"
          status={memberSummary ? `${formatNumber(memberSummary.current_members)} current` : "Loading roster"}
          tone={memberSummary && memberSummary.current_members > 0 ? "good" : "quiet"}
          actionLabel="Open member stats"
          onAction={() => onOpenView("members")}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="Current members" value={memberSummary ? formatNumber(memberSummary.current_members) : "-"} />
            <MetricLine label="Revivable" value={memberSummary ? formatNumber(memberSummary.revivable_members) : "-"} />
            <MetricLine
              label="Roster updated"
              value={formatRelativeTime(memberSummary?.updated_at ?? null)}
            />
          </div>
        </DashboardCard>
      </section>

      <MemberHighlightsPanel
        achievements={memberAchievements}
        loaded={memberAchievementsLoaded}
        rotation={highlightRotation}
      />

      <SuggestionBox
        onSubmitted={(suggestion) => {
          if (isAdmin) {
            setSuggestions((current) => [suggestion, ...current].slice(0, 12));
            setTotalSuggestions((current) => current + 1);
          }
        }}
      />

      {isAdmin ? (
        <section className="panel dashboard-admin-panel">
          <div className="panel-header collapsible-header dashboard-admin-header">
            <button
              type="button"
              className="collapse-button"
              onClick={() => setAdminPanelCollapsed((current) => !current)}
              aria-expanded={!adminPanelCollapsed}
            >
              <span>{adminPanelCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
              <strong>Admin operations</strong>
            </button>
            <span className="dashboard-admin-badge">
              <ShieldCheck size={14} />
              Admin only
            </span>
          </div>
          {adminPanelCollapsed ? null : (
            <>
              <p className="panel-description dashboard-admin-description">
                Admin-only checks for data refreshes, stale stats, suggestions, and recent system activity.
              </p>
              <section className="dashboard-home-lower-grid dashboard-admin-grid">
                <DashboardCard
                  icon={<Activity size={17} />}
                  title="Maintenance health"
                  status={maintenanceRunStatus(maintenanceRun)}
                  tone={maintenanceRun?.status === "error" ? "danger" : maintenanceRun ? "good" : "quiet"}
                  actionLabel="Open admin controls"
                  onAction={() => onOpenView("admin")}
                >
                  <div className="dashboard-card-metrics">
                    <MetricLine label="Ingestion" value={ingestionStatus(ingestionRun)} />
                    <MetricLine label="15m maintenance" value={maintenanceRunStatus(maintenanceRun)} />
                    <MetricLine label="Tasks logged" value={formatNumber(maintenanceTasks.length)} />
                  </div>
                </DashboardCard>

                <DashboardCard
                  icon={<ShieldCheck size={17} />}
                  title="Admin attention"
                  status={adminAttentionCount > 0 ? `${adminAttentionCount} to check` : "Clear"}
                  tone={adminAttentionCount > 0 ? "warn" : "good"}
                  actionLabel="Open admin"
                  onAction={() => onOpenView("admin")}
                >
                  <div className="dashboard-card-metrics">
                    <MetricLine label="Missing reports" value={formatNumber(missingReports)} />
                    <MetricLine label="Daily stats stale" value={formatNumber(dailyStatsAttentionCount)} />
                  </div>
                </DashboardCard>
              </section>

              <AdminSuggestionsPanel
                suggestions={suggestions}
                totalSuggestions={totalSuggestions}
              />

              <section className="dashboard-activity-panel dashboard-admin-activity-panel">
                <PanelHeader icon={<Clock3 size={17} />} title="Recent activity" />
                {events.length === 0 ? (
                  <EmptyState text="No recent activity yet" />
                ) : (
                  <div className="dashboard-event-list">
                    {events.map((event) => (
                      <div key={`${event.label}-${event.time ?? event.detail}`} className="dashboard-event-row">
                        <span>{event.time ? formatRelativeTime(event.time) : "-"}</span>
                        <strong>{event.label}</strong>
                        <small>{event.detail}</small>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      ) : null}

      <section className="panel dashboard-activity-panel dashboard-attacks-panel">
        <PanelHeader
          icon={<Swords size={17} />}
          title="Recent attacks"
          aside={`Latest ${RECENT_ATTACK_LIMIT}`}
        />
        <div className="dashboard-attack-info">
          <span>Attack updates</span>
          <strong>{ATTACK_POLLING_RATE_LABEL}</strong>
          <small>{ATTACK_POLLING_DETAIL}</small>
        </div>
        {!recentAttacksLoaded ? (
          <EmptyState text="Loading recent attacks" />
        ) : recentAttacksError && recentAttacks.length === 0 ? (
          <EmptyState text={`Recent attacks unavailable: ${recentAttacksError}`} />
        ) : recentAttacks.length === 0 ? (
          <EmptyState text="No recent incoming or outgoing attacks yet" />
        ) : (
          <>
            {recentAttacksError ? (
              <p className="dashboard-attack-warning">Refresh failed: {recentAttacksError}</p>
            ) : null}
            <div className="dashboard-attack-list">
              {recentAttacks.map((attack) => (
                <RecentAttackRow key={attack.id} attack={attack} />
              ))}
            </div>
          </>
        )}
      </section>

    </>
  );
}

function RecentAttackRow({ attack }: { attack: RecentFactionAttack }) {
  const isOutgoing = attack.direction === "outgoing";
  const actor = isOutgoing
    ? displayAttackName(attack.attacker_name, attack.attacker_id)
    : displayAttackName(attack.defender_name, attack.defender_id);
  const target = isOutgoing
    ? displayAttackName(attack.defender_name, attack.defender_id)
    : displayAttackName(attack.attacker_name, attack.attacker_id);

  return (
    <div className={`dashboard-attack-row ${attack.direction}`}>
      <span className="dashboard-attack-time">{formatRelativeTime(attack.started)}</span>
      <span className="dashboard-attack-direction">
        {isOutgoing ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
        {isOutgoing ? "Outgoing" : "Incoming"}
      </span>
      <span className="dashboard-attack-main">
        <strong>{actor}</strong>
        <small>{isOutgoing ? "attacked" : "was hit by"} {target}</small>
      </span>
      <span className="dashboard-attack-result">
        <strong>{attack.result ?? "Unknown"}</strong>
        <small>{formatRespect(attack.respect_gain)}</small>
      </span>
      <span className="dashboard-attack-actions" aria-label="Attack links">
        {attack.code ? (
          <a
            href={`https://www.torn.com/loader.php?sid=attackLog&ID=${encodeURIComponent(attack.code)}`}
            target="_blank"
            rel="noreferrer"
            title="Open attack log"
            aria-label="Open attack log"
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
        {!isOutgoing && attack.attacker_id ? (
          <a
            href={`https://www.torn.com/page.php?sid=attack&user2ID=${encodeURIComponent(String(attack.attacker_id))}`}
            target="_blank"
            rel="noreferrer"
            title={`Attack ${attack.attacker_name ?? `#${attack.attacker_id}`}`}
            aria-label={`Attack ${attack.attacker_name ?? `#${attack.attacker_id}`}`}
          >
            <Swords size={14} />
          </a>
        ) : null}
      </span>
    </div>
  );
}

function AdminDailyStatsAttentionAlert({
  attention,
  onOpenAdmin,
}: {
  attention: DailyStatsAttention | null;
  onOpenAdmin: () => void;
}) {
  const staleCount = attention?.stale_personalstats ?? 0;
  const missingDonatorDays = attention?.missing_donator_days ?? 0;
  const total = staleCount + missingDonatorDays;
  const affectedMembers = attention?.affected_members ?? [];

  return (
    <section className="dashboard-admin-alert" role="status" aria-live="polite">
      <div className="dashboard-admin-alert-heading">
        <span className="dashboard-admin-alert-icon">
          <AlertTriangle size={18} />
        </span>
        <div>
          <strong>Daily personal stats need attention</strong>
          <p>
            {formatNumber(total)} current member{total === 1 ? "" : "s"} still have unresolved daily personalstats.
          </p>
        </div>
      </div>
      <div className="dashboard-admin-alert-metrics">
        <MetricLine label="Old Torn buckets" value={formatNumber(staleCount)} />
        <MetricLine label="Missing donator days" value={formatNumber(missingDonatorDays)} />
      </div>
      {affectedMembers.length > 0 ? (
        <div className="dashboard-admin-alert-members">
          {affectedMembers.slice(0, 6).map((member) => (
            <span key={member.member_id} title={member.error ?? undefined}>
              {member.member_name ?? member.member_id}
              <small>{dailyStatsErrorLabel(member.error)}</small>
            </span>
          ))}
          {total > affectedMembers.length ? <span>+{formatNumber(total - affectedMembers.length)} more</span> : null}
        </div>
      ) : null}
      <button type="button" className="panel-action-button" onClick={onOpenAdmin}>
        Open repair tools
      </button>
    </section>
  );
}

function dailyStatsErrorLabel(error: string | null): string {
  if (!error) {
    return "Unknown";
  }
  if (error.startsWith("OLD_PERSONALSTATS_BUCKET")) {
    return "Old bucket";
  }
  if (error.startsWith("MISSING_DONATOR_DAYS")) {
    return "Missing days";
  }
  return "Error";
}

function SuggestionBox({
  onSubmitted,
}: {
  onSubmitted: (suggestion: MemberSuggestion) => void;
}) {
  const [suggestion, setSuggestion] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "good" | "error"; text: string } | null>(null);
  const remaining = 1200 - suggestion.length;
  const canSubmit = suggestion.trim().length >= 3 && remaining >= 0 && !isSubmitting;

  async function submitSuggestion(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = suggestion.trim();
    if (trimmed.length < 3) {
      setNotice({ tone: "error", text: "Add a little more detail first." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const response = await submitMemberSuggestion(trimmed);
      setSuggestion("");
      setNotice({ tone: "good", text: "Suggestion sent. Thank you." });
      onSubmitted(response.suggestion);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Suggestion could not be sent.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel dashboard-suggestion-panel">
      <PanelHeader icon={<MessageSquare size={17} />} title="Suggestions" />
      <form className="dashboard-suggestion-form" onSubmit={submitSuggestion}>
        <label>
          <span>Share an idea, bug, or quality-of-life request</span>
          <textarea
            value={suggestion}
            maxLength={1200}
            placeholder="What should be added or improved?"
            onChange={(event) => setSuggestion(event.target.value)}
          />
        </label>
        <div className="dashboard-suggestion-actions">
          <small className={remaining < 0 ? "danger" : undefined}>{formatNumber(Math.max(0, remaining))} characters left</small>
          <button type="submit" className="panel-action-button primary-action" disabled={!canSubmit}>
            <Send size={14} />
            {isSubmitting ? "Sending" : "Send suggestion"}
          </button>
        </div>
        {notice ? (
          <p className={notice.tone === "good" ? "dashboard-suggestion-success" : "form-error"}>{notice.text}</p>
        ) : null}
      </form>
    </section>
  );
}

function AdminSuggestionsPanel({
  suggestions,
  totalSuggestions,
}: {
  suggestions: MemberSuggestion[];
  totalSuggestions: number;
}) {
  return (
    <section className="dashboard-admin-suggestions-panel">
      <PanelHeader
        icon={<MessageSquare size={17} />}
        title="Member suggestions"
        aside={totalSuggestions > suggestions.length ? `${suggestions.length} of ${totalSuggestions}` : `${suggestions.length}`}
      />
      {suggestions.length === 0 ? (
        <EmptyState text="No suggestions yet" />
      ) : (
        <div className="dashboard-suggestion-list">
          {suggestions.map((suggestion) => (
            <article key={suggestion.id} className="dashboard-suggestion-row">
              <div>
                <strong>{suggestion.member_name ?? `#${suggestion.torn_user_id}`}</strong>
                <span>{formatRelativeTime(suggestion.created_at)}</span>
              </div>
              <p>{suggestion.suggestion}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MemberHighlightsPanel({
  achievements,
  loaded,
  rotation,
}: {
  achievements: MemberAchievementSummary[];
  loaded: boolean;
  rotation: number;
}) {
  const groups = buildHighlightGroups(achievements);
  const activePeriod = HIGHLIGHT_PERIODS[rotation % HIGHLIGHT_PERIODS.length];

  return (
    <section className="panel dashboard-highlights-panel">
      <div className="panel-header">
        <h2>
          <Trophy size={17} />
          Member highlights
          <span
            className="data-wip-badge"
            title="Member highlights are marked WIP while we rebuild and verify the daily stats data."
          >
            WIP
          </span>
        </h2>
        <span>{loaded ? `Top 3 | ${activePeriod.label}` : "Loading"}</span>
      </div>
      {!loaded ? (
        <EmptyState text="Loading member highlights" />
      ) : groups.length === 0 ? (
        <EmptyState text="No member highlights available yet" />
      ) : (
        <div className="dashboard-highlight-grid">
          {groups.map((group) => (
            <MemberHighlightTile
              key={group.key}
              group={group}
              periodKey={activePeriod.key}
              periodLabel={activePeriod.label}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MemberHighlightTile({
  group,
  periodKey,
  periodLabel,
}: {
  group: HighlightGroup;
  periodKey: HighlightPeriodKey;
  periodLabel: string;
}) {
  const metric = group.metrics.find((candidate) => candidate.periodKey === periodKey) ?? null;

  return (
    <article className="dashboard-highlight-tile">
      <div className="dashboard-highlight-heading">
        <span>{group.label}</span>
        <strong>{metric?.title ?? `${group.label} ${periodLabel.toLowerCase()}`}</strong>
        <small>{metric ? formatAchievementPeriod(metric.rows[0]) : periodLabel}</small>
      </div>
      <div className="dashboard-podium-list">
        {!metric || metric.rows.length === 0 ? (
          <EmptyState text="No podium for this period" />
        ) : (
          metric.rows.map((row) => (
            <div key={`${row.metric_key}-${row.rank}`} className={`dashboard-podium-row rank-${row.rank}`}>
              <span className="dashboard-rank-chip">{row.rank}</span>
              <strong>{row.member_name ?? `#${row.member_id}`}</strong>
              <small>{formatAchievementValue(row)}</small>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function displayAttackName(name: string | null, id: number | null): string {
  if (name) {
    return name;
  }

  return id ? `#${id}` : "Unknown";
}

function formatRespect(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0 respect";
  }

  return `${formatNumber(value)} respect`;
}

type HighlightGroup = {
  key: string;
  label: string;
  metrics: Array<{
    key: string;
    periodKey: HighlightPeriodKey;
    title: string;
    rows: MemberAchievementSummary[];
  }>;
};

type HighlightPeriodKey = (typeof HIGHLIGHT_PERIODS)[number]["key"];

function buildHighlightGroups(achievements: MemberAchievementSummary[]): HighlightGroup[] {
  return HIGHLIGHT_GROUPS.map((group) => {
    const groupRows = achievements.filter((achievement) => achievement.metric_group === group.key);
    const metricKeys = Array.from(new Set(groupRows.map((achievement) => achievement.metric_key)))
      .sort((left, right) => HIGHLIGHT_METRIC_ORDER.indexOf(left) - HIGHLIGHT_METRIC_ORDER.indexOf(right));

    return {
      key: group.key,
      label: group.label,
      metrics: metricKeys.map((metricKey) => {
        const rows = groupRows
          .filter((achievement) => achievement.metric_key === metricKey)
          .sort((left, right) => left.rank - right.rank);
        return {
          key: metricKey,
          periodKey: rows[0]?.period_key as HighlightPeriodKey,
          title: rows[0]?.metric_title ?? metricKey,
          rows,
        };
      }),
    };
  }).filter((group) => group.metrics.length > 0);
}

function formatAchievementPeriod(row: MemberAchievementSummary | undefined): string {
  if (!row) {
    return "-";
  }

  if (row.period_start_date === row.period_end_date) {
    return formatDateKey(row.period_start_date);
  }

  return `${formatDateKey(row.period_start_date)} - ${formatDateKey(row.period_end_date)}`;
}

function formatAchievementValue(row: MemberAchievementSummary): string {
  const unit = row.unit;
  const value = unit.includes("/day") ? formatNumber(row.value) : formatNumber(Math.round(row.value));
  return `${value} ${unit}`;
}

function formatDateKey(dateKey: string): string {
  const timestamp = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function DashboardCard({
  icon,
  title,
  status,
  tone,
  actionLabel,
  onAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  tone: "good" | "warn" | "danger" | "hot" | "quiet";
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className="panel dashboard-card">
      <div className="dashboard-card-header">
        <div>
          <span className="dashboard-card-icon">{icon}</span>
          <h3>{title}</h3>
        </div>
        <span className={`dashboard-status-chip ${tone}`}>{status}</span>
      </div>
      {children}
      {actionLabel && onAction ? (
        <button type="button" className="panel-action-button dashboard-card-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ingestionStatus(run: IngestionRun | null): string {
  if (!run) {
    return "No run logged";
  }

  return run.status === "error"
    ? "Error"
    : run.finished_at
      ? formatRelativeTime(run.finished_at)
      : "Running";
}

function maintenanceRunStatus(run: MaintenanceRun | null): string {
  if (!run) {
    return "No run logged";
  }

  return run.status === "error"
    ? "Error"
    : run.finished_at
      ? formatRelativeTime(run.finished_at)
      : "Running";
}

function buildRecentEvents({
  activeWar,
  ingestionRun,
  maintenanceRun,
  maintenanceTasks,
  primaryWar,
  watchlists,
}: {
  activeWar: WarSummary | null;
  ingestionRun: IngestionRun | null;
  maintenanceRun: MaintenanceRun | null;
  maintenanceTasks: MaintenanceTask[];
  primaryWar: WarSummary | null;
  watchlists: TradeWatchlist[];
}): Array<{ label: string; detail: string; time: number | null }> {
  const taskEvents = maintenanceTasks.slice(0, 2).map((task) => ({
    label: task.task_name,
    detail: task.status === "error" ? task.error ?? "Task failed" : `${task.changed_rows} row changes`,
    time: task.finished_at ?? task.started_at,
  }));

  return [
    activeWar
      ? {
          label: "Live war active",
          detail: activeWar.name,
          time: activeWar.last_attack_at ?? activeWar.summary_updated_at,
        }
      : null,
    primaryWar
      ? {
          label: "Latest recorded war",
          detail: `${primaryWar.name} - ${displayWarStatus(primaryWar)}`,
          time: primaryWar.summary_updated_at ?? primaryWar.practical_start_time,
        }
      : null,
    ingestionRun
      ? {
          label: "Ingestion",
          detail: ingestionRun.status === "error" ? ingestionRun.error ?? "Failed" : `${ingestionRun.fetched_attacks} attacks fetched`,
          time: ingestionRun.finished_at ?? ingestionRun.started_at,
        }
      : null,
    maintenanceRun
      ? {
          label: "15m maintenance",
          detail: `${maintenanceRun.status}, ${maintenanceRun.changed_rows} row changes`,
          time: maintenanceRun.finished_at ?? maintenanceRun.started_at,
        }
      : null,
    ...taskEvents,
    ...watchlists.slice(0, 1).map((watchlist) => ({
      label: "Trade scout",
      detail: `${watchlist.name}: ${watchlist.latest_snapshot?.opportunity_count ?? 0} opportunities`,
      time: watchlist.latest_snapshot?.scanned_at ?? watchlist.updated_at,
    })),
  ]
    .filter((event): event is { label: string; detail: string; time: number | null } => event !== null)
    .sort((a, b) => Number(b.time ?? 0) - Number(a.time ?? 0))
    .slice(0, 6);
}
