import { RECRUITMENT_MIN_STATS, type RecruitmentResults } from '../../../shared/recruitment';

export type RecruitmentFilters = {job:string; coverage:string; min:string; max:string; q:string};
export function filterRecruitmentCandidates(data: RecruitmentResults, filters: RecruitmentFilters, page: number) {
  const min = Number(filters.min) || RECRUITMENT_MIN_STATS;
  const max = filters.max ? Number(filters.max) : Infinity;
  const search = filters.q.trim().toLowerCase();
  const rows = data.candidates.filter(p => {
    if (filters.job === 'unemployed' ? p.city_job !== null : filters.job !== 'all' && p.city_job !== filters.job) return false;
    if (filters.coverage === 'unknown') { if (p.total_work_stats !== null) return false; }
    else if (p.total_work_stats === null ? filters.coverage !== 'all' : p.total_work_stats < min || p.total_work_stats > max) return false;
    return !search || p.username.toLowerCase().includes(search) || String(p.player_id) === search;
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length/50)-1));
  return {...data, candidates:rows.slice(currentPage*50,currentPage*50+50), total:rows.length, page:currentPage};
}
