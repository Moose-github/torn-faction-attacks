import React from "react";
import { RefreshCw, ShieldCheck, Swords } from "lucide-react";
import {
  claimRetaliation,
  listAvailableRetaliations,
  type RetaliationOpportunity,
  type RetaliationsResponse,
} from "../api";
import { EmptyState, FreshnessMeta, PanelHeader } from "../components/Common";
import { formatDate, formatRelativeTime } from "../utils/format";
import { useCurrentTimeMs } from "../utils/time";

const REFRESH_MS = 12_000;

export function Retaliations({ currentUserId }: { currentUserId: number }) {
  const [data, setData] = React.useState<RetaliationsResponse | null>(null);
  const [includeExpired, setIncludeExpired] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [claimingId, setClaimingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const nowMs = useCurrentTimeMs();
  const nowSeconds = Math.floor(nowMs / 1000);

  const load = React.useCallback(async (showLoading: boolean) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      setData(await listAvailableRetaliations({
        includeClaimed: true,
        includeExpired,
        limit: 100,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [includeExpired]);

  React.useEffect(() => {
    void load(true);
  }, [load]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void load(false);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function handleClaim(row: RetaliationOpportunity) {
    if (!row.opening_attack_id || !row.available) return;
    setClaimingId(row.opening_attack_id);
    setError(null);
    setNotice(null);
    const attackUrl = attackLink(row.target_id);
    try {
      const response = await claimRetaliation({
        target_id: row.target_id,
        opening_attack_id: row.opening_attack_id,
        attack_url: attackUrl,
      });
      setData((current) => current ? replaceRetaliation(current, response.retaliation) : current);
      window.open(attackUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(claimFailureMessage(message));
      await load(false);
    } finally {
      setClaimingId(null);
    }
  }

  const rows = data?.retaliations ?? [];
  const availableCount = rows.filter((row) => row.status === "available").length;
  const startedCount = rows.filter((row) => row.status === "claimed_pending").length;
  const retaliatedCount = rows.filter((row) => row.status === "claimed_confirmed").length;
  const expiredCount = rows.filter((row) => row.status === "expired").length;

  return (
    <div className="retaliations-page">
      <section className="panel retaliations-header-panel">
        <PanelHeader
          title="Retaliations"
          icon={<Swords size={18} />}
          control={
            <FreshnessMeta
              state={freshnessLabel(data, isLoading)}
              cadence={freshnessCadence(data)}
              detail={freshnessDetail(data)}
              tone={freshnessTone(data, isLoading)}
            />
          }
        />
        <div className="retaliations-controls">
          <span className="retaliations-summary">
            <strong>{availableCount}</strong> available
            <strong>{startedCount}</strong> in progress
            {retaliatedCount > 0 ? (
              <>
                <strong>{retaliatedCount}</strong> retaliated
              </>
            ) : null}
            {expiredCount > 0 ? (
              <>
                <strong>{expiredCount}</strong> expired
              </>
            ) : null}
          </span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(event) => setIncludeExpired(event.target.checked)}
            />
            <span>Expired history</span>
          </label>
          <button type="button" className="panel-action-button" onClick={() => void load(true)} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? "spinning-icon" : ""} />
            Refresh
          </button>
        </div>
        {notice ? <p className="retaliations-notice">{notice}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Current board" aside={isLoading ? "Loading" : `${rows.length}`} icon={<ShieldCheck size={18} />} />
        {isLoading && !data ? (
          <EmptyState text="Loading retaliations" />
        ) : rows.length === 0 ? (
          <EmptyState text={includeExpired ? "No retaliation history to show" : "No active retaliations"} />
        ) : (
          <div className="table-scroll">
            <table className="retaliations-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Victim</th>
                  <th>Result</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Started by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RetaliationRow
                    key={row.opening_attack_id ?? `target-${row.target_id}`}
                    row={row}
                    currentUserId={currentUserId}
                    nowSeconds={nowSeconds}
                    isClaiming={claimingId === row.opening_attack_id}
                    onClaim={handleClaim}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RetaliationRow({
  row,
  currentUserId,
  nowSeconds,
  isClaiming,
  onClaim,
}: {
  row: RetaliationOpportunity;
  currentUserId: number;
  nowSeconds: number;
  isClaiming: boolean;
  onClaim: (row: RetaliationOpportunity) => void;
}) {
  const attack = row.enemy_attack;
  const startedSignal = row.pending_claim;
  const startedByMe = startedSignal?.claimant_torn_user_id === currentUserId;
  const canClaim = row.status === "available" && row.opening_attack_id !== null;
  const statusClass = row.status.replace("_", "-");

  return (
    <tr className={`retaliation-row ${statusClass}`}>
      <td>
        <a className="retaliation-table-link" href={profileLink(row.target_id)} target="_blank" rel="noreferrer">
          <strong>{attack?.attacker_name ?? `Torn ${row.target_id}`}</strong>
        </a>
        <small>{row.target_id}</small>
      </td>
      <td>
        {attack?.defender_id ? (
          <a className="retaliation-table-link" href={profileLink(attack.defender_id)} target="_blank" rel="noreferrer">
            <strong>{attack.defender_name ?? `Torn ${attack.defender_id}`}</strong>
          </a>
        ) : (
          <strong>{attack?.defender_name ?? "-"}</strong>
        )}
        <small>{attack?.defender_id ?? ""}</small>
      </td>
      <td>
        {attack?.code ? (
          <a className="retaliation-table-link" href={attackLogLink(attack.code)} target="_blank" rel="noreferrer">
            <strong>{attack.result ?? "Attack log"}</strong>
          </a>
        ) : (
          <strong>{attack?.result ?? "-"}</strong>
        )}
        <small>{formatDate(attack?.attack_at ?? null)}</small>
      </td>
      <td>
        <strong>{formatCountdown(row.expires_at, nowSeconds)}</strong>
        <small>{expiryDetail(row, nowSeconds)}</small>
      </td>
      <td>
        <span className={`status-pill retaliation-status ${statusClass}`}>
          {statusLabel(row)}
        </span>
      </td>
      <td>
        <strong>{startedSignal ? startedSignal.claimant_name ?? startedSignal.claimant_torn_user_id : retaliatedBy(row)}</strong>
        {startedSignal ? <small>{startedByMe ? "You" : signalSourceLabel(startedSignal.source)}</small> : null}
      </td>
      <td>
        <div className="retaliation-actions">
          <button
            type="button"
            className="panel-action-button primary-action"
            disabled={!canClaim || isClaiming}
            title={retaliationActionTitle(row)}
            onClick={() => onClaim(row)}
          >
            {isClaiming ? <RefreshCw size={14} className="spinning-icon" /> : <Swords size={14} />}
            {retaliationActionLabel(row, isClaiming)}
          </button>
        </div>
      </td>
    </tr>
  );
}

function replaceRetaliation(data: RetaliationsResponse, retaliation: RetaliationOpportunity): RetaliationsResponse {
  const rows = data.retaliations.some((row) => row.opening_attack_id === retaliation.opening_attack_id)
    ? data.retaliations.map((row) => row.opening_attack_id === retaliation.opening_attack_id ? retaliation : row)
    : [retaliation, ...data.retaliations];
  return {
    ...data,
    retaliations: rows,
    checked_at: Math.floor(Date.now() / 1000),
  };
}

function attackLink(targetId: number): string {
  return `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
}

function profileLink(userId: number): string {
  return `https://www.torn.com/profiles.php?XID=${userId}`;
}

function attackLogLink(code: string): string {
  return `https://www.torn.com/loader.php?sid=attackLog&ID=${encodeURIComponent(code)}`;
}

function statusLabel(row: RetaliationOpportunity): string {
  if (row.status === "available") return "Available";
  if (row.status === "claimed_pending") return "In progress";
  if (row.status === "claimed_confirmed") return "Retaliated";
  if (row.status === "expired") return "Expired";
  return "None";
}

function retaliatedBy(row: RetaliationOpportunity): string {
  return row.claimed_by_attack?.attacker_name ?? "-";
}

function signalSourceLabel(source: string): string {
  if (source === "dashboard") return "Dashboard";
  if (source === "tampermonkey") return "Userscript";
  return source;
}

function formatCountdown(expiresAt: number | null, nowSeconds: number): string {
  if (!expiresAt) return "-";
  const remaining = expiresAt - nowSeconds;
  if (remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function expiryDetail(row: RetaliationOpportunity, nowSeconds: number): string {
  if (!row.expires_at) return "-";
  if (row.status === "expired" || row.expires_at <= nowSeconds) {
    return `Expired ${formatRelativeTime(row.expires_at)}`;
  }
  return formatDate(row.expires_at);
}

function retaliationActionLabel(row: RetaliationOpportunity, isClaiming: boolean): string {
  if (isClaiming) return "Starting";
  if (row.status === "expired") return "Expired";
  if (row.status === "claimed_pending") return "Started";
  if (row.status === "claimed_confirmed") return "Done";
  return "Attack";
}

function retaliationActionTitle(row: RetaliationOpportunity): string {
  if (row.status === "available") return "Notify the board that you started this attack and open Torn";
  if (row.status === "expired") return "This retaliation window has expired";
  if (row.status === "claimed_pending") return "Another member has started this attack";
  if (row.status === "claimed_confirmed") return "Torn attack data confirmed this retaliation was completed";
  return "Retaliation is unavailable";
}

function claimFailureMessage(message: string): string {
  if (message.includes("CLAIM_ALREADY_PENDING") || /already (claimed|started)/i.test(message)) {
    return "Attack already started. Refreshing board.";
  }
  if (message.includes("OPPORTUNITY_CHANGED") || /newer/i.test(message)) {
    return "Opportunity changed. Refreshing board.";
  }
  if (message.includes("OPPORTUNITY_EXPIRED") || /expired/i.test(message)) {
    return "Opportunity expired. Refreshing board.";
  }
  return message;
}

function freshnessLabel(data: RetaliationsResponse | null, isLoading: boolean): string {
  if (!data) return isLoading ? "Loading" : "Unchecked";
  if (data.fresh) return data.sync.status === "refreshed" ? "Refreshed" : "Fresh";
  if (data.sync.status === "cooldown") return "Stored data";
  if (data.sync.status === "failed") return "Refresh failed";
  return "Stale";
}

function freshnessTone(data: RetaliationsResponse | null, isLoading: boolean): "fresh" | "stale" | "quiet" {
  if (!data) return isLoading ? "quiet" : "stale";
  return data.fresh ? "fresh" : "stale";
}

function freshnessDetail(data: RetaliationsResponse | null): string | undefined {
  if (!data) return undefined;
  const pieces = [
    "Dashboard polling: Auto 12s",
    `Board checked: ${formatDate(data.checked_at)}`,
    `Sync status: ${data.sync.status}`,
  ];
  if (data.sync.last_success_at) pieces.push(`Last success: ${formatDate(data.sync.last_success_at)}`);
  if (data.sync.warning) pieces.push(data.sync.warning);
  return pieces.join(" - ");
}

function freshnessCadence(data: RetaliationsResponse | null): string {
  if (!data) return "Auto 12s";
  return data.sync.last_success_at ? `Synced ${formatRelativeTime(data.sync.last_success_at)}` : "No sync yet";
}
