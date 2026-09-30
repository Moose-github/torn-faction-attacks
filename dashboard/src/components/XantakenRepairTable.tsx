import React from "react";
import { createMemberLifestyleRepairJob, type MemberLifestyleRepairJob, type XantakenRepairDetail } from "../api";
import { formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";

export function XantakenRepairTable({ rows, onRefresh }: {
  rows: XantakenRepairDetail[];
  onRefresh: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const requestInFlight = React.useRef(false);
  const [queuedJobs, setQueuedJobs] = React.useState<Record<string, MemberLifestyleRepairJob>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function repair(row: XantakenRepairDetail) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const key = `${row.member_id}:${row.snapshot_date}`;
    setSubmitting(key);
    setError(null);
    setNotice(null);
    try {
      const followingDay = new Date(`${row.snapshot_date}T00:00:00Z`);
      followingDay.setUTCDate(followingDay.getUTCDate() + 1);
      const { job } = await createMemberLifestyleRepairJob({
        member_id: row.member_id,
        start_date: row.snapshot_date,
        end_date: followingDay.toISOString().slice(0, 10),
        xantaken_recheck_date: row.snapshot_date,
      });
      setQueuedJobs(current => ({ ...current, [key]: job }));
      setNotice(`Repair queued for ${row.member_name ?? `#${row.member_id}`}, ${row.snapshot_date} and its adjacent days. Progress refreshes automatically.`);
    } catch (err) {
      setError(`${row.member_name ?? `#${row.member_id}`} (${row.snapshot_date}): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      requestInFlight.current = false;
      setSubmitting(null);
    }
    try {
      await onRefresh();
    } catch {
      setError("Could not refresh repair progress. Refresh Data health to check the latest status.");
    }
  }

  return (
    <div className="xantaken-repairs">
      <p>Each row is one member and date. Repair fetches personal stats for that member on the affected day and both adjacent days. The warning stays until the values pass validation.</p>
      {error ? <div className="error-panel" role="alert">{error}</div> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Xanax repair details">
        <table className="stock-status-table data-health-table data-health-issue-table xantaken-repair-table" aria-label="Xanax rechecks needing repair">
          <thead><tr>
            <th scope="col">Member / date (UTC)</th>
            <th scope="col">Problem / values</th>
            <th scope="col">Recheck attempts</th>
            <th scope="col">Last checked</th>
            <th scope="col">Repair</th>
          </tr></thead>
          <tbody>{rows.map(row => {
            const key = `${row.member_id}:${row.snapshot_date}`;
            const queued = queuedJobs[key];
            const local = queued && queued.id !== row.repair_job_id ? queued : null;
            const status = local?.status ?? row.repair_status;
            const active = status === "queued" || status === "running";
            const completed = local?.completed_items ?? row.repair_completed_items ?? 0;
            const failed = local?.failed_items ?? row.repair_failed_items ?? 0;
            const skipped = local?.skipped_items ?? row.repair_skipped_items ?? 0;
            const total = local?.total_items ?? row.repair_total_items ?? 0;
            return <tr key={key}>
              <td>
                <span className="data-health-issue-user">{row.member_name ?? `#${row.member_id}`}{row.member_name ? <small>#{row.member_id}</small> : null}</span>
                <br />{row.snapshot_date}
              </td>
              <td className="data-health-issue-error">
                <span>{problemDescription(row)}</span>
                <details className="xantaken-repair-values">
                  <summary>View values and error</summary>
                  <p>Cumulative Xanax totals recorded at the last recheck:</p>
                  <dl>
                    <dt>Previous day</dt><dd>{value(row.prior_xantaken)}</dd>
                    <dt>Affected day</dt><dd>{value(row.current_xantaken)}</dd>
                    <dt>Following day</dt><dd>{value(row.next_xantaken)}</dd>
                    <dt>Returned by recheck</dt><dd>{value(row.returned_xantaken)}</dd>
                    <dt>Returned date (UTC)</dt><dd>{row.returned_bucket_date ?? "Not returned"}</dd>
                  </dl>
                  <p>Recorded error: {row.last_error ?? "No error recorded"}</p>
                </details>
              </td>
              <td>{row.attempts} / {row.max_attempts}</td>
              <td title={formatLongDateTime(row.updated_at)}>{formatRelativeTime(row.updated_at)}</td>
              <td className="data-health-issue-error">
                {status ? <p role="status">
                  {active ? `${status === "queued" ? "Queued" : "Running"}: ${completed + failed + skipped}/${total} processed` :
                    status === "completed" ? "Repair finished; validation did not clear this issue." :
                    status === "failed" ? `Repair failed (${failed} failed).` : "Repair cancelled."}
                </p> : null}
                {row.repair_error ? <small>{row.repair_error}</small> : null}
                <button type="button" className="panel-action-button"
                  disabled={submitting !== null || active}
                  aria-label={`Repair Xanax stats for ${row.member_name ?? `#${row.member_id}`} on ${row.snapshot_date}`}
                  onClick={() => void repair(row)}>
                  {submitting === key ? "Queuing…" : active ? "Repair in progress" : status ? "Retry repair" : "Repair 3 days"}
                </button>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function value(total: number | null) {
  return total === null ? "Not recorded" : formatNumber(total);
}

function problemDescription(row: XantakenRepairDetail) {
  if (row.last_error === "Returned xantaken does not fit neighboring daily limits") {
    return "The rechecked total conflicts with adjacent days.";
  }
  if (row.reason === "impossible_delta") {
    return "The daily change is still outside the allowed range.";
  }
  return "The daily total did not change, and the recheck needs repair.";
}
