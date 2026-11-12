import React from 'react';
import { Play, Pause, RefreshCw, Users } from 'lucide-react';
import { getJson, postJson } from '../api/client';
import { CITY_JOBS, RECRUITMENT_MIN_STATS, type RecruitmentStatus, type RecruitmentResults } from '../../../shared/recruitment';
import './recruitment.css';

const number = (n: number) => n.toLocaleString('en-GB');
const dateTime = (n: number | null) => n === null ? '—' : new Date(n * 1000).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';

export function Recruitment({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = React.useState<RecruitmentStatus | null>(null);
  const [results, setResults] = React.useState<RecruitmentResults | null>(null);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [version, setVersion] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [filters, setFilters] = React.useState({ job: 'all', coverage: 'matched', min: String(RECRUITMENT_MIN_STATS), max: '', q: '' });
  const [applied, setApplied] = React.useState(filters);
  const [refreshingCandidates, setRefreshingCandidates] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await getJson<RecruitmentStatus>('/api/recruitment/status', true, controller.signal);
        if (!controller.signal.aborted) setStatus(next);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load scan status.'); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 5000); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [version]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({ ...applied, page: String(page) });
    void getJson<RecruitmentResults>(`/api/recruitment/candidates?${query}`, true, controller.signal)
      .then(next => { if (!controller.signal.aborted) { setResults(next); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load candidates.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, version, status?.snapshot?.id, status?.scan.status]);

  async function control(action: 'start' | 'pause' | 'resume') {
    if (!status) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await postJson<RecruitmentStatus>(`/api/recruitment/scan/${action}`, { run_id: status.scan.run_id });
      setStatus(next); setVersion(v => v + 1);
      setNotice(action === 'pause' ? 'Paused. Any request already in flight will finish saving.' : 'Scan queued. Collection advances within the next minute and continues with this page closed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update scan.'); setVersion(v => v + 1); }
    finally { setBusy(false); }
  }

  async function refreshCandidates() {
    setRefreshingCandidates(true); setError(''); setNotice('');
    try {
      const next = await postJson<RecruitmentStatus>('/api/recruitment/candidates/refresh');
      setStatus(next); setPage(0); setVersion(v => v + 1);
      setNotice('Candidates refreshed from Torn’s daily active-player snapshot.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to refresh candidates.'); }
    finally { setRefreshingCandidates(false); }
  }

  const scan = status?.scan;
  const currentPageCount = results ? Math.max(1, Math.ceil(results.total / 50)) : 1;
  const estimatedMinutes = status?.keys.calls_per_minute ? Math.ceil(2006 / status.keys.calls_per_minute) : null;
  return <div className="recruitment-page">
    <section className="panel recruitment-intro">
      <div><p className="eyebrow">Company tools</p><h2><Users size={25} /> Recruitment</h2>
        <p>Find active players in city jobs or without a job, matched against saved work stats.</p></div>
      <div className="recruitment-floor"><strong>100,000+</strong><span>Saved total work stats</span></div>
    </section>
    {error && <div className="panel recruitment-error" role="alert">{error}</div>}
    {notice && <div className="panel" role="status">{notice}</div>}
      <section className="panel">
        <div className="recruitment-heading"><h3>Work-stat database</h3><span className={`recruitment-state ${scan?.status ?? ''}`}>{scan?.status ?? 'Loading'}</span></div>
        <p>Scans run only when started manually. The cutoff follows total stats, not a fixed leaderboard position.</p>
        <dl className="recruitment-metrics">
          <div><dt>Positions scanned</dt><dd>{number(scan?.next_offset ?? 0)}</dd></div>
          <div><dt>Records saved this scan</dt><dd>{number(scan?.players_saved ?? 0)}</dd></div>
          <div><dt>API calls used</dt><dd>{number(scan?.calls_used ?? 0)}</dd></div>
          <div><dt>Last work-stat total</dt><dd>{scan?.last_value == null ? '—' : number(scan.last_value)}</dd></div>
        </dl>
        <p className="recruitment-muted">{status ? `${status.keys.available} of ${status.keys.total} eligible pool keys available · Up to ${status.keys.calls_per_minute} calls/minute` : 'Checking key availability…'}</p>
        <p className="recruitment-muted">10 calls per key per rolling minute. Fallback excluded. Shared key limits and cooldowns also apply.</p>
        {scan?.status === 'idle' && <p>Initial estimate: 2,006 calls{estimatedMinutes ? `, about ${estimatedMinutes} minutes` : ''}. Actual duration depends on key availability and Torn response times.</p>}
        {scan?.started_at && <p className="recruitment-muted">Started {dateTime(scan.started_at)}{scan.finished_at ? ` · Finished ${dateTime(scan.finished_at)}` : ''}</p>}
        {scan?.last_error && <p className="recruitment-warning" role="status">{scan.last_error}</p>}
        {scan?.status === 'running' && <p role="status">{scan.retry_at > Date.now() / 1000 ? `Retry after ${dateTime(scan.retry_at)}.` : status?.keys.available === 0 ? 'Waiting for available pool keys.' : 'Collecting pages in the background. Progress is saved after each page.'}</p>}
        {isAdmin && scan && <div className="recruitment-actions">
          {['idle','completed'].includes(scan.status) && <button className="panel-action-button primary-action" disabled={busy || !status?.keys.available || scan.lease_until > Date.now()/1000} onClick={() => void control('start')}><RefreshCw size={16}/>{scan.status === 'idle' ? 'Start HOF scan' : 'Refresh HOF database'}</button>}
          {scan.status === 'running' && <button className="panel-action-button" disabled={busy} onClick={() => void control('pause')}><Pause size={16}/>Pause scan</button>}
          {['paused','failed'].includes(scan.status) && <button className="panel-action-button primary-action" disabled={busy} onClick={() => void control('resume')}><Play size={16}/>Resume scan</button>}
        </div>}
        {!isAdmin && <p className="recruitment-muted">An administrator can start, pause or resume a scan.</p>}
      </section>
    <section className="panel">
      <div className="recruitment-heading"><h3>Candidates</h3>{isAdmin
        ? <button className="panel-action-button" onClick={() => void refreshCandidates()} disabled={refreshingCandidates}><RefreshCw size={16}/>{refreshingCandidates ? 'Refreshing…' : 'Refresh candidates'}</button>
        : <button className="panel-action-button" onClick={() => setVersion(v => v + 1)} disabled={loading}>Refresh results</button>}</div>
      <p className="recruitment-muted">{status?.snapshot
        ? `Snapshot ${status.snapshot.snapshot_date} · ${number(status.snapshot.unemployed)} unemployed · ${number(status.snapshot.city_jobs)} city-job workers · Updated ${dateTime(status.snapshot.imported_at)}`
        : isAdmin ? 'Refresh candidates to fetch Torn’s daily active-player snapshot.' : 'An administrator can refresh the daily candidate data.'}</p>
      <p className="recruitment-muted">Candidate refresh uses one Torn API call. Filtering and matching saved work stats use no additional calls.</p>
      <p className="recruitment-muted">{results ? `${number(results.matched)} with saved stats · ${number(results.unknown)} not in saved work-stat data` : 'Loading coverage…'}. Missing stats may mean a player was below the cutoff or qualified after the last scan.</p>
      <form className="recruitment-filters" onSubmit={e => { e.preventDefault(); setPage(0); setApplied({...filters}); }}>
        <label>Employment<select value={filters.job} onChange={e => setFilters({...filters, job:e.target.value})}><option value="all">Unemployed + city jobs</option><option value="unemployed">Unemployed only</option>{CITY_JOBS.map(job => <option key={job}>{job}</option>)}</select></label>
        <label>Work-stat data<select value={filters.coverage} onChange={e => setFilters({...filters,coverage:e.target.value})}><option value="matched">Saved stats</option><option value="unknown">Not in saved data</option><option value="all">Both</option></select></label>
        <label>Minimum total<input type="number" min={RECRUITMENT_MIN_STATS} step="1" required disabled={filters.coverage==='unknown'} value={filters.min} onChange={e => setFilters({...filters,min:e.target.value})}/></label>
        <label>Maximum total<input type="number" min={Number(filters.min)||RECRUITMENT_MIN_STATS} step="1" disabled={filters.coverage==='unknown'} placeholder="No maximum" value={filters.max} onChange={e => setFilters({...filters,max:e.target.value})}/></label>
        <label>Player name or ID<input type="search" maxLength={100} value={filters.q} onChange={e => setFilters({...filters,q:e.target.value})}/></label>
        <button className="panel-action-button primary-action">Apply filters</button>
      </form>
      {loading ? <p role="status">Loading candidates…</p> : !status?.snapshot ? <p>No candidate data fetched yet.</p> : results?.candidates.length ? <>
        <div className="recruitment-table-wrap"><table className="recruitment-table"><thead><tr><th>Player</th><th>Employment</th><th>Level</th><th>Total work stats</th><th>Saved HOF position</th><th>Stats checked</th></tr></thead>
          <tbody>{results.candidates.map(p => <tr key={p.player_id}><td><a href={`https://www.torn.com/profiles.php?XID=${p.player_id}`} target="_blank" rel="noreferrer">{p.username}</a><small>{p.player_id}</small></td><td>{p.city_job ?? 'Unemployed'}</td><td>{p.level}</td><td>{p.total_work_stats === null ? 'Not in saved data' : number(p.total_work_stats)}</td><td>{p.hof_position === null ? '—' : number(p.hof_position)}</td><td>{dateTime(p.work_stats_checked_at)}</td></tr>)}</tbody></table></div>
        <div className="recruitment-pagination"><span>{number(results.total)} results · Page {page+1} of {number(currentPageCount)}</span><button className="panel-action-button" disabled={page===0} onClick={() => setPage(p => p-1)}>Previous</button><button className="panel-action-button" disabled={page+1>=currentPageCount} onClick={() => setPage(p => p+1)}>Next</button></div>
      </> : <p>No candidates match these filters{scan?.status==='running' ? ' yet. More matches may appear as the scan progresses' : ''}.</p>}
    </section>
  </div>;
}
