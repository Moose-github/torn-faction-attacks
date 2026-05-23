import React from "react";
import {
  Activity,
  Clock3,
  Radar,
  ShieldCheck,
  Swords,
  Users,
} from "lucide-react";
import {
  getLatestIngestionRun,
  getLatestMaintenanceRun,
  getTradeWatchlists,
  IngestionRun,
  MaintenanceRun,
  MaintenanceTask,
  TradeWatchlist,
  WarDetailResponse,
  WarSummary,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatDate, formatNumber, formatRelativeTime } from "../utils/format";
import { displayWarStatus } from "../utils/members";
import type { AppView } from "../routes";

type DashboardHomeProps = {
  activeWar: WarSummary | null;
  isAdmin: boolean;
  isLoadingWars: boolean;
  selectedWar: WarSummary | null;
  warDetail: WarDetailResponse | null;
  wars: WarSummary[];
  onOpenView: (view: AppView) => void;
  onOpenWar: (warName: string) => void;
};

export function DashboardHome({
  activeWar,
  isAdmin,
  isLoadingWars,
  selectedWar,
  warDetail,
  wars,
  onOpenView,
  onOpenWar,
}: DashboardHomeProps) {
  const [ingestionRun, setIngestionRun] = React.useState<IngestionRun | null>(null);
  const [maintenanceRun, setMaintenanceRun] = React.useState<MaintenanceRun | null>(null);
  const [maintenanceTasks, setMaintenanceTasks] = React.useState<MaintenanceTask[]>([]);
  const [watchlists, setWatchlists] = React.useState<TradeWatchlist[]>([]);

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
  const memberRows = warDetail?.members ?? [];
  const currentMembers = memberRows.filter((member) => member.is_current_member !== 0).length;
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
          status={memberRows.length > 0 ? `${currentMembers || memberRows.length} tracked` : "No selected war"}
          tone={memberRows.length > 0 ? "good" : "quiet"}
          actionLabel="View members"
          onAction={() => onOpenView("members")}
        >
          <div className="dashboard-card-metrics">
            <MetricLine label="War members" value={memberRows.length > 0 ? formatNumber(memberRows.length) : "-"} />
            <MetricLine
              label="Successful hits"
              value={formatNumber(memberRows.reduce((total, member) => total + member.attacks_vs_enemy_successful, 0))}
            />
            <MetricLine
              label="Latest attack"
              value={formatRelativeTime(primaryWar?.last_attack_at ?? null)}
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
