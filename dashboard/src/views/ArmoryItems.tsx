import React from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { getMedicalArmory, syncMedicalArmory, saveMedicalStockSetting } from "../api/armory";
import type { ArmoryMedicalResponse, ArmoryStack, ArmoryStockSetting } from "../../../shared/armory";
import { ArmoryBorrower } from "./ArmoryBorrower";
import { ArmoryActivityRefresh } from "./ArmoryActivityRefresh";

const tct = (value: number | null) => value ? `${new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19)} TCT` : "Not loaded yet";

export function ArmoryItems({ categoryTabs }: { categoryTabs: React.ReactNode }) {
  const [data, setData] = React.useState<ArmoryMedicalResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const refresh = React.useRef<() => void>(() => {});
  const settingsRevision = React.useRef(0);
  function saved(id: number, setting: ArmoryStockSetting) {
    settingsRevision.current++;
    setData(previous => previous ? { ...previous, stock_settings: { ...previous.stock_settings, [id]: setting } } : previous);
  }

  React.useEffect(() => {
    let disposed = false, working = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function update(manual = false) {
      if (disposed || working || document.hidden) return;
      working = true;
      clearTimeout(timer);
      setBusy(true);
      let delay = 30_000;
      const revision = settingsRevision.current;
      const accept = (result: ArmoryMedicalResponse) => setData(previous => previous && revision !== settingsRevision.current
        ? { ...result, stock_settings: previous.stock_settings } : result);
      try {
        let result = await getMedicalArmory();
        if (disposed) return;
        accept(result);
        if (manual && result.next_inventory_at * 1000 > Date.now()) {
          setNotice(`${result.error ? "The last refresh failed. Next retry" : "Inventory is cached. Next check"}: ${tct(result.next_inventory_at)}.`);
        }
        if (result.next_sync_at * 1000 <= Date.now() && !document.hidden) {
          result = await syncMedicalArmory();
          if (disposed) return;
          accept(result);
          if (!result.error) setNotice("");
        }
        if (!manual && !result.error) setNotice("");
        setError(null);
        delay = Math.max(1000, Math.min(30_000, result.next_sync_at * 1000 - Date.now()));
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to load medical inventory. Please retry.");
        delay = 60_000;
      } finally {
        working = false;
        if (!disposed) {
          setBusy(false);
          timer = setTimeout(() => void update(), delay);
        }
      }
    }
    refresh.current = () => void update(true);
    const wake = () => { if (!document.hidden) void update(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void update();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, []);

  return <div className="armory-page">
    <section className="panel armory-heading">
      <div><div className="panel-kicker"><Boxes size={16} /> Admin · Items</div><h1>Faction armory</h1>
        <p>Medical supplies, quantities, and current loans.</p></div>
      <div className="armory-actions"><button type="button" disabled={busy} onClick={() => refresh.current()}>
        <RefreshCw size={15} /> {busy ? "Checking…" : "Refresh inventory"}</button>
        <ArmoryActivityRefresh fetchedAt={data?.activity_fetched_at ?? null} disabled={!data || busy} onRefresh={() => refresh.current()} /></div>
      <div className="armory-freshness"><span>Snapshot: {tct(data?.inventory_timestamp ?? null)}</span>
        <span>Fetched: {tct(data?.checked_at ?? null)}</span><span>Torn updates Inventory data hourly</span></div>
    </section>
    {categoryTabs}
    {error || data?.error ? <div className="panel armory-message armory-warning" role="alert">{error ?? data?.error} {data?.inventory_timestamp ? "Showing the last saved inventory." : ""}</div> : null}
    {notice ? <div className="armory-message" role="status">{notice}</div> : null}
    <section className="panel armory-content" aria-label="Medical inventory">
      <p className="armory-loan-note">Alerts use available stock only and trigger at or below the threshold. Default: 0. Save changes per item; turn alerts off to disable its threshold.</p>
      {!data ? <div className="armory-empty">{error ? "Inventory could not be loaded. Use Refresh inventory to retry." : "Loading saved inventory…"}</div>
        : !data.inventory_timestamp ? <div className="armory-empty">{busy ? "Fetching the first medical inventory snapshot…" : "No medical inventory snapshot yet. Use Refresh inventory to get started."}</div>
        : !data.items.length ? <div className="armory-empty">There are no medical items in this faction inventory.</div>
        : <div className="armory-table-scroll"><table className="armory-table armory-items-table">
          <thead><tr><th>Item</th><th>Quantity</th><th>Availability</th><th>Low-stock threshold</th><th>Stock alerts</th></tr></thead>
          <tbody>{data.items.map(item => <MedicalRow key={`${item.id}:${item.loaned?.id ?? "available"}`} item={item}
            setting={data.stock_settings?.[item.id] ?? { name: item.name, threshold: 0, enabled: true }} onSaved={saved} />)}</tbody>
        </table></div>}
    </section>
  </div>;
}

function MedicalRow({ item, setting, onSaved }: { item: ArmoryStack; setting: ArmoryStockSetting; onSaved: (id: number, setting: ArmoryStockSetting) => void }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const [threshold, setThreshold] = React.useState(String(setting.threshold));
  const [enabled, setEnabled] = React.useState(setting.enabled);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!dirty && !saving) { setThreshold(String(setting.threshold)); setEnabled(setting.enabled); }
  }, [setting.threshold, setting.enabled, dirty, saving]);
  async function save() {
    if (saving) return;
    if (!/^\d+$/.test(threshold) || !Number.isSafeInteger(Number(threshold))) {
      setFailed(true); setMessage("Enter a whole number of 0 or more."); return;
    }
    setSaving(true); setMessage(""); setFailed(false);
    try {
      const result = await saveMedicalStockSetting(item.id, Number(threshold), enabled);
      onSaved(item.id, result.stock_settings[item.id]);
      setDirty(false); setMessage("Saved");
    } catch (cause) {
      setFailed(true); setMessage(cause instanceof Error ? cause.message : "Unable to save. Please retry.");
    } finally { setSaving(false); }
  }
  return <tr><td><div className="armory-weapon"><div className="armory-art">
    {imageFailed ? <Boxes size={28} aria-label="Item image unavailable" /> : <img src={`https://www.torn.com/images/items/${item.id}/large.png`}
      width="96" height="64" alt={item.name} loading="lazy" onError={() => setImageFailed(true)} />}</div><strong>{item.name}</strong></div></td>
    <td>{item.amount.toLocaleString("en-GB")}</td>
    <td>{item.loaned ? <ArmoryBorrower borrower={item.loaned} />
      : <span className="armory-available">Available</span>}</td>
    <td>{item.loaned ? "—" : <><div className="armory-stock-entry">
      <input type="text" inputMode="numeric" aria-label={`Low-stock threshold for ${item.name}`} value={threshold} disabled={saving || !enabled}
        onChange={event => { setThreshold(event.target.value); setDirty(true); setMessage(""); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
      <button type="button" disabled={!dirty || saving} onClick={() => void save()} aria-label={`Save stock alert for ${item.name}`}>{saving ? "Saving…" : "Save"}</button>
    </div>{message ? <small className={failed ? "armory-stock-error" : ""} role={failed ? "alert" : "status"}>{message}</small> : null}</>}</td>
    <td>{item.loaned ? "—" : <label className="armory-stock-toggle"><input type="checkbox" role="switch" checked={enabled} disabled={saving}
      aria-label={`Stock alerts for ${item.name}`} onChange={event => { setEnabled(event.target.checked); setDirty(true); setMessage(""); }} />
      {enabled ? "On" : "Off"}</label>}</td></tr>;
}
