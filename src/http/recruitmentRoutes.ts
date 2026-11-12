import { controlRecruitmentScan, recruitmentCandidates, recruitmentStatus } from '../recruitment';
import { refreshRecruitmentSnapshot, RecruitmentInputError } from '../recruitmentSnapshot';
import { readJsonObject } from '../backend/request';
import { json } from '../utils';
import { withAdmin, withMember, type RouteContext, type RouteResult } from './context';

export async function routeRecruitmentApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url } = context;
  if (!url.pathname.startsWith('/api/recruitment/')) return null;
  const handle = async () => {
    try {
      if (request.method === 'GET' && url.pathname === '/api/recruitment/status') return json({ ok: true, ...await recruitmentStatus(env) });
      if (request.method === 'GET' && url.pathname === '/api/recruitment/candidates') return json({ ok: true, ...await recruitmentCandidates(env, url.searchParams) });
      if (request.method === 'POST' && url.pathname === '/api/recruitment/candidates/refresh') {
        await refreshRecruitmentSnapshot(env);
        return json({ ok: true, ...await recruitmentStatus(env) });
      }
      const action = /^\/api\/recruitment\/scan\/(start|pause|resume)$/.exec(url.pathname)?.[1];
      if (request.method === 'POST' && action) {
        const body = await readJsonObject(request);
        if (typeof body.run_id !== 'string') throw new RecruitmentInputError('Refresh the scan controls before trying again.');
        await controlRecruitmentScan(env, action, body.run_id);
        return json({ ok: true, ...await recruitmentStatus(env) });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      if (error instanceof RecruitmentInputError) return json({ ok: false, error: error.message }, 400);
      // Do not log upstream URLs or credentials, including errors originating in fetch.
      return json({ ok: false, error: 'Recruitment data is temporarily unavailable. Saved scan progress is retained.' }, 503);
    }
  };
  return request.method === 'GET' ? withMember(context, handle) : withAdmin(context, handle);
}
