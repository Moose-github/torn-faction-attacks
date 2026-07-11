import React from "react";
import { RefreshCw, RotateCcw, Save } from "lucide-react";
import {
  getStockBenefitValues,
  getStockInvestmentRoi,
  StockBenefitValue,
  StockInvestmentRoiResponse,
  StockInvestmentRoiRow,
  updateStockBenefitValue,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatNumber } from "../utils/format";

export function StockInvestments() {
  const [roiData, setRoiData] = React.useState<StockInvestmentRoiResponse | null>(null);
  const [benefits, setBenefits] = React.useState<StockBenefitValue[]>([]);
  const [benefitInputs, setBenefitInputs] = React.useState<Record<string, string>>({});
  const [investmentAmount, setInvestmentAmount] = React.useState("");
  const [affordableOnly, setAffordableOnly] = React.useState(false);
  const [minimumRoi, setMinimumRoi] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [savingBenefitKey, setSavingBenefitKey] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
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

  React.useEffect(() => {
    loadData();
  }, []);

  const budget = moneyInputValue(investmentAmount);
  const minRoi = percentInputValue(minimumRoi);
  const rows = (roiData?.rows ?? []).filter((row) => {
    if (affordableOnly && budget !== null && row.increment_cost > budget) {
      return false;
    }
    if (minRoi !== null && row.roi_percent < minRoi) {
      return false;
    }
    return true;
  });
  const skippedTotal = (roiData?.skipped.passive ?? 0) + (roiData?.skipped.unpriced ?? 0) + (roiData?.skipped.invalid ?? 0);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      {message ? <div className="dashboard-suggestion-success">{message}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Stocks</p>
          <h2>Stock ROI</h2>
          <p>Active stock benefit increments ranked by estimated annual return against current stock prices.</p>
        </div>
        <button type="button" className="panel-action-button" disabled={isLoading} onClick={loadData}>
          <RefreshCw size={14} className={isLoading ? "spinning-icon" : ""} />
          {isLoading ? "Refreshing" : "Refresh"}
        </button>
      </section>

      <section className="status-grid stock-status-grid stock-investment-status-grid">
        <StatusMetric
          label="Data refreshed"
          value={formatLongDateTime(roiData?.refreshed_at ?? null)}
          detail="Latest stock snapshot used for pricing"
        />
        <StatusMetric
          label="ROI rows"
          value={formatNumber(roiData?.rows.length ?? 0)}
          detail={`${formatNumber(rows.length)} after filters`}
        />
        <StatusMetric
          label="Skipped"
          value={formatNumber(skippedTotal)}
          detail={`${formatNumber(roiData?.skipped.unpriced ?? 0)} need valuation`}
        />
      </section>

      <section className="panel stock-investment-controls-panel">
        <PanelHeader title="Filters" aside={affordableOnly ? "Budget applied" : "All increments"} />
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
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Active benefit increments" aside={`${formatNumber(rows.length)} shown`} />
        {isLoading ? (
          <EmptyState text="Loading stock ROI" />
        ) : rows.length === 0 ? (
          <EmptyState text="No stock increments match the current filters" />
        ) : (
          <StockRoiTable rows={rows} />
        )}
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Benefit values" aside={`${formatNumber(benefits.length)} editable`} />
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

function StockRoiTable({ rows }: { rows: StockInvestmentRoiRow[] }) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table stock-investment-table">
        <thead>
          <tr>
            <th>Acronym</th>
            <th>Name</th>
            <th>Increment</th>
            <th>Shares</th>
            <th>Total Shares</th>
            <th>Increment Cost</th>
            <th>Total Cost</th>
            <th>Benefit</th>
            <th>Frequency</th>
            <th>Annual Return</th>
            <th>Break Even</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.increment}`}>
              <td>{row.acronym ?? `#${row.stock_id}`}</td>
              <td>{row.name ?? "-"}</td>
              <td>{row.increment}</td>
              <td>{formatNumber(row.required_shares)}</td>
              <td>{formatNumber(row.total_shares_required)}</td>
              <td>{formatMoney(row.increment_cost)}</td>
              <td>{formatMoney(row.total_cost)}</td>
              <td>
                <span className="stock-benefit-cell">
                  <strong>{row.benefit_description}</strong>
                  <small>{valuationSourceLabel(row.valuation_source)}</small>
                </span>
              </td>
              <td>{formatNumber(row.frequency_days)} days</td>
              <td>{formatMoney(row.annual_return)}</td>
              <td>{formatNumber(Math.round(row.days_to_break_even))} days</td>
              <td>{formatPercent(row.roi_percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  return (
    <div className="table-scroll">
      <table className="stock-status-table stock-benefit-values-table">
        <thead>
          <tr>
            <th>Benefit</th>
            <th>Default</th>
            <th>Custom</th>
            <th>Effective</th>
            <th>Source</th>
            <th>Used By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {benefits.map((benefit) => {
            const isSaving = savingBenefitKey === benefit.benefit_key;
            const inputValue = inputs[benefit.benefit_key] ?? "";
            const canSave = moneyInputValue(inputValue) !== null;
            return (
              <tr key={benefit.benefit_key}>
                <td>
                  <span className="stock-benefit-cell">
                    <strong>{benefit.label}</strong>
                    <small>{benefit.benefit_key}</small>
                  </span>
                </td>
                <td>{formatMoney(benefit.default_value)}</td>
                <td>
                  <input
                    className="stock-benefit-value-input"
                    inputMode="numeric"
                    value={inputValue}
                    onChange={(event) => onInputChange(benefit.benefit_key, event.target.value)}
                    placeholder="Set value"
                  />
                </td>
                <td>{formatMoney(benefit.effective_value)}</td>
                <td>{statusLabel(benefit.source)}</td>
                <td>{formatNumber(benefit.used_by_stock_count)}</td>
                <td>
                  <div className="stock-benefit-actions">
                    <button
                      type="button"
                      className="panel-action-button secondary"
                      disabled={isSaving || !canSave}
                      onClick={() => onSave(benefit)}
                    >
                      {isSaving ? <RefreshCw size={14} className="spinning-icon" /> : <Save size={14} />}
                      Save
                    </button>
                    <button
                      type="button"
                      className="panel-action-button secondary"
                      disabled={isSaving || benefit.override_value === null}
                      onClick={() => onReset(benefit)}
                    >
                      <RotateCcw size={14} />
                      Reset
                    </button>
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

function StatusMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <span className="panel-kicker">{label}</span>
      <strong className="metric-card-value">{value}</strong>
      <span className="metric-card-detail">{detail}</span>
    </div>
  );
}

function inputsFromBenefits(benefits: StockBenefitValue[]): Record<string, string> {
  return Object.fromEntries(benefits.map((benefit) => [
    benefit.benefit_key,
    String(Math.round(benefit.override_value ?? benefit.default_value ?? benefit.effective_value ?? 0) || ""),
  ]));
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
