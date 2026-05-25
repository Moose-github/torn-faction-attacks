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
  getTradeSearchOpportunities,
  getTradeWatchlists,
  scanTradeSearch,
  updateTradeWatchlist,
} from "../api";
import type {
  TradeItemSnapshotSummary,
  TradeItemSource,
  TradeOpportunity,
  TradeWatchlist,
  TradeWatchlistPayload,
} from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatNumber, formatRelativeTime } from "../utils/format";
import {
  EMPTY_FILTERS,
  EMPTY_FORM,
  WATCHLIST_PRESETS,
  bazaarUrl,
  createdByLabel,
  filterAndSortOpportunities,
  formFromTemplate,
  formToPayload,
  formToSearchPayload,
  formatPercent,
  groupOpportunitiesByItem,
  itemSnapshotLabel,
  itemsWithoutVisibleOpportunities,
  formatMoney,
  opportunityQuality,
  parseItemIds,
  searchFreshness,
  sourceLabel,
} from "../utils/tradeScout";
import type { TradeScoutFilters, TradeSortKey, WatchlistFormState, WatchlistPreset } from "../utils/tradeScout";

const TORN_KEY_STORAGE_KEY = "tradeScoutTornKey";

export function TradeScout({ isAdmin }: { isAdmin: boolean }) {
  const [watchlists, setWatchlists] = React.useState<TradeWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = React.useState<number | null>(null);
  const [snapshots, setSnapshots] = React.useState<TradeItemSnapshotSummary[]>([]);
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
  const currentSearch = React.useMemo(() => formToSearchPayload(form), [form]);
  const snapshotByItem = React.useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.item_id, snapshot])),
    [snapshots],
  );
  const scanFreshness = currentSearch ? searchFreshness(currentSearch.item_ids, snapshotByItem) : null;
  const filteredOpportunities = React.useMemo(
    () => filterAndSortOpportunities(opportunities, filters, snapshotByItem),
    [filters, opportunities, snapshotByItem],
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
    () => itemsWithoutVisibleOpportunities(currentSearch?.item_ids ?? [], opportunities, opportunityGroups),
    [currentSearch, opportunities, opportunityGroups],
  );

  React.useEffect(() => {
    window.localStorage.setItem(TORN_KEY_STORAGE_KEY, tornKey);
  }, [tornKey]);

  React.useEffect(() => {
    if (!currentSearch) {
      setSnapshots([]);
      setOpportunities([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void loadLatestForSearch(currentSearch);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [currentSearch]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getTradeWatchlists();
        if (cancelled) return;

        setWatchlists(response.watchlists);
        const nextTemplate = response.watchlists[0] ?? null;
        if (nextTemplate) {
          loadTemplate(nextTemplate);
        }
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

  function updateForm(patch: Partial<WatchlistFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateFilters(patch: Partial<TradeScoutFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function applyPreset(preset: WatchlistPreset) {
    setEditingId(null);
    setSelectedWatchlistId(null);
    setForm({
      name: preset.name,
      itemIds: preset.itemIds.join(", "),
      itemSource: "weav3r_verified",
      minProfit: String(preset.minProfit),
      minRoiPercent: String(preset.minRoiPercent),
      minQuantity: String(preset.minQuantity),
      marketFeePercent: "5",
    });
    setSnapshots([]);
    setOpportunities([]);
  }

  function loadTemplate(watchlist: TradeWatchlist) {
    setSelectedWatchlistId(watchlist.id);
    setEditingId(null);
    const nextForm = formFromTemplate(watchlist);
    setForm(nextForm);
    const payload = formToSearchPayload(nextForm);
    if (payload) {
      void loadLatestForSearch(payload);
    }
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
    setSelectedWatchlistId(null);
    setSnapshots([]);
    setOpportunities([]);
  }

  async function loadLatestForSearch(payload = currentSearch) {
    if (!payload) {
      setSnapshots([]);
      setOpportunities([]);
      return;
    }

    setIsLoadingOpportunities(true);
    setError(null);
    try {
      const response = await getTradeSearchOpportunities(payload);
      setSnapshots(response.snapshots ?? []);
      setOpportunities(response.opportunities);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshots([]);
      setOpportunities([]);
    } finally {
      setIsLoadingOpportunities(false);
    }
  }

  async function refreshWatchlists(nextSelectedId = selectedWatchlistId) {
    const response = await getTradeWatchlists();
    setWatchlists(response.watchlists);
    if (nextSelectedId && response.watchlists.some((watchlist) => watchlist.id === nextSelectedId)) {
      setSelectedWatchlistId(nextSelectedId);
    }
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
    if (!currentSearch) {
      setError("Add at least one valid Torn item ID before scanning.");
      return;
    }
    if (!tornKey.trim()) {
      setError("Enter your Torn API key before scanning.");
      return;
    }

    setIsScanning(true);
    setError(null);

    try {
      const response = await scanTradeSearch(currentSearch, tornKey.trim());
      setSnapshots(response.snapshots ?? []);
      setOpportunities(response.opportunities);
      await refreshWatchlists(selectedWatchlistId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshWatchlists(selectedWatchlistId);
      await loadLatestForSearch(currentSearch);
    } finally {
      setIsScanning(false);
    }
  }

  async function refreshItem(itemId: number) {
    if (!currentSearch) {
      setError("Add at least one valid Torn item ID before refreshing an item.");
      return;
    }
    if (!tornKey.trim()) {
      setError("Enter your Torn API key before refreshing an item.");
      return;
    }

    setIsScanning(true);
    setError(null);
    try {
      const response = await scanTradeSearch(currentSearch, tornKey.trim(), itemId);
      setSnapshots(response.snapshots ?? []);
      setOpportunities(response.opportunities);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadLatestForSearch(currentSearch);
    } finally {
      setIsScanning(false);
    }
  }

  function exportCsv() {
    if (filteredOpportunities.length === 0) {
      return;
    }

    downloadCsv(
      `${sanitizeCsvFilename(form.name.trim() || "trade-search")}-trade-scout.csv`,
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
      `Buy: ${formatMoney(opportunity.listing_price)}`,
      `Reference: ${formatMoney(opportunity.resale_price)}`,
      `Profit: ${formatMoney(opportunity.profit)} (${formatPercent(opportunity.roi_percent)})`,
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
          <p>Shared search templates with member-run item refreshes and reusable market snapshots.</p>
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
            value={formatMoney(bestProfit)}
            detail={form.name.trim() || "-"}
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
            title="Search templates"
            aside={isLoading ? "Loading" : `${watchlists.length}`}
          />
          {watchlists.length === 0 ? (
            <EmptyState text={isLoading ? "Loading search templates" : "No search templates yet"} />
          ) : (
            <div className="trade-scout-watchlist-list">
              {watchlists.map((watchlist) => (
                <button
                  key={watchlist.id}
                  type="button"
                  className={watchlist.id === selectedWatchlistId ? "selected" : ""}
                  onClick={() => loadTemplate(watchlist)}
                >
                  <strong>{watchlist.name}</strong>
                  <span>
                    {watchlist.item_ids.length} items - {sourceLabel(watchlist.item_source)}
                  </span>
                  <small>{createdByLabel(watchlist)}</small>
                  <small>Updated {formatRelativeTime(watchlist.updated_at)}</small>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel trade-scout-action-panel">
            <PanelHeader
              title={form.name.trim() || "Current search"}
              aside={scanFreshness ? scanFreshness.label : "No item snapshots"}
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
                    disabled={!currentSearch || isScanning}
                  >
                    {isScanning ? <RefreshCw size={14} className="spinning-icon" /> : <Search size={14} />}
                    {isScanning ? "Refreshing" : "Refresh all"}
                  </button>
                </div>
              }
            />
            {currentSearch ? (
              <div className="trade-scout-selected-meta">
                <span>{currentSearch.item_ids.join(", ")}</span>
                <span>{sourceLabel(currentSearch.item_source)}</span>
                <span>Min profit {formatMoney(currentSearch.min_profit)}</span>
                <span>Min ROI {currentSearch.min_roi_percent}%</span>
                <span>{selectedWatchlist ? createdByLabel(selectedWatchlist) : "Unsaved search"}</span>
                {scanFreshness ? <span className={`trade-scout-freshness ${scanFreshness.tone}`}>{scanFreshness.label}</span> : null}
              </div>
            ) : (
              <EmptyState text="Load a template or enter item IDs to start" />
            )}
          </section>

        <section className="panel trade-scout-form-panel">
            <PanelHeader
              title={editingId ? "Edit search template" : "Current search"}
              aside={editingId ? "Admin edit" : selectedWatchlist ? "Loaded template" : "Unsaved"}
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
                  {isSaving ? "Saving" : editingId ? "Save" : "Save search template"}
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
            {snapshots.length === 0 ? (
              <EmptyState
                text={
                  isLoadingOpportunities
                    ? "Loading opportunities"
                    : "Refresh the current search to populate item snapshots"
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
                          <span>{itemSnapshotLabel(snapshotByItem.get(group.itemId))}</span>
                        </div>
                        <div className="trade-opportunity-item-actions">
                          <small>{formatNumber(group.opportunities.length)} opportunities</small>
                          <button type="button" onClick={() => refreshItem(group.itemId)} disabled={isScanning}>
                            <RefreshCw size={13} className={isScanning ? "spinning-icon" : undefined} />
                            Refresh item
                          </button>
                        </div>
                      </div>
                      <OpportunityTable
                        opportunities={group.opportunities}
                        search={currentSearch}
                        snapshotByItem={snapshotByItem}
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
                          <small>{itemSnapshotLabel(snapshotByItem.get(item.id))}</small>
                          <button type="button" onClick={() => refreshItem(item.id)} disabled={isScanning}>
                            <RefreshCw size={12} className={isScanning ? "spinning-icon" : undefined} />
                          </button>
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
  search,
  snapshotByItem,
  copiedOpportunityId,
  onCopyOpportunity,
}: {
  opportunities: TradeOpportunity[];
  search: TradeWatchlistPayload | null;
  snapshotByItem: Map<number, TradeItemSnapshotSummary>;
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
            const quality = opportunityQuality(opportunity, search, snapshotByItem.get(opportunity.item_id) ?? null);
            return (
              <tr key={opportunity.id}>
                <td>{sellerCell(opportunity)}</td>
                <td>{formatMoney(opportunity.listing_price)}</td>
                <td>
                  <strong>{formatMoney(opportunity.resale_price)}</strong>
                  <small>{opportunity.reference_label ?? "-"}</small>
                  <small>{search ? `Fee model ${search.market_fee_percent}%` : "Fee model -"}</small>
                </td>
                <td className={opportunity.profit >= 0 ? "positive" : "negative"}>
                  {formatMoney(opportunity.profit)}
                </td>
                <td>{formatNumber(opportunity.quantity)}</td>
                <td className={opportunity.bulk_profit >= 0 ? "positive" : "negative"}>
                  {formatMoney(opportunity.bulk_profit)}
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
