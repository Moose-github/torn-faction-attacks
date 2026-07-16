import React from "react";
import { BadgeDollarSign, Ban, RefreshCw, RotateCcw, Save } from "lucide-react";
import {
  autoRefreshStockBenefitItemPrices,
  getStockBenefitValues,
  getStockInvestmentRoi,
  refreshStockBenefitItemPrices,
  setStockBenefitStockDisabled,
  StockBenefitDisabledStock,
  StockBenefitStock,
  StockBenefitValue,
  StockBenefitValuesResponse,
  StockInvestmentRoiResponse,
  StockInvestmentRoiRow,
  updateStockBenefitValue,
} from "../api";
import { getStoredAuthSession } from "../api/client";
import { CollapsiblePanel, EmptyState, PanelHeader } from "../components/Common";
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
  buildFhgTciHybridRow,
  buildStockRebalanceRecommendations,
  buildStockStrategyPlan,
  DEFAULT_STOCK_STRATEGY_STEP_LIMIT,
  isFhgTciHybridRow,
  recommendBestStockBuy,
  STOCK_SELL_FEE_RATE,
  stockInvestmentRowMetrics,
  type StockBuyRecommendation,
  type StockInvestmentRecommendationRow,
  type StockInvestmentRowMetrics,
  type StockRebalanceRecommendation,
  type StockStrategyStep,
} from "../utils/stockRecommendations";

const TORN_OWNED_STOCKS_URL = "https://api.torn.com/v2/user/stocks";
const TORN_USER_MERITS_URL = "https://api.torn.com/v2/user/merits";
const DEFAULT_MINIMUM_ROI = "5";
const CITY_BANK_TERM_DAYS = 90;
const MANUAL_BENEFIT_VALUES_SECTION_ID = "stock-benefit-manual-values";

type StockRoiSortKey = "acronym" | "name" | "shares" | "increment_cost" | "benefit" | "annual_return" | "days_to_break_even" | "roi_percent";

type SortDirection = "asc" | "desc";

type StockRoiSort = {
  key: StockRoiSortKey;
  direction: SortDirection;
};

type StockStrategyPanelTab = "strategy" | "rebalance";

type StockLockOption = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  shares: number;
};

type StockPanelStorageKey = "plannerSetup" | "benefitValues";

export function StockInvestments() {
  const storageUserId = React.useMemo(() => getStoredAuthSession()?.user.id ?? null, []);
  const [roiData, setRoiData] = React.useState<StockInvestmentRoiResponse | null>(null);
  const [benefits, setBenefits] = React.useState<StockBenefitValue[]>([]);
  const [disabledBenefitStocks, setDisabledBenefitStocks] = React.useState<StockBenefitDisabledStock[]>([]);
  const [benefitInputs, setBenefitInputs] = React.useState<Record<string, string>>({});
  const [investmentAmount, setInvestmentAmount] = React.useState("");
  const [affordableOnly, setAffordableOnly] = React.useState(false);
  const [minimumRoi, setMinimumRoi] = React.useState(DEFAULT_MINIMUM_ROI);
  const [hideOwnedBlocks, setHideOwnedBlocks] = React.useState(false);
  const [nextBlockOnly, setNextBlockOnly] = React.useState(false);
  const [includeFhgTciHybrid, setIncludeFhgTciHybrid] = React.useState(true);
  const [cityBankActive, setCityBankActive] = React.useState(false);
  const [fhgTciHybridActive, setFhgTciHybridActive] = React.useState(false);
  const [bankMerits, setBankMerits] = React.useState(0);
  const [roiSort, setRoiSort] = React.useState<StockRoiSort>({ key: "roi_percent", direction: "desc" });
  const [strategyPanelTab, setStrategyPanelTab] = React.useState<StockStrategyPanelTab>("strategy");
  const [isPlannerSetupOpen, setIsPlannerSetupOpen] = React.useState(() => readPanelOpenStorage(storageUserId, "plannerSetup", true));
  const [isBenefitValuesOpen, setIsBenefitValuesOpen] = React.useState(() => readPanelOpenStorage(storageUserId, "benefitValues", true));
  const [ownedApiKey, setOwnedApiKey] = React.useState("");
  const [ownedSnapshot, setOwnedSnapshot] = React.useState<OwnedStockSnapshot | null>(null);
  const [lockedStockIds, setLockedStockIds] = React.useState<Set<number>>(() => new Set());
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshingBenefitPrices, setIsRefreshingBenefitPrices] = React.useState(false);
  const [isRefreshingOwnedStocks, setIsRefreshingOwnedStocks] = React.useState(false);
  const [savingBenefitKey, setSavingBenefitKey] = React.useState<string | null>(null);
  const [savingDisabledStockId, setSavingDisabledStockId] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function applyBenefitValues(benefitValues: StockBenefitValuesResponse) {
    setBenefits(benefitValues.benefits);
    setDisabledBenefitStocks(benefitValues.disabled_stocks ?? []);
    setBenefitInputs(inputsFromBenefits(benefitValues.benefits));
  }

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
      applyBenefitValues(benefitValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRoiData(null);
      setBenefits([]);
      setDisabledBenefitStocks([]);
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
      applyBenefitValues(nextBenefits);
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
      applyBenefitValues(nextBenefits);
      setRoiData(nextRoi);
      setMessage(`${benefit.label} value reset`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingBenefitKey(null);
    }
  }

  async function updateBenefitStockDisabled(stock: StockBenefitStock | StockBenefitDisabledStock, disabled: boolean) {
    setSavingDisabledStockId(stock.stock_id);
    setError(null);
    setMessage(null);
    try {
      const nextBenefits = await setStockBenefitStockDisabled(stock.stock_id, disabled);
      const nextRoi = await getStockInvestmentRoi();
      applyBenefitValues(nextBenefits);
      setRoiData(nextRoi);
      setMessage(`${stockLabel(stock)} ${disabled ? "disabled" : "enabled"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDisabledStockId(null);
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
      applyBenefitValues(benefitValues);
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
    setLockedStockIds(new Set());
    setHideOwnedBlocks(false);
    clearOwnedStocksStorage(storageUserId);
    saveLockedStockIdsStorage(storageUserId, new Set());
    setError(null);
    setMessage("Owned stock highlights cleared");
  }

  function toggleLockedStock(stockId: number, locked: boolean) {
    setLockedStockIds((current) => {
      const next = new Set(current);
      if (locked) {
        next.add(stockId);
      } else {
        next.delete(stockId);
      }
      saveLockedStockIdsStorage(storageUserId, next);
      return next;
    });
  }

  function togglePlannerSetup() {
    setIsPlannerSetupOpen((current) => {
      const next = !current;
      savePanelOpenStorage(storageUserId, "plannerSetup", next);
      return next;
    });
  }

  function toggleBenefitValues() {
    setIsBenefitValuesOpen((current) => {
      const next = !current;
      savePanelOpenStorage(storageUserId, "benefitValues", next);
      return next;
    });
  }

  function openBenefitValues() {
    setIsBenefitValuesOpen(true);
    savePanelOpenStorage(storageUserId, "benefitValues", true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(MANUAL_BENEFIT_VALUES_SECTION_ID)
          ?? document.querySelector<HTMLElement>(".stock-benefit-values-panel");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  React.useEffect(() => {
    const stored = readOwnedStocksStorage(storageUserId);
    const storedCityBank = readCityBankStorage(storageUserId);
    const storedFhgTciHybridActive = readFhgTciHybridStorage(storageUserId);
    setOwnedApiKey(stored.apiKey);
    setOwnedSnapshot(stored.snapshot);
    setLockedStockIds(readLockedStockIdsStorage(storageUserId));
    setCityBankActive(storedCityBank.active);
    setFhgTciHybridActive(storedFhgTciHybridActive);
    setBankMerits(storedCityBank.merits);
    loadData();
  }, []);

  const ownedShares = React.useMemo(() => ownedSharesMap(ownedSnapshot), [ownedSnapshot]);
  const baseInvestmentRows = React.useMemo(
    () => (roiData?.rows ?? []).map((row) => adjustCityBankRowForMerits(row, bankMerits)),
    [roiData?.rows, bankMerits],
  );
  const fhgTciHybridRow = React.useMemo(() => buildFhgTciHybridRow(baseInvestmentRows), [baseInvestmentRows]);
  const investmentRows = React.useMemo<StockInvestmentRecommendationRow[]>(
    () => includeFhgTciHybrid && fhgTciHybridRow ? [...baseInvestmentRows, fhgTciHybridRow] : baseInvestmentRows,
    [baseInvestmentRows, fhgTciHybridRow, includeFhgTciHybrid],
  );
  const ownedStockCount = ownedSnapshot?.stocks.filter((stock) => stock.shares > 0).length ?? 0;
  const ownedCoveredBlockCount = investmentRows.filter((row) => isStockInvestmentRow(row) && ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required ?? 0)).length;
  const nextStockBlockRowIds = React.useMemo(
    () => nextStockBlockIds(investmentRows, ownedShares, ownedSnapshot !== null),
    [investmentRows, ownedShares, ownedSnapshot],
  );
  const lockableHoldings = React.useMemo(
    () => ownedStockLockOptions(ownedSnapshot, investmentRows),
    [ownedSnapshot, investmentRows],
  );
  const budget = moneyInputValue(investmentAmount);
  const minRoi = percentInputValue(minimumRoi);
  const filteredRows = investmentRows.filter((row) => {
    if (isFhgTciHybridRow(row) && !cityBankActive) {
      return false;
    }
    if (nextBlockOnly && isStockInvestmentRow(row) && !nextStockBlockRowIds.has(row.row_id)) {
      return false;
    }
    if (hideOwnedBlocks && isInvestmentRowCovered(row, ownedShares, ownedSnapshot !== null, cityBankActive, fhgTciHybridActive)) {
      return false;
    }
    const rowMetrics = stockInvestmentRowMetrics(row, {
      ownedShares,
      hasOwnedSnapshot: ownedSnapshot !== null,
      fhgTciHybridActive,
    });
    if (affordableOnly && budget !== null && rowMetrics.estimated_cost > budget) {
      return false;
    }
    if (minRoi !== null && rowMetrics.roi_percent < minRoi) {
      return false;
    }
    return true;
  });
  const rows = sortStockRoiRows(filteredRows, roiSort, ownedShares, ownedSnapshot !== null, fhgTciHybridActive);
  const bestBuyRecommendation = React.useMemo(() => recommendBestStockBuy({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    fhgTciHybridActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
  }), [investmentRows, ownedSnapshot, cityBankActive, fhgTciHybridActive, budget, affordableOnly, minRoi]);
  const rebalanceRecommendations = React.useMemo(() => buildStockRebalanceRecommendations({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    fhgTciHybridActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
    lockedStockIds,
  }, 5), [investmentRows, ownedSnapshot, cityBankActive, fhgTciHybridActive, budget, affordableOnly, minRoi, lockedStockIds]);
  const strategyPlan = React.useMemo(() => buildStockStrategyPlan({
    rows: investmentRows,
    ownedSnapshot,
    cityBankActive,
    fhgTciHybridActive,
    budget,
    affordableOnly,
    minimumRoi: minRoi,
    lockedStockIds,
  }, DEFAULT_STOCK_STRATEGY_STEP_LIMIT), [investmentRows, ownedSnapshot, cityBankActive, fhgTciHybridActive, budget, affordableOnly, minRoi, lockedStockIds]);
  const totalPricedRows = investmentRows.length;
  const missingValueCount = roiData?.skipped.unpriced ?? 0;
  const stockPricesRefreshedAt = roiData?.refreshed_at ?? null;
  const benefitValuesRefreshedAt = roiData?.benefit_prices_refreshed_at ?? null;
  const recommendationFiltersActive = investmentAmount.trim() !== "" || minimumRoi.trim() !== DEFAULT_MINIMUM_ROI || affordableOnly;
  const tableFiltersActive = hideOwnedBlocks || nextBlockOnly;
  const activeFilterCount = [
    investmentAmount.trim() !== "",
    minimumRoi.trim() !== DEFAULT_MINIMUM_ROI,
    affordableOnly,
    nextBlockOnly,
    hideOwnedBlocks,
  ].filter(Boolean).length;
  const disabledStockCount = roiData?.skipped.disabled ?? disabledBenefitStocks.length;

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
          disabledCount={disabledStockCount}
          onOpen={openBenefitValues}
        />
        <StatusMetric
          label="Benefit values"
          value={formatRelativeTime(benefitValuesRefreshedAt)}
          detail={benefitValuesRefreshedAt ? formatLongDateTime(benefitValuesRefreshedAt) : "No market refresh yet"}
        />
      </section>

      <CollapsiblePanel
        title="Planner setup"
        collapsed={!isPlannerSetupOpen}
        onToggle={togglePlannerSetup}
        className="stock-planner-setup-panel"
        control={(
          <div className="stock-setup-summary" aria-label="Planner setup summary">
            <span>
              <strong>{ownedSnapshot ? formatNumber(ownedStockCount) : "No"}</strong>
              <small>{ownedSnapshot ? "Stocks loaded" : "Snapshot"}</small>
            </span>
            <span>
              <strong>{budget === null ? "Any" : formatMoney(budget)}</strong>
              <small>Budget</small>
            </span>
            <span>
              <strong>{cityBankActive ? "Active" : "Inactive"}</strong>
              <small>Bank {formatNumber(bankMerits)}/10</small>
            </span>
            <span>
              <strong>{fhgTciHybridActive ? "Yes" : "No"}</strong>
              <small>Hybrid owned</small>
            </span>
            <span>
              <strong>{formatNumber(activeFilterCount)}</strong>
              <small>Filters</small>
            </span>
          </div>
        )}
      >
        <div className="stock-planner-setup-grid">
          <div className="stock-owned-settings-section">
            <div className="stock-owned-settings-title">
              <strong>Portfolio</strong>
              <span>{ownedSnapshot ? `${formatNumber(ownedCoveredBlockCount)} active blocks covered` : "Used only in this browser"}</span>
            </div>
            <div className="stock-owned-summary" aria-label="Owned stock snapshot summary">
              <span>
                <strong>{ownedSnapshot ? formatNumber(ownedStockCount) : "-"}</strong>
                <small>Stocks loaded</small>
              </span>
              <span>
                <strong>{ownedSnapshot ? formatNumber(ownedCoveredBlockCount) : "-"}</strong>
                <small>Active blocks covered</small>
              </span>
              <span>
                <strong>{ownedSnapshot ? formatRelativeTime(ownedSnapshot.refreshed_at) : "Not loaded"}</strong>
                <small>Snapshot age</small>
              </span>
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
              <strong>Assumptions</strong>
              <span>Bank and hybrid behavior</span>
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
              <label className="stock-owned-hide-toggle">
                <input
                  type="checkbox"
                  checked={fhgTciHybridActive}
                  onChange={(event) => {
                    const nextActive = event.target.checked;
                    setFhgTciHybridActive(nextActive);
                    saveFhgTciHybridStorage(storageUserId, nextActive);
                  }}
                />
                <span>FHG/TCI Hybrid already owned</span>
              </label>
              <label className="stock-owned-hide-toggle">
                <input
                  type="checkbox"
                  checked={includeFhgTciHybrid}
                  onChange={(event) => setIncludeFhgTciHybrid(event.target.checked)}
                />
                <span>Show FHG/TCI Hybrid option</span>
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

          <div className="stock-owned-settings-section stock-planner-wide-section">
            <div className="stock-owned-settings-title">
              <strong>Recommendation filters</strong>
              <span>{recommendationFiltersActive ? "Used by strategy and table" : "Default minimum ROI applied"}</span>
            </div>
            <div className="stock-investment-controls">
              <div className="stock-investment-control-fields">
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
              </div>
              <div className="stock-investment-toggle-list stock-recommendation-toggle-list">
                <label className="stock-investment-toggle-row">
                  <input
                    type="checkbox"
                    checked={affordableOnly}
                    onChange={(event) => setAffordableOnly(event.target.checked)}
                  />
                  <span>Affordable only</span>
                </label>
              </div>
              <button
                type="button"
                className="panel-action-button secondary stock-investment-clear-button"
                disabled={!recommendationFiltersActive}
                onClick={() => {
                  setInvestmentAmount("");
                  setMinimumRoi(DEFAULT_MINIMUM_ROI);
                  setAffordableOnly(false);
                }}
              >
                <RotateCcw size={14} />
                Clear filters
              </button>
            </div>
          </div>

          {lockableHoldings.length > 0 ? (
            <div className="stock-owned-settings-section stock-planner-wide-section">
              <div className="stock-owned-settings-title">
                <strong>Locked holdings</strong>
                <span>{formatNumber(lockedStockIds.size)} locked</span>
              </div>
              <div className="stock-locked-holdings-list">
                {lockableHoldings.map((holding) => (
                  <label key={holding.stock_id} className="stock-locked-holding-row">
                    <input
                      type="checkbox"
                      checked={lockedStockIds.has(holding.stock_id)}
                      onChange={(event) => toggleLockedStock(holding.stock_id, event.target.checked)}
                    />
                    <span>
                      <strong>{holding.acronym ?? `#${holding.stock_id}`}</strong>
                      <small>{formatNumber(holding.shares)} shares{holding.name ? ` - ${holding.name}` : ""}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CollapsiblePanel>

      <section className="panel stock-next-buys-panel">
        <PanelHeader
          title="Investment strategy"
          aside={rebalanceRecommendations.length + strategyPlan.steps.length > 0 ? `${formatNumber(rebalanceRecommendations.length + strategyPlan.steps.length)} ideas` : "No ideas"}
          icon={<BadgeDollarSign size={18} />}
        />
        <div className="stock-strategy-tabs" role="tablist" aria-label="Investment strategy views">
          <button
            type="button"
            className={`stock-strategy-tab${strategyPanelTab === "strategy" ? " active" : ""}`}
            role="tab"
            aria-selected={strategyPanelTab === "strategy"}
            aria-controls="stock-strategy-path-panel"
            id="stock-strategy-path-tab"
            onClick={() => setStrategyPanelTab("strategy")}
          >
            <span>Strategy path</span>
            <strong>{formatNumber(strategyPlan.steps.length)}</strong>
          </button>
          <button
            type="button"
            className={`stock-strategy-tab${strategyPanelTab === "rebalance" ? " active" : ""}`}
            role="tab"
            aria-selected={strategyPanelTab === "rebalance"}
            aria-controls="stock-rebalance-ideas-panel"
            id="stock-rebalance-ideas-tab"
            onClick={() => setStrategyPanelTab("rebalance")}
          >
            <span>Rebalance ideas</span>
            <strong>{formatNumber(rebalanceRecommendations.length)}</strong>
          </button>
        </div>
        <div className="stock-suggested-layout">
          {strategyPanelTab === "rebalance" ? (
            <div
              className="stock-suggested-section"
              role="tabpanel"
              id="stock-rebalance-ideas-panel"
              aria-labelledby="stock-rebalance-ideas-tab"
            >
              <div className="stock-suggested-heading">
                <strong>Rebalance ideas</strong>
                <span>Sell one, buy one</span>
              </div>
              {!ownedSnapshot ? (
                <EmptyState text="Load owned stocks to find rebalance ideas" />
              ) : rebalanceRecommendations.length === 0 ? (
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
          ) : (
            <div
              className="stock-suggested-section"
              role="tabpanel"
              id="stock-strategy-path-panel"
              aria-labelledby="stock-strategy-path-tab"
            >
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
          )}
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Investment returns" aside={`${formatNumber(rows.length)} shown / ${formatNumber(totalPricedRows)} total`} icon={<BadgeDollarSign size={18} />} />
        <div className="stock-table-filter-panel">
          <div className="stock-owned-settings-title">
            <strong>Table filters</strong>
            <span>{tableFiltersActive ? `${formatNumber(rows.length)} matching blocks` : "Table display only"}</span>
          </div>
          <div className="stock-table-filter-controls">
            <div className="stock-investment-toggle-list">
              <label className="stock-investment-toggle-row">
                <input
                  type="checkbox"
                  checked={nextBlockOnly}
                  onChange={(event) => setNextBlockOnly(event.target.checked)}
                />
                <span>Next block</span>
              </label>
              <label className="stock-investment-toggle-row">
                <input
                  type="checkbox"
                  checked={hideOwnedBlocks}
                  onChange={(event) => setHideOwnedBlocks(event.target.checked)}
                />
                <span>Hide owned blocks</span>
              </label>
            </div>
            <button
              type="button"
              className="panel-action-button secondary stock-investment-clear-button"
              disabled={!tableFiltersActive}
              onClick={() => {
                setNextBlockOnly(false);
                setHideOwnedBlocks(false);
              }}
            >
              <RotateCcw size={14} />
              Clear filters
            </button>
          </div>
        </div>
        {isLoading ? (
          <EmptyState text="Loading stock ROI" />
        ) : rows.length === 0 ? (
          <EmptyState text="No investment opportunities match the current filters" />
        ) : (
          <StockRoiTable rows={rows} ownedShares={ownedShares} lockedStockIds={lockedStockIds} hasOwnedSnapshot={ownedSnapshot !== null} cityBankActive={cityBankActive} fhgTciHybridActive={fhgTciHybridActive} bankMerits={bankMerits} sort={roiSort} onSort={updateRoiSort} />
        )}
      </section>

      <CollapsiblePanel
        title="Benefit values"
        collapsed={!isBenefitValuesOpen}
        onToggle={toggleBenefitValues}
        className="stock-benefit-values-panel table-panel"
        control={(
          <div className="stock-benefit-panel-actions">
            <span>{formatNumber(benefits.length)} editable</span>
            <span>{formatNumber(disabledBenefitStocks.length)} disabled</span>
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
      >
        {isLoading ? (
          <EmptyState text="Loading benefit values" />
        ) : benefits.length === 0 && disabledBenefitStocks.length === 0 ? (
          <EmptyState text="No editable active benefits found" />
        ) : (
          <BenefitValuesTable
            benefits={benefits}
            disabledStocks={disabledBenefitStocks}
            inputs={benefitInputs}
            savingBenefitKey={savingBenefitKey}
            savingDisabledStockId={savingDisabledStockId}
            onInputChange={(benefitKey, value) => setBenefitInputs((current) => ({ ...current, [benefitKey]: value }))}
            onSave={saveBenefit}
            onReset={resetBenefit}
            onDisableStock={(stock) => updateBenefitStockDisabled(stock, true)}
            onEnableStock={(stock) => updateBenefitStockDisabled(stock, false)}
          />
        )}
      </CollapsiblePanel>
    </>
  );
}

function StockRoiTable({
  rows,
  ownedShares,
  lockedStockIds,
  hasOwnedSnapshot,
  cityBankActive,
  fhgTciHybridActive,
  bankMerits,
  sort,
  onSort,
}: {
  rows: StockInvestmentRecommendationRow[];
  ownedShares: Map<number, number>;
  lockedStockIds: ReadonlySet<number>;
  hasOwnedSnapshot: boolean;
  cityBankActive: boolean;
  fhgTciHybridActive: boolean;
  bankMerits: number;
  sort: StockRoiSort;
  onSort: (key: StockRoiSortKey) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table stock-investment-table">
        <thead>
          <tr>
            <SortableHeader label="Ticker" sortKey="acronym" sort={sort} onSort={onSort} className="stock-col-symbol" />
            <SortableHeader label="Name" sortKey="name" sort={sort} onSort={onSort} className="stock-col-name" />
            <SortableHeader label="Shares" sortKey="shares" sort={sort} onSort={onSort} className="stock-col-shares" />
            <SortableHeader label="Cost" sortKey="increment_cost" sort={sort} onSort={onSort} className="stock-col-cost" />
            <SortableHeader label="Benefit" sortKey="benefit" sort={sort} onSort={onSort} className="stock-col-benefit" />
            <SortableHeader label="Annual" sortKey="annual_return" sort={sort} onSort={onSort} className="stock-col-return" />
            <SortableHeader label="Break even" sortKey="days_to_break_even" sort={sort} onSort={onSort} className="stock-col-break-even" />
            <SortableHeader label="ROI" sortKey="roi_percent" sort={sort} onSort={onSort} className="stock-col-roi" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isStockRow = isStockInvestmentRow(row);
            const owned = isStockRow ? ownedShares.get(row.stock_id) ?? 0 : 0;
            const isLocked = isStockRow && lockedStockIds.has(row.stock_id);
            const ownsIncrement = isInvestmentRowCovered(row, ownedShares, hasOwnedSnapshot, cityBankActive, fhgTciHybridActive);
            const rowMetrics = stockInvestmentRowMetrics(row, { ownedShares, hasOwnedSnapshot, fhgTciHybridActive });
            const costDetail = stockCostDetail(row, rowMetrics);
            const showRawRoi = rowMetrics.personalized && !rowMetrics.covered && rowMetrics.roi_percent !== row.roi_percent;
            return (
              <tr key={row.row_id} className={ownsIncrement ? "stock-owned-increment-row" : undefined}>
                <td className="stock-col-symbol" data-label="Ticker">
                  <span className="stock-symbol-chip">{row.acronym ?? (row.stock_id ? `#${row.stock_id}` : "-")}</span>
                </td>
                <td className="stock-col-name" data-label="Name">
                  <span className="stock-benefit-cell">
                    <strong>{row.name ?? "-"}</strong>
                    <small>{stockRowSubtitle(row, isStockRow, bankMerits)}</small>
                  </span>
                </td>
                <td className="stock-col-shares" data-label="Shares">
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
                    {isLocked ? <small>Locked</small> : null}
                  </span>
                </td>
                <td className="stock-col-cost" data-label="Cost">
                  <span className="stock-cost-cell">
                    <span
                      className={isStockRow && row.increment !== 1 ? "stock-tooltip-value" : undefined}
                      title={isStockRow && row.increment !== 1 ? `Total cost through this increment: ${formatMoney(row.total_cost)}` : undefined}
                    >
                      {formatMoney(rowMetrics.estimated_cost)}
                    </span>
                    {costDetail ? <small>{costDetail}</small> : null}
                  </span>
                </td>
                <td className="stock-col-benefit" data-label="Benefit">
                  <span className="stock-benefit-cell">
                    <strong>{row.benefit_description}</strong>
                    <small>{stockBenefitDetail(row, isStockRow, bankMerits)}</small>
                  </span>
                </td>
                <td className="stock-col-return" data-label="Annual">{formatMoney(row.annual_return)}</td>
                <td className="stock-col-break-even" data-label="Break even">{formatNumber(Math.round(rowMetrics.days_to_break_even))} days</td>
                <td className="stock-col-roi" data-label="ROI">
                  <span className="stock-benefit-cell">
                    <span className={`stock-roi-chip ${roiTone(rowMetrics.roi_percent)}`}>{formatPercent(rowMetrics.roi_percent)}</span>
                    {showRawRoi ? <small>Block: {formatPercent(row.roi_percent)}</small> : null}
                  </span>
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
  className,
}: {
  label: string;
  sortKey: StockRoiSortKey;
  sort: StockRoiSort;
  onSort: (key: StockRoiSortKey) => void;
  className?: string;
}) {
  const isActive = sort.key === sortKey;
  return (
    <th className={className} aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
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
  disabledStocks,
  inputs,
  savingBenefitKey,
  savingDisabledStockId,
  onInputChange,
  onSave,
  onReset,
  onDisableStock,
  onEnableStock,
}: {
  benefits: StockBenefitValue[];
  disabledStocks: StockBenefitDisabledStock[];
  inputs: Record<string, string>;
  savingBenefitKey: string | null;
  savingDisabledStockId: number | null;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
  onDisableStock: (stock: StockBenefitStock) => void;
  onEnableStock: (stock: StockBenefitDisabledStock) => void;
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
          savingDisabledStockId={savingDisabledStockId}
          onInputChange={onInputChange}
          onSave={onSave}
          onReset={onReset}
          onDisableStock={onDisableStock}
        />
      ) : null}
      {manualBenefits.length > 0 ? (
        <BenefitValuesSection
          id={MANUAL_BENEFIT_VALUES_SECTION_ID}
          title="Manual values"
          aside={`${formatNumber(manualBenefits.length)} manual-only`}
          benefits={manualBenefits}
          inputs={inputs}
          savingBenefitKey={savingBenefitKey}
          savingDisabledStockId={savingDisabledStockId}
          onInputChange={onInputChange}
          onSave={onSave}
          onReset={onReset}
          onDisableStock={onDisableStock}
        />
      ) : null}
      {disabledStocks.length > 0 ? (
        <DisabledBenefitStocksSection
          disabledStocks={disabledStocks}
          savingDisabledStockId={savingDisabledStockId}
          onEnableStock={onEnableStock}
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
  savingDisabledStockId,
  onInputChange,
  onSave,
  onReset,
  onDisableStock,
}: {
  id?: string;
  title: string;
  aside: string;
  benefits: StockBenefitValue[];
  inputs: Record<string, string>;
  savingBenefitKey: string | null;
  savingDisabledStockId: number | null;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
  onDisableStock: (stock: StockBenefitStock) => void;
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
              <th>Stocks</th>
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
                savingDisabledStockId={savingDisabledStockId}
                onInputChange={onInputChange}
                onSave={onSave}
                onReset={onReset}
                onDisableStock={onDisableStock}
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
  savingDisabledStockId,
  onInputChange,
  onSave,
  onReset,
  onDisableStock,
}: {
  benefit: StockBenefitValue;
  inputValue: string;
  isSaving: boolean;
  savingDisabledStockId: number | null;
  onInputChange: (benefitKey: string, value: string) => void;
  onSave: (benefit: StockBenefitValue) => void;
  onReset: (benefit: StockBenefitValue) => void;
  onDisableStock: (stock: StockBenefitStock) => void;
}) {
  const canSave = moneyInputValue(inputValue) !== null;
  const hasCustomValue = benefit.override_value !== null;
  const parsedInput = moneyInputValue(inputValue);
  const isChanged = parsedInput !== null && parsedInput !== benefit.effective_value;
  const canDisableStocks = benefit.default_value === null && benefit.effective_value === null;
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
        <div className="stock-benefit-stock-list">
          {benefit.stocks.map((stock) => (
            <span key={stock.stock_id} className="stock-benefit-stock-chip">
              <span>{stockLabel(stock)}</span>
              {canDisableStocks ? (
                <button
                  type="button"
                  className="stock-text-button"
                  disabled={savingDisabledStockId === stock.stock_id}
                  onClick={() => onDisableStock(stock)}
                >
                  <Ban size={13} />
                  {savingDisabledStockId === stock.stock_id ? "Disabling" : "Disable"}
                </button>
              ) : null}
            </span>
          ))}
        </div>
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

function DisabledBenefitStocksSection({
  disabledStocks,
  savingDisabledStockId,
  onEnableStock,
}: {
  disabledStocks: StockBenefitDisabledStock[];
  savingDisabledStockId: number | null;
  onEnableStock: (stock: StockBenefitDisabledStock) => void;
}) {
  return (
    <div className="stock-benefit-table-section">
      <div className="stock-benefit-table-title">
        <strong>Disabled stocks</strong>
        <span>{formatNumber(disabledStocks.length)} ignored</span>
      </div>
      <div className="stock-disabled-benefit-list">
        {disabledStocks.map((stock) => (
          <div key={stock.stock_id} className="stock-disabled-benefit-row">
            <span>
              <strong>{stockLabel(stock)}</strong>
              <small>{stock.label ?? stock.benefit_key}</small>
            </span>
            <button
              type="button"
              className="panel-action-button secondary"
              disabled={savingDisabledStockId === stock.stock_id}
              onClick={() => onEnableStock(stock)}
            >
              {savingDisabledStockId === stock.stock_id ? <RefreshCw size={14} className="spinning-icon" /> : <RotateCcw size={14} />}
              Enable
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingValuesMetric({
  missingValueCount,
  disabledCount,
  onOpen,
}: {
  missingValueCount: number;
  disabledCount: number;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="metric-card stock-clickable-metric stock-missing-values-card" onClick={onOpen}>
      <span className="panel-kicker">Missing values</span>
      <strong className="metric-card-value">{formatNumber(missingValueCount)}</strong>
      <span className="metric-card-detail">
        {missingValueCount > 0 ? "Open Benefit values to set or disable stocks" : "All enabled benefits are priced"}
        {disabledCount > 0 ? ` - ${formatNumber(disabledCount)} disabled` : ""}
      </span>
    </button>
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
        <span className="stock-symbol-chip">{rebalanceSaleChip(recommendation)}</span>
        <span>
          <strong>
            {rebalanceSaleTitle(recommendation)}
            {recommendation.highlight ? <em className="stock-rebalance-highlight">{rebalanceHighlightLabel(recommendation.highlight)}</em> : null}
          </strong>
          <small>{rebalanceActionDescription(recommendation, bankMerits)}</small>
        </span>
      </div>
      <div className="stock-rebalance-metrics">
        <span>
          <strong>{formatMoney(recommendation.sale_value)}</strong>
          <small>Net sale value</small>
        </span>
        <span>
          <strong>{formatMoney(recommendation.sale_fee)}</strong>
          <small>{formatPercent(STOCK_SELL_FEE_RATE * 100)} sell fee</small>
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
          <strong>{formatPercent(proposed.roi_percent)}</strong>
          <small>{proposed.roi_percent === row.roi_percent ? "Block ROI" : "Proposed ROI"}</small>
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
  const milestoneLabel = step.extra_cash_needed <= 0 ? "Now" : `At ${formatInstructionMoney(step.cash_required)} cash`;
  return (
    <div className="stock-milestone-row">
      <div>
        <strong>
          {formatNumber(index + 1)}. {milestoneLabel}
          <em className="stock-rebalance-highlight">{strategyReasonLabel(step)}</em>
        </strong>
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
            <small>Net sale value</small>
          </span>
        ) : null}
        {step.rebalance && step.rebalance.sale_fee > 0 ? (
          <span>
            <strong>{formatMoney(step.rebalance.sale_fee)}</strong>
            <small>{formatPercent(STOCK_SELL_FEE_RATE * 100)} sell fee</small>
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
    ? ` and ${formatInstructionMoney(recommendation.available_cash)} available cash`
    : "";
  return `Sell ${rebalanceSaleDescription(recommendation)}, combine about ${formatInstructionMoney(recommendation.sale_value)} net sale value${availableCash}, and buy ${bestOpportunityTitle(proposed.row)} for ${formatInstructionMoney(proposed.estimated_cost)}. ${rebalanceProposedDetail(proposed, bankMerits)}`;
}

function rebalanceHighlightLabel(highlight: NonNullable<StockRebalanceRecommendation["highlight"]>): string {
  switch (highlight) {
    case "best_gain":
      return "Best gain";
    case "best_roi":
      return "Best ROI";
    case "best_gain_and_roi":
      return "Best gain + ROI";
  }
}

function rebalanceSaleChip(recommendation: StockRebalanceRecommendation): string {
  if (recommendation.sales.length <= 1) {
    return recommendation.sell_acronym ?? stockSaleFallbackLabel(recommendation.sell_stock_id);
  }

  return `${saleLabel(recommendation.sales[0] ?? null)} +${recommendation.sales.length - 1}`;
}

function rebalanceSaleTitle(recommendation: StockRebalanceRecommendation): string {
  if (recommendation.sales.length <= 1) {
    return recommendation.sell_stock_id === null
      ? `Sell ${recommendation.sell_acronym ?? "holding"}`
      : `Sell ${formatNumber(recommendation.sell_shares)} shares`;
  }

  return `Sell from ${formatNumber(recommendation.sales.length)} holdings`;
}

function rebalanceSaleDescription(recommendation: StockRebalanceRecommendation): string {
  const sales = recommendation.sales.length > 0
    ? recommendation.sales
    : [{
        source_kind: recommendation.sell_stock_id === null ? "synthetic" as const : "stock" as const,
        source_row_id: null,
        stock_id: recommendation.sell_stock_id,
        acronym: recommendation.sell_acronym,
        name: recommendation.sell_name,
        shares: recommendation.sell_shares,
        sale_value: recommendation.sale_value,
        sale_fee: recommendation.sale_fee,
        current_annual_return: recommendation.current_annual_return,
      }];

  return sales
    .map((sale) => sale.source_kind === "synthetic"
      ? `${sale.acronym ?? "FHG/TCI Hybrid"} block`
      : `${formatNumber(sale.shares)} ${saleLabel(sale)} shares`)
    .join(", ");
}

function rebalanceProposedDetail(recommendation: StockBuyRecommendation, bankMerits: number): string {
  if (recommendation.row.investment_type === "city_bank") {
    return `City Bank uses ${bankMerits}/10 merits.`;
  }
  if (isFhgTciHybridRow(recommendation.row)) {
    return `TCI plus 83/90 FHG using ${bankMerits}/10 merits.`;
  }
  if (isBankInterestBonusRow(recommendation.row)) {
    return `${recommendation.row.benefit_description} using ${bankMerits}/10 merits.`;
  }

  return `${recommendation.row.benefit_description} every ${formatNumber(recommendation.row.frequency_days)} days.`;
}

function strategyStepTitle(step: StockStrategyStep): string {
  if (step.kind === "rebalance" && step.sales.length > 0) {
    return `Sell ${strategySaleLabels(step)}, buy ${bestOpportunityTitle(step.recommendation.row)}`;
  }
  if (step.kind === "convert") {
    return `Convert to ${bestOpportunityTitle(step.recommendation.row)}`;
  }

  return `Buy ${bestOpportunityTitle(step.recommendation.row)}`;
}

function strategyReasonLabel(step: StockStrategyStep): string {
  if (step.kind === "rebalance" && step.extra_cash_needed <= 0) {
    return "No extra cash";
  }
  if (step.kind === "rebalance") {
    return "Funded by sales";
  }
  if (step.kind === "convert") {
    return "Convert capital";
  }
  if (step.extra_cash_needed <= 0) {
    return "Affordable now";
  }
  if (step.recommendation.personalized && step.recommendation.owned_shares > 0) {
    return "Closest completion";
  }
  return "ROI milestone";
}

function strategyStepDescription(step: StockStrategyStep, bankMerits: number): string {
  const recommendation = step.recommendation;
  const row = recommendation.row;
  const cashText = step.extra_cash_needed > 0
    ? `Save ${formatInstructionMoney(step.extra_cash_needed)} more cash. `
    : "";
  if (step.kind === "rebalance" && step.sales.length > 0) {
    return `${strategyRebalanceFundingDescription(step)} Sources: ${strategySaleDescription(step)}.`;
  }
  if (step.kind === "convert" && isFhgTciHybridRow(row)) {
    const conversion = recommendation.hybrid_conversion;
    const componentLabel = conversion?.acronym ?? "FHG/TCI";
    return `Convert existing ${componentLabel} capital into the FHG/TCI Hybrid.`;
  }
  if (row.investment_type === "city_bank") {
    return `${cashText}Add City Bank for ${formatInstructionMoney(recommendation.estimated_cost)} with ${bankMerits}/10 merits.`;
  }
  if (isFhgTciHybridRow(row)) {
    return `${cashText}Buy/hold the FHG/TCI Hybrid for ${formatInstructionMoney(recommendation.estimated_cost)} additional capital.`;
  }

  const sharesText = recommendation.personalized && recommendation.owned_shares > 0
    ? `Buy ${formatNumber(recommendation.shares_needed ?? 0)} more shares`
    : `Buy ${formatNumber(recommendation.shares_needed ?? recommendation.target_shares ?? 0)} shares`;
  return `${cashText}${sharesText} to reach ${formatNumber(recommendation.target_shares ?? 0)}.`;
}

function strategySaleLabels(step: StockStrategyStep): string {
  return step.sales
    .map((sale) => saleLabel(sale))
    .join(" + ");
}

function strategyRebalanceFundingDescription(step: StockStrategyStep): string {
  const saleValue = step.sales.reduce((sum, sale) => sum + sale.sale_value, 0);
  const cashText = step.extra_cash_needed > 0
    ? `Save ${formatInstructionMoney(step.extra_cash_needed)} more cash, then use`
    : "Use";
  const holdingText = step.sales.length === 1
    ? "1 holding"
    : `${formatNumber(step.sales.length)} holdings`;
  const feeText = step.rebalance && step.rebalance.sale_fee > 0
    ? ` after ${formatInstructionMoney(step.rebalance.sale_fee)} sell fee`
    : "";
  return `${cashText} ${formatInstructionMoney(saleValue)} net sale value${feeText} from ${holdingText} to fund ${bestOpportunityTitle(step.recommendation.row)}.`;
}

function strategySaleDescription(step: StockStrategyStep): string {
  return step.sales
    .map((sale) => sale.source_kind === "synthetic"
      ? `${sale.acronym ?? "FHG/TCI Hybrid"} (${formatInstructionMoney(sale.sale_value)})`
      : `${formatNumber(sale.shares)} ${saleLabel(sale)} (${formatInstructionMoney(sale.sale_value)})`)
    .join(", ");
}

function saleLabel(sale: StockStrategyStep["sales"][number] | null): string {
  if (!sale) {
    return "holding";
  }
  return sale.acronym ?? stockSaleFallbackLabel(sale.stock_id);
}

function stockSaleFallbackLabel(stockId: number | null): string {
  return stockId === null ? "FHG/TCI Hybrid" : `#${stockId}`;
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

function sortStockRoiRows(
  rows: StockInvestmentRecommendationRow[],
  sort: StockRoiSort,
  ownedShares: Map<number, number>,
  hasOwnedSnapshot: boolean,
  fhgTciHybridActive: boolean,
): StockInvestmentRecommendationRow[] {
  return [...rows].sort((a, b) => {
    const compared = compareStockRoiRows(a, b, sort.key, ownedShares, hasOwnedSnapshot, fhgTciHybridActive);
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

function compareStockRoiRows(
  a: StockInvestmentRoiRow,
  b: StockInvestmentRoiRow,
  key: StockRoiSortKey,
  ownedShares: Map<number, number>,
  hasOwnedSnapshot: boolean,
  fhgTciHybridActive: boolean,
): number {
  const metricsA = stockInvestmentRowMetrics(a, { ownedShares, hasOwnedSnapshot, fhgTciHybridActive });
  const metricsB = stockInvestmentRowMetrics(b, { ownedShares, hasOwnedSnapshot, fhgTciHybridActive });
  switch (key) {
    case "acronym":
      return compareText(rowAcronym(a), rowAcronym(b));
    case "name":
      return compareText(`${a.name ?? ""} ${a.increment ?? ""}`, `${b.name ?? ""} ${b.increment ?? ""}`);
    case "shares":
      return compareNullableNumber(a.required_shares, b.required_shares);
    case "increment_cost":
      return metricsA.estimated_cost - metricsB.estimated_cost;
    case "benefit":
      return compareText(a.benefit_description, b.benefit_description);
    case "annual_return":
      return a.annual_return - b.annual_return;
    case "days_to_break_even":
      return metricsA.days_to_break_even - metricsB.days_to_break_even;
    case "roi_percent":
      return metricsA.roi_percent - metricsB.roi_percent;
  }
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function rowAcronym(row: StockInvestmentRecommendationRow): string {
  return row.acronym ?? (row.stock_id ? `#${row.stock_id}` : row.row_id);
}

function isStockInvestmentRow(row: StockInvestmentRecommendationRow): row is StockInvestmentRoiRow & {
  investment_type: "stock";
  stock_id: number;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
} {
  return row.investment_type === "stock" && row.stock_id !== null && row.increment !== null;
}

function isBankInterestBonusRow(row: StockInvestmentRecommendationRow): boolean {
  return row.benefit_key === "city_bank:tci_bonus";
}

function isInvestmentRowCovered(
  row: StockInvestmentRecommendationRow,
  ownedShares: Map<number, number>,
  hasOwnedSnapshot: boolean,
  cityBankActive: boolean,
  fhgTciHybridActive: boolean,
): boolean {
  if (row.investment_type === "city_bank") {
    return cityBankActive;
  }

  if (isFhgTciHybridRow(row)) {
    return stockInvestmentRowMetrics(row, {
      ownedShares,
      hasOwnedSnapshot,
      fhgTciHybridActive,
    }).covered;
  }

  if (!isStockInvestmentRow(row)) {
    return false;
  }

  return ownsStockIncrement(ownedShares.get(row.stock_id) ?? 0, row.total_shares_required);
}

function nextStockBlockIds(
  rows: StockInvestmentRecommendationRow[],
  ownedShares: Map<number, number>,
  hasOwnedSnapshot: boolean,
): Set<string> {
  const rowsByStockId = rows.filter(isStockInvestmentRow).reduce((map, row) => {
    const stockRows = map.get(row.stock_id) ?? [];
    stockRows.push(row);
    map.set(row.stock_id, stockRows);
    return map;
  }, new Map<number, StockInvestmentRecommendationRow[]>());
  const rowIds = new Set<string>();

  for (const [stockId, stockRows] of rowsByStockId) {
    const owned = hasOwnedSnapshot ? ownedShares.get(stockId) ?? 0 : 0;
    const nextRow = [...stockRows]
      .sort((left, right) => (left.increment ?? 0) - (right.increment ?? 0))
      .find((row) => !ownsStockIncrement(owned, row.total_shares_required ?? 0));
    if (nextRow) {
      rowIds.add(nextRow.row_id);
    }
  }

  return rowIds;
}

function ownedStockLockOptions(snapshot: OwnedStockSnapshot | null, rows: StockInvestmentRecommendationRow[]): StockLockOption[] {
  if (!snapshot) {
    return [];
  }

  const stockLabels = rows.filter(isStockInvestmentRow).reduce((map, row) => {
    if (!map.has(row.stock_id)) {
      map.set(row.stock_id, {
        acronym: row.acronym,
        name: row.name,
      });
    }
    return map;
  }, new Map<number, Pick<StockLockOption, "acronym" | "name">>());

  return snapshot.stocks
    .filter((stock) => stock.shares > 0)
    .map((stock) => ({
      stock_id: stock.stock_id,
      acronym: stockLabels.get(stock.stock_id)?.acronym ?? null,
      name: stockLabels.get(stock.stock_id)?.name ?? null,
      shares: stock.shares,
    }))
    .sort((left, right) => compareText(left.acronym ?? `#${left.stock_id}`, right.acronym ?? `#${right.stock_id}`));
}

function stockCostDetail(row: StockInvestmentRecommendationRow, metrics: StockInvestmentRowMetrics): string | null {
  if (isFhgTciHybridRow(row)) {
    if (metrics.covered) {
      return "Active";
    }
    return metrics.personalized && metrics.estimated_cost !== row.increment_cost
      ? `Reusable capital: ${formatMoney(row.increment_cost - metrics.estimated_cost)}`
      : "Synthetic block";
  }
  if (!isStockInvestmentRow(row)) {
    return null;
  }

  if (metrics.covered) {
    return "Covered";
  }
  if (!metrics.personalized || metrics.estimated_cost === row.increment_cost) {
    return null;
  }

  return `Increment: ${formatMoney(row.increment_cost)}`;
}

function bestOpportunityTitle(row: StockInvestmentRecommendationRow): string {
  if (row.investment_type === "city_bank") {
    return "BANK 90 days";
  }
  if (isFhgTciHybridRow(row)) {
    return "FHG/TCI Hybrid";
  }

  return `${row.acronym ?? `#${row.stock_id}`} Block ${row.increment ?? "-"}`;
}

function bestBuyRecommendationDetail(recommendation: StockBuyRecommendation, bankMerits: number): string {
  if (recommendation.row.investment_type === "city_bank") {
    return `City Bank - ${bankMerits}/10 Merits`;
  }
  if (isFhgTciHybridRow(recommendation.row)) {
    if (recommendation.hybrid_conversion) {
      return `Convert existing ${recommendation.hybrid_conversion.acronym ?? "FHG/TCI"} capital`;
    }
    return "Synthetic block - TCI + 83/90 FHG";
  }

  if (!recommendation.personalized) {
    return `${formatNumber(recommendation.target_shares ?? 0)} shares required`;
  }

  if (recommendation.owned_shares > 0) {
    return `You own ${formatNumber(recommendation.owned_shares)}; buy ${formatNumber(recommendation.shares_needed ?? 0)} more to reach ${formatNumber(recommendation.target_shares ?? 0)}`;
  }

  return `Buy ${formatNumber(recommendation.shares_needed ?? 0)} shares to reach ${formatNumber(recommendation.target_shares ?? 0)}`;
}

function stockRowSubtitle(row: StockInvestmentRecommendationRow, isStockRow: boolean, bankMerits: number): string {
  if (isFhgTciHybridRow(row)) {
    return "Synthetic block";
  }
  return isStockRow ? `Block ${row.increment}` : `${CITY_BANK_TERM_DAYS} days (${bankMerits}/10 Merits)`;
}

function stockBenefitDetail(row: StockInvestmentRecommendationRow, isStockRow: boolean, bankMerits: number): string {
  if (isFhgTciHybridRow(row)) {
    return "TCI + 83/90 FHG";
  }
  if (isBankInterestBonusRow(row)) {
    return `${formatNumber(row.frequency_days)} days - ${bankMerits}/10 Merits`;
  }
  return isStockRow
    ? `${formatNumber(row.frequency_days)} days - ${valuationSourceLabel(row.valuation_source)} value`
    : `${CITY_BANK_TERM_DAYS} days - ${bankMerits}/10 Merits`;
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

function stockLabel(stock: Pick<StockBenefitStock, "stock_id" | "acronym" | "name">): string {
  return stock.acronym ?? stock.name ?? `#${stock.stock_id}`;
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

function readLockedStockIdsStorage(userId: number | null): Set<number> {
  const key = lockedStockIdsStorageKey(userId);
  if (!key) {
    return new Set();
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is number => Number.isInteger(value) && value > 0))
      : new Set();
  } catch {
    window.localStorage.removeItem(key);
    return new Set();
  }
}

function saveLockedStockIdsStorage(userId: number | null, stockIds: ReadonlySet<number>): void {
  const key = lockedStockIdsStorageKey(userId);
  if (!key) {
    return;
  }

  const values = [...stockIds].filter((stockId) => Number.isInteger(stockId) && stockId > 0).sort((left, right) => left - right);
  if (values.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(values));
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

function lockedStockIdsStorageKey(userId: number | null): string | null {
  return userId ? `stockRoiLockedStockIds:${userId}` : null;
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

function readFhgTciHybridStorage(userId: number | null): boolean {
  const key = fhgTciHybridStorageKey(userId);
  return key ? window.localStorage.getItem(key) === "1" : false;
}

function saveFhgTciHybridStorage(userId: number | null, active: boolean): void {
  const key = fhgTciHybridStorageKey(userId);
  if (!key) {
    return;
  }

  window.localStorage.setItem(key, active ? "1" : "0");
}

function readPanelOpenStorage(userId: number | null, panel: StockPanelStorageKey, defaultOpen: boolean): boolean {
  const key = panelOpenStorageKey(userId, panel);
  if (!key) {
    return defaultOpen;
  }

  const stored = window.localStorage.getItem(key);
  return stored === null ? defaultOpen : stored === "1";
}

function savePanelOpenStorage(userId: number | null, panel: StockPanelStorageKey, open: boolean): void {
  const key = panelOpenStorageKey(userId, panel);
  if (!key) {
    return;
  }

  window.localStorage.setItem(key, open ? "1" : "0");
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

function fhgTciHybridStorageKey(userId: number | null): string | null {
  return userId ? `stockRoiFhgTciHybridActive:${userId}` : null;
}

function panelOpenStorageKey(userId: number | null, panel: StockPanelStorageKey): string | null {
  return userId ? `stockRoiPanelOpen:${panel}:${userId}` : null;
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

function formatInstructionMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (Math.abs(value) < 500_000) {
    return formatMoney(value);
  }

  return `$${formatNumber(Math.round(value / 1_000_000))}m`;
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
