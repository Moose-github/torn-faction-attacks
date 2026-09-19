import React from "react";
import type { AdminDiscordAlertMentionsResponse, DiscordAlertMentionSetting } from "../../../../shared/discordAlertMentions";
import { getAdminDiscordAlertMentions, updateAdminDiscordAlertMentions } from "../../api/admin";
import "./DiscordAlertMentionEditor.css";

export function useDiscordMentionSettings() {
  const [data, setData] = React.useState<AdminDiscordAlertMentionsResponse | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await getAdminDiscordAlertMentions()); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load alert mentions."); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  async function save(alertKey: string, mentions: DiscordAlertMentionSetting) {
    const response = await updateAdminDiscordAlertMentions(alertKey, mentions);
    setData(current => current ? { ...current, alerts: { ...current.alerts, [alertKey]: response.mentions } } : current);
  }
  return { data, error, loading, load, save };
}

export function DiscordAlertMentionEditor({ alertKey, label, controls }: {
  alertKey: string; label: string; controls: ReturnType<typeof useDiscordMentionSettings>;
}) {
  const [draft, setDraft] = React.useState<DiscordAlertMentionSetting | null>(null);
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const inFlight = React.useRef(false);
  const saved = controls.data?.alerts[alertKey];
  const roles = controls.data?.roles ?? [];
  const name = (id: string) => `@${roles.find(role => role.id === id)?.name ?? `Role ${id}`}`;
  const summary = saved ? [...saved.role_ids.map(name), ...(saved.everyone ? ["@everyone"] : []), ...(saved.here ? ["@here"] : [])].join(", ") : "";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { await controls.save(alertKey, draft); setDraft(null); setNotice("Mentions saved."); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to save mentions."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="admin-alert-mentions" role="group" aria-label={`${label} mentions`}>
    <span className="admin-mention-summary">{saved ? summary || "No role or broadcast mentions" : controls.loading ? "Loading mentions…" : "Mentions unavailable"}</span>
    {notice ? <small role="status">{notice}</small> : null}
    {!draft ? <button type="button" className="admin-alert-route-test" disabled={!saved || controls.loading}
      onClick={() => { setDraft({ ...saved!, role_ids: [...saved!.role_ids] }); setSearch(""); setError(""); setNotice(""); }}>Edit mentions</button> :
      <form className="admin-mention-form" onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>Roles to ping</legend>
          <input type="search" aria-label={`Search roles for ${label}`} placeholder="Search roles" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="admin-mention-roles">
            {[...roles, ...draft.role_ids.filter(id => !roles.some(role => role.id === id)).map(id => ({ id, name: `Unavailable role (${id})` }))]
              .filter(role => role.name.toLowerCase().includes(search.toLowerCase()) || role.id.includes(search))
              .map(role => <label key={role.id} title={role.id}>
                <input type="checkbox" checked={draft.role_ids.includes(role.id)}
                  disabled={!draft.role_ids.includes(role.id) && draft.role_ids.length >= 20}
                  onChange={event => setDraft({ ...draft, role_ids: event.target.checked ? [...draft.role_ids, role.id] : draft.role_ids.filter(id => id !== role.id) })} />
                <span>{role.name}</span>
              </label>)}
            {!roles.length ? <small>{controls.data?.roles_error ?? "No roles available."}</small> : null}
          </div>
          <small>{draft.role_ids.length}/20 roles selected</small>
          <label><input type="checkbox" checked={draft.everyone} onChange={event => setDraft({ ...draft, everyone: event.target.checked })} /><span>@everyone</span></label>
          <label><input type="checkbox" checked={draft.here} onChange={event => setDraft({ ...draft, here: event.target.checked })} /><span>@here</span></label>
        </fieldset>
        {error ? <p role="alert" className="admin-mention-error">{error}</p> : null}
        <div className="admin-mention-actions">
          <button className="admin-alert-route-test" type="submit" disabled={busy}>{busy ? "Saving…" : "Save mentions"}</button>
          <button className="admin-alert-route-test" type="button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Cancel</button>
        </div>
      </form>}
  </div>;
}
