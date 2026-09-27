import React from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { getMedicalArmory, syncMedicalArmory } from "../api/armory";
import type { ArmoryMedicalResponse, ArmoryStack } from "../../../shared/armory";

const tct = (value: number | null) => value ? `${new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19)} TCT` : "Not loaded yet";

export function ArmoryItems() {
  const [data, setData] = React.useState<ArmoryMedicalResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const refresh = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let disposed = false, working = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function update(manual = false) {
      if (disposed || working || document.hidden) return;
      working = true;
      clearTimeout(timer);
      setBusy(true);
      let delay = 30_000;
      try {
        let result = await getMedicalArmory();
        if (disposed) return;
        setData(result);
        if (manual && result.next_inventory_at * 1000 > Date.now()) {
          setNotice(`${result.error ? "The last refresh failed. Next retry" : "Inventory is cached. Next check"}: ${tct(result.next_inventory_at)}.`);
        }
        if (result.next_sync_at * 1000 <= Date.now() && !document.hidden) {
          result = await syncMedicalArmory();
          if (disposed) return;
          setData(result);
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
        <RefreshCw size={15} /> {busy ? "Checking…" : "Refresh inventory"}</button></div>
      <div className="armory-freshness"><span>Snapshot: {tct(data?.inventory_timestamp ?? null)}</span>
        <span>Last checked: {tct(data?.checked_at ?? null)}</span><span>Inventory updates at most hourly.</span></div>
    </section>
    {error || data?.error ? <div className="panel armory-message armory-warning" role="alert">{error ?? data?.error} {data?.inventory_timestamp ? "Showing the last saved inventory." : ""}</div> : null}
    {notice ? <div className="armory-message" role="status">{notice}</div> : null}
    <section className="panel armory-content" aria-label="Medical inventory">
      {!data ? <div className="armory-empty">{error ? "Inventory could not be loaded. Use Refresh inventory to retry." : "Loading saved inventory…"}</div>
        : !data.inventory_timestamp ? <div className="armory-empty">{busy ? "Fetching the first medical inventory snapshot…" : "No medical inventory snapshot yet. Use Refresh inventory to get started."}</div>
        : !data.items.length ? <div className="armory-empty">There are no medical items in this faction inventory.</div>
        : <div className="armory-table-scroll"><table className="armory-table armory-items-table">
          <thead><tr><th>Item</th><th>Quantity</th><th>Availability</th></tr></thead>
          <tbody>{data.items.map(item => <MedicalRow key={`${item.id}:${item.loaned?.id ?? "available"}`} item={item} />)}</tbody>
        </table></div>}
    </section>
  </div>;
}

function MedicalRow({ item }: { item: ArmoryStack }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  return <tr><td><div className="armory-weapon"><div className="armory-art">
    {imageFailed ? <Boxes size={28} aria-label="Item image unavailable" /> : <img src={`https://www.torn.com/images/items/${item.id}/large.png`}
      width="96" height="64" alt={item.name} loading="lazy" onError={() => setImageFailed(true)} />}</div><strong>{item.name}</strong></div></td>
    <td>{item.amount.toLocaleString("en-GB")}</td>
    <td>{item.loaned ? <><span className="armory-badge">Loaned</span><a href={`https://www.torn.com/profiles.php?XID=${item.loaned.id}`} target="_blank" rel="noreferrer">{item.loaned.name} ↗</a></>
      : <span className="armory-available">Available</span>}</td></tr>;
}
