import React from "react";
import {
  parseWarPayoutPresetConfig, parseWarPayoutPresetName,
  type WarPayoutPreset, type WarPayoutPresetConfig,
} from "../../../shared/warPayoutPresets";
import {
  createWarPayoutPreset, deleteWarPayoutPreset, getWarPayoutPreset,
  getWarPayoutPresets, updateWarPayoutPreset,
} from "../api/warPayoutPresets";
import { formatLongDateTime } from "../utils/format";
import { PanelHeader } from "./Common";

export function WarPayoutPresetsPanel({ config, onLoad }: {
  config: WarPayoutPresetConfig;
  onLoad: (config: WarPayoutPresetConfig) => void;
}) {
  const [presets, setPresets] = React.useState<WarPayoutPreset[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loadedPreset, setLoadedPreset] = React.useState<WarPayoutPreset | null>(null);
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const busyRef = React.useRef(false);
  const busy = loading || pending !== null;
  const selectedPreset = presets.find(preset => preset.id === selectedId);

  React.useEffect(() => {
    const controller = new AbortController();
    getWarPayoutPresets(controller.signal).then(response => {
      if (!controller.signal.aborted) setPresets(response.presets);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function run(action: string, work: () => Promise<void>) {
    if (busyRef.current || loading) return;
    busyRef.current = true;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setPending(null);
    }
  }

  function remember(preset: WarPayoutPreset) {
    setPresets(current => [...current.filter(item => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedId(preset.id);
    setLoadedPreset(preset);
    setName(preset.name);
    setConfirmDelete(false);
  }

  function load() {
    void run("Loading preset", async () => {
      const { preset } = await getWarPayoutPreset(selectedId);
      const settings = parseWarPayoutPresetConfig(preset.config);
      onLoad(settings);
      remember(preset);
      setNotice(`Loaded “${preset.name}”.`);
    });
  }

  function save(update: boolean) {
    if (update && !selectedId) return;
    void run("Saving preset", async () => {
      const validName = parseWarPayoutPresetName(name);
      const settings = parseWarPayoutPresetConfig(config);
      const { preset } = update
        ? await updateWarPayoutPreset(selectedId, validName, settings)
        : await createWarPayoutPreset(validName, settings);
      remember(preset);
      setNotice(`Saved “${preset.name}” for all admins.`);
    });
  }

  function refresh() {
    void run("Refreshing presets", async () => {
      const response = await getWarPayoutPresets();
      setPresets(response.presets);
      if (selectedId && !response.presets.some(preset => preset.id === selectedId)) {
        setSelectedId("");
        setLoadedPreset(null);
        setConfirmDelete(false);
      }
      setNotice("Shared presets refreshed.");
    });
  }

  function remove() {
    if (!selectedPreset) return;
    void run("Deleting preset", async () => {
      await deleteWarPayoutPreset(selectedPreset.id);
      setPresets(current => current.filter(item => item.id !== selectedPreset.id));
      setSelectedId("");
      setLoadedPreset(null);
      setName("");
      setConfirmDelete(false);
      setNotice(`Deleted “${selectedPreset.name}”. The current calculator settings are still available.`);
    });
  }

  let changed = false;
  if (loadedPreset) {
    try {
      changed = name.trim() !== loadedPreset.name || JSON.stringify(parseWarPayoutPresetConfig(config)) !== JSON.stringify(loadedPreset.config);
    } catch { changed = true; }
  }

  return (
    <section className="panel table-panel payout-presets-panel" aria-label="Presets">
      <PanelHeader title="Presets" aside={pending ?? (loading ? "Loading presets" : `${presets.length} shared preset${presets.length === 1 ? "" : "s"}`)} />
      <p className="panel-description">
        Save and share payout rules with other admins. Presets include the mode, respect basis,
        points, flat payments, and percentage adjustments. Choose the war, payout pool, and respect limit for each calculation.
      </p>
      <div className="payout-preset-row">
        <label className="payout-preset-field">
          <span>Saved preset</span>
          <select value={selectedId} disabled={busy || presets.length === 0} onChange={event => {
            const id = event.target.value;
            setSelectedId(id);
            setLoadedPreset(null);
            setName(presets.find(preset => preset.id === id)?.name ?? "");
            setConfirmDelete(false);
            setError(null);
            setNotice(null);
          }}>
            <option value="">{presets.length ? "Choose a preset" : "No saved presets yet"}</option>
            {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <div className="payout-preset-actions">
          <button type="button" className="panel-action-button" disabled={busy || !selectedId} onClick={load}>Load preset</button>
          <button type="button" className="panel-action-button" disabled={busy} onClick={refresh}>Refresh</button>
        </div>
      </div>
      <div className="payout-preset-row">
        <label className="payout-preset-field">
          <span>Preset name</span>
          <input value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder="e.g. Termed war payouts" />
        </label>
        <div className="payout-preset-actions">
          <button type="button" className="panel-action-button" disabled={busy || !name.trim()} onClick={() => save(false)}>Save as new preset</button>
          <button type="button" className="panel-action-button" disabled={busy || !selectedId || !name.trim()} onClick={() => save(true)}>Update preset</button>
          <button type="button" className="panel-action-button" disabled={busy || !selectedId} onClick={() => setConfirmDelete(true)}>Delete preset</button>
        </div>
      </div>
      {loadedPreset ? <p className="payout-preset-note">
        Loaded: <strong>{loadedPreset.name}</strong> · Saved {formatLongDateTime(loadedPreset.updated_at)}.
        {changed ? " Current settings have unsaved changes." : null}
      </p> : <p className="payout-preset-note">Select a preset to update it with the current calculator settings, or enter a new name to save a new preset.</p>}
      {confirmDelete && selectedPreset ? (
        <div className="payout-preset-delete" role="group" aria-label="Delete preset confirmation">
          <p>Delete “{selectedPreset.name}” for all admins?</p>
          <div className="payout-preset-actions">
            <button type="button" className="panel-action-button" disabled={busy} onClick={remove}>Confirm delete</button>
            <button type="button" className="panel-action-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="payout-preset-note" role="status">{notice}</p> : null}
    </section>
  );
}
