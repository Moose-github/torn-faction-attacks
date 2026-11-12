import { controlRecruitmentScan, recruitmentStatus } from '../recruitment';
import { readRecruitmentResults } from '../recruitmentResults';
import { cachedGetJson } from '../responseCache';
import { refreshRecruitmentSnapshot, RecruitmentInputError } from '../recruitmentSnapshot';
import { readJsonObject } from '../backend/request';
import { json } from '../utils';
import { withAdmin, withMember, type RouteContext, type RouteResult } from './context';

export async function routeRecruitmentApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url } = context;
  if (!url.pathname.startsWith('/api/recruitment/')) return null;
  const handle = async () => {
    try {
      if (request.method === 'GET' && url.pathname === '/api/recruitment/status') {
        return await cachedGetJson(request, context.ctx, 55, async () => json({ ok: true, ...await recruitmentStatus(env) }));
      }
      if (request.method === 'GET' && url.pathname === '/api/recruitment/candidates') {
        const version = url.searchParams.get('version');
        const cacheUrl = new URL(url); cacheUrl.search = version ? new URLSearchParams({version}).toString() : '';
        return await cachedGetJson(new Request(cacheUrl), context.ctx,
          data => version !== null && String(data.version) === version ? 86400 : 0,
          async () => json({ok:true, ...await readRecruitmentResults(env)}), 'recruitment-results-v1');
      }
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
