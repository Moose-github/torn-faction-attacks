import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleDollarSign,
  ExternalLink,
  Gauge,
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
  getDataHealthSummary,
  getHomeFactionMemberSummary,
  getMemberAchievements,
  getRecentFactionAttacks,
  getTradeWatchlists,
  getXanaxCompetition,
  HomeFactionMemberSummary,
  IngestionRun,
  DailyStatsAttention,
  DataHealthSummaryResponse,
  MaintenanceRun,
  MaintenanceTask,
  MemberAchievementSummary,
  MemberSuggestion,
  RecentFactionAttack,
  submitMemberSuggestion,
  TradeWatchlist,
  type GlobalWarState,
  WarSummary,
  XanaxCompetitionResponse,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatDate, formatNumber, formatRelativeTime } from "../utils/format";
import { displayWarStatus } from "../utils/members";
import type { AppView } from "../routes";

const RECENT_ATTACK_LIMIT = 10;
const RECENT_ATTACK_REFRESH_MS = 30_000;
const ADMIN_HEALTH_REFRESH_MS = 60_000;
const DATA_HEALTH_REFRESH_MS = 60_000;
const ATTACK_POLLING_RATE_LABEL = "Every minute";
const ATTACK_POLLING_DETAIL = "Attack ingestion now polls on the same one-minute cadence in every war state.";
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
  { key: "yesterday", label: "Last completed day" },
  { key: "last_7_completed_days", label: "Last complete 7-day period" },
] as const;
const TORN_XANAX_IMAGE_URL = "https://www.torn.com/images/items/206/medium@2x.png";
const XANAX_RAIN_DURATION_MS = 5_000;
const XANAX_RAIN_PARTICLES = Array.from({ length: 24 }, (_, index) => index);

type DashboardHomeProps = {
  activeWar: WarSummary | null;
  activeWarId: number | null;
  isAdmin: boolean;
  isLoadingWars: boolean;
  selectedWar: WarSummary | null;
  warState: GlobalWarState;
  wars: WarSummary[];
  onOpenView: (view: AppView) => void;
  onOpenWar: (warName: string) => void;
};

export function DashboardHome({
  activeWar,
  activeWarId,
  isAdmin,
  isLoadingWars,
  selectedWar,
  warState,
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
  const [xanaxCompetition, setXanaxCompetition] = React.useState<XanaxCompetitionResponse | null>(null);
  const [xanaxCompetitionLoaded, setXanaxCompetitionLoaded] = React.useState(false);
  const [highlightRotation, setHighlightRotation] = React.useState(0);
  const [recentAttacks, setRecentAttacks] = React.useState<RecentFactionAttack[]>([]);
  const [recentAttacksLoaded, setRecentAttacksLoaded] = React.useState(false);
  const [recentAttacksError, setRecentAttacksError] = React.useState<string | null>(null);
  const [dataHealth, setDataHealth] = React.useState<DataHealthSummaryResponse | null>(null);
  const [dataHealthLoaded, setDataHealthLoaded] = React.useState(false);
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

    async function loadXanaxCompetition() {
      const response = await getXanaxCompetition().catch(() => null);
      if (!cancelled) {
        setXanaxCompetition(response);
        setXanaxCompetitionLoaded(true);
      }
    }

    loadXanaxCompetition();
    const timer = window.setInterval(loadXanaxCompetition, HIGHLIGHT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadDataHealth() {
      const response = await getDataHealthSummary().catch(() => null);
      if (!cancelled) {
        setDataHealth(response);
        setDataHealthLoaded(true);
      }
    }

    loadDataHealth();
    const timer = window.setInterval(loadDataHealth, DATA_HEALTH_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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

  const stateWar = activeWarId === null
    ? null
    : wars.find((war) => war.id === activeWarId) ??
      (selectedWar?.id === activeWarId ? selectedWar : null);
  const primaryWar = stateWar ?? selectedWar ?? wars[0] ?? null;
  const missingReports = wars.filter((war) => war.status === "ended" && !war.torn_report_fetched_at).length;
  const dailyStatsAttentionCount =
    (dailyStatsAttention?.stale_personalstats ?? 0) + (dailyStatsAttention?.missing_donator_days ?? 0);
  const adminAttentionCount = missingReports + dailyStatsAttentionCount;
  const personalstatsLag = formatPersonalstatsLag(dailyStatsAttention);

  const events = buildRecentEvents({
    activeWar,
    ingestionRun,
    maintenanceRun,
    maintenanceTasks,
    primaryWar,
    warState,
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

      <section className="dashboard-feature-grid">
        <XanaxCompetitionSpotlight
          competition={xanaxCompetition}
          canTestRain={isAdmin}
          loaded={xanaxCompetitionLoaded}
        />
        <CurrentWarCard
          isLoadingWars={isLoadingWars}
          primaryWar={primaryWar}
          warState={warState}
          onOpenView={onOpenView}
          onOpenWar={onOpenWar}
        />
      </section>

      <section className="dashboard-home-grid">
        <DashboardCard
          icon={<Radar size={17} />}
          title="Enemy tracking"
          status={enemyTrackingStatus(warState, primaryWar)}
          tone={enemyTrackingTone(warState)}
          actionLabel={warState === "current" && activeWar?.enemy_faction_id ? "Open monitor" : "Open war room"}
          onAction={() => onOpenView(warState === "current" && activeWar?.enemy_faction_id ? "hospitalMonitor" : "warRoom")}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="Enemy faction" value={primaryWar?.enemy_faction_id ? String(primaryWar.enemy_faction_id) : "-"} />
            <MetricLine label="Scouting updated" value={formatRelativeTime(primaryWar?.enemy_scouting_status_checked_at ?? null)} />
            <MetricLine label="Monitor" value={enemyMonitorStatus(warState, activeWar)} />
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

        <DataHealthCard
          data={dataHealth}
          loaded={dataHealthLoaded}
          onOpenDataHealth={() => onOpenView("dataHealth")}
        />
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
                    <MetricLine label="Personalstats lag" value={personalstatsLag} />
                    <MetricLine label="Daily stat errors" value={formatNumber(dailyStatsAttentionCount)} />
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
            {formatNumber(total)} current member{total === 1 ? "" : "s"} returned incomplete or errored daily personalstats.
          </p>
        </div>
      </div>
      <div className="dashboard-admin-alert-metrics">
        <MetricLine label="Other errors" value={formatNumber(staleCount)} />
        <MetricLine label="Missing donator days" value={formatNumber(missingDonatorDays)} />
        <MetricLine label="Latest Torn bucket" value={attention?.latest_personalstats_bucket_date ?? "-"} />
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
    return "Bucket lag";
  }
  if (error.startsWith("MISSING_PERSONALSTATS_BUCKET")) {
    return "Missing bucket";
  }
  if (error.startsWith("MISSING_DONATOR_DAYS")) {
    return "Missing days";
  }
  return "Error";
}

function formatPersonalstatsLag(attention: DailyStatsAttention | null): string {
  if (!attention?.latest_personalstats_bucket_date) {
    return "-";
  }
  const lag = attention.personalstats_lag_days;
  const suffix = lag === null ? "" : ` (${lag}d)`;
  return `${attention.latest_personalstats_bucket_date}${suffix}`;
}

function CurrentWarCard({
  isLoadingWars,
  primaryWar,
  warState,
  onOpenView,
  onOpenWar,
}: {
  isLoadingWars: boolean;
  primaryWar: WarSummary | null;
  warState: GlobalWarState;
  onOpenView: (view: AppView) => void;
  onOpenWar: (warName: string) => void;
}) {
  const title = currentWarTileTitle(primaryWar, warState);
  const status = currentWarTileStatus(primaryWar, warState);
  const tone = currentWarTileTone(warState);
  const timing = primaryWar ? currentWarTiming(primaryWar, warState) : null;

  return (
    <DashboardCard
      className="current-war-card"
      icon={<Swords size={20} />}
      title={title}
      status={status}
      tone={tone}
      actionLabel={warState !== "none" && primaryWar ? "Open war room" : primaryWar ? "Open latest war" : undefined}
      onAction={
        warState !== "none" && primaryWar
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
          <MetricLine label="Type" value={warTypeLabel(primaryWar.war_type)} />
          {timing ? <MetricLine label={timing.label} value={formatDate(timing.timestamp)} /> : null}
        </div>
      ) : (
        <EmptyState text={isLoadingWars ? "Loading wars" : "No wars recorded"} />
      )}
    </DashboardCard>
  );
}

function currentWarTileTitle(war: WarSummary | null, warState: GlobalWarState): string {
  if (warState === "upcoming") {
    return "Upcoming war";
  }

  if (warState === "current") {
    return "Current war";
  }

  if (warState === "practically_finished") {
    return "Practically finished";
  }

  return war ? "Last war" : "Current war";
}

function currentWarTileStatus(war: WarSummary | null, warState: GlobalWarState): string {
  if (warState === "none") {
    return "No war";
  }

  return war ? displayWarStatus(war) : warState.replace("_", " ");
}

function currentWarTileTone(warState: GlobalWarState): "good" | "warn" | "danger" | "hot" | "quiet" {
  if (warState === "current") {
    return "hot";
  }
  if (warState === "upcoming") {
    return "warn";
  }
  return "quiet";
}

function currentWarTiming(
  war: WarSummary,
  warState: GlobalWarState,
): { label: string; timestamp: number | null } {
  if (warState === "upcoming") {
    return { label: "Starting", timestamp: war.official_start_time ?? war.practical_start_time };
  }

  if (warState === "practically_finished") {
    return { label: "Practical finish", timestamp: war.practical_finish_time };
  }

  if (warState === "none" || warEnded(war)) {
    return { label: "Finished", timestamp: war.official_end_time ?? war.practical_finish_time };
  }

  return { label: "Started", timestamp: war.official_start_time ?? war.practical_start_time };
}

function warEnded(war: WarSummary): boolean {
  return Boolean(war.official_end_time ?? war.practical_finish_time) || war.status === "ended";
}

function warTypeLabel(warType: WarSummary["war_type"]): string {
  if (warType === "real") {
    return "Real";
  }
  if (warType === "termed") {
    return "Termed";
  }
  if (warType === "event") {
    return "Event";
  }
  return "-";
}

function enemyTrackingStatus(warState: GlobalWarState, war: WarSummary | null): string {
  if (warState === "current" && war?.enemy_faction_id) {
    return "Live";
  }
  if (warState === "upcoming" && war?.enemy_faction_id) {
    return "Pre-war";
  }
  if (warState === "practically_finished") {
    return "Paused";
  }
  return "No war";
}

function enemyTrackingTone(warState: GlobalWarState): "good" | "warn" | "danger" | "hot" | "quiet" {
  if (warState === "current") {
    return "hot";
  }
  if (warState === "upcoming") {
    return "warn";
  }
  return "quiet";
}

function enemyMonitorStatus(warState: GlobalWarState, activeWar: WarSummary | null): string {
  if (warState === "current" && activeWar?.enemy_faction_id) {
    return "Available now";
  }
  if (warState === "upcoming") {
    return "Starts at war start";
  }
  if (warState === "practically_finished") {
    return "Stopped at practical finish";
  }
  return "No tracked war";
}

function DataHealthCard({
  data,
  loaded,
  onOpenDataHealth,
}: {
  data: DataHealthSummaryResponse | null;
  loaded: boolean;
  onOpenDataHealth: () => void;
}) {
  const attention = data?.subsystems
    .filter((subsystem) => subsystem.status === "critical" || subsystem.status === "warn")
    .slice(0, 3) ?? [];
  const primaryMetrics = data?.subsystems.slice(0, 3) ?? [];

  return (
    <DashboardCard
      icon={<Gauge size={17} />}
      title="Data health"
      status={!loaded ? "Loading" : data ? dataHealthStatusLabel(data.overall_status) : "Unavailable"}
      tone={!loaded || !data ? "quiet" : dashboardToneForHealth(data.overall_status)}
      actionLabel="Open overview"
      onAction={onOpenDataHealth}
    >
      {!loaded ? (
        <EmptyState text="Loading data freshness" />
      ) : !data ? (
        <EmptyState text="Data health unavailable" />
      ) : attention.length > 0 ? (
        <div className="dashboard-card-metrics">
          {attention.map((subsystem) => (
            <MetricLine
              key={subsystem.key}
              label={subsystem.label}
              value={`${dataHealthStatusLabel(subsystem.status)} - ${subsystem.summary}`}
            />
          ))}
        </div>
      ) : (
        <div className="dashboard-card-metrics">
          {primaryMetrics.map((subsystem) => (
            <MetricLine
              key={subsystem.key}
              label={subsystem.label}
              value={subsystem.updated_at ? formatRelativeTime(subsystem.updated_at) : subsystem.summary}
            />
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

function dataHealthStatusLabel(status: DataHealthSummaryResponse["overall_status"]): string {
  if (status === "critical") return "Critical";
  if (status === "warn") return "Warning";
  if (status === "good") return "Good";
  return "Unknown";
}

function dashboardToneForHealth(status: DataHealthSummaryResponse["overall_status"]): "good" | "warn" | "danger" | "hot" | "quiet" {
  if (status === "critical") return "danger";
  if (status === "warn") return "warn";
  if (status === "good") return "good";
  return "quiet";
}

function XanaxCompetitionSpotlight({
  canTestRain,
  competition,
  loaded,
}: {
  canTestRain: boolean;
  competition: XanaxCompetitionResponse | null;
  loaded: boolean;
}) {
  const [isRaining, setIsRaining] = React.useState(false);
  const rainPlayedRef = React.useRef(false);
  const leaderXanax = competition?.leaderboard[0]?.monthly_xanax ?? 0;
  const shouldPlayRain = loaded && Boolean(competition?.settings.enabled) && leaderXanax > 100;

  React.useEffect(() => {
    if (!shouldPlayRain || rainPlayedRef.current) {
      return;
    }

    rainPlayedRef.current = true;
    setIsRaining(true);
    const timer = window.setTimeout(() => setIsRaining(false), XANAX_RAIN_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [shouldPlayRain]);

  function playRain() {
    setIsRaining(false);
    window.setTimeout(() => setIsRaining(true), 0);
    window.setTimeout(() => setIsRaining(false), XANAX_RAIN_DURATION_MS);
  }

  if (!loaded) {
    return (
      <section className="panel xanax-competition-panel">
        <PanelHeader icon={<CircleDollarSign size={17} />} title="Monthly Xanax prize" aside="Loading" />
        <EmptyState text="Loading competition progress" />
      </section>
    );
  }

  if (!competition) {
    return (
      <section className="panel xanax-competition-panel">
        <PanelHeader icon={<CircleDollarSign size={17} />} title="Monthly Xanax prize" aside="Unavailable" />
        <EmptyState text="Competition progress unavailable" />
      </section>
    );
  }

  if (!competition.settings.enabled) {
    return (
      <section className="panel xanax-competition-panel">
        <PanelHeader icon={<CircleDollarSign size={17} />} title="Monthly Xanax prize" aside="Disabled" />
        <EmptyState text="Competition is currently disabled" />
      </section>
    );
  }

  const contenders = competition.leaderboard.slice(0, 3);

  return (
    <section className="panel xanax-competition-panel">
      {isRaining ? (
        <div className="xanax-rain" aria-hidden="true">
          {XANAX_RAIN_PARTICLES.map((particle) => (
            <img key={particle} src={TORN_XANAX_IMAGE_URL} alt="" />
          ))}
        </div>
      ) : null}
      <div className="xanax-competition-compact">
        <div className="xanax-competition-summary">
          <div>
            <span>Monthly Xanax prize</span>
            <strong>{formatPrize(competition.settings.current_prize)}</strong>
            <small>
              Take 100 Xanax in a month to win the prize.
              {competition.latest_snapshot_date
                ? ` | Updated ${formatDateKey(competition.latest_snapshot_date)}`
                : ""}
            </small>
          </div>
          <img
            className="xanax-competition-image"
            src={TORN_XANAX_IMAGE_URL}
            alt="Xanax"
            loading="lazy"
            decoding="async"
            onClick={canTestRain ? playRain : undefined}
          />
        </div>

        <div className="xanax-leaderboard">
          <div className="xanax-leaderboard-header">
            <span>Top 3 contenders</span>
            <small>{competition.settings.month_key}</small>
          </div>
          {contenders.length === 0 ? (
            <EmptyState text="No contenders yet" />
          ) : (
            contenders.map((row) => (
              <div
                key={row.member_id}
                className={`${row.eligible ? "xanax-leader-row eligible" : "xanax-leader-row"} rank-${row.rank}`}
              >
                <span className="dashboard-rank-chip">{row.rank}</span>
                <strong>{row.member_name ?? `#${row.member_id}`}</strong>
                <small>{formatNumber(row.monthly_xanax)} Xanax</small>
                {row.eligible ? <em>Eligible</em> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
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
  const headingTitle = metric
    ? formatHighlightTitle(metric, periodLabel)
    : `${group.label} ${periodLabel.toLowerCase()}`;
  const headingPeriod = metric
    ? formatHighlightPeriodSubtitle(metric, periodLabel)
    : periodLabel;
  const headingPeriodTitle = metric ? highlightPeriodTooltip(metric) : undefined;

  return (
    <article className="dashboard-highlight-tile">
      <div className="dashboard-highlight-heading">
        <span>{group.label}</span>
        <strong>{headingTitle}</strong>
        <small title={headingPeriodTitle}>{headingPeriod}</small>
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

function formatHighlightTitle(metric: HighlightGroup["metrics"][number], periodLabel: string): string {
  const row = metric.rows[0];
  if (metric.periodKey === "yesterday" && row) {
    return `${oneDayHighlightTitlePrefix(metric.title)} ${formatDateKey(row.period_start_date)}`;
  }

  return metric.title || periodLabel;
}

function oneDayHighlightTitlePrefix(title: string): string {
  return title.replace(/\s+(?:on last completed day|yesterday)$/i, "");
}

function formatHighlightPeriodSubtitle(
  metric: HighlightGroup["metrics"][number],
  periodLabel: string,
): string {
  if (metric.periodKey === "yesterday") {
    return periodLabel.toLowerCase();
  }

  return formatAchievementPeriod(metric.rows[0]);
}

function highlightPeriodTooltip(metric: HighlightGroup["metrics"][number]): string | undefined {
  if (metric.periodKey === "last_7_completed_days") {
    return "last complete 7-day period";
  }

  return undefined;
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

function formatPrize(value: number): string {
  return `$${formatNumber(Math.round(value))}`;
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
  className,
  icon,
  title,
  status,
  tone,
  actionLabel,
  onAction,
  children,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
  status: string;
  tone: "good" | "warn" | "danger" | "hot" | "quiet";
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className={`panel dashboard-card${className ? ` ${className}` : ""}`}>
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
  warState,
  watchlists,
}: {
  activeWar: WarSummary | null;
  ingestionRun: IngestionRun | null;
  maintenanceRun: MaintenanceRun | null;
  maintenanceTasks: MaintenanceTask[];
  primaryWar: WarSummary | null;
  warState: GlobalWarState;
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
          label: "Current war live",
          detail: activeWar.name,
          time: activeWar.last_attack_at ?? activeWar.summary_updated_at,
        }
      : null,
    primaryWar
      ? {
          label: warState === "none" ? "Latest recorded war" : "War state",
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
          detail: maintenanceRunDetail(maintenanceRun, maintenanceTasks),
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

function maintenanceRunDetail(run: MaintenanceRun, tasks: MaintenanceTask[]): string {
  const changedRows = rowChangeLabel(run.changed_rows);
  if (run.status !== "error") {
    return `${run.status}, ${changedRows}`;
  }

  const failedTask = tasks.find((task) => task.status === "error") ?? null;
  const failureLabel = failedTask ? failedTask.task_name : "maintenance task";
  const successfulChanges = run.changed_rows > 0 ? `. ${changedRows} from completed tasks` : "";
  return `Failed: ${failureLabel}${successfulChanges}`;
}

function rowChangeLabel(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "row change" : "row changes"}`;
}
