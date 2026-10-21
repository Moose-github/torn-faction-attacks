import type { ResearchHealth, ResearchRun } from '../../../../shared/rankedResearch';

const when = (value: number | null | undefined) => value ? new Date(value * 1000).toLocaleString() : 'Not recorded yet';

export function ResearchCollectionHealth({ run, health, onDownload, busy }: {
  run: ResearchRun; health: ResearchHealth | null; onDownload: () => void; busy: boolean;
}) {
  const snapshot = run.status === 'frozen' && run.collection_json ? JSON.parse(run.collection_json) : null;
  const deferred = snapshot?.deferred_reports ?? run.deferred ?? 0;
  const failed = snapshot?.failed_reports ?? run.exhausted ?? 0;
  return <section className="research-collection-health" aria-label="Collection health">
    <h4>Collection health</h4>
    <dl className="research-health-grid">
      <div><dt>Last report saved</dt><dd>{when(run.last_saved_at)}</dd></div>
      <div><dt>Last successful response</dt><dd>{when(run.last_success_at)}</dd></div>
      <div><dt>Last collector check</dt><dd>{when(run.last_tick_at)}</dd></div>
      <div><dt>Saved reports reused</dt><dd>{run.reused ?? 0}</dd></div>
      <div><dt>Eligible Platinum reports</dt><dd>{run.eligible ?? 0} / {run.reports ?? 0} saved{run.reports ? ` (${Math.round(100 * (run.eligible ?? 0) / run.reports)}%)` : ''}</dd></div>
      <div><dt>{snapshot ? 'Deferred at freeze' : 'Reports awaiting retry'}</dt><dd>{deferred}</dd></div>
      <div><dt>{snapshot ? 'Retry limit reached at freeze' : 'Reports at retry limit'}</dt><dd>{failed}</dd></div>
      <div><dt>Remaining call budget</dt><dd>{Math.max(0, run.request_limit - run.requests).toLocaleString()}</dd></div>
      {health && <>
        <div><dt>Requests in last minute</dt><dd>{health.requests_last_minute}</dd></div>
        <div><dt>Average calls/minute, last 5 minutes</dt><dd>{(health.requests_last_five_minutes / 5).toFixed(1)}</dd></div>
        <div><dt>Failed calls in last 5 minutes</dt><dd>{health.failures_last_five_minutes}</dd></div>
        <div><dt>Opted-in owners / keys cooling down</dt><dd>{health.opted_in_owners} / {health.cooling_keys}</dd></div>
      </>}
    </dl>
    {run.status === 'running' && health?.budget_minutes != null && <p>At the last five minutes’ pace, the remaining budget lasts about {health.budget_minutes.toLocaleString()} minutes. This estimates budget exhaustion, not completion; discovery, retries and available capacity can change the pace.</p>}
    {run.status === 'running' && run.retry_at > Date.now() / 1000 && <p>Next automatic attempt no earlier than {when(run.retry_at)}.</p>}
    {run.last_error && <p>Last service/key issue: {run.last_error}</p>}
    {!!health?.cooling_keys && run.status !== 'frozen' && <p>Start / resume also retries keys cooled down by research. Owner-wide rate-limit cooldowns remain in force.</p>}
    {!!failed && run.status !== 'frozen' && <p>Reports at the retry limit remain unresolved. When collection pauses, Start / resume grants them another five attempts within your remaining call budget.</p>}
    {!!health?.issue_count && <details><summary>Unresolved report details ({health.issue_count})</summary>
      <p>Showing the first {Math.min(20, health.issues.length)} reports. Download all details to inspect every unresolved war{snapshot ? ' at freeze' : ''}.</p>
      <button className="admin-button" disabled={busy} onClick={onDownload}>Download report issues</button>
      <div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>War</th><th>Failed attempts</th><th>Retry</th><th>Reason</th></tr></thead><tbody>
        {health.issues.slice(0, 20).map(issue => <tr key={issue.war_id}><td>{issue.war_id}</td><td>{issue.failures} / 5</td><td>{snapshot ? 'Frozen' : issue.failures >= 5 ? 'Needs resume' : when(issue.next_attempt_at)}</td><td>{issue.last_error}</td></tr>)}
      </tbody></table></div>
    </details>}
    {!health && <p>Recent request statistics are unavailable.</p>}
  </section>;
}
