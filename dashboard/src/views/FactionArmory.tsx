import React from "react";
import { Boxes, Check, Copy, Download, RefreshCw, Swords, Users, ArrowUpRight } from "lucide-react";
import { getArmory, refreshArmoryDetails, syncArmory, type ArmoryCopy, type ArmoryResponse } from "../api/armory";
import { MetricCard } from "../components/Common";
import { armoryCounts, armoryCsv, EMPTY_ARMORY_FILTERS, filterArmory, groupArmory, weaponClass,
  type ArmoryFilters, type ArmoryGroup, type ArmorySort } from "../utils/armory";
import "./FactionArmory.css";

const tct = (value: number | null) => value ? `${new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19)} TCT` : "Not loaded yet";
type Action = "check" | "inventory" | "details";

export function FactionArmory() {
  const [data, setData] = React.useState<ArmoryResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const [tab, setTab] = React.useState<"weapons" | "borrowers">("weapons");
  const [filters, setFilters] = React.useState<ArmoryFilters>(EMPTY_ARMORY_FILTERS);
  const [individual, setIndividual] = React.useState(false);
  const [sort, setSort] = React.useState<ArmorySort>("name");
  const run = React.useRef<(action: Action) => void>(() => {});

  React.useEffect(() => {
    let disposed = false, working = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function update(action: Action) {
      if (disposed || working || document.hidden) return;
      working = true;
      clearTimeout(timer);
      setBusy(true);
      let delay = 30_000;
      try {
        let result = action === "details" ? await refreshArmoryDetails() : await getArmory();
        if (disposed) return;
        setData(result);
        if (action === "details") setNotice(result.refreshing ? "Weapon detail refresh scheduled." : "Detail refresh is already complete or on its one-hour cooldown.");
        if (action === "inventory" && result.next_inventory_at * 1000 > Date.now()) {
          setNotice(`Inventory is cached. Next check: ${tct(result.next_inventory_at)}.`);
        }
        if (result.next_sync_at * 1000 <= Date.now() && !document.hidden) {
          result = await syncArmory();
          if (disposed) return;
          setData(result);
        }
        setError(null);
        delay = Math.max(1000, Math.min(30_000, result.next_sync_at * 1000 - Date.now()));
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to load the armory. Please retry.");
        delay = 60_000;
      } finally {
        working = false;
        if (!disposed) {
          setBusy(false);
          timer = setTimeout(() => void update("check"), delay);
        }
      }
    }
    run.current = action => void update(action);
    const wake = () => { if (!document.hidden) void update("check"); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void update("check");
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, []);

  const items = data?.items ?? [];
  const counts = armoryCounts(items);
  const filtered = filterArmory(items, filters);
  const groups = groupArmory(filtered, individual, sort);
  const borrowers = new Map<number, { name: string; items: ArmoryCopy[] }>();
  for (const item of filtered) {
    if (!item.loaned) continue;
    const borrower = borrowers.get(item.loaned.id) ?? { name: item.loaned.name, items: [] };
    borrower.items.push(item);
    borrowers.set(item.loaned.id, borrower);
  }
  const field = (key: keyof ArmoryFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  function exportCsv() {
    const exported = tab === "borrowers" ? filtered.filter(item => item.loaned) : filtered;
    const url = URL.createObjectURL(new Blob(["\uFEFF", armoryCsv(exported)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "faction-armory-weapons.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const age = data?.inventory_timestamp ? Math.max(0, Math.floor(Date.now() / 1000 - data.inventory_timestamp)) : null;
  return <div className="armory-page">
    <section className="panel armory-heading">
      <div><div className="panel-kicker"><Swords size={16} /> Admin · Weapons</div><h1>Faction armory</h1>
        <p>See what is available, compare individual weapons, and review member loans.</p></div>
      <div className="armory-actions">
        <button type="button" disabled={busy} onClick={() => run.current("inventory")}><RefreshCw size={15} /> {busy ? "Checking…" : "Refresh inventory"}</button>
        <button type="button" disabled={busy || !items.length || !!data?.refreshing} onClick={() => run.current("details")}>Refresh weapon details</button>
      </div>
      <div className="armory-freshness"><span>Snapshot: {tct(data?.inventory_timestamp ?? null)}{age !== null ? ` · ${Math.floor(age / 60)} min old` : ""}</span>
        <span>Last checked: {tct(data?.checked_at ?? null)}</span><span>Inventory updates at most hourly.</span></div>
    </section>
    {error || data?.error ? <div className="panel armory-message armory-warning" role="alert">{error ?? data?.error} {data?.inventory_timestamp ? "Showing the last saved inventory." : ""}</div> : null}
    {notice ? <div className="armory-message" role="status">{notice}</div> : null}
    <div className="armory-metrics">
      <MetricCard label="Total weapons" value={data?.inventory_timestamp ? String(counts.total) : "—"} icon={<Boxes size={16} />} />
      <MetricCard label="Available" value={data?.inventory_timestamp ? String(counts.available) : "—"} icon={<Check size={16} />} />
      <MetricCard label="Loaned" value={data?.inventory_timestamp ? String(counts.loaned) : "—"} icon={<ArrowUpRight size={16} />} />
      <MetricCard label="Borrowers" value={data?.inventory_timestamp ? String(counts.borrowers) : "—"} icon={<Users size={16} />} />
    </div>
    <section className="panel armory-content">
      <div className="armory-toolbar"><div className="armory-tabs" role="group" aria-label="Armory view">
        <button type="button" aria-pressed={tab === "weapons"} onClick={() => setTab("weapons")}>Weapons</button>
        <button type="button" aria-pressed={tab === "borrowers"} onClick={() => setTab("borrowers")}>Borrowers</button>
      </div><button type="button" disabled={!filtered.length} onClick={exportCsv}><Download size={15} /> Export CSV</button></div>
      <div className="armory-detail-progress" role="status">{data ? `${items.length - data.pending} of ${items.length} weapon details loaded · ${counts.bonuses} bonus weapons${data.pending ? " (partial)" : ""}` : "Loading inventory…"}
        {data?.refreshing ? ` · ${data.refreshing} detail refreshes remaining` : ""}{data?.syncing ? " · Sync in progress" : ""}</div>
      <div className="armory-filters">
        <label className="armory-search">Search<input type="search" placeholder="Weapon, member or UID" value={filters.search} onChange={event => field("search", event.target.value)} /></label>
        <Filter label="Slot" value={filters.slot} onChange={value => field("slot", value)} options={["Primary", "Secondary", "Melee"]} />
        <Filter label="Availability" value={filters.status} onChange={value => field("status", value)} options={["available", "loaned"]} />
        <Filter label="Weapon class" value={filters.kind} onChange={value => field("kind", value)} options={["standard", "special", "pending"]} />
        <Filter label="Rarity" value={filters.rarity} onChange={value => field("rarity", value)} options={[...new Set(items.flatMap(item => item.details?.rarity ? [item.details.rarity] : []))].sort()} />
        <Filter label="Bonus" value={filters.bonus} onChange={value => field("bonus", value)} options={[...new Set(items.flatMap(item => item.details?.bonuses.map(bonus => bonus.title) ?? []))].sort()} />
      </div>
      <div className="armory-toolbar armory-results"><span>{tab === "weapons" ? `${filtered.length} matching weapons` : `${borrowers.size} matching borrowers`} · Full inventory totals above</span>
        <div className="armory-actions"><button type="button" onClick={() => setFilters(EMPTY_ARMORY_FILTERS)}>Clear filters</button>
          {tab === "weapons" ? <><label className="armory-checkbox"><input type="checkbox" checked={individual} onChange={event => { setIndividual(event.target.checked); setSort("name"); }} /> Show individual copies</label>
            <label>Sort <select value={sort} onChange={event => setSort(event.target.value as ArmorySort)}><option value="name">Weapon name</option><option value="quantity">Quantity ↓</option><option value="available">Available ↓</option><option value="loaned">Loaned ↓</option>
              {individual ? <><option value="damage">Damage ↓</option><option value="accuracy">Accuracy ↓</option><option value="quality">Quality ↓</option></> : null}</select></label></> : null}
        </div>
      </div>
      {!data ? <div className="armory-empty">{error ? "Inventory could not be loaded. Use Refresh inventory to retry." : "Loading saved inventory…"}</div>
        : !data.inventory_timestamp ? <div className="armory-empty">{busy ? "Fetching the first inventory snapshot…" : "No inventory snapshot yet. Use Refresh inventory to get started."}</div>
        : !items.length ? <div className="armory-empty">There are no weapons in this faction inventory.</div>
        : tab === "weapons" ? groups.length ? <WeaponTable groups={groups} /> : <div className="armory-empty">No weapons match these filters.</div>
        : borrowers.size ? <div className="armory-borrowers">{[...borrowers].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, borrower]) => <details className="armory-borrower" key={id}>
          <summary><strong>{borrower.name}</strong><span>{borrower.items.length} loaned</span>{["Primary", "Secondary", "Melee"].map(slot => <span key={slot}>{slot}: {borrower.items.filter(item => item.type === slot).length}</span>)}</summary>
          <p><a href={`https://www.torn.com/profiles.php?XID=${id}`} target="_blank" rel="noreferrer">View {borrower.name} [{id}] on Torn ↗</a></p>
          <WeaponTable groups={groupArmory(borrower.items, true, "name")} />
        </details>)}</div> : <div className="armory-empty">No borrowers match these filters.</div>}
    </section>
  </div>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">All</option>{options.map(option => <option key={option} value={option}>{option === "pending" ? "Details pending" : option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>;
}

function WeaponImage({ item }: { item: ArmoryCopy }) {
  const [failed, setFailed] = React.useState(false);
  const rarity = item.details?.rarity;
  const tone = ["yellow", "orange", "red"].includes(rarity ?? "") ? rarity : "none";
  return <div className={`armory-art armory-rarity-${tone}`}>
    {failed ? <Swords aria-label="Weapon image unavailable" size={28} /> : <img src={`https://www.torn.com/images/items/${item.id}/large.png`}
      srcSet={`https://www.torn.com/images/items/${item.id}/large.png 1x, https://www.torn.com/images/items/${item.id}/large@2x.png 2x`}
      width="96" height="64" alt={`${item.name}${rarity ? ` — ${rarity} rarity` : ""}`} loading="lazy" onError={() => setFailed(true)} />}
  </div>;
}

function CopyUid({ uid }: { uid: string }) {
  const [message, setMessage] = React.useState("");
  return <button className="armory-uid" type="button" title="Copy weapon UID" onClick={() => void navigator.clipboard.writeText(uid).then(() => setMessage("Copied"), () => setMessage("Copy unavailable"))}>
    <Copy size={11} /> {uid}<span role="status">{message ? ` · ${message}` : ""}</span></button>;
}

function WeaponTable({ groups }: { groups: ArmoryGroup[] }) {
  return <div className="armory-table-scroll"><table className="armory-table"><thead><tr><th>Weapon</th><th>Rarity & bonuses</th><th>Damage</th><th>Accuracy</th><th>Quality</th><th>Qty</th><th>Availability / borrower</th></tr></thead>
    <tbody>{groups.map(group => <WeaponRows key={group.key} group={group} />)}</tbody></table></div>;
}

function WeaponRows({ group }: { group: ArmoryGroup }) {
  const [open, setOpen] = React.useState(false);
  const item = group.items[0];
  if (!group.grouped) return <CopyRow item={item} />;
  const available = group.items.filter(copy => !copy.loaned).length;
  const range = (stat: "damage" | "accuracy" | "quality") => {
    const values = group.items.flatMap(copy => copy.details ? [copy.details.stats[stat]] : []);
    if (!values.length) return "—";
    const min = Math.min(...values), max = Math.max(...values);
    return `${min.toFixed(2)}${min !== max ? `–${max.toFixed(2)}` : ""}${stat === "quality" ? "%" : ""}`;
  };
  return <><tr className="armory-group-row"><td><div className="armory-weapon"><WeaponImage item={item} /><div><button className="armory-expand" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {item.name}</button><small>{item.type} · Standard copies</small></div></div></td>
    <td><span className="armory-badge">Standard</span></td><td>{range("damage")}</td><td>{range("accuracy")}</td><td>{range("quality")}</td><td>{group.items.length}</td>
    <td><span className="armory-available">{available} available</span><small>{group.items.length - available} loaned</small></td></tr>
    {open ? [...group.items].sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true })).map(copy => <CopyRow key={copy.uid} item={copy} child />) : null}</>;
}

function CopyRow({ item, child = false }: { item: ArmoryCopy; child?: boolean }) {
  const kind = weaponClass(item);
  return <tr className={child ? "armory-copy-child" : undefined}><td><div className="armory-weapon"><WeaponImage item={item} /><div><strong>{item.name}</strong><small>{item.type}</small><CopyUid uid={item.uid} /></div></div></td>
    <td><span className="armory-badge">{kind === "pending" ? "Details pending" : item.details?.rarity ?? (kind === "standard" ? "Standard" : "Special")}</span>
      {item.details?.bonuses.map((bonus, index) => <details className="armory-bonus" key={`${bonus.id}-${index}`}><summary>{bonus.title} · {bonus.value}</summary><p>{bonus.description}</p></details>)}</td>
    <td>{item.details?.stats.damage.toFixed(2) ?? "—"}</td><td>{item.details?.stats.accuracy.toFixed(2) ?? "—"}</td><td>{item.details ? `${item.details.stats.quality.toFixed(2)}%` : "—"}</td><td>1</td>
    <td>{item.loaned ? <><span className="armory-badge">Loaned</span><a href={`https://www.torn.com/profiles.php?XID=${item.loaned.id}`} target="_blank" rel="noreferrer">{item.loaned.name} ↗</a></> : <span className="armory-available">Available</span>}</td></tr>;
}
