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
  parseBankMeritsResponse,
  parseOwnedStocksResponse,
  parseStoredOwnedStockSnapshot,
} from "../utils/ownedStocks";
import {
  adjustCityBankRowForMerits,
  buildStockRebalanceRecommendations,
  buildStockStrategyPlan,
  DEFAULT_STOCK_STRATEGY_STEP_LIMIT,
  recommendBestStockBuy,
  type StockBuyRecommendation,
  type StockRebalanceRecommendation,
  type StockStrategyStep,
} from "../utils/stockRecommendations";

const TORN_OWNED_STOCKS_URL = "https://api.torn.com/v2/user/stocks";
const TORN_USER_MERITS_URL = "https://api.torn.com/v2/user/merits";
const DEFAULT_MINIMUM_ROI = "5";
const CITY_BANK_TERM_DAYS = 90;

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
  const [cityBankActive, setCityBankActive] = React.useState(false);
  const [bankMerits, setBankMerits] = React.useState(0);
  const [roiSort, setRoiSort] = React.useState<StockRoiSort>({ key: "roi_percent", direction: "desc" });
  const [isMissingValuesOpen, setIsMissingValuesOpen] = React.useState(false);
  const [isOwnedSettingsOpen, setIsOwnedSettingsOpen] = React.useState(false);
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
      const refreshedAt = Math.floor(Date.now() / 1000);
      const [snapshot, bankMeritResult] = await Promise.all([
        fetchOwnedStockSnapshot(trimmedKey, refreshedAt),
        fetchBankMerits(trimmedKey).catch((err) => {
          console.warn("Torn bank merits fetch failed:", err);
          return null;
        }),
      ]);

      setOwnedSnapshot(snapshot);
      saveOwnedStocksStorage(storageUserId, trimmedKey, snapshot);
      if (bankMeritResult !== null) {
        setBankMerits(bankMeritResult);
        saveCityBankStorage(storageUserId, cityBankActive, bankMeritResult);
      }
      setMessage(bankMeritResult === null
        ? `Owned stocks loaded: ${formatNumber(snapshot.stocks.length)} stocks. Bank merits were not found.`
        : `Owned stocks loaded: ${formatNumber(snapshot.stocks.length)} stocks; bank merits set to ${formatNumber(bankMeritResult)}.`);
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
    const storedCityBank = readCityBankStorage(storageUserId);
    setOwnedApiKey(stored.apiKey);
    setOwnedSnapshot(stored.snapshot);
    setCityBankActive(storedCityBank.active);
    setBankMerits(storedCityBank.merits);
    loadData();
  }, []);

  const ownedShares = React.useMemo(() => ownedSharesMap(ownedSnapshot), [ownedSnapshot]);
  const investmentRows = React.useMemo(
    () => (roiData?.rows ?? []).map((row) => adjustCityBankRowForMerits(row, bankMerits)),
    [roiData?.rows, bankMerits],
  );
  const ownedStockCount = ownedSnapshot?.stocks.filter((stock) => stock.shares > 0).length ?? 0;
  const ownedCoveredBlockCount = investmentRows.filter((row) => isStockInvestmentRow(row) && ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required ?? 0)).length;
  const budget = moneyInputValue(investmentAmount);
  const minRoi = percentInputValue(minimumRoi);
  const filteredRows = investmentRows.filter((row) => {
    if (affordableOnly && budget !== null && row.increment_cost > budget) {
      return false;
    }
    if (minRoi !== null && row.roi_percent < minRoi) {
      return false;
    }
    if (hideOwnedBlocks && isInvestmentRowCovered(row, ownedShares, cityBankActive)) {
      return false;
    }
    return true;
  });
  const rows = sortStockRoiRows(filteredRows, roiSort);
  const bestBuyRecommendation = React.useMemo(() => recommendBestStockBuy({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
  }), [investmentRows, ownedSnapshot, cityBankActive, budget, affordableOnly, minRoi]);
  const rebalanceRecommendations = React.useMemo(() => buildStockRebalanceRecommendations({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
  }, 5), [investmentRows, ownedSnapshot, cityBankActive, budget, affordableOnly, minRoi]);
  const strategyPlan = React.useMemo(() => buildStockStrategyPlan({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
  }, DEFAULT_STOCK_STRATEGY_STEP_LIMIT), [investmentRows, ownedSnapshot, cityBankActive, budget, affordableOnly, minRoi]);
  const totalPricedRows = investmentRows.length;
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
          label={ownedSnapshot ? "Best next buy" : "Best opportunity"}
          value={bestBuyRecommendation ? bestOpportunityTitle(bestBuyRecommendation.row) : "-"}
          detail={bestBuyRecommendation
            ? (
              <span className="stock-metric-detail-stack">
                <span>{formatPercent(bestBuyRecommendation.roi_percent)} ROI - {formatMoney(bestBuyRecommendation.estimated_cost)} estimated cost</span>
                <span>{bestBuyRecommendationDetail(bestBuyRecommendation, bankMerits)}</span>
                <span>Expected annual return: {formatMoney(bestBuyRecommendation.annual_return)}</span>
              </span>
            )
            : rows.length > 0
              ? ownedSnapshot ? "All eligible opportunities already covered" : "No eligible opportunity"
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

      <section className="panel stock-owned-status-panel">
        <PanelHeader
          title="Owned stock input/status"
          aside={ownedSnapshot ? `${formatNumber(ownedStockCount)} stocks loaded` : "Not loaded"}
          icon={<Settings size={18} />}
        />
        <div className="stock-owned-controls stock-owned-controls-standalone">
          <div className="stock-owned-controls-heading">
            <div>
              <strong>Portfolio snapshot</strong>
              <span>Browser-only Torn key and Bank settings</span>
            </div>
            <button
              type="button"
              className="panel-action-button secondary"
              aria-expanded={isOwnedSettingsOpen}
              onClick={() => setIsOwnedSettingsOpen((current) => !current)}
            >
              <Settings size={14} />
              Settings
            </button>
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
              <span>
                <strong>{cityBankActive ? "Active" : "Inactive"}</strong>
                <small>Bank: {formatNumber(bankMerits)}/10 merits</small>
              </span>
            </div>
          ) : (
            <p className="stock-owned-empty-note">Load owned stocks from the settings popout to personalize the strategy planner.</p>
          )}
          {isOwnedSettingsOpen ? (
            <div className="stock-owned-settings-popout" role="dialog" aria-label="Owned stock settings">
              <div className="stock-missing-values-popout-heading">
                <strong>Owned stock settings</strong>
                <button type="button" className="stock-text-button" onClick={() => setIsOwnedSettingsOpen(false)}>Close</button>
              </div>
              <div className="stock-owned-settings-section">
                <div className="stock-owned-settings-title">
                  <strong>Torn owned stocks</strong>
                  <span>Used only in this browser</span>
                </div>
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
                      Stored only in this browser. Never sent to our server; used only for direct Torn owned-stocks and merits requests.
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
                </div>
              </div>
              <div className="stock-owned-settings-section">
                <div className="stock-owned-settings-title">
                  <strong>City Bank comparison</strong>
                  <span>Used for the BANK row only</span>
                </div>
                <div className="stock-city-bank-controls">
                  <label className="stock-owned-hide-toggle">
                    <input
                      type="checkbox"
                      checked={cityBankActive}
                      onChange={(event) => {
                        const nextActive = event.target.checked;
                        setCityBankActive(nextActive);
                        saveCityBankStorage(storageUserId, nextActive, bankMerits);
                      }}
                    />
                    <span>City Bank investment active</span>
                  </label>
                  <label className="stock-city-bank-merits">
                    <span>Bank merits</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      step={1}
                      value={bankMerits}
                      onChange={(event) => {
                        const nextMerits = clampBankMerits(event.target.value);
                        setBankMerits(nextMerits);
                        saveCityBankStorage(storageUserId, cityBankActive, nextMerits);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel stock-next-buys-panel">
        <PanelHeader
          title="Investment strategy"
          aside={rebalanceRecommendations.length + strategyPlan.steps.length > 0 ? `${formatNumber(rebalanceRecommendations.length + strategyPlan.steps.length)} ideas` : "No ideas"}
          icon={<BadgeDollarSign size={18} />}
        />
        <div className="stock-suggested-layout">
          {ownedSnapshot ? (
            <div className="stock-suggested-section">
              <div className="stock-suggested-heading">
                <strong>Rebalance ideas</strong>
                <span>Sell one, buy one</span>
              </div>
              {rebalanceRecommendations.length === 0 ? (
                <EmptyState text="No clear rebalance upgrade found" />
              ) : (
                <div className="stock-rebalance-list">
                  {rebalanceRecommendations.map((recommendation) => (
                    <RebalanceRecommendationRow
                      key={`${recommendation.sell_stock_id}:${recommendation.proposed.row.row_id}`}
                      recommendation={recommendation}
                      bankMerits={bankMerits}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <div className="stock-suggested-section">
            <div className="stock-suggested-heading">
              <strong>Strategy path</strong>
              <span>ROI-first milestones</span>
            </div>
            {strategyPlan.steps.length === 0 ? (
              <EmptyState text="No strategy path matches the current filters" />
            ) : (
              <div className="stock-milestone-list">
                {strategyPlan.steps.map((step, index) => (
                  <StrategyStepRow
                    key={`${index}:${step.kind}:${step.recommendation.row.row_id}`}
                    step={step}
                    index={index}
                    bankMerits={bankMerits}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
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
            <label className="stock-investment-toggle-row">
              <input
                type="checkbox"
                checked={hideOwnedBlocks}
                onChange={(event) => setHideOwnedBlocks(event.target.checked)}
              />
              <span>Hide owned blocks</span>
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
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Investment returns" aside={`${formatNumber(rows.length)} shown / ${formatNumber(totalPricedRows)} total`} icon={<BadgeDollarSign size={18} />} />
        {isLoading ? (
          <EmptyState text="Loading stock ROI" />
        ) : rows.length === 0 ? (
          <EmptyState text="No investment opportunities match the current filters" />
        ) : (
          <StockRoiTable rows={rows} ownedShares={ownedShares} cityBankActive={cityBankActive} bankMerits={bankMerits} sort={roiSort} onSort={updateRoiSort} />
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
  cityBankActive,
  bankMerits,
  sort,
  onSort,
}: {
  rows: StockInvestmentRoiRow[];
  ownedShares: Map<number, number>;
  cityBankActive: boolean;
  bankMerits: number;
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
            const isStockRow = isStockInvestmentRow(row);
            const owned = isStockRow ? ownedShares.get(row.stock_id) ?? 0 : 0;
            const ownsIncrement = isInvestmentRowCovered(row, ownedShares, cityBankActive);
            const additionalCost = additionalCostForOwnedStockRow(row, owned);
            return (
              <tr key={row.row_id} className={ownsIncrement ? "stock-owned-increment-row" : undefined}>
                <td>
                  <span className="stock-symbol-chip">{row.acronym ?? (row.stock_id ? `#${row.stock_id}` : "-")}</span>
                </td>
                <td>
                  <span className="stock-benefit-cell">
                    <strong>{row.name ?? "-"}</strong>
                    <small>{isStockRow ? `Block ${row.increment}` : `${CITY_BANK_TERM_DAYS} days (${bankMerits}/10 Merits)`}</small>
                  </span>
                </td>
                <td>
                  <span className="stock-benefit-cell stock-shares-cell">
                    <strong>
                      {!isStockRow ? (
                        "-"
                      ) : row.increment === 1 ? (
                        formatNumber(row.required_shares ?? 0)
                      ) : (
                        <span className="stock-tooltip-value" title={`Total shares needed for this increment: ${formatNumber(row.total_shares_required ?? 0)}`}>
                          {formatNumber(row.required_shares ?? 0)}
                        </span>
                      )}
                    </strong>
                    {isStockRow && owned > 0 ? <small>Owned: {formatNumber(owned)}</small> : null}
                  </span>
                </td>
                <td>
                  <span className="stock-cost-cell">
                    {!isStockRow || row.increment === 1 ? (
                      <span>{formatMoney(row.increment_cost)}</span>
                    ) : (
                      <span className="stock-tooltip-value" title={`Total cost through this increment: ${formatMoney(row.total_cost)}`}>
                        {formatMoney(row.increment_cost)}
                      </span>
                    )}
                    {additionalCost !== null ? (
                      <small>Additional: {formatMoney(additionalCost)}</small>
                    ) : null}
                    </span>
                </td>
                <td>
                  <span className="stock-benefit-cell">
                    <strong>{row.benefit_description}</strong>
                    <small>{isStockRow ? `${formatNumber(row.frequency_days)} days - ${valuationSourceLabel(row.valuation_source)} value` : `${CITY_BANK_TERM_DAYS} days - ${bankMerits}/10 Merits`}</small>
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

function RebalanceRecommendationRow({
  recommendation,
  bankMerits,
}: {
  recommendation: StockRebalanceRecommendation;
  bankMerits: number;
}) {
  const proposed = recommendation.proposed;
  const row = proposed.row;
  return (
    <div className="stock-rebalance-row">
      <div className="stock-rebalance-title">
        <span className="stock-symbol-chip">{recommendation.sell_acronym ?? `#${recommendation.sell_stock_id}`}</span>
        <span>
          <strong>Sell {formatNumber(recommendation.sell_shares)} shares</strong>
          <small>{rebalanceActionDescription(recommendation, bankMerits)}</small>
        </span>
      </div>
      <div className="stock-rebalance-metrics">
        <span>
          <strong>{formatMoney(recommendation.sale_value)}</strong>
          <small>Sale value</small>
        </span>
        <span>
          <strong>{formatMoney(recommendation.current_annual_return)}</strong>
          <small>Current return</small>
        </span>
        <span>
          <strong>{formatMoney(proposed.annual_return)}</strong>
          <small>Proposed return</small>
        </span>
        <span className="stock-rebalance-gain">
          <strong>+{formatMoney(recommendation.annual_return_gain)}</strong>
          <small>Annual gain</small>
        </span>
        <span>
          <strong>{formatPercent(row.roi_percent)}</strong>
          <small>Block ROI</small>
        </span>
      </div>
    </div>
  );
}

function StrategyStepRow({
  step,
  index,
  bankMerits,
}: {
  step: StockStrategyStep;
  index: number;
  bankMerits: number;
}) {
  const recommendation = step.recommendation;
  const milestoneLabel = step.extra_cash_needed <= 0 ? "Now" : `At ${formatMoney(step.cash_required)} cash`;
  return (
    <div className="stock-milestone-row">
      <div>
        <strong>{formatNumber(index + 1)}. {milestoneLabel}</strong>
        <small>{strategyStepTitle(step)}</small>
      </div>
      <p>{strategyStepDescription(step, bankMerits)}</p>
      <div className="stock-milestone-metrics">
        <span>
          <strong>{formatMoney(recommendation.estimated_cost)}</strong>
          <small>Cost</small>
        </span>
        {step.sales.length > 0 ? (
          <span>
            <strong>{formatMoney(step.sales.reduce((sum, sale) => sum + sale.sale_value, 0))}</strong>
            <small>Sale value</small>
          </span>
        ) : null}
        <span>
          <strong>+{formatMoney(step.annual_return_gain)}</strong>
          <small>Annual gain</small>
        </span>
        <span>
          <strong>{formatPercent(step.roi_percent)}</strong>
          <small>ROI</small>
        </span>
      </div>
    </div>
  );
}

function rebalanceActionDescription(recommendation: StockRebalanceRecommendation, bankMerits: number): string {
  const proposed = recommendation.proposed;
  const availableCash = recommendation.available_cash > 0
    ? ` and ${formatMoney(recommendation.available_cash)} available cash`
    : "";
  return `Combine about ${formatMoney(recommendation.sale_value)} sale value${availableCash} to buy ${bestOpportunityTitle(proposed.row)} for ${formatMoney(proposed.estimated_cost)}. ${rebalanceProposedDetail(proposed, bankMerits)}`;
}

function rebalanceProposedDetail(recommendation: StockBuyRecommendation, bankMerits: number): string {
  if (recommendation.row.investment_type === "city_bank") {
    return `City Bank uses ${bankMerits}/10 merits.`;
  }

  return `${recommendation.row.benefit_description} every ${formatNumber(recommendation.row.frequency_days)} days.`;
}

function strategyStepTitle(step: StockStrategyStep): string {
  if (step.kind === "rebalance" && step.sales.length > 0) {
    return `Sell ${strategySaleLabels(step)}, buy ${bestOpportunityTitle(step.recommendation.row)}`;
  }

  return `Buy ${bestOpportunityTitle(step.recommendation.row)}`;
}

function strategyStepDescription(step: StockStrategyStep, bankMerits: number): string {
  const recommendation = step.recommendation;
  const row = recommendation.row;
  const cashText = step.extra_cash_needed > 0
    ? `Need ${formatMoney(step.extra_cash_needed)} more cash. `
    : "";
  if (step.kind === "rebalance" && step.sales.length > 0) {
    return `${cashText}Sell ${strategySaleDescription(step)}, then buy ${bestOpportunityTitle(row)}.`;
  }
  if (row.investment_type === "city_bank") {
    return `${cashText}Add City Bank for ${formatMoney(recommendation.estimated_cost)} with ${bankMerits}/10 merits.`;
  }

  const sharesText = recommendation.personalized && recommendation.owned_shares > 0
    ? `Buy ${formatNumber(recommendation.shares_needed ?? 0)} more shares`
    : `Buy ${formatNumber(recommendation.shares_needed ?? recommendation.target_shares ?? 0)} shares`;
  return `${cashText}${sharesText} to reach ${formatNumber(recommendation.target_shares ?? 0)}.`;
}

function strategySaleLabels(step: StockStrategyStep): string {
  return step.sales
    .map((sale) => sale.acronym ?? `#${sale.stock_id}`)
    .join(" + ");
}

function strategySaleDescription(step: StockStrategyStep): string {
  return step.sales
    .map((sale) => `${formatNumber(sale.shares)} ${sale.acronym ?? `#${sale.stock_id}`} shares for about ${formatMoney(sale.sale_value)}`)
    .join(", ");
}

async function fetchOwnedStockSnapshot(apiKey: string, refreshedAt: number): Promise<OwnedStockSnapshot> {
  const data = await fetchTornUserJson(TORN_OWNED_STOCKS_URL, apiKey, "Torn owned stocks response was not valid.");
  return parseOwnedStocksResponse(data, refreshedAt);
}

async function fetchBankMerits(apiKey: string): Promise<number | null> {
  const data = await fetchTornUserJson(TORN_USER_MERITS_URL, apiKey, "Torn merits response was not valid.");
  return parseBankMeritsResponse(data);
}

async function fetchTornUserJson(url: string, apiKey: string, invalidResponseMessage: string): Promise<unknown> {
  const response = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    headers: { Accept: "application/json" },
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(invalidResponseMessage);
  }

  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      return data;
    }
    throw new Error("Could not fetch directly from Torn. No server proxy is used for Limited keys.");
  }

  return data;
}

function sortStockRoiRows(rows: StockInvestmentRoiRow[], sort: StockRoiSort): StockInvestmentRoiRow[] {
  return [...rows].sort((a, b) => {
    const compared = compareStockRoiRows(a, b, sort.key);
    if (compared !== 0) {
      return sort.direction === "asc" ? compared : -compared;
    }
    const stockIdA = a.stock_id ?? Number.MAX_SAFE_INTEGER;
    const stockIdB = b.stock_id ?? Number.MAX_SAFE_INTEGER;
    if (stockIdA !== stockIdB) {
      return stockIdA - stockIdB;
    }
    const incrementA = a.increment ?? Number.MAX_SAFE_INTEGER;
    const incrementB = b.increment ?? Number.MAX_SAFE_INTEGER;
    if (incrementA !== incrementB) {
      return incrementA - incrementB;
    }
    return compareText(a.row_id, b.row_id);
  });
}

function compareStockRoiRows(a: StockInvestmentRoiRow, b: StockInvestmentRoiRow, key: StockRoiSortKey): number {
  switch (key) {
    case "acronym":
      return compareText(rowAcronym(a), rowAcronym(b));
    case "name":
      return compareText(`${a.name ?? ""} ${a.increment ?? ""}`, `${b.name ?? ""} ${b.increment ?? ""}`);
    case "shares":
      return compareNullableNumber(a.required_shares, b.required_shares);
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

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function rowAcronym(row: StockInvestmentRoiRow): string {
  return row.acronym ?? (row.stock_id ? `#${row.stock_id}` : row.row_id);
}

function isStockInvestmentRow(row: StockInvestmentRoiRow): row is StockInvestmentRoiRow & {
  investment_type: "stock";
  stock_id: number;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
} {
  return row.investment_type === "stock" && row.stock_id !== null && row.increment !== null;
}

function isInvestmentRowCovered(row: StockInvestmentRoiRow, ownedShares: Map<number, number>, cityBankActive: boolean): boolean {
  if (row.investment_type === "city_bank") {
    return cityBankActive;
  }

  if (!isStockInvestmentRow(row)) {
    return false;
  }

  return ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required);
}

function additionalCostForOwnedStockRow(row: StockInvestmentRoiRow, ownedShares: number): number | null {
  if (!isStockInvestmentRow(row) || ownedShares <= 0) {
    return null;
  }

  const targetShares = row.total_shares_required ?? 0;
  const latestPrice = row.latest_price ?? 0;
  if (ownedShares >= targetShares || targetShares <= 0 || latestPrice <= 0) {
    return null;
  }

  return (targetShares - ownedShares) * latestPrice;
}

function bestOpportunityTitle(row: StockInvestmentRoiRow): string {
  if (row.investment_type === "city_bank") {
    return "BANK 90 days";
  }

  return `${row.acronym ?? `#${row.stock_id}`} Block ${row.increment ?? "-"}`;
}

function bestBuyRecommendationDetail(recommendation: StockBuyRecommendation, bankMerits: number): string {
  if (recommendation.row.investment_type === "city_bank") {
    return `City Bank - ${bankMerits}/10 Merits`;
  }

  if (!recommendation.personalized) {
    return `${formatNumber(recommendation.target_shares ?? 0)} shares required`;
  }

  if (recommendation.owned_shares > 0) {
    return `You own ${formatNumber(recommendation.owned_shares)}; buy ${formatNumber(recommendation.shares_needed ?? 0)} more to reach ${formatNumber(recommendation.target_shares ?? 0)}`;
  }

  return `Buy ${formatNumber(recommendation.shares_needed ?? 0)} shares to reach ${formatNumber(recommendation.target_shares ?? 0)}`;
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

function readCityBankStorage(userId: number | null): { active: boolean; merits: number } {
  const keys = cityBankStorageKeys(userId);
  if (!keys) {
    return { active: false, merits: 0 };
  }

  return {
    active: window.localStorage.getItem(keys.active) === "1",
    merits: clampBankMerits(window.localStorage.getItem(keys.merits) ?? "0"),
  };
}

function saveCityBankStorage(userId: number | null, active: boolean, merits: number): void {
  const keys = cityBankStorageKeys(userId);
  if (!keys) {
    return;
  }

  window.localStorage.setItem(keys.active, active ? "1" : "0");
  window.localStorage.setItem(keys.merits, String(clampBankMerits(merits)));
}

function cityBankStorageKeys(userId: number | null): { active: string; merits: string } | null {
  if (!userId) {
    return null;
  }

  return {
    active: `stockRoiCityBankActive:${userId}`,
    merits: `stockRoiCityBankMerits:${userId}`,
  };
}

function clampBankMerits(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(10, Math.max(0, parsed));
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
