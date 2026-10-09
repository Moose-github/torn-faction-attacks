import { useArmoryPolling } from "../hooks/useArmoryPolling";
import React from "react";
import { createPortal } from "react-dom";
import { Boxes, Check, Copy, Download, RefreshCw, Swords, Users, ArrowUpRight, Bomb, Target, BadgePercent, Shield, Link as LinkIcon } from "lucide-react";
import { getArmory, syncArmory, type ArmoryCategory, type ArmoryCopy } from "../api/armory";
import { MetricCard } from "../components/Common";
import { armoryCounts, armoryCsv, DEFAULT_ARMORY_FILTERS, EMPTY_ARMORY_FILTERS, filterArmory, groupArmory, loanElapsed, weaponClass, tornArmoryPositions, tornArmoryUrl,
  type ArmoryFilters, type ArmoryGroup, type ArmorySort, type ArmorySortDirection } from "../utils/armory";
import "./FactionArmory.css";
import { ArmoryItems } from "./ArmoryItems";
import { ArmoryBorrower } from "./ArmoryBorrower";
import { ArmoryActivityRefresh } from "./ArmoryActivityRefresh";
import { ArmoryOwner, ArmoryOwnerName, ArmoryOwnershipContext, type ArmoryOwnershipControls } from "./ArmoryOwner";

const tct = (value: number | null) => value ? `${new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19)} TCT` : "Not loaded yet";

export function FactionArmory() {
  const [category, setCategory] = React.useState<ArmoryCategory | "items">("weapons");
  const categoryTabs = <div className="armory-tabs armory-category-tabs" role="group" aria-label="Armory category">
    {(["weapons", "armor", "items"] as const).map(value => {
      const Icon = value === "weapons" ? Swords : value === "armor" ? Shield : Boxes;
      return <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>
        <Icon size={18} aria-hidden="true" />{value[0].toUpperCase() + value.slice(1)}
      </button>;
    })}
  </div>;
  return category === "items" ? <ArmoryItems categoryTabs={categoryTabs} />
    : <EquipmentInventory key={category} category={category} categoryTabs={categoryTabs} />;
}

function EquipmentInventory({ category, categoryTabs }: { category: ArmoryCategory; categoryTabs: React.ReactNode }) {
  const isArmor = category === "armor";
  const itemLabel = isArmor ? "Armor" : "Weapon";
  const plural = isArmor ? "armor pieces" : "weapons";
  const slots = isArmor ? ["Defensive"] : ["Primary", "Secondary", "Melee"];
  const { data, busy, error, notice, refresh, updateLocal } = useArmoryPolling(category, {
    load: signal => getArmory(category, signal),
    sync: () => syncArmory(category),
    preserveEdits: (incoming, current) => {
      const owners = new Map(current.items.map(item => [item.uid, item.owner]));
      return { ...incoming, items: incoming.items.map(item => owners.has(item.uid) ? { ...item, owner: owners.get(item.uid) } : item) };
    },
    errorMessage: "Unable to load the armory. Please retry.",
  });
  const [tab, setTab] = React.useState<"weapons" | "borrowers" | "owners">("weapons");
  const [filters, setFilters] = React.useState<ArmoryFilters>(DEFAULT_ARMORY_FILTERS);
  const [individual, setIndividual] = React.useState(false);
  const [sort, setSort] = React.useState<ArmorySort>("name");
  const [sortDirection, setSortDirection] = React.useState<ArmorySortDirection>("asc");
  const [borrowerSort, setBorrowerSort] = React.useState<"name" | "count">("name");
  const [borrowerSortDirection, setBorrowerSortDirection] = React.useState<ArmorySortDirection>("asc");
  const [ownerSort, setOwnerSort] = React.useState<"name" | "count">("name");
  const [ownerSortDirection, setOwnerSortDirection] = React.useState<ArmorySortDirection>("asc");
  const ownership: ArmoryOwnershipControls = {
    options: data?.owner_options ?? [],
    onSaved: (uid, owner) => updateLocal(previous => ({
      ...previous, items: previous.items.map(item => item.uid === uid ? { ...item, owner } : item),
    })),
  };

  const items = data?.items ?? [];
  const tornPositions = React.useMemo(() => tornArmoryPositions(data?.items ?? []), [data?.items]);
  const counts = armoryCounts(items);
  const filtered = filterArmory(items, filters);
  const groups = groupArmory(filtered, individual, sort, sortDirection);
  const borrowers = new Map<number, { name: string; items: ArmoryCopy[] }>();
  const owners = new Map<number, { name: string; items: ArmoryCopy[] }>();
  for (const item of filtered) {
    const ownerId = item.owner?.id ?? 0;
    const owner = owners.get(ownerId) ?? { name: item.owner?.name ?? "Faction", items: [] };
    owner.items.push(item);
    owners.set(ownerId, owner);
    if (!item.loaned) continue;
    const borrower = borrowers.get(item.loaned.id) ?? { name: item.loaned.name, items: [] };
    borrower.items.push(item);
    borrowers.set(item.loaned.id, borrower);
  }
  const ownerView = tab === "owners";
  const people = ownerView ? owners : borrowers;
  const peopleSort = ownerView ? ownerSort : borrowerSort;
  const peopleDirection = ownerView ? ownerSortDirection : borrowerSortDirection;
  const field = (key: keyof ArmoryFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  function exportCsv() {
    const exported = tab === "borrowers" ? filtered.filter(item => item.loaned) : filtered;
    const url = URL.createObjectURL(new Blob(["\uFEFF", armoryCsv(exported)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `faction-armory-${category}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const age = data?.inventory_timestamp ? Math.max(0, Math.floor(Date.now() / 1000 - data.inventory_timestamp)) : null;
  return <ArmoryOwnershipContext.Provider value={ownership}><div className="armory-page">
    <section className="panel armory-heading">
      <div><div className="panel-kicker">{isArmor ? <Shield size={16} /> : <Swords size={16} />} Admin · {isArmor ? "Armor" : "Weapons"}</div><h1>Faction armory</h1>
        <p>See what is available, compare individual {plural}, and review member loans.</p></div>
      <div className="armory-actions">
        <button type="button" disabled={busy} onClick={() => refresh("inventory")}><RefreshCw size={15} /> {busy ? "Checking…" : "Refresh inventory"}</button>
        <ArmoryActivityRefresh fetchedAt={data?.activity_fetched_at ?? null} disabled={!data || busy} onRefresh={() => refresh("check")} />
      </div>
      <div className="armory-freshness"><span>Snapshot: {tct(data?.inventory_timestamp ?? null)}{age !== null ? ` · ${Math.floor(age / 60)} min old` : ""}</span>
        <span>Fetched: {tct(data?.checked_at ?? null)}</span><span>Inventory checked every 15 minutes</span></div>
    </section>
    {categoryTabs}
    {error || data?.error ? <div className="panel armory-message armory-warning" role="alert">{error ?? data?.error} {data?.inventory_timestamp ? "Showing the last saved inventory." : ""}</div> : null}
    {notice ? <div className="armory-message" role="status">{notice}</div> : null}
    <div className="armory-metrics">
      <MetricCard label={isArmor ? "Total armor" : "Total weapons"} value={data?.inventory_timestamp ? String(counts.total) : "—"} icon={<Boxes size={16} />} />
      <MetricCard label="Available" value={data?.inventory_timestamp ? String(counts.available) : "—"} icon={<Check size={16} />} />
      <MetricCard label="Loaned" value={data?.inventory_timestamp ? String(counts.loaned) : "—"} icon={<ArrowUpRight size={16} />} />
      <MetricCard label="Borrowers" value={data?.inventory_timestamp ? String(counts.borrowers) : "—"} icon={<Users size={16} />} />
    </div>
    <section className="panel armory-content">
      <div className="armory-toolbar"><div className="armory-tabs" role="group" aria-label="Armory view">
        <button type="button" aria-pressed={tab === "weapons"} onClick={() => setTab("weapons")}>Inventory</button>
        <button type="button" aria-pressed={tab === "borrowers"} onClick={() => setTab("borrowers")}>Borrowers</button>
        <button type="button" aria-pressed={tab === "owners"} onClick={() => setTab("owners")}>Owners</button>
      </div><button type="button" disabled={!filtered.length} onClick={exportCsv}><Download size={15} /> Export CSV</button></div>
      <div className="armory-detail-progress" role="status">{data ? `${items.length - data.pending} of ${items.length} ${itemLabel.toLowerCase()} details loaded · ${counts.bonuses} ${plural} with bonuses${data.pending ? " (partial)" : ""}` : "Loading inventory…"}
        {data?.refreshing ? ` · ${data.refreshing} detail refreshes remaining` : ""}{data?.syncing ? " · Sync in progress" : ""}</div>
      <p className="armory-loan-note">Loan times show when we first observed the current borrower, not the checkout date. Inventory refreshes every 15 minutes even with this page closed; returns between snapshots may be missed.</p>
      <div className="armory-filters">
        <label className="armory-search">Search<input type="search" placeholder={`${itemLabel}, member or UID`} value={filters.search} onChange={event => field("search", event.target.value)} /></label>
        {!isArmor ? <Filter label="Slot" value={filters.slot} onChange={value => field("slot", value)} options={slots} /> : null}
        <Filter label="Availability" value={filters.status} onChange={value => field("status", value)} options={["available", "loaned"]} />
        <Filter label={`${itemLabel} class`} value={filters.kind} onChange={value => field("kind", value)} options={["standard", "special", "pending"]} />
        <Filter label="Rarity" value={filters.rarity} onChange={value => field("rarity", value)} options={[...new Set(items.flatMap(item => item.details?.rarity ? [item.details.rarity] : []))].sort()} />
        <Filter label="Bonus" value={filters.bonus} onChange={value => field("bonus", value)} options={[...new Set(items.flatMap(item => item.details?.bonuses.map(bonus => bonus.title) ?? []))].sort()} />
      </div>
      <div className="armory-toolbar armory-results"><span>{tab === "weapons" ? `${filtered.length} matching ${plural}` : `${people.size} matching ${ownerView ? "owners" : "borrowers"}`} · Full inventory totals above</span>
        <div className="armory-actions"><button type="button" onClick={() => setFilters(EMPTY_ARMORY_FILTERS)}>Clear filters</button>
          {tab === "weapons" ? <><label className="armory-checkbox"><input type="checkbox" checked={individual} onChange={event => { setIndividual(event.target.checked); setSort("name"); }} /> Show individual copies</label>
            <label>Sort <select value={sort} onChange={event => setSort(event.target.value as ArmorySort)}><option value="name">{itemLabel} name</option><option value="owner">Owner</option><option value="available">Available</option><option value="rarity">Rarity</option>
              <option value="bonus">Bonus %</option><option value="observed">Observed loan time</option>
              {individual ? <>{isArmor ? <option value="armor">Armor</option> : <><option value="damage">Damage</option><option value="accuracy">Accuracy</option></>}<option value="quality">Quality</option></> : null}</select></label>
            <label>Order <select value={sortDirection} onChange={event => setSortDirection(event.target.value as ArmorySortDirection)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></>
            : <><label>Sort <select value={peopleSort} onChange={event => (ownerView ? setOwnerSort : setBorrowerSort)(event.target.value as "name" | "count")}><option value="name">{ownerView ? "Owner" : "Borrower"} name</option><option value="count">Items {ownerView ? "owned" : "borrowed"}</option></select></label>
              <label>Order <select value={peopleDirection} onChange={event => (ownerView ? setOwnerSortDirection : setBorrowerSortDirection)(event.target.value as ArmorySortDirection)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></>}
        </div>
      </div>
      {!data ? <div className="armory-empty">{error ? "Inventory could not be loaded. Use Refresh inventory to retry." : "Loading saved inventory…"}</div>
        : !data.inventory_timestamp ? <div className="armory-empty">{busy ? "Fetching the first inventory snapshot…" : "No inventory snapshot yet. Use Refresh inventory to get started."}</div>
        : !items.length ? <div className="armory-empty">There are no {plural} in this faction inventory.</div>
        : tab === "weapons" ? groups.length ? <EquipmentTable category={category} groups={groups} tornPositions={tornPositions} /> : <div className="armory-empty">No {plural} match these filters.</div>
        : people.size ? <div className="armory-borrowers" key={tab}>{[...people].sort((a, b) => {
          const names = a[1].name.localeCompare(b[1].name);
          const delta = peopleSort === "count" ? a[1].items.length - b[1].items.length : names;
          return delta * (peopleDirection === "asc" ? 1 : -1) || names || a[0] - b[0];
        }).map(([id, person]) => <details className="armory-borrower" key={id}>
          <summary><strong>{person.name}</strong><span>{person.items.length} {ownerView ? "owned" : "loaned"}</span>{slots.map(slot => <span key={slot}>{slot}: {person.items.filter(item => item.type === slot).length}</span>)}</summary>
          <EquipmentTable category={category} groups={groupArmory(person.items, true, "name")} tornPositions={tornPositions} />
        </details>)}</div> : <div className="armory-empty">No {ownerView ? "owners" : "borrowers"} match these filters.</div>}
    </section>
  </div></ArmoryOwnershipContext.Provider>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">All</option>{options.map(option => <option key={option} value={option}>{option === "pending" ? "Details pending" : option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>;
}

function EquipmentImage({ item, category, start }: { item: ArmoryCopy; category: ArmoryCategory; start: number }) {
  const [failed, setFailed] = React.useState(false);
  const rarity = item.details?.rarity;
  const tone = ["yellow", "orange", "red"].includes(rarity ?? "") ? rarity : "none";
  return <a className={`armory-art armory-rarity-${tone}`} href={tornArmoryUrl(category, start)} target="_blank" rel="noreferrer"
    aria-label={`View ${item.name} in Torn armory`}
    title="View in Torn armory — position estimated from the saved inventory; ties and inventory changes may shift it.">
    {failed ? <Swords aria-label="Item image unavailable" size={28} /> : <img src={`https://www.torn.com/images/items/${item.id}/large.png`}
      srcSet={`https://www.torn.com/images/items/${item.id}/large.png 1x, https://www.torn.com/images/items/${item.id}/large@2x.png 2x`}
      width="96" height="64" alt={`${item.name}${rarity ? ` — ${rarity} rarity` : ""}`} loading="lazy" onError={() => setFailed(true)} />}
  </a>;
}

function CopyUid({ uid }: { uid: string }) {
  const [message, setMessage] = React.useState("");
  return <button className="armory-uid" type="button" title="Copy item UID" onClick={() => void navigator.clipboard.writeText(uid).then(() => setMessage("Copied"), () => setMessage("Copy unavailable"))}>
    <Copy size={11} /> {uid}<span role="status">{message ? ` · ${message}` : ""}</span></button>;
}

function EquipmentName({ name, category, start }: { name: string; category: ArmoryCategory; start: number }) {
  return <a className="armory-item-link" href={tornArmoryUrl(category, start)} target="_blank" rel="noreferrer"
    title="View in Torn armory — position estimated from the saved inventory; ties and inventory changes may shift it.">
    {name}<LinkIcon size={13} aria-hidden="true" />
  </a>;
}

function EquipmentTable({ groups, category, tornPositions }: { groups: ArmoryGroup[]; category: ArmoryCategory; tornPositions: Map<string, number> }) {
  return <div className="armory-table-scroll"><table className="armory-table"><thead><tr><th>{category === "armor" ? "Armor" : "Weapon"}</th><th>Bonuses</th><th>Stats</th><th>Qty</th><th>Availability</th><th>Owner</th><th>Loan first observed</th></tr></thead>
    <tbody>{groups.map(group => <EquipmentRows key={group.key} group={group} category={category} tornPositions={tornPositions} />)}</tbody></table></div>;
}

function EquipmentStats({ damage, accuracy, armor, quality, category }: { damage: string; accuracy: string; armor: string; quality: string; category: ArmoryCategory }) {
  return <div className="armory-stats">
    {category === "armor" ? <StatTooltip name="Armor" value={armor} icon={<Shield size={14} aria-hidden="true" />} />
      : <><StatTooltip name="Damage" value={damage} icon={<Bomb size={14} aria-hidden="true" />} />
        <StatTooltip name="Accuracy" value={accuracy} icon={<Target size={14} aria-hidden="true" />} /></>}
    <StatTooltip name="Quality" value={quality} icon={<BadgePercent size={14} aria-hidden="true" />} />
  </div>;
}

function StatTooltip({ name, value, icon }: { name: string; value: string; icon: React.ReactNode }) {
  return <ArmoryTooltip variant="stat" label={<>{icon}{value}</>} description={name} accessibleLabel={`${name}: ${value}`} />;
}

function EquipmentRows({ group, category, tornPositions }: { group: ArmoryGroup; category: ArmoryCategory; tornPositions: Map<string, number> }) {
  const [open, setOpen] = React.useState(false);
  const item = group.items[0];
  if (!group.grouped || group.items.length === 1) return <CopyRow category={category} item={item} start={tornPositions.get(item.uid) ?? 0} />;
  const start = Math.min(...group.items.map(copy => tornPositions.get(copy.uid) ?? 0));
  const available = group.items.filter(copy => !copy.loaned).length;
  const owners = new Map(group.items.map(copy => [copy.owner?.id ?? null, copy.owner?.name ?? "Faction"]));
  const range = (stat: "damage" | "accuracy" | "armor" | "quality") => {
    const values = group.items.flatMap(copy => copy.details?.stats[stat] != null ? [copy.details.stats[stat]!] : []);
    if (!values.length) return "—";
    const min = Math.min(...values), max = Math.max(...values);
    return `${min.toFixed(2)}${min !== max ? `–${max.toFixed(2)}` : ""}${stat === "quality" ? "%" : ""}`;
  };
  return <><tr className="armory-group-row"><td><div className="armory-weapon"><EquipmentImage item={item} category={category} start={start} /><div><div className="armory-group-name"><button className="armory-expand" type="button" aria-label={`${open ? "Collapse" : "Expand"} ${item.name} copies`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button><EquipmentName name={item.name} category={category} start={start} /></div><small>{item.type} · Standard copies</small></div></div></td>
    <td><span className="armory-badge">Standard</span></td><td><EquipmentStats category={category} armor={range("armor")} damage={range("damage")} accuracy={range("accuracy")} quality={range("quality")} /></td><td>{group.items.length}</td>
    <td><span className="armory-available">{available} available</span><small>{group.items.length - available} loaned</small></td>
    <td>{owners.size === 1 ? <ArmoryOwnerName owner={item.owner} /> : "Multiple owners"}<small><button type="button" className="armory-owner-action"
      aria-label={`Edit owners of ${item.name} copies`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "collapse" : "edit"}</button></small></td>
    <td>{available < group.items.length ? "Expand copies" : "—"}</td></tr>
    {open ? group.items.map(copy => <CopyRow category={category} key={copy.uid} item={copy} start={tornPositions.get(copy.uid) ?? 0} child />) : null}</>;
}

function CopyRow({ item, category, start, child = false }: { item: ArmoryCopy; category: ArmoryCategory; start: number; child?: boolean }) {
  const kind = weaponClass(item);
  return <tr className={child ? "armory-copy-child" : undefined}><td><div className="armory-weapon"><EquipmentImage item={item} category={category} start={start} /><div><strong><EquipmentName name={item.name} category={category} start={start} /></strong><small>{item.type}</small><CopyUid uid={item.uid} /></div></div></td>
    <td data-rarity={item.details?.rarity ?? undefined}>
      {kind === "special" ? <span className="armory-stat-label">{item.details?.rarity} rarity</span>
        : <span className="armory-badge">{kind === "pending" ? "Details pending" : "Standard"}</span>}
      {item.details?.bonuses.map((bonus, index) => <ArmoryTooltip key={`${bonus.id}-${index}`} label={`${bonus.title} · ${bonus.value}`} description={bonus.description} />)}</td>
    <td><EquipmentStats category={category} armor={item.details?.stats.armor?.toFixed(2) ?? "—"} damage={item.details?.stats.damage?.toFixed(2) ?? "—"} accuracy={item.details?.stats.accuracy?.toFixed(2) ?? "—"} quality={item.details ? `${item.details.stats.quality.toFixed(2)}%` : "—"} /></td><td>1</td>
    <td>{item.loaned ? <ArmoryBorrower borrower={item.loaned} /> : <span className="armory-available">Available</span>}</td>
    <td><ArmoryOwner item={item} category={category} /></td>
    <td className="armory-loan-time">{!item.loaned ? "—" : item.loan_first_seen_at
      ? <>{loanElapsed(item.loan_first_seen_at)} since first observed<small><time dateTime={new Date(item.loan_first_seen_at * 1000).toISOString()}>{tct(item.loan_first_seen_at)}</time></small></>
      : <span title="Tracking starts on the next successful inventory refresh.">Awaiting observation</span>}</td></tr>;
}

function ArmoryTooltip({ label, description, variant = "bonus", accessibleLabel }: {
  label: React.ReactNode; description: string; variant?: "bonus" | "stat"; accessibleLabel?: string;
}) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const tooltip = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { clearTimeout(closeTimer.current); setOpen(false); };
  const leave = () => {
    if (document.activeElement !== trigger.current) closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  React.useEffect(() => () => clearTimeout(closeTimer.current), []);
  React.useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)),
      top: Math.max(12, anchor.bottom + box.height + 20 <= window.innerHeight ? anchor.bottom + 8 : anchor.top - box.height - 8) });
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className={`armory-${variant}`}>
    <button type="button" ref={trigger} className={`armory-${variant}-trigger`} aria-label={accessibleLabel} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={hide} onClick={show}>{label}</button>
    {open ? createPortal(<div ref={tooltip} id={id} role="tooltip" className="armory-bonus-tooltip" style={position}
      onMouseEnter={show} onMouseLeave={leave}>{description}</div>, document.body) : null}
  </div>;
}
