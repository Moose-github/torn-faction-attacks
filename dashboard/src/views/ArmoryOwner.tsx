import React from "react";
import type { ArmoryCategory, ArmoryCopy, ArmoryOwner as Owner } from "../../../shared/armory";
import { saveArmoryOwner } from "../api/armory";

export type ArmoryOwnershipControls = { options: Owner[]; onSaved: (uid: string, owner: Owner | null) => void };
export const ArmoryOwnershipContext = React.createContext<ArmoryOwnershipControls>({ options: [], onSaved: () => {} });

export function ArmoryOwnerName({ owner }: { owner?: Owner | null }) {
  return owner ? <a href={`https://www.torn.com/profiles.php?XID=${owner.id}`} target="_blank" rel="noreferrer">{owner.name}</a>
    : <span className="armory-owner-faction">Faction</span>;
}

export function ArmoryOwner({ item, category }: { item: ArmoryCopy; category: ArmoryCategory }) {
  const { options, onSaved } = React.useContext(ArmoryOwnershipContext);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const choices = item.owner && !options.some(owner => owner.id === item.owner!.id) ? [item.owner, ...options] : options;
  async function save(value: string) {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const result = await saveArmoryOwner(category, item.uid, value === "" ? null : Number(value));
      onSaved(result.uid, result.owner);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save owner. Please retry.");
    } finally { setSaving(false); }
  }
  return <div className="armory-owner">
    <ArmoryOwnerName owner={item.owner} />
    <small><button type="button" className="armory-owner-action" aria-expanded={editing}
      aria-label={`${editing ? "Cancel editing" : "Edit"} owner of ${item.name} (${item.uid})`} disabled={saving}
      onClick={() => { setEditing(!editing); setError(""); }}>{editing ? "cancel" : "edit"}</button></small>
    {editing ? <select autoFocus aria-label={`Owner of ${item.name} (${item.uid})`} value={item.owner?.id ?? ""} disabled={saving}
      onChange={event => void save(event.target.value)}>
      <option value="">Faction</option>
      {choices.map(owner => <option key={owner.id} value={owner.id}>{owner.name} [{owner.id}]</option>)}
    </select> : null}
    {saving ? <small role="status">Saving…</small> : null}
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
