import React from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Radar,
  ShieldCheck,
  Swords,
  Users,
} from "lucide-react";
import {
  getLatestIngestionRun,
  getLatestMaintenanceRun,
  getHomeFactionMemberSummary,
  getRecentFactionAttacks,
  getTradeWatchlists,
  HomeFactionMemberSummary,
  IngestionRun,
  MaintenanceRun,
  MaintenanceTask,
  RecentFactionAttack,
  TradeWatchlist,
  WarSummary,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatDate, formatNumber, formatRelativeTime } from "../utils/format";
import { displayWarStatus } from "../utils/members";
import type { AppView } from "../routes";

const RECENT_ATTACK_LIMIT = 10;
const RECENT_ATTACK_WINDOW_SECONDS = 5 * 60;
const RECENT_ATTACK_REFRESH_MS = 30_000;
const ATTACK_POLLING_RATE_LABEL = "Every 5 minutes";
const ATTACK_POLLING_DETAIL = "Worker wakes every minute; attack import runs on the 5-minute gate.";

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
  const [watchlists, setWatchlists] = React.useState<TradeWatchlist[]>([]);
  const [memberSummary, setMemberSummary] = React.useState<HomeFactionMemberSummary | null>(null);
  const [recentAttacks, setRecentAttacks] = React.useState<RecentFactionAttack[]>([]);
  const [recentAttacksLoaded, setRecentAttacksLoaded] = React.useState(false);

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

    async function loadRecentAttacks() {
      const response = await getRecentFactionAttacks({
        limit: RECENT_ATTACK_LIMIT,
        windowSeconds: RECENT_ATTACK_WINDOW_SECONDS,
      }).catch(() => null);
      if (!cancelled) {
        setRecentAttacks(response?.attacks ?? []);
        setRecentAttacksLoaded(true);
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
      setWatchlists([]);
      return;
    }

    let cancelled = false;

    async function loadAdminHealth() {
      const [ingestion, maintenance, trade] = await Promise.all([
        getLatestIngestionRun().catch(() => null),
        getLatestMaintenanceRun().catch(() => null),
        getTradeWatchlists().catch(() => null),
      ]);

      if (cancelled) {
        return;
      }

      setIngestionRun(ingestion?.run ?? null);
      setMaintenanceRun(maintenance?.run ?? null);
      setMaintenanceTasks(maintenance?.tasks ?? []);
      setWatchlists(trade?.watchlists ?? []);
    }

    loadAdminHealth();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const primaryWar = activeWar ?? selectedWar ?? wars[0] ?? null;
  const missingReports = wars.filter((war) => war.status === "ended" && !war.torn_report_fetched_at).length;
  const tradeScansDue = watchlists.filter((watchlist) => {
    const scannedAt = watchlist.latest_snapshot?.scanned_at ?? 0;
    return scannedAt === 0 || scannedAt < Math.floor(Date.now() / 1000) - 6 * 60 * 60;
  }).length;

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
          <h2>Faction command centre</h2>
          <p>Live war status, member signals, maintenance health, and the next places worth checking.</p>
        </div>
      </section>

      <section className="dashboard-home-grid">
        <DashboardCard
          icon={<Swords size={17} />}
          title="Live war"
          status={activeWar ? displayWarStatus(activeWar) : "No live war"}
          tone={activeWar ? "hot" : "quiet"}
          actionLabel={activeWar ? "Open War room" : primaryWar ? "Open latest war" : undefined}
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
          status={activeWar?.enemy_faction_id ? "Live tracking available" : "Inactive"}
          tone={activeWar?.enemy_faction_id ? "good" : "quiet"}
          actionLabel={activeWar?.enemy_faction_id ? "Open tracking" : "Open War room"}
          onAction={() => onOpenView("warRoom")}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="Enemy faction" value={activeWar?.enemy_faction_id ? String(activeWar.enemy_faction_id) : "-"} />
            <MetricLine label="Scouting check" value={formatRelativeTime(activeWar?.enemy_scouting_status_checked_at ?? null)} />
            <MetricLine label="Monitor" value={activeWar?.enemy_faction_id ? "Ready from War room" : "No active enemy"} />
          </div>
        </DashboardCard>

        <DashboardCard
          icon={<Users size={17} />}
          title="Members"
          status={memberSummary ? `${formatNumber(memberSummary.current_members)} current` : "Loading roster"}
          tone={memberSummary && memberSummary.current_members > 0 ? "good" : "quiet"}
          actionLabel="View performance"
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

      <section className={isAdmin ? "dashboard-home-lower-grid" : "dashboard-home-lower-grid member-only"}>
        <DashboardCard
          icon={<Activity size={17} />}
          title="Maintenance health"
          status={isAdmin ? maintenanceRunStatus(maintenanceRun) : "Admin only"}
          tone={maintenanceRun?.status === "error" ? "danger" : maintenanceRun ? "good" : "quiet"}
          actionLabel={isAdmin ? "Open admin controls" : undefined}
          onAction={isAdmin ? () => onOpenView("admin") : undefined}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="Ingestion" value={isAdmin ? ingestionStatus(ingestionRun) : "Hidden for members"} />
            <MetricLine label="15m maintenance" value={isAdmin ? maintenanceRunStatus(maintenanceRun) : "Hidden for members"} />
            <MetricLine label="Tasks logged" value={isAdmin ? formatNumber(maintenanceTasks.length) : "-"} />
          </div>
        </DashboardCard>

        {isAdmin ? (
          <DashboardCard
            icon={<ShieldCheck size={17} />}
            title="Admin attention"
            status={missingReports + tradeScansDue > 0 ? `${missingReports + tradeScansDue} to check` : "Clear"}
            tone={missingReports + tradeScansDue > 0 ? "warn" : "good"}
            actionLabel="Open admin"
            onAction={() => onOpenView("admin")}
          >
            <div className="dashboard-card-metrics">
              <MetricLine label="Missing reports" value={formatNumber(missingReports)} />
              <MetricLine label="Trade scans due" value={formatNumber(tradeScansDue)} />
              <MetricLine label="Watchlists" value={formatNumber(watchlists.length)} />
            </div>
          </DashboardCard>
        ) : null}
      </section>

      <section className="panel dashboard-activity-panel dashboard-attacks-panel">
        <PanelHeader
          icon={<Swords size={17} />}
          title="Recent attacks"
          aside={`Last 5 minutes, max ${RECENT_ATTACK_LIMIT}`}
        />
        <div className="dashboard-attack-info">
          <span>Attack polling</span>
          <strong>{ATTACK_POLLING_RATE_LABEL}</strong>
          <small>{ATTACK_POLLING_DETAIL}</small>
        </div>
        {!recentAttacksLoaded ? (
          <EmptyState text="Loading recent attacks" />
        ) : recentAttacks.length === 0 ? (
          <EmptyState text="No incoming or outgoing attacks in the last 5 minutes" />
        ) : (
          <div className="dashboard-attack-list">
            {recentAttacks.map((attack) => (
              <RecentAttackRow key={attack.id} attack={attack} />
            ))}
          </div>
        )}
      </section>

      <section className="panel dashboard-activity-panel">
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
    </div>
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
