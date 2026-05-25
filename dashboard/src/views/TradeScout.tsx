import React from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Filter,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  createTradeWatchlist,
  deleteTradeWatchlist,
  getTradeOpportunities,
  getTradeWatchlists,
  scanTradeWatchlist,
  updateTradeWatchlist,
} from "../api";
import type {
  TradeItemSource,
  TradeOpportunity,
  TradeSnapshotSummary,
  TradeWatchlist,
  TradeWatchlistPayload,
} from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatNumber, formatRelativeTime } from "../utils/format";

const TORN_KEY_STORAGE_KEY = "tradeScoutTornKey";
const STALE_SCAN_SECONDS = 30 * 60;

type TradeSortKey = "profit" | "bulk_profit" | "roi" | "quantity" | "listing_price" | "item";

type TradeScoutFilters = {
  search: string;
  minProfit: string;
  minRoi: string;
  minQuantity: string;
  sortBy: TradeSortKey;
  onlyProfitable: boolean;
  hideStale: boolean;
};

type WatchlistPreset = {
  name: string;
  itemIds: number[];
  minProfit: number;
  minRoiPercent: number;
  minQuantity: number;
};

const EMPTY_FILTERS: TradeScoutFilters = {
  search: "",
  minProfit: "",
  minRoi: "",
  minQuantity: "",
  sortBy: "profit",
  onlyProfitable: true,
  hideStale: false,
};

const WATCHLIST_PRESETS: WatchlistPreset[] = [
  {
    name: "Plushies - quick flips",
    itemIds: [258, 260, 261, 263, 264, 266, 268, 269, 273, 274],
    minProfit: 25000,
    minRoiPercent: 0,
    minQuantity: 1,
  },
  {
    name: "Plushies - bulk flips",
    itemIds: [258, 260, 261, 263, 264, 266, 268, 269, 273, 274],
    minProfit: 100000,
    minRoiPercent: 0,
    minQuantity: 3,
  },
  {
    name: "Energy cans - market flips",
    itemIds: [530, 532, 533, 553, 554, 555, 985, 986, 987],
    minProfit: 50000,
    minRoiPercent: 1,
    minQuantity: 1,
  },
  {
    name: "Alcohol - nerve bottles",
    itemIds: [180, 181, 426, 531, 541, 542, 550, 551, 552, 816, 873, 984],
    minProfit: 5000,
    minRoiPercent: 0,
    minQuantity: 1,
  },
];

type WatchlistFormState = {
  name: string;
  itemIds: string;
  itemSource: TradeItemSource;
  minProfit: string;
  minRoiPercent: string;
  minQuantity: string;
  marketFeePercent: string;
};

const EMPTY_FORM: WatchlistFormState = {
  name: "",
  itemIds: "",
  itemSource: "weav3r_verified",
  minProfit: "25000",
  minRoiPercent: "0",
  minQuantity: "1",
  marketFeePercent: "5",
};

export function TradeScout({ isAdmin }: { isAdmin: boolean }) {
  const [watchlists, setWatchlists] = React.useState<TradeWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = React.useState<number | null>(null);
  const [snapshot, setSnapshot] = React.useState<TradeSnapshotSummary | null>(null);
  const [opportunities, setOpportunities] = React.useState<TradeOpportunity[]>([]);
  const [tornKey, setTornKey] = React.useState(() => window.localStorage.getItem(TORN_KEY_STORAGE_KEY) ?? "");
  const [form, setForm] = React.useState<WatchlistFormState>(EMPTY_FORM);
  const [filters, setFilters] = React.useState<TradeScoutFilters>(EMPTY_FILTERS);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingOpportunities, setIsLoadingOpportunities] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copiedOpportunityId, setCopiedOpportunityId] = React.useState<string | null>(null);

  const selectedWatchlist = watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null;
  const scanFreshness = snapshot ? snapshotFreshness(snapshot.scanned_at) : null;
  const filteredOpportunities = React.useMemo(
    () => filterAndSortOpportunities(opportunities, filters, snapshot),
    [filters, opportunities, snapshot],
  );
  const profitableCount = filteredOpportunities.filter((opportunity) => opportunity.profit > 0).length;
  const bestProfit = filteredOpportunities[0]?.profit ?? 0;
  const bulkCount = filteredOpportunities.filter((opportunity) => opportunity.bulk_profit > opportunity.profit).length;
  const parsedItemCount = parseItemIds(form.itemIds).length;
  const opportunityGroups = React.useMemo(
    () => groupOpportunitiesByItem(filteredOpportunities),
    [filteredOpportunities],
  );
  const noOpportunityItems = React.useMemo(
    () => itemsWithoutVisibleOpportunities(selectedWatchlist, opportunities, opportunityGroups),
    [opportunities, opportunityGroups, selectedWatchlist],
  );

  React.useEffect(() => {
    window.localStorage.setItem(TORN_KEY_STORAGE_KEY, tornKey);
  }, [tornKey]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getTradeWatchlists();
        if (cancelled) return;

        setWatchlists(response.watchlists);
        setSelectedWatchlistId((current) =>
          response.watchlists.some((watchlist) => watchlist.id === current)
            ? current
            : response.watchlists[0]?.id ?? null,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadOpportunities() {
      if (!selectedWatchlistId) {
        setSnapshot(null);
        setOpportunities([]);
        return;
      }

      setIsLoadingOpportunities(true);
      setError(null);

      try {
        const response = await getTradeOpportunities(selectedWatchlistId);
        if (!cancelled) {
          setSnapshot(response.snapshot);
          setOpportunities(response.opportunities);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSnapshot(null);
          setOpportunities([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingOpportunities(false);
        }
      }
    }

    loadOpportunities();
    return () => {
      cancelled = true;
    };
  }, [selectedWatchlistId]);

  function updateForm(patch: Partial<WatchlistFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateFilters(patch: Partial<TradeScoutFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function applyPreset(preset: WatchlistPreset) {
    setEditingId(null);
    setForm({
      name: preset.name,
      itemIds: preset.itemIds.join(", "),
      itemSource: "weav3r_verified",
      minProfit: String(preset.minProfit),
      minRoiPercent: String(preset.minRoiPercent),
      minQuantity: String(preset.minQuantity),
      marketFeePercent: "5",
    });
  }

  function startEdit(watchlist: TradeWatchlist) {
    if (!isAdmin) {
      return;
    }
    setEditingId(watchlist.id);
    setForm({
      name: watchlist.name,
      itemIds: watchlist.item_ids.join(", "),
      itemSource: watchlist.item_source,
      minProfit: String(watchlist.min_profit),
      minRoiPercent: String(watchlist.min_roi_percent),
      minQuantity: String(watchlist.min_quantity),
      marketFeePercent: String(watchlist.market_fee_percent),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function refreshWatchlists(nextSelectedId = selectedWatchlistId) {
    const response = await getTradeWatchlists();
    setWatchlists(response.watchlists);
    setSelectedWatchlistId(
      response.watchlists.some((watchlist) => watchlist.id === nextSelectedId)
        ? nextSelectedId
        : response.watchlists[0]?.id ?? null,
    );
  }

  async function saveWatchlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingId && !isAdmin) {
      setError("Admin access is required to edit shared watchlists.");
      return;
    }
    const payload = formToPayload(form);
    if (!payload) {
      setError("Add a name and at least one valid Torn item ID.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = editingId
        ? await updateTradeWatchlist(editingId, payload)
        : await createTradeWatchlist(payload);
      await refreshWatchlists(response.watchlist.id);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeWatchlist(watchlist: TradeWatchlist) {
    if (!window.confirm(`Delete ${watchlist.name}?`)) {
      return;
    }

    setError(null);
    try {
      await deleteTradeWatchlist(watchlist.id);
      if (editingId === watchlist.id) {
        cancelEdit();
      }
      await refreshWatchlists(selectedWatchlistId === watchlist.id ? null : selectedWatchlistId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runScan() {
    if (!selectedWatchlist) {
      return;
    }
    if (!tornKey.trim()) {
      setError("Enter your Torn API key before scanning.");
      return;
    }

    setIsScanning(true);
    setError(null);

    try {
      const response = await scanTradeWatchlist(selectedWatchlist.id, tornKey.trim());
      setSnapshot(response.snapshot);
      setOpportunities(response.opportunities);
      await refreshWatchlists(selectedWatchlist.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshWatchlists(selectedWatchlist.id);
      const latest = await getTradeOpportunities(selectedWatchlist.id).catch(() => null);
      if (latest) {
        setSnapshot(latest.snapshot);
        setOpportunities(latest.opportunities);
      }
    } finally {
      setIsScanning(false);
    }
  }

  function exportCsv() {
    if (!selectedWatchlist || filteredOpportunities.length === 0) {
      return;
    }

    downloadCsv(
      `${sanitizeCsvFilename(selectedWatchlist.name)}-trade-scout.csv`,
      [
        { label: "Item ID", value: (row) => row.item_id },
        { label: "Item", value: (row) => row.item_name ?? `Item ${row.item_id}` },
        { label: "Source", value: (row) => row.source },
        { label: "Seller ID", value: (row) => row.seller_id ?? "" },
        { label: "Seller", value: (row) => row.seller_name ?? "" },
        { label: "Listing price", value: (row) => row.listing_price },
        { label: "Resale price", value: (row) => row.resale_price },
        { label: "Profit", value: (row) => row.profit },
        { label: "ROI %", value: (row) => row.roi_percent },
        { label: "Quantity", value: (row) => row.quantity },
        { label: "Bulk profit", value: (row) => row.bulk_profit },
        { label: "Needed quantity", value: (row) => row.needed_quantity ?? "" },
        { label: "Reference", value: (row) => row.reference_label ?? "" },
      ],
      filteredOpportunities,
    );
  }

  async function copyOpportunity(opportunity: TradeOpportunity) {
    const seller = opportunity.seller_name || (opportunity.seller_id ? `Seller ${opportunity.seller_id}` : opportunity.source);
    const text = [
      `${opportunity.item_name ?? `Item ${opportunity.item_id}`}`,
      `Seller: ${seller}`,
      `Buy: ${money(opportunity.listing_price)}`,
      `Reference: ${money(opportunity.resale_price)}`,
      `Profit: ${money(opportunity.profit)} (${formatPercent(opportunity.roi_percent)})`,
      opportunity.seller_id ? `Bazaar: ${bazaarUrl(opportunity.seller_id)}` : null,
    ].filter(Boolean).join("\n");

    await window.navigator.clipboard?.writeText(text);
    setCopiedOpportunityId(opportunity.id);
    window.setTimeout(() => setCopiedOpportunityId((current) => current === opportunity.id ? null : current), 1600);
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Trade scout</p>
          <h2>
            Trade scout
            <span
              className="data-wip-badge"
              title="Trade Scout is still being shaped and should be treated as work in progress."
            >
              WIP
            </span>
          </h2>
          <p>Shared item watchlists with member-run scans and saved opportunity snapshots.</p>
        </div>
      </section>

      <section className="trade-scout-layout">
        <section className="trade-scout-summary-grid">
          <section className="metric-card trade-scout-key-panel">
            <PanelHeader title="Scanner key" aside="Local" />
            <label>
              <span>Torn API key</span>
              <input
                type="password"
                value={tornKey}
                autoComplete="off"
                onChange={(event) => setTornKey(event.target.value)}
                placeholder="Stored in this browser"
              />
            </label>
          </section>
          <MetricCard
            icon={<Search size={16} />}
            label="Opportunities"
            value={formatNumber(filteredOpportunities.length)}
            detail={`${profitableCount} profitable shown`}
          />
          <MetricCard
            icon={<Download size={16} />}
            label="Best unit profit"
            value={money(bestProfit)}
            detail={selectedWatchlist?.name ?? "-"}
          />
          <MetricCard
            icon={<RefreshCw size={16} />}
            label="Bulk candidates"
            value={formatNumber(bulkCount)}
            detail={scanFreshness ? scanFreshness.label : "No scan"}
          />
        </section>

        <section className="panel trade-scout-watchlists-panel">
          <PanelHeader
            title="Watchlists"
            aside={isLoading ? "Loading" : `${watchlists.length}`}
          />
          {watchlists.length === 0 ? (
            <EmptyState text={isLoading ? "Loading watchlists" : "No watchlists yet"} />
          ) : (
            <div className="trade-scout-watchlist-list">
              {watchlists.map((watchlist) => (
                <button
                  key={watchlist.id}
                  type="button"
                  className={watchlist.id === selectedWatchlistId ? "selected" : ""}
                  onClick={() => setSelectedWatchlistId(watchlist.id)}
                >
                  <strong>{watchlist.name}</strong>
                  <span>
                    {watchlist.item_ids.length} items - {sourceLabel(watchlist.item_source)}
                  </span>
                  <small>{createdByLabel(watchlist)}</small>
                  <small>
                    {watchlist.latest_snapshot
                      ? `Scanned ${formatRelativeTime(watchlist.latest_snapshot.scanned_at)}`
                      : "Not scanned"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>

          <section className="panel trade-scout-action-panel">
            <PanelHeader
              title={selectedWatchlist?.name ?? "Selected watchlist"}
              aside={snapshot ? snapshotStatus(snapshot) : "No snapshot"}
              control={
                <div className="trade-scout-actions">
                  {isAdmin && selectedWatchlist ? (
                    <>
                      <button type="button" className="panel-action-button" onClick={() => startEdit(selectedWatchlist)}>
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button type="button" className="panel-action-button" onClick={() => removeWatchlist(selectedWatchlist)}>
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="panel-action-button"
                    onClick={exportCsv}
                    disabled={filteredOpportunities.length === 0}
                  >
                    <Download size={14} />
                    CSV
                  </button>
                  <button
                    type="button"
                    className="panel-action-button primary-action"
                    onClick={runScan}
                    disabled={!selectedWatchlist || isScanning}
                  >
                    {isScanning ? <RefreshCw size={14} className="spinning-icon" /> : <Search size={14} />}
                    {isScanning ? "Scanning" : "Scan"}
                  </button>
                </div>
              }
            />
            {selectedWatchlist ? (
              <div className="trade-scout-selected-meta">
                <span>{selectedWatchlist.item_ids.join(", ")}</span>
                <span>{sourceLabel(selectedWatchlist.item_source)}</span>
                <span>Min profit {money(selectedWatchlist.min_profit)}</span>
                <span>Min ROI {selectedWatchlist.min_roi_percent}%</span>
                <span>{createdByLabel(selectedWatchlist)}</span>
                {scanFreshness ? <span className={`trade-scout-freshness ${scanFreshness.tone}`}>{scanFreshness.label}</span> : null}
              </div>
            ) : (
              <EmptyState text="Select or create a watchlist" />
            )}
            {snapshot?.error ? <p className="form-error">{snapshot.error}</p> : null}
          </section>

          <section className="panel trade-scout-form-panel">
            <PanelHeader
              title={editingId ? "Edit watchlist" : "New watchlist"}
              aside={editingId ? "Admin edit" : "Shared"}
              control={editingId ? (
                <button type="button" className="panel-action-button" onClick={cancelEdit}>
                  <X size={14} />
                  Cancel
                </button>
              ) : null}
            />
            {!editingId ? (
              <div className="trade-scout-presets" aria-label="Watchlist presets">
                {WATCHLIST_PRESETS.map((preset) => (
                  <button key={preset.name} type="button" onClick={() => applyPreset(preset)}>
                    <strong>{preset.name}</strong>
                    <span>{preset.itemIds.length} items</span>
                  </button>
                ))}
              </div>
            ) : null}
            <form className="trade-scout-form" onSubmit={saveWatchlist}>
              <label>
                <span>Name</span>
                <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
              </label>
              <label className="trade-scout-items-field">
                <span>Item IDs <small>{parsedItemCount} parsed</small></span>
                <textarea
                  value={form.itemIds}
                  onChange={(event) => updateForm({ itemIds: event.target.value })}
                  placeholder="206, 533, 780"
                />
              </label>
              <label>
                <span>Source</span>
                <select
                  value={form.itemSource}
                  onChange={(event) => updateForm({ itemSource: event.target.value as TradeItemSource })}
                >
                  <option value="weav3r_verified">Weav3r + Torn verification</option>
                  <option value="torn">Torn market</option>
                </select>
              </label>
              <label>
                <span>Min profit</span>
                <input inputMode="numeric" value={form.minProfit} onChange={(event) => updateForm({ minProfit: event.target.value })} />
              </label>
              <label>
                <span>Min ROI %</span>
                <input inputMode="decimal" value={form.minRoiPercent} onChange={(event) => updateForm({ minRoiPercent: event.target.value })} />
              </label>
              <label>
                <span>Min quantity</span>
                <input inputMode="numeric" value={form.minQuantity} onChange={(event) => updateForm({ minQuantity: event.target.value })} />
              </label>
              <label>
                <span>Market fee %</span>
                <input inputMode="decimal" value={form.marketFeePercent} onChange={(event) => updateForm({ marketFeePercent: event.target.value })} />
              </label>
              <div className="trade-scout-form-actions">
                <button type="submit" className="panel-action-button primary-action" disabled={isSaving}>
                  {editingId ? <Save size={14} /> : <Plus size={14} />}
                  {isSaving ? "Saving" : editingId ? "Save" : "Create shared list"}
                </button>
              </div>
            </form>
          </section>

          <section className="panel trade-scout-filter-panel">
            <PanelHeader
              icon={<Filter size={16} />}
              title="Filters and sorting"
              aside={`${filteredOpportunities.length} shown`}
              control={
                <button type="button" className="panel-action-button" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Reset
                </button>
              }
            />
            <div className="trade-scout-filter-grid">
              <label className="trade-scout-filter-wide">
                <span>Search</span>
                <input
                  value={filters.search}
                  onChange={(event) => updateFilters({ search: event.target.value })}
                  placeholder="Item, seller, or source"
                />
              </label>
              <label>
                <span>Min profit</span>
                <input inputMode="numeric" value={filters.minProfit} onChange={(event) => updateFilters({ minProfit: event.target.value })} />
              </label>
              <label>
                <span>Min ROI %</span>
                <input inputMode="decimal" value={filters.minRoi} onChange={(event) => updateFilters({ minRoi: event.target.value })} />
              </label>
              <label>
                <span>Min quantity</span>
                <input inputMode="numeric" value={filters.minQuantity} onChange={(event) => updateFilters({ minQuantity: event.target.value })} />
              </label>
              <label>
                <span>Sort by</span>
                <select value={filters.sortBy} onChange={(event) => updateFilters({ sortBy: event.target.value as TradeSortKey })}>
                  <option value="profit">Unit profit</option>
                  <option value="bulk_profit">Bulk profit</option>
                  <option value="roi">ROI</option>
                  <option value="quantity">Quantity</option>
                  <option value="listing_price">Lowest buy price</option>
                  <option value="item">Item name</option>
                </select>
              </label>
              <label className="trade-scout-check">
                <input
                  type="checkbox"
                  checked={filters.onlyProfitable}
                  onChange={(event) => updateFilters({ onlyProfitable: event.target.checked })}
                />
                <span>Profitable only</span>
              </label>
              <label className="trade-scout-check">
                <input
                  type="checkbox"
                  checked={filters.hideStale}
                  onChange={(event) => updateFilters({ hideStale: event.target.checked })}
                />
                <span>Hide stale scan</span>
              </label>
            </div>
          </section>

          <section className="panel table-panel">
            <PanelHeader
              title="Latest opportunities"
              aside={isLoadingOpportunities ? "Loading" : `${filteredOpportunities.length} of ${opportunities.length}`}
            />
            {!snapshot ? (
              <EmptyState
                text={
                  isLoadingOpportunities
                    ? "Loading opportunities"
                    : "Run a scan to populate this watchlist"
                }
              />
            ) : (
              <div className="trade-opportunity-sections">
                {opportunityGroups.length === 0 ? (
                  <EmptyState
                    text={opportunities.length > 0 ? "No opportunities match the current filters" : "No opportunities matched this watchlist"}
                  />
                ) : (
                  opportunityGroups.map((group) => (
                    <section key={group.itemId} className="trade-opportunity-item-section">
                      <div className="trade-opportunity-item-header">
                        <div>
                          <strong>{group.itemName}</strong>
                          <span>Item {group.itemId}</span>
                        </div>
                        <small>{formatNumber(group.opportunities.length)} opportunities</small>
                      </div>
                      <OpportunityTable
                        opportunities={group.opportunities}
                        selectedWatchlist={selectedWatchlist}
                        snapshot={snapshot}
                        copiedOpportunityId={copiedOpportunityId}
                        onCopyOpportunity={copyOpportunity}
                      />
                    </section>
                  ))
                )}

                {noOpportunityItems.length > 0 ? (
                  <section className="trade-no-opportunity-section">
                    <div className="trade-opportunity-item-header">
                      <div>
                        <strong>No opportunities</strong>
                        <span>Items without visible matches in this scan</span>
                      </div>
                      <small>{formatNumber(noOpportunityItems.length)} items</small>
                    </div>
                    <div className="trade-no-opportunity-list">
                      {noOpportunityItems.map((item) => (
                        <span key={item.id}>
                          <strong>{item.name}</strong>
                          <small>{item.id}</small>
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </section>
      </section>
    </>
  );
}

function OpportunityTable({
  opportunities,
  selectedWatchlist,
  snapshot,
  copiedOpportunityId,
  onCopyOpportunity,
}: {
  opportunities: TradeOpportunity[];
  selectedWatchlist: TradeWatchlist | null;
  snapshot: TradeSnapshotSummary | null;
  copiedOpportunityId: string | null;
  onCopyOpportunity: (opportunity: TradeOpportunity) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="trade-scout-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Buy</th>
            <th>Reference</th>
            <th>Unit profit</th>
            <th>Quantity</th>
            <th>Bulk profit</th>
            <th>ROI</th>
            <th>Quality</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => {
            const quality = opportunityQuality(opportunity, selectedWatchlist, snapshot);
            return (
              <tr key={opportunity.id}>
                <td>{sellerCell(opportunity)}</td>
                <td>{money(opportunity.listing_price)}</td>
                <td>
                  <strong>{money(opportunity.resale_price)}</strong>
                  <small>{opportunity.reference_label ?? "-"}</small>
                  <small>{selectedWatchlist ? `Fee model ${selectedWatchlist.market_fee_percent}%` : "Fee model -"}</small>
                </td>
                <td className={opportunity.profit >= 0 ? "positive" : "negative"}>
                  {money(opportunity.profit)}
                </td>
                <td>{formatNumber(opportunity.quantity)}</td>
                <td className={opportunity.bulk_profit >= 0 ? "positive" : "negative"}>
                  {money(opportunity.bulk_profit)}
                  {opportunity.needed_quantity ? <small>{opportunity.needed_quantity} needed</small> : null}
                </td>
                <td>{formatPercent(opportunity.roi_percent)}</td>
                <td>
                  <span className={`trade-quality-badge ${quality.tone}`}>{quality.label}</span>
                  <small>{quality.detail}</small>
                </td>
                <td>
                  <div className="trade-scout-row-actions">
                    {opportunity.seller_id ? (
                      <a
                        href={bazaarUrl(opportunity.seller_id)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open seller bazaar"
                        aria-label="Open seller bazaar"
                      >
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onCopyOpportunity(opportunity)}
                      title="Copy opportunity"
                      aria-label="Copy opportunity"
                    >
                      <Copy size={14} />
                    </button>
                    <small>{copiedOpportunityId === opportunity.id ? "Copied" : null}</small>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function groupOpportunitiesByItem(opportunities: TradeOpportunity[]): Array<{
  itemId: number;
  itemName: string;
  opportunities: TradeOpportunity[];
}> {
  const groups = new Map<number, TradeOpportunity[]>();
  opportunities.forEach((opportunity) => {
    const current = groups.get(opportunity.item_id) ?? [];
    current.push(opportunity);
    groups.set(opportunity.item_id, current);
  });

  return Array.from(groups.entries()).map(([itemId, rows]) => ({
    itemId,
    itemName: rows.find((row) => row.item_name)?.item_name ?? `Item ${itemId}`,
    opportunities: rows,
  }));
}

function itemsWithoutVisibleOpportunities(
  watchlist: TradeWatchlist | null,
  allOpportunities: TradeOpportunity[],
  visibleGroups: Array<{ itemId: number }>,
): Array<{ id: number; name: string }> {
  if (!watchlist) {
    return [];
  }

  const visibleItemIds = new Set(visibleGroups.map((group) => group.itemId));
  return watchlist.item_ids
    .filter((itemId) => !visibleItemIds.has(itemId))
    .map((itemId) => ({
      id: itemId,
      name: allOpportunities.find((opportunity) => opportunity.item_id === itemId && opportunity.item_name)?.item_name ?? `Item ${itemId}`,
    }));
}

function filterAndSortOpportunities(
  opportunities: TradeOpportunity[],
  filters: TradeScoutFilters,
  snapshot: TradeSnapshotSummary | null,
): TradeOpportunity[] {
  const search = filters.search.trim().toLowerCase();
  const minProfit = optionalNumber(filters.minProfit);
  const minRoi = optionalNumber(filters.minRoi);
  const minQuantity = optionalNumber(filters.minQuantity);
  const scanIsStale = snapshot ? nowSeconds() - snapshot.scanned_at > STALE_SCAN_SECONDS : false;

  if (filters.hideStale && scanIsStale) {
    return [];
  }

  return opportunities
    .filter((opportunity) => {
      if (filters.onlyProfitable && opportunity.profit <= 0) return false;
      if (minProfit !== null && opportunity.profit < minProfit) return false;
      if (minRoi !== null && opportunity.roi_percent < minRoi) return false;
      if (minQuantity !== null && opportunity.quantity < minQuantity) return false;
      if (!search) return true;
      const haystack = [
        opportunity.item_name,
        opportunity.item_id,
        opportunity.seller_name,
        opportunity.seller_id,
        opportunity.source,
        opportunity.reference_label,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => compareOpportunities(left, right, filters.sortBy));
}

function compareOpportunities(left: TradeOpportunity, right: TradeOpportunity, sortBy: TradeSortKey): number {
  switch (sortBy) {
    case "bulk_profit":
      return right.bulk_profit - left.bulk_profit || right.profit - left.profit || left.listing_price - right.listing_price;
    case "roi":
      return right.roi_percent - left.roi_percent || right.profit - left.profit;
    case "quantity":
      return right.quantity - left.quantity || right.bulk_profit - left.bulk_profit;
    case "listing_price":
      return left.listing_price - right.listing_price || right.profit - left.profit;
    case "item":
      return (left.item_name ?? `Item ${left.item_id}`).localeCompare(right.item_name ?? `Item ${right.item_id}`);
    case "profit":
    default:
      return right.profit - left.profit || right.bulk_profit - left.bulk_profit || left.listing_price - right.listing_price;
  }
}

function snapshotFreshness(scannedAt: number): { label: string; tone: "fresh" | "warm" | "stale" } {
  const ageSeconds = nowSeconds() - scannedAt;
  if (ageSeconds > STALE_SCAN_SECONDS) {
    return { label: `Stale - ${formatRelativeTime(scannedAt)}`, tone: "stale" };
  }
  if (ageSeconds > 10 * 60) {
    return { label: `Aging - ${formatRelativeTime(scannedAt)}`, tone: "warm" };
  }
  return { label: `Fresh - ${formatRelativeTime(scannedAt)}`, tone: "fresh" };
}

function opportunityQuality(
  opportunity: TradeOpportunity,
  watchlist: TradeWatchlist | null,
  snapshot: TradeSnapshotSummary | null,
): { label: string; detail: string; tone: "good" | "warn" | "muted" | "danger" } {
  if (snapshot && nowSeconds() - snapshot.scanned_at > STALE_SCAN_SECONDS) {
    return { label: "Needs price check", detail: "Scan is over 30m old", tone: "warn" };
  }

  if (opportunity.profit <= 0) {
    return { label: "No margin", detail: "Profit is currently negative", tone: "danger" };
  }

  if (watchlist && opportunity.profit < watchlist.min_profit && opportunity.bulk_profit >= watchlist.min_profit) {
    return { label: "Bulk only", detail: `${opportunity.needed_quantity ?? 1}+ needed`, tone: "muted" };
  }

  if (opportunity.roi_percent < 2) {
    return { label: "Low margin", detail: `${formatPercent(opportunity.roi_percent)} ROI`, tone: "warn" };
  }

  return { label: "Good flip", detail: `${money(opportunity.profit)} unit profit`, tone: "good" };
}

function createdByLabel(watchlist: TradeWatchlist): string {
  if (watchlist.created_by_name) {
    return `Created by ${watchlist.created_by_name}`;
  }
  if (watchlist.created_by_torn_user_id) {
    return `Created by #${watchlist.created_by_torn_user_id}`;
  }
  return "Default shared list";
}

function bazaarUrl(sellerId: number): string {
  return `https://www.torn.com/bazaar.php?userId=${encodeURIComponent(String(sellerId))}#/`;
}

function formToPayload(form: WatchlistFormState): TradeWatchlistPayload | null {
  const itemIds = parseItemIds(form.itemIds);
  const name = form.name.trim();
  if (!name || itemIds.length === 0) {
    return null;
  }

  return {
    name,
    item_ids: itemIds,
    item_source: form.itemSource,
    min_profit: numericInput(form.minProfit, 25000),
    min_roi_percent: numericInput(form.minRoiPercent, 0),
    min_quantity: Math.max(1, Math.floor(numericInput(form.minQuantity, 1))),
    market_fee_percent: numericInput(form.marketFeePercent, 5),
  };
}

function parseItemIds(value: string): number[] {
  return Array.from(new Set(
    value
      .split(/[\s,]+/)
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
}

function numericInput(value: string, fallback: number): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.replace(/,/g, "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sourceLabel(source: TradeItemSource): string {
  switch (source) {
    case "weav3r_verified":
      return "Weav3r + Torn";
    case "torn":
      return "Torn market";
    default:
      return source;
  }
}

function snapshotStatus(snapshot: TradeSnapshotSummary): string {
  const prefix = snapshot.status === "ok" ? "Scanned" : "Failed";
  return `${prefix} ${formatRelativeTime(snapshot.scanned_at)}`;
}

function sellerCell(opportunity: TradeOpportunity): React.ReactNode {
  const seller = opportunity.seller_name || (opportunity.seller_id ? `Seller ${opportunity.seller_id}` : opportunity.source);
  if (!opportunity.seller_id) {
    return (
      <>
        <strong>{opportunity.source}</strong>
      </>
    );
  }

  return (
    <>
      <a
        href={bazaarUrl(opportunity.seller_id)}
        target="_blank"
        rel="noreferrer"
      >
        {seller}
      </a>
      <small>{opportunity.source}</small>
    </>
  );
}

function money(value: number): string {
  return `$${formatNumber(Math.round(value))}`;
}

function formatPercent(value: number): string {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}
