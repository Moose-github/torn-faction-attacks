import React from "react";
import { BadgeDollarSign, CircleDollarSign, RefreshCw, RotateCcw, Save, Settings, SlidersHorizontal } from "lucide-react";
import {
  autoRefreshStockBenefitItemPrices,
  getStockBenefitValues,
  getStockInvestmentRoi,
  refreshStockBenefitItemPrices,
  StockBenefitValue,
  StockInvestmentRoiResponse,
  StockInvestmentRoiRow,
  updateStockBenefitValue,
} from "../api";
import { getStoredAuthSession } from "../api/client";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";
import {
  ownedSharesMap,
  ownsStockIncrement,
  OwnedStockSnapshot,
  parseOwnedStocksResponse,
  parseStoredOwnedStockSnapshot,
} from "../utils/ownedStocks";

const TORN_OWNED_STOCKS_URL = "https://api.torn.com/v2/user/stocks";
const DEFAULT_MINIMUM_ROI = "5";

type StockRoiSortKey = "acronym" | "name" | "shares" | "increment_cost" | "benefit" | "annual_return" | "days_to_break_even" | "roi_percent";

type SortDirection = "asc" | "desc";

type StockRoiSort = {
  key: StockRoiSortKey;
  direction: SortDirection;
};

export function StockInvestments() {
  const storageUserId = React.useMemo(() => getStoredAuthSession()?.user.id ?? null, []);
  const [roiData, setRoiData] = React.useState<StockInvestmentRoiResponse | null>(null);
  const [benefits, setBenefits] = React.useState<StockBenefitValue[]>([]);
  const [benefitInputs, setBenefitInputs] = React.useState<Record<string, string>>({});
  const [investmentAmount, setInvestmentAmount] = React.useState("");
  const [affordableOnly, setAffordableOnly] = React.useState(false);
  const [minimumRoi, setMinimumRoi] = React.useState(DEFAULT_MINIMUM_ROI);
  const [hideOwnedBlocks, setHideOwnedBlocks] = React.useState(false);
  const [roiSort, setRoiSort] = React.useState<StockRoiSort>({ key: "roi_percent", direction: "desc" });
  const [isMissingValuesOpen, setIsMissingValuesOpen] = React.useState(false);
  const [ownedApiKey, setOwnedApiKey] = React.useState("");
  const [ownedSnapshot, setOwnedSnapshot] = React.useState<OwnedStockSnapshot | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshingBenefitPrices, setIsRefreshingBenefitPrices] = React.useState(false);
  const [isRefreshingOwnedStocks, setIsRefreshingOwnedStocks] = React.useState(false);
  const [savingBenefitKey, setSavingBenefitKey] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      await autoRefreshBenefitPrices();
      const [roi, benefitValues] = await Promise.all([
        getStockInvestmentRoi(),
        getStockBenefitValues(),
      ]);
      setRoiData(roi);
      setBenefits(benefitValues.benefits);
      setBenefitInputs(inputsFromBenefits(benefitValues.benefits));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRoiData(null);
      setBenefits([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function autoRefreshBenefitPrices() {
    try {
      await autoRefreshStockBenefitItemPrices();
    } catch (err) {
      console.warn("Stock benefit item price auto-refresh failed:", err);
    }
  }

  async function saveBenefit(benefit: StockBenefitValue) {
    const parsed = moneyInputValue(benefitInputs[benefit.benefit_key] ?? "");
    if (parsed === null) {
      setError("Enter a positive benefit value before saving.");
      return;
    }

    setSavingBenefitKey(benefit.benefit_key);
    setError(null);
    setMessage(null);
    try {
      const nextBenefits = await updateStockBenefitValue(benefit.benefit_key, parsed);
      const nextRoi = await getStockInvestmentRoi();
      setBenefits(nextBenefits.benefits);
      setBenefitInputs(inputsFromBenefits(nextBenefits.benefits));
      setRoiData(nextRoi);
      setMessage(`${benefit.label} value saved`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingBenefitKey(null);
    }
  }

  async function resetBenefit(benefit: StockBenefitValue) {
    setSavingBenefitKey(benefit.benefit_key);
    setError(null);
    setMessage(null);
    try {
      const nextBenefits = await updateStockBenefitValue(benefit.benefit_key, null);
      const nextRoi = await getStockInvestmentRoi();
      setBenefits(nextBenefits.benefits);
      setBenefitInputs(inputsFromBenefits(nextBenefits.benefits));
      setRoiData(nextRoi);
      setMessage(`${benefit.label} value reset`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingBenefitKey(null);
    }
  }

  async function refreshBenefitPrices() {
    setIsRefreshingBenefitPrices(true);
    setError(null);
    setMessage(null);
    try {
      const result = await refreshStockBenefitItemPrices();
      const [roi, benefitValues] = await Promise.all([
        getStockInvestmentRoi(),
        getStockBenefitValues(),
      ]);
      setRoiData(roi);
      setBenefits(benefitValues.benefits);
      setBenefitInputs(inputsFromBenefits(benefitValues.benefits));
      setMessage(`Benefit prices refreshed: ${formatNumber(result.refreshed)} updated, ${formatNumber(result.skipped)} unchanged`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingBenefitPrices(false);
    }
  }

  async function refreshOwnedStocks() {
    const trimmedKey = ownedApiKey.trim();
    if (!trimmedKey) {
      setError("Enter a Limited Torn API key before refreshing owned stocks.");
      return;
    }

    setIsRefreshingOwnedStocks(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${TORN_OWNED_STOCKS_URL}?key=${encodeURIComponent(trimmedKey)}`, {
        headers: { Accept: "application/json" },
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error("Torn owned stocks response was not valid.");
      }
      const snapshot = parseOwnedStocksResponse(data, Math.floor(Date.now() / 1000));
      if (!response.ok) {
        throw new Error("Could not fetch owned stocks directly from Torn. No server proxy is used for Limited keys.");
      }

      setOwnedSnapshot(snapshot);
      saveOwnedStocksStorage(storageUserId, trimmedKey, snapshot);
      setMessage(`Owned stocks loaded: ${formatNumber(snapshot.stocks.length)} stocks`);
    } catch (err) {
      const message = err instanceof TypeError
        ? "Could not fetch owned stocks directly from Torn. No server proxy is used for Limited keys."
        : err instanceof Error
          ? err.message
          : String(err);
      setError(message);
    } finally {
      setIsRefreshingOwnedStocks(false);
    }
  }

  function clearOwnedStocks() {
    setOwnedApiKey("");
    setOwnedSnapshot(null);
    setHideOwnedBlocks(false);
    clearOwnedStocksStorage(storageUserId);
    setError(null);
    setMessage("Owned stock highlights cleared");
  }

  React.useEffect(() => {
    const stored = readOwnedStocksStorage(storageUserId);
    setOwnedApiKey(stored.apiKey);
    setOwnedSnapshot(stored.snapshot);
    loadData();
  }, []);

  const ownedShares = React.useMemo(() => ownedSharesMap(ownedSnapshot), [ownedSnapshot]);
  const ownedStockCount = ownedSnapshot?.stocks.filter((stock) => stock.shares > 0).length ?? 0;
  const ownedCoveredBlockCount = (roiData?.rows ?? []).filter((row) => ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required)).length;
  const budget = moneyInputValue(investmentAmount);
  const minRoi = percentInputValue(minimumRoi);
  const filteredRows = (roiData?.rows ?? []).filter((row) => {
    if (affordableOnly && budget !== null && row.increment_cost > budget) {
      return false;
    }
    if (minRoi !== null && row.roi_percent < minRoi) {
      return false;
    }
    if (hideOwnedBlocks && ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required)) {
      return false;
    }
    return true;
  });
  const rows = sortStockRoiRows(filteredRows, roiSort);
  const bestRow = React.useMemo(
    () => filteredRows.find((row) => !ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required)) ?? null,
    [filteredRows, ownedShares],
  );
  const bestRowOwnedShares = bestRow ? ownedShares.get(bestRow.stock_id) ?? 0 : 0;
  const bestRowSharesRemaining = bestRow ? Math.max(0, bestRow.total_shares_required - bestRowOwnedShares) : 0;
  const totalPricedRows = roiData?.rows.length ?? 0;
  const missingValueCount = roiData?.skipped.unpriced ?? 0;
  const manualBenefits = benefits.filter((benefit) => benefit.default_value === null);
  const stockPricesRefreshedAt = roiData?.refreshed_at ?? null;
  const benefitValuesRefreshedAt = roiData?.benefit_prices_refreshed_at ?? null;
  const filtersActive = investmentAmount.trim() !== "" || minimumRoi.trim() !== DEFAULT_MINIMUM_ROI || affordableOnly || hideOwnedBlocks;

  function updateRoiSort(key: StockRoiSortKey) {
    setRoiSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: defaultSortDirection(key) });
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      {message ? <div className="dashboard-suggestion-success">{message}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Stocks</p>
          <h2>Stock ROI</h2>
          <p>Active benefit increments priced from current shares and your benefit values.</p>
        </div>
        <button type="button" className="panel-action-button" disabled={isLoading} onClick={loadData}>
          <RefreshCw size={14} className={isLoading ? "spinning-icon" : ""} />
          {isLoading ? "Refreshing" : "Refresh"}
        </button>
      </section>

      <section className="status-grid stock-status-grid stock-investment-status-grid">
        <StatusMetric
          className="stock-best-block-card"
          label="Best next block"
          value={bestRow ? `${bestRow.acronym ?? `#${bestRow.stock_id}`} Block ${bestRow.increment}` : "-"}
          detail={bestRow
            ? (
              <span className="stock-metric-detail-stack">
                <span>{formatPercent(bestRow.roi_percent)} ROI - {formatMoney(bestRow.increment_cost)} next cost</span>
                <span>{bestRowOwnedShares > 0 ? `Need ${formatNumber(bestRowSharesRemaining)} more shares` : `${formatNumber(bestRow.total_shares_required)} shares required`}</span>
              </span>
            )
            : rows.length > 0
              ? "All shown blocks already covered"
              : "No priced rows"}
        />
        <StatusMetric
          label="Stock prices"
          value={formatRelativeTime(stockPricesRefreshedAt)}
          detail={stockPricesRefreshedAt ? formatLongDateTime(stockPricesRefreshedAt) : "No stock snapshot yet"}
        />
        <MissingValuesMetric
          missingValueCount={missingValueCount}
          benefits={manualBenefits}
          inputs={benefitInputs}
          isOpen={isMissingValuesOpen}
          savingBenefitKey={savingBenefitKey}
          onToggle={() => setIsMissingValuesOpen((current) => !current)}
          onOpen={() => setIsMissingValuesOpen(true)}
          onClose={() => setIsMissingValuesOpen(false)}
          onInputChange={(benefitKey, value) => setBenefitInputs((current) => ({ ...current, [benefitKey]: value }))}
          onSave={saveBenefit}
          onReset={resetBenefit}
        />
        <StatusMetric
          label="Benefit values"
          value={formatRelativeTime(benefitValuesRefreshedAt)}
          detail={benefitValuesRefreshedAt ? formatLongDateTime(benefitValuesRefreshedAt) : "No market refresh yet"}
        />
      </section>

      <section className="panel stock-investment-controls-panel">
        <PanelHeader
          title="Find blocks"
          aside={filtersActive ? "Filtered" : "All increments"}
          icon={<SlidersHorizontal size={18} />}
        />
        <div className="stock-filter-stack">
          <div className="stock-filter-section-heading">
            <strong>Block filters</strong>
            <span>{filtersActive ? `${formatNumber(rows.length)} matching blocks` : "Default minimum ROI applied"}</span>
          </div>
          <div className="stock-investment-controls">
            <label>
              <span>Investment amount</span>
              <input
                inputMode="numeric"
                value={investmentAmount}
                onChange={(event) => setInvestmentAmount(event.target.value)}
                placeholder="Optional budget"
              />
            </label>
            <label>
              <span>Minimum ROI %</span>
              <input
                inputMode="decimal"
                value={minimumRoi}
                onChange={(event) => setMinimumRoi(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="stock-investment-toggle-row">
              <input
                type="checkbox"
                checked={affordableOnly}
                onChange={(event) => setAffordableOnly(event.target.checked)}
              />
              <span>Show affordable only</span>
            </label>
            <button
              type="button"
              className="panel-action-button secondary stock-investment-clear-button"
              disabled={!filtersActive}
              onClick={() => {
                setInvestmentAmount("");
                setMinimumRoi(DEFAULT_MINIMUM_ROI);
                setAffordableOnly(false);
                setHideOwnedBlocks(false);
              }}
            >
              <RotateCcw size={14} />
              Clear filters
            </button>
          </div>
        </div>
        <div className="stock-owned-controls">
          <div className="stock-owned-controls-heading">
            <strong>Owned stock highlighting</strong>
            <span>{ownedSnapshot ? "Local snapshot loaded" : "No owned stocks loaded"}</span>
          </div>
          {ownedSnapshot ? (
            <div className="stock-owned-summary" aria-label="Owned stock snapshot summary">
              <span>
                <strong>{formatNumber(ownedStockCount)}</strong>
                <small>Stocks loaded</small>
              </span>
              <span>
                <strong>{formatNumber(ownedCoveredBlockCount)}</strong>
                <small>Active blocks covered</small>
              </span>
              <span>
                <strong>{formatRelativeTime(ownedSnapshot.refreshed_at)}</strong>
                <small>Snapshot age</small>
              </span>
            </div>
          ) : null}
          <div className="stock-owned-controls-grid">
            <label>
              <span>Limited API key</span>
              <input
                type="password"
                value={ownedApiKey}
                onChange={(event) => setOwnedApiKey(event.target.value)}
                placeholder="Paste Limited key"
                autoComplete="off"
              />
              <small className="stock-owned-key-note">
                Stored only in this browser. Never sent to our server; used only for the direct Torn owned-stocks request.
              </small>
            </label>
            <button
              type="button"
              className="panel-action-button secondary"
              disabled={isRefreshingOwnedStocks}
              onClick={refreshOwnedStocks}
            >
              <RefreshCw size={14} className={isRefreshingOwnedStocks ? "spinning-icon" : ""} />
              {isRefreshingOwnedStocks ? "Refreshing" : "Refresh owned stocks"}
            </button>
            <button
              type="button"
              className="panel-action-button secondary"
              disabled={!ownedApiKey && !ownedSnapshot}
              onClick={clearOwnedStocks}
            >
              <RotateCcw size={14} />
              Clear
            </button>
            <label className="stock-owned-hide-toggle">
              <input
                type="checkbox"
                checked={hideOwnedBlocks}
                onChange={(event) => setHideOwnedBlocks(event.target.checked)}
              />
              <span>Hide owned blocks</span>
            </label>
          </div>
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Active benefit increments" aside={`${formatNumber(rows.length)} shown / ${formatNumber(totalPricedRows)} total`} icon={<BadgeDollarSign size={18} />} />
        {isLoading ? (
          <EmptyState text="Loading stock ROI" />
        ) : rows.length === 0 ? (
          <EmptyState text="No stock increments match the current filters" />
        ) : (
          <StockRoiTable rows={rows} ownedShares={ownedShares} sort={roiSort} onSort={updateRoiSort} />
        )}
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Benefit values"
          icon={<CircleDollarSign size={18} />}
          control={(
            <div className="stock-benefit-panel-actions">
              <span>{formatNumber(benefits.length)} editable</span>
              <button
                type="button"
                className="panel-action-button secondary"
                disabled={isLoading || isRefreshingBenefitPrices}
                onClick={refreshBenefitPrices}
              >
                <RefreshCw size={14} className={isRefreshingBenefitPrices ? "spinning-icon" : ""} />
                {isRefreshingBenefitPrices ? "Force refreshing" : "Force refresh"}
              </button>
            </div>
          )}
        />
        {isLoading ? (
          <EmptyState text="Loading benefit values" />
        ) : benefits.length === 0 ? (
          <EmptyState text="No editable active benefits found" />
        ) : (
          <BenefitValuesTable
            benefits={benefits}
            inputs={benefitInputs}
            savingBenefitKey={savingBenefitKey}
            onInputChange={(benefitKey, value) => setBenefitInputs((current) => ({ ...current, [benefitKey]: value }))}
            onSave={saveBenefit}
            onReset={resetBenefit}
          />
        )}
      </section>
    </>
  );
}

function StockRoiTable({
  rows,
  ownedShares,
  sort,
  onSort,
}: {
  rows: StockInvestmentRoiRow[];
  ownedShares: Map<number, number>;
  sort: StockRoiSort;
  onSort: (key: StockRoiSortKey) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table stock-investment-table">
        <thead>
          <tr>
            <SortableHeader label="Acronym" sortKey="acronym" sort={sort} onSort={onSort} />
            <SortableHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
            <SortableHeader label="Shares" sortKey="shares" sort={sort} onSort={onSort} />
            <SortableHeader label="Increment Cost" sortKey="increment_cost" sort={sort} onSort={onSort} />
            <SortableHeader label="Benefit" sortKey="benefit" sort={sort} onSort={onSort} />
            <SortableHeader label="Annual Return" sortKey="annual_return" sort={sort} onSort={onSort} />
            <SortableHeader label="Break Even" sortKey="days_to_break_even" sort={sort} onSort={onSort} />
            <SortableHeader label="ROI" sortKey="roi_percent" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const owned = ownedShares.get(row.stock_id) ?? 0;
            const ownsIncrement = ownsStockIncrement(owned, row.total_shares_required);
            return (
              <tr key={`${row.stock_id}-${row.increment}`} className={ownsIncrement ? "stock-owned-increment-row" : undefined}>
                <td>
                  <span className="stock-symbol-chip">{row.acronym ?? `#${row.stock_id}`}</span>
                </td>
                <td>
                  <span className="stock-benefit-cell">
                    <strong>{row.name ?? "-"}</strong>
                    <small>Block {row.increment}</small>
                  </span>
                </td>
                <td>
                  <span className="stock-benefit-cell stock-shares-cell">
                    <strong>
                      {row.increment === 1 ? (
                        formatNumber(row.required_shares)
                      ) : (
                        <span className="stock-tooltip-value" title={`Total shares needed for this increment: ${formatNumber(row.total_shares_required)}`}>
                          {formatNumber(row.required_shares)}
                        </span>
                      )}
                    </strong>
                    {owned > 0 ? <small>Owned: {formatNumber(owned)}</small> : null}
                  </span>
                </td>
                <td>
                  {row.increment === 1 ? (
                    formatMoney(row.increment_cost)
                  ) : (
                    <span className="stock-tooltip-value" title={`Total cost through this increment: ${formatMoney(row.total_cost)}`}>
                      {formatMoney(row.increment_cost)}
                    </span>
                  )}
                </td>
                <td>
                  <span className="stock-benefit-cell">
                    <strong>{row.benefit_description}</strong>
                    <small>{formatNumber(row.frequency_days)} days - {valuationSourceLabel(row.valuation_source)} value</small>
                  </span>
                </td>
                <td>{formatMoney(row.annual_return)}</td>
                <td>{formatNumber(Math.round(row.days_to_break_even))} days</td>
                <td>
                  <span className={`stock-roi-chip ${roiTone(row.roi_percent)}`}>{formatPercent(row.roi_percent)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: StockRoiSortKey;
  sort: StockRoiSort;
  onSort: (key: StockRoiSortKey) => void;
}) {
  const isActive = sort.key === sortKey;
  return (
    <th aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`sort-button stock-roi-sort-button${isActive ? " active" : ""}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {isActive ? <span className="stock-sort-indicator" aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function BenefitValuesTable({
  benefits,
  inputs,
  savingBenefitKey,
  onInputChange,
  onSave,
  onReset,
}: {
  benefits: StockBenefitValue[];
  inputs: Record<string, string>;
  savingBenefitKey: string | null;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
}) {
  const pricedBenefits = benefits.filter((benefit) => benefit.default_value !== null);
  const manualBenefits = benefits.filter((benefit) => benefit.default_value === null);

  return (
    <div className="stock-benefit-table-stack">
      {pricedBenefits.length > 0 ? (
        <BenefitValuesSection
          title="Priced values"
          aside={`${formatNumber(pricedBenefits.length)} default-backed`}
          benefits={pricedBenefits}
          inputs={inputs}
          savingBenefitKey={savingBenefitKey}
          onInputChange={onInputChange}
          onSave={onSave}
          onReset={onReset}
        />
      ) : null}
      {manualBenefits.length > 0 ? (
        <BenefitValuesSection
          id="stock-benefit-manual-values"
          title="Manual values"
          aside={`${formatNumber(manualBenefits.length)} manual-only`}
          benefits={manualBenefits}
          inputs={inputs}
          savingBenefitKey={savingBenefitKey}
          onInputChange={onInputChange}
          onSave={onSave}
          onReset={onReset}
        />
      ) : null}
    </div>
  );
}

function BenefitValuesSection({
  id,
  title,
  aside,
  benefits,
  inputs,
  savingBenefitKey,
  onInputChange,
  onSave,
  onReset,
}: {
  id?: string;
  title: string;
  aside: string;
  benefits: StockBenefitValue[];
  inputs: Record<string, string>;
  savingBenefitKey: string | null;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
}) {
  return (
    <div id={id} className="stock-benefit-table-section">
      <div className="stock-benefit-table-title">
        <strong>{title}</strong>
        <span>{aside}</span>
      </div>
      <div className="table-scroll stock-benefit-table-frame">
        <table className="stock-status-table stock-benefit-values-table">
          <thead>
            <tr>
              <th>Benefit</th>
              <th>Default</th>
              <th>Custom</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {benefits.map((benefit) => (
              <BenefitValueRow
                key={benefit.benefit_key}
                benefit={benefit}
                inputValue={inputs[benefit.benefit_key] ?? ""}
                isSaving={savingBenefitKey === benefit.benefit_key}
                onInputChange={onInputChange}
                onSave={onSave}
                onReset={onReset}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BenefitValueRow({
  benefit,
  inputValue,
  isSaving,
  onInputChange,
  onSave,
  onReset,
}: {
  benefit: StockBenefitValue;
  inputValue: string;
  isSaving: boolean;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
}) {
  const canSave = moneyInputValue(inputValue) !== null;
  const hasCustomValue = benefit.override_value !== null;
  const parsedInput = moneyInputValue(inputValue);
  const isChanged = parsedInput !== null && parsedInput !== benefit.effective_value;
  return (
    <tr>
      <td>
        <span className="stock-benefit-cell">
          <strong>{benefit.label}</strong>
          <small>{benefit.benefit_key}</small>
        </span>
      </td>
      <td>
        <span className="stock-money-cell">{formatMoney(benefit.default_value)}</span>
      </td>
      <td>
        <input
          className="stock-benefit-value-input"
          inputMode="numeric"
          value={inputValue}
          onChange={(event) => onInputChange(benefit.benefit_key, event.target.value)}
          placeholder={benefit.default_value === null ? "Set value" : "Custom value"}
        />
      </td>
      <td>
        <span className={`stock-source-chip ${benefit.source}`}>{statusLabel(benefit.source)}</span>
      </td>
      <td>
        <div className="stock-benefit-actions">
          <button
            type="button"
            className="panel-action-button secondary"
            disabled={isSaving || !canSave || !isChanged}
            onClick={() => onSave(benefit)}
          >
            {isSaving ? <RefreshCw size={14} className="spinning-icon" /> : <Save size={14} />}
            Save
          </button>
          <button
            type="button"
            className="panel-action-button secondary"
            disabled={isSaving || !hasCustomValue}
            onClick={() => onReset(benefit)}
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </td>
    </tr>
  );
}

function MissingValuesMetric({
  missingValueCount,
  benefits,
  inputs,
  isOpen,
  savingBenefitKey,
  onToggle,
  onOpen,
  onClose,
  onInputChange,
  onSave,
  onReset,
}: {
  missingValueCount: number;
  benefits: StockBenefitValue[];
  inputs: Record<string, string>;
  isOpen: boolean;
  savingBenefitKey: string | null;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
}) {
  return (
    <div className="metric-card stock-missing-values-card stock-clickable-metric" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onOpen();
      }
    }}>
      <div className="stock-missing-values-heading">
        <span className="panel-kicker">Missing values</span>
        <button
          type="button"
          className="stock-missing-values-gear"
          aria-expanded={isOpen}
          aria-label="Edit missing benefit values"
          title="Edit missing benefit values"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Settings size={15} />
        </button>
      </div>
      <strong className="metric-card-value">{formatNumber(missingValueCount)}</strong>
      <span className="metric-card-detail">{missingValueCount > 0 ? "Add manual values to unlock more blocks" : "All active benefits are priced"}</span>
      {isOpen ? (
        <div className="stock-missing-values-popout" role="dialog" aria-label="Missing benefit values" onClick={(event) => event.stopPropagation()}>
          <div className="stock-missing-values-popout-heading">
            <strong>Manual values</strong>
            <button type="button" className="stock-text-button" onClick={onClose}>Close</button>
          </div>
          {benefits.length === 0 ? (
            <p>No manual benefit values are available.</p>
          ) : (
            <div className="stock-missing-values-list">
              {benefits.map((benefit) => (
                <MissingValueEditorRow
                  key={benefit.benefit_key}
                  benefit={benefit}
                  inputValue={inputs[benefit.benefit_key] ?? ""}
                  isSaving={savingBenefitKey === benefit.benefit_key}
                  onInputChange={onInputChange}
                  onSave={onSave}
                  onReset={onReset}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MissingValueEditorRow({
  benefit,
  inputValue,
  isSaving,
  onInputChange,
  onSave,
  onReset,
}: {
  benefit: StockBenefitValue;
  inputValue: string;
  isSaving: boolean;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
}) {
  const parsedInput = moneyInputValue(inputValue);
  const canSave = parsedInput !== null;
  const hasCustomValue = benefit.override_value !== null;
  const isChanged = parsedInput !== null && parsedInput !== benefit.effective_value;
  return (
    <div className="stock-missing-value-row">
      <label>
        <span>{benefit.label}</span>
        <input
          inputMode="numeric"
          value={inputValue}
          onChange={(event) => onInputChange(benefit.benefit_key, event.target.value)}
          placeholder="Set value"
        />
      </label>
      <div className="stock-missing-value-actions">
        <button
          type="button"
          className="panel-action-button secondary"
          disabled={isSaving || !canSave || !isChanged}
          onClick={() => onSave(benefit)}
        >
          {isSaving ? <RefreshCw size={14} className="spinning-icon" /> : <Save size={14} />}
          Save
        </button>
        <button
          type="button"
          className="panel-action-button secondary"
          disabled={isSaving || !hasCustomValue}
          onClick={() => onReset(benefit)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
}

function StatusMetric({
  label,
  value,
  detail,
  className,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="panel-kicker">{label}</span>
      <strong className="metric-card-value">{value}</strong>
      <span className="metric-card-detail">{detail}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={`metric-card stock-clickable-metric${className ? ` ${className}` : ""}`} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className={`metric-card${className ? ` ${className}` : ""}`}>
      {content}
    </div>
  );
}

function sortStockRoiRows(rows: StockInvestmentRoiRow[], sort: StockRoiSort): StockInvestmentRoiRow[] {
  return [...rows].sort((a, b) => {
    const compared = compareStockRoiRows(a, b, sort.key);
    if (compared !== 0) {
      return sort.direction === "asc" ? compared : -compared;
    }
    if (a.stock_id !== b.stock_id) {
      return a.stock_id - b.stock_id;
    }
    return a.increment - b.increment;
  });
}

function compareStockRoiRows(a: StockInvestmentRoiRow, b: StockInvestmentRoiRow, key: StockRoiSortKey): number {
  switch (key) {
    case "acronym":
      return compareText(a.acronym ?? `#${a.stock_id}`, b.acronym ?? `#${b.stock_id}`);
    case "name":
      return compareText(`${a.name ?? ""} ${a.increment}`, `${b.name ?? ""} ${b.increment}`);
    case "shares":
      return a.required_shares - b.required_shares;
    case "increment_cost":
      return a.increment_cost - b.increment_cost;
    case "benefit":
      return compareText(a.benefit_description, b.benefit_description);
    case "annual_return":
      return a.annual_return - b.annual_return;
    case "days_to_break_even":
      return a.days_to_break_even - b.days_to_break_even;
    case "roi_percent":
      return a.roi_percent - b.roi_percent;
  }
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function defaultSortDirection(key: StockRoiSortKey): SortDirection {
  return key === "acronym" || key === "name" || key === "benefit" || key === "increment_cost" || key === "days_to_break_even" || key === "shares"
    ? "asc"
    : "desc";
}

function inputsFromBenefits(benefits: StockBenefitValue[]): Record<string, string> {
  return Object.fromEntries(benefits.map((benefit) => [
    benefit.benefit_key,
    String(Math.round(benefit.override_value ?? benefit.default_value ?? benefit.effective_value ?? 0) || ""),
  ]));
}

function readOwnedStocksStorage(userId: number | null): { apiKey: string; snapshot: OwnedStockSnapshot | null } {
  const keys = ownedStocksStorageKeys(userId);
  if (!keys) {
    return { apiKey: "", snapshot: null };
  }

  const apiKey = window.localStorage.getItem(keys.apiKey) ?? "";
  const rawSnapshot = window.localStorage.getItem(keys.snapshot);
  if (!rawSnapshot) {
    return { apiKey, snapshot: null };
  }

  try {
    return {
      apiKey,
      snapshot: parseStoredOwnedStockSnapshot(JSON.parse(rawSnapshot)),
    };
  } catch {
    window.localStorage.removeItem(keys.snapshot);
    return { apiKey, snapshot: null };
  }
}

function saveOwnedStocksStorage(userId: number | null, apiKey: string, snapshot: OwnedStockSnapshot): void {
  const keys = ownedStocksStorageKeys(userId);
  if (!keys) {
    return;
  }

  window.localStorage.setItem(keys.apiKey, apiKey);
  window.localStorage.setItem(keys.snapshot, JSON.stringify(snapshot));
}

function clearOwnedStocksStorage(userId: number | null): void {
  const keys = ownedStocksStorageKeys(userId);
  if (!keys) {
    return;
  }

  window.localStorage.removeItem(keys.apiKey);
  window.localStorage.removeItem(keys.snapshot);
}

function ownedStocksStorageKeys(userId: number | null): { apiKey: string; snapshot: string } | null {
  if (!userId) {
    return null;
  }

  return {
    apiKey: `stockRoiOwnedStocksKey:${userId}`,
    snapshot: `stockRoiOwnedStocksSnapshot:${userId}`,
  };
}

function moneyInputValue(value: string): number | null {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function percentInputValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/%/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `$${formatNumber(Math.round(value))}`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function valuationSourceLabel(value: string): string {
  if (value === "cash") return "Cash";
  return statusLabel(value);
}

function roiTone(value: number): "high" | "medium" | "low" {
  if (value >= 25) return "high";
  if (value >= 10) return "medium";
  return "low";
}
