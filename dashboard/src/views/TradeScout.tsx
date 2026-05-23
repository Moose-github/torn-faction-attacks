import React from "react";
import {
  Download,
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
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingOpportunities, setIsLoadingOpportunities] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const selectedWatchlist = watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null;
  const profitableCount = opportunities.filter((opportunity) => opportunity.profit > 0).length;
  const bestProfit = opportunities[0]?.profit ?? 0;
  const bulkCount = opportunities.filter((opportunity) => opportunity.bulk_profit > opportunity.profit).length;

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

  function startEdit(watchlist: TradeWatchlist) {
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
    if (!selectedWatchlist || opportunities.length === 0) {
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
      opportunities,
    );
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Trade scout</p>
          <h2>Trade scout</h2>
          <p>Shared item watchlists with member-run scans and saved opportunity snapshots.</p>
        </div>
      </section>

      <section className="trade-scout-layout">
        <div className="trade-scout-sidebar">
          <section className="panel trade-scout-key-panel">
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
        </div>

        <div className="trade-scout-main">
          <section className="trade-scout-summary-grid">
            <MetricCard
              icon={<Search size={16} />}
              label="Opportunities"
              value={formatNumber(opportunities.length)}
              detail={`${profitableCount} profitable`}
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
              detail={snapshot ? formatRelativeTime(snapshot.scanned_at) : "No scan"}
            />
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
                    disabled={opportunities.length === 0}
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
              </div>
            ) : (
              <EmptyState text="Select or create a watchlist" />
            )}
            {snapshot?.error ? <p className="form-error">{snapshot.error}</p> : null}
          </section>

          {isAdmin ? (
            <section className="panel trade-scout-form-panel">
              <PanelHeader
                title={editingId ? "Edit watchlist" : "New watchlist"}
                aside={editingId ? "Admin" : "Shared"}
                control={editingId ? (
                  <button type="button" className="panel-action-button" onClick={cancelEdit}>
                    <X size={14} />
                    Cancel
                  </button>
                ) : null}
              />
              <form className="trade-scout-form" onSubmit={saveWatchlist}>
                <label>
                  <span>Name</span>
                  <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
                </label>
                <label className="trade-scout-items-field">
                  <span>Item IDs</span>
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
                    <option value="weav3r">Weav3r</option>
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
                    {isSaving ? "Saving" : editingId ? "Save" : "Create"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="panel table-panel">
            <PanelHeader
              title="Latest opportunities"
              aside={isLoadingOpportunities ? "Loading" : `${opportunities.length}`}
            />
            {opportunities.length === 0 ? (
              <EmptyState
                text={
                  isLoadingOpportunities
                    ? "Loading opportunities"
                    : snapshot
                      ? "No opportunities matched this watchlist"
                      : "Run a scan to populate this watchlist"
                }
              />
            ) : (
              <div className="table-scroll">
                <table className="trade-scout-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Source</th>
                      <th>Buy</th>
                      <th>Reference</th>
                      <th>Unit profit</th>
                      <th>Quantity</th>
                      <th>Bulk profit</th>
                      <th>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((opportunity) => (
                      <tr key={opportunity.id}>
                        <td>
                          <strong>{opportunity.item_name ?? `Item ${opportunity.item_id}`}</strong>
                          <small>{opportunity.item_id}</small>
                        </td>
                        <td>{sellerCell(opportunity)}</td>
                        <td>{money(opportunity.listing_price)}</td>
                        <td>
                          <strong>{money(opportunity.resale_price)}</strong>
                          <small>{opportunity.reference_label ?? "-"}</small>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
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

function sourceLabel(source: TradeItemSource): string {
  switch (source) {
    case "weav3r":
      return "Weav3r";
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
        href={`https://www.torn.com/bazaar.php?userId=${encodeURIComponent(String(opportunity.seller_id))}#/`}
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
