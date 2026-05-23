import React from "react";
import {
  getMiscellaneousData,
  getWar,
  getWars,
  MemberStats,
  MiscellaneousResponse,
  WarDetailResponse,
  WarSummary,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { detailNumber, formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";
import { displayMember, memberDefendsLost } from "../utils/members";

type PayoutMode = "points" | "respect";
type RespectBasis = "adjusted" | "raw";
type PercentageRuleType = "bonus" | "penalty";
type PayoutMetric =
  | "average_fair_fight"
  | "defends_lost"
  | "defends_total"
  | "defends_won"
  | "defends_other"
  | "defends_lost_non_hospitalized"
  | "attacks_vs_enemy_successful"
  | "outside_hits"
  | "assists_vs_enemy"
  | "friendly_hosps"
  | "hospitalizations_vs_enemy"
  | "mugs_vs_enemy"
  | "retaliations_vs_enemy"
  | "respect_gained"
  | "respect_gained_raw"
  | "respect_lost"
  | "respect_lost_raw"
  | "respect_lost_non_hospitalized";
type BonusOperator = ">=" | ">" | "<=" | "<" | "=";

type PointRule = {
  id: string;
  metric: PayoutMetric;
  points: string;
};

type FlatPaymentRule = {
  id: string;
  metric: PayoutMetric;
  amount: string;
};

type BonusRule = {
  id: string;
  type: PercentageRuleType;
  metric: PayoutMetric;
  operator: BonusOperator;
  threshold: string;
  percent: string;
};

type PayoutRow = {
  member: MemberStats;
  basis: number;
  bonusPercent: number;
  penaltyPercent: number;
  netPercent: number;
  adjustedBasis: number;
  flatPayment: number;
  variablePayment: number;
  finalPayment: number;
};

const DEFAULT_BONUS_RULES: BonusRule[] = [
  {
    id: "fair-fight-3",
    type: "bonus",
    metric: "average_fair_fight",
    operator: ">=",
    threshold: "3",
    percent: "10",
  },
  {
    id: "fair-fight-25",
    type: "bonus",
    metric: "average_fair_fight",
    operator: ">=",
    threshold: "2.5",
    percent: "8",
  },
  {
    id: "defends-lost-10",
    type: "bonus",
    metric: "defends_lost",
    operator: "<",
    threshold: "10",
    percent: "10",
  },
];

const PAYOUT_METRICS: Array<{ value: PayoutMetric; label: string }> = [
  { value: "attacks_vs_enemy_successful", label: "War hits" },
  { value: "outside_hits", label: "Outside hits" },
  { value: "assists_vs_enemy", label: "Assists" },
  { value: "friendly_hosps", label: "Friendly hosps" },
  { value: "hospitalizations_vs_enemy", label: "Hospitalizations" },
  { value: "mugs_vs_enemy", label: "Mugs" },
  { value: "retaliations_vs_enemy", label: "Retaliations" },
  { value: "defends_total", label: "Defends" },
  { value: "defends_won", label: "Defends won" },
  { value: "defends_other", label: "Other defends" },
  { value: "defends_lost", label: "Defends lost" },
  { value: "defends_lost_non_hospitalized", label: "Non-hosp defends lost" },
  { value: "respect_gained", label: "Respect gained" },
  { value: "respect_gained_raw", label: "Respect gained raw" },
  { value: "respect_lost", label: "Respect lost" },
  { value: "respect_lost_raw", label: "Respect lost raw" },
  { value: "respect_lost_non_hospitalized", label: "Non-hosp respect lost" },
  { value: "average_fair_fight", label: "Average fair fight" },
];

const DEFAULT_POINT_RULES: PointRule[] = [
  { id: "points-war-hits", metric: "attacks_vs_enemy_successful", points: "1" },
  { id: "points-outside-hits", metric: "outside_hits", points: "0.9" },
  { id: "points-assists", metric: "assists_vs_enemy", points: "0.75" },
];

const DEFAULT_FLAT_PAYMENT_RULES: FlatPaymentRule[] = [
  { id: "flat-friendly-hosps", metric: "friendly_hosps", amount: "2000000" },
];

export function Miscellaneous() {
  const [data, setData] = React.useState<MiscellaneousResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getMiscellaneousData();
        if (!cancelled) {
          setData(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
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

  const rows = shopliftingRows(data?.shoplifting ?? {});
  const fetchedAt = data?.fetched_at ?? null;

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Miscellaneous</p>
          <h2>Miscellaneous</h2>
          <p>Useful tools and live information that do not fit cleanly into the main war views.</p>
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Shoplifting"
          aside={isLoading ? "Loading" : fetchedAt ? `Updated ${formatRelativeTime(fetchedAt)}` : "No data"}
        />
        {data?.error ? <p className="form-error">{data.error}</p> : null}
        {fetchedAt ? (
          <p className="panel-description">
            Cached Torn shoplifting obstacles and security status from the one-minute refresh. Last fetched{" "}
            {formatLongDateTime(fetchedAt)}.
          </p>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState text={isLoading ? "Loading shoplifting data" : "No shoplifting data cached yet"} />
        ) : (
          <div className="table-scroll">
            <table className="shoplifting-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Obstacle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.shopKey}>
                    <td>{formatShopName(row.shopKey)}</td>
                    <td>
                      <div className="shoplifting-obstacle-stack">
                        {row.obstacles.map((obstacle) => (
                          <span key={obstacle.title}>{obstacle.title}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="shoplifting-obstacle-stack">
                        {row.obstacles.map((obstacle) => (
                          <span
                            className={obstacle.disabled ? "shoplifting-status disabled" : "shoplifting-status active"}
                            key={obstacle.title}
                          >
                            {obstacle.disabled ? "Disabled" : "Active"}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function WarPayoutCalculator() {
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState("");
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
  const [isLoadingWars, setIsLoadingWars] = React.useState(true);
  const [isLoadingWar, setIsLoadingWar] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [poolInput, setPoolInput] = React.useState("");
  const [mode, setMode] = React.useState<PayoutMode>("points");
  const [respectBasis, setRespectBasis] = React.useState<RespectBasis>("adjusted");
  const [pointRules, setPointRules] = React.useState<PointRule[]>(DEFAULT_POINT_RULES);
  const [flatPaymentRules, setFlatPaymentRules] =
    React.useState<FlatPaymentRule[]>(DEFAULT_FLAT_PAYMENT_RULES);
  const [pointMetricToAdd, setPointMetricToAdd] =
    React.useState<PayoutMetric>("attacks_vs_enemy_successful");
  const [flatMetricToAdd, setFlatMetricToAdd] =
    React.useState<PayoutMetric>("friendly_hosps");
  const [bonusRules, setBonusRules] = React.useState<BonusRule[]>(DEFAULT_BONUS_RULES);

  React.useEffect(() => {
    let cancelled = false;

    async function loadWars() {
      setIsLoadingWars(true);
      setError(null);

      try {
        const response = await getWars("all");
        if (cancelled) {
          return;
        }

        const payoutWars = response.wars.filter((war) => war.status !== "scheduled");
        setWars(payoutWars);
        setSelectedWarName((current) => current || payoutWars[0]?.name || "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWars(false);
        }
      }
    }

    loadWars();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadWar() {
      if (!selectedWarName) {
        setWarDetail(null);
        return;
      }

      setIsLoadingWar(true);
      setError(null);

      try {
        const response = await getWar(selectedWarName);
        if (!cancelled) {
          setWarDetail(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setWarDetail(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWar(false);
        }
      }
    }

    loadWar();
    return () => {
      cancelled = true;
    };
  }, [selectedWarName]);

  const members = React.useMemo(
    () => [...(warDetail?.members ?? [])].sort((a, b) => b.respect_gained - a.respect_gained),
    [warDetail?.members],
  );
  const payout = React.useMemo(
    () =>
      calculatePayoutRows({
        members,
        totalPool: moneyInput(poolInput),
        mode,
        respectBasis,
        pointRules,
        flatPaymentRules,
        bonusRules,
      }),
    [
      bonusRules,
      flatPaymentRules,
      members,
      mode,
      pointRules,
      poolInput,
      respectBasis,
    ],
  );

  const availablePointMetrics = availableMetrics(pointRules.map((rule) => rule.metric));
  const availableFlatMetrics = availableMetrics(flatPaymentRules.map((rule) => rule.metric));

  React.useEffect(() => {
    if (!availablePointMetrics.some((metric) => metric.value === pointMetricToAdd)) {
      setPointMetricToAdd(availablePointMetrics[0]?.value ?? "attacks_vs_enemy_successful");
    }
  }, [availablePointMetrics, pointMetricToAdd]);

  React.useEffect(() => {
    if (!availableFlatMetrics.some((metric) => metric.value === flatMetricToAdd)) {
      setFlatMetricToAdd(availableFlatMetrics[0]?.value ?? "friendly_hosps");
    }
  }, [availableFlatMetrics, flatMetricToAdd]);

  function updatePointRule(id: string, patch: Partial<PointRule>) {
    setPointRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function addPointRule() {
    if (availablePointMetrics.length === 0) {
      return;
    }

    setPointRules((current) => [
      ...current,
      {
        id: `points-${Date.now()}`,
        metric: pointMetricToAdd,
        points: "1",
      },
    ]);
  }

  function removePointRule(id: string) {
    setPointRules((current) => current.filter((rule) => rule.id !== id));
  }

  function updateFlatPaymentRule(id: string, patch: Partial<FlatPaymentRule>) {
    setFlatPaymentRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function addFlatPaymentRule() {
    if (availableFlatMetrics.length === 0) {
      return;
    }

    setFlatPaymentRules((current) => [
      ...current,
      {
        id: `flat-${Date.now()}`,
        metric: flatMetricToAdd,
        amount: "0",
      },
    ]);
  }

  function removeFlatPaymentRule(id: string) {
    setFlatPaymentRules((current) => current.filter((rule) => rule.id !== id));
  }

  function updateBonusRule(id: string, patch: Partial<BonusRule>) {
    setBonusRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function addBonusRule() {
    setBonusRules((current) => [
      ...current,
      {
        id: `bonus-${Date.now()}`,
        type: "bonus",
        metric: "average_fair_fight",
        operator: ">=",
        threshold: "",
        percent: "",
      },
    ]);
  }

  function removeBonusRule(id: string) {
    setBonusRules((current) => current.filter((rule) => rule.id !== id));
  }

  return (
    <>
      <PanelHeader
        title="Calculator"
        aside={isLoadingWar ? "Loading war" : `${members.length} members`}
      />
      <p className="panel-description">
        Draft calculator for splitting war reward money. Flat payments are deducted from the pool first; bonuses
        rebalance each member's share of the remaining pool.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="payout-controls">
        <label>
          <span>War</span>
          <select
            value={selectedWarName}
            onChange={(event) => setSelectedWarName(event.target.value)}
            disabled={isLoadingWars || wars.length === 0}
          >
            {wars.map((war) => (
              <option key={war.id} value={war.name}>
                {war.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Total payout pool</span>
          <input
            inputMode="numeric"
            value={poolInput}
            onChange={(event) => setPoolInput(event.target.value)}
            placeholder="1000000000"
          />
        </label>
        <label>
          <span>Mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as PayoutMode)}>
            <option value="points">Points</option>
            <option value="respect">Respect</option>
          </select>
        </label>
        {mode === "respect" ? (
          <label>
            <span>Respect basis</span>
            <select
              value={respectBasis}
              onChange={(event) => setRespectBasis(event.target.value as RespectBasis)}
            >
              <option value="adjusted">Adjusted respect</option>
              <option value="raw">Raw respect</option>
            </select>
          </label>
        ) : null}
      </div>

      {mode === "points" ? (
        <section className="payout-rule-section payout-section-divider">
          <div className="payout-section-header">
            <div>
              <strong>Points</strong>
              <p>Choose which member stats create payout points.</p>
            </div>
            <div className="payout-add-control">
              <select
                value={pointMetricToAdd}
                onChange={(event) => setPointMetricToAdd(event.target.value as PayoutMetric)}
                disabled={availablePointMetrics.length === 0}
              >
                {availablePointMetrics.map((metric) => (
                  <option key={metric.value} value={metric.value}>
                    {metric.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="panel-action-button"
                onClick={addPointRule}
                disabled={availablePointMetrics.length === 0}
              >
                Add variable
              </button>
            </div>
          </div>
          <div className="table-scroll">
            <table className="payout-rules-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Points per</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pointRules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{payoutMetricLabel(rule.metric)}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={rule.points}
                        onChange={(event) => updatePointRule(rule.id, { points: event.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="panel-action-button"
                        onClick={() => removePointRule(rule.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="payout-rule-section payout-section-divider">
        <div className="payout-section-header">
          <div>
            <strong>Flat payments</strong>
            <p>Flat payments are always deducted from the total pool before the remaining pool is split.</p>
          </div>
          <div className="payout-add-control">
            <select
              value={flatMetricToAdd}
              onChange={(event) => setFlatMetricToAdd(event.target.value as PayoutMetric)}
              disabled={availableFlatMetrics.length === 0}
            >
              {availableFlatMetrics.map((metric) => (
                <option key={metric.value} value={metric.value}>
                  {metric.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="panel-action-button"
              onClick={addFlatPaymentRule}
              disabled={availableFlatMetrics.length === 0}
            >
              Add variable
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="payout-rules-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Payment per</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flatPaymentRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{payoutMetricLabel(rule.metric)}</td>
                  <td>
                    <input
                      inputMode="numeric"
                      value={rule.amount}
                      onChange={(event) => updateFlatPaymentRule(rule.id, { amount: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="panel-action-button"
                      onClick={() => removeFlatPaymentRule(rule.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="payout-bonus-rules payout-section-divider">
        <div className="payout-section-header">
          <div>
            <strong>Percentage adjustment rules</strong>
            <p>Use bonuses or penalties. Only the strongest matching rule for each metric and type is used.</p>
          </div>
          <button type="button" className="panel-action-button" onClick={addBonusRule}>
            Add rule
          </button>
        </div>
        <div className="table-scroll">
          <table className="payout-rules-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Value</th>
                <th>Percent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bonusRules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <select
                      value={rule.type}
                      onChange={(event) =>
                        updateBonusRule(rule.id, { type: event.target.value as PercentageRuleType })
                      }
                    >
                      <option value="bonus">Bonus</option>
                      <option value="penalty">Penalty</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={rule.metric}
                      onChange={(event) => updateBonusRule(rule.id, { metric: event.target.value as PayoutMetric })}
                    >
                      {PAYOUT_METRICS.map((metric) => (
                        <option key={metric.value} value={metric.value}>
                          {metric.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={rule.operator}
                      onChange={(event) => updateBonusRule(rule.id, { operator: event.target.value as BonusOperator })}
                    >
                      <option value=">=">&gt;=</option>
                      <option value=">">&gt;</option>
                      <option value="<=">&lt;=</option>
                      <option value="<">&lt;</option>
                      <option value="=">=</option>
                    </select>
                  </td>
                  <td>
                    <input inputMode="decimal" value={rule.threshold} onChange={(event) => updateBonusRule(rule.id, { threshold: event.target.value })} />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      aria-label="Adjustment percentage"
                      value={rule.percent}
                      onChange={(event) => updateBonusRule(rule.id, { percent: event.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="panel-action-button" onClick={() => removeBonusRule(rule.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="payout-summary-grid payout-section-divider">
        <PayoutSummaryItem label="Total pool" value={payout.totalPool} />
        <PayoutSummaryItem label="Flat payments" value={payout.flatTotal} />
        <PayoutSummaryItem label="Remaining pool" value={payout.remainingPool} />
        <PayoutSummaryItem label="Final total" value={payout.finalTotal} />
      </div>
      {payout.flatTotal > payout.totalPool && payout.totalPool > 0 ? (
        <p className="form-error">Flat payments exceed the total pool, so no remaining pool is distributed.</p>
      ) : null}
      {members.length === 0 ? (
        <EmptyState text={isLoadingWar || isLoadingWars ? "Loading payout data" : "No member stats for this war"} />
      ) : (
        <div className="table-scroll">
          <table className="payout-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>{mode === "points" ? "Points" : "Respect"}</th>
                <th>Bonus %</th>
                <th>Penalty %</th>
                <th>Net %</th>
                <th>Flat</th>
                <th>Variable</th>
                <th>Final</th>
              </tr>
            </thead>
            <tbody>
              {payout.rows.map((row) => (
                <tr key={row.member.member_id}>
                  <td>{displayMember(row.member)}</td>
                  <td title={`Adjusted basis: ${formatDecimal(row.adjustedBasis)}`}>
                    {formatDecimal(row.basis)}
                  </td>
                  <td>{formatDecimal(row.bonusPercent)}%</td>
                  <td>{formatDecimal(row.penaltyPercent)}%</td>
                  <td>{formatDecimal(row.netPercent)}%</td>
                  <td>{formatMoney(row.flatPayment)}</td>
                  <td>{formatMoney(row.variablePayment)}</td>
                  <td>
                    <strong>{formatMoney(row.finalPayment)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PayoutSummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="payout-summary-item">
      <span>{label}</span>
      <strong>{formatMoney(value)}</strong>
    </div>
  );
}

function calculatePayoutRows({
  members,
  totalPool,
  mode,
  respectBasis,
  pointRules,
  flatPaymentRules,
  bonusRules,
}: {
  members: MemberStats[];
  totalPool: number;
  mode: PayoutMode;
  respectBasis: RespectBasis;
  pointRules: PointRule[];
  flatPaymentRules: FlatPaymentRule[];
  bonusRules: BonusRule[];
}): { rows: PayoutRow[]; totalPool: number; flatTotal: number; remainingPool: number; finalTotal: number } {
  const flatRows = members.map((member) => ({
    member,
    basis: memberPayoutBasis(member, mode, respectBasis, pointRules),
    ...memberPercentageAdjustments(member, bonusRules),
    flatPayment: memberFlatPayment(member, flatPaymentRules),
  }));
  const flatTotal = flatRows.reduce((total, row) => total + row.flatPayment, 0);
  const remainingPool = Math.max(0, totalPool - flatTotal);
  const weightedRows = flatRows.map((row) => ({
    ...row,
    adjustedBasis: row.basis * Math.max(0, 1 + row.netPercent / 100),
  }));
  const totalAdjustedBasis = weightedRows.reduce((total, row) => total + row.adjustedBasis, 0);
  const rows = weightedRows
    .map((row) => {
      const variablePayment =
        totalAdjustedBasis > 0 ? (row.adjustedBasis / totalAdjustedBasis) * remainingPool : 0;
      return {
        ...row,
        variablePayment,
        finalPayment: row.flatPayment + variablePayment,
      };
    })
    .sort((a, b) => b.finalPayment - a.finalPayment);

  return {
    rows,
    totalPool,
    flatTotal,
    remainingPool,
    finalTotal: rows.reduce((total, row) => total + row.finalPayment, 0),
  };
}

function memberPayoutBasis(
  member: MemberStats,
  mode: PayoutMode,
  respectBasis: RespectBasis,
  pointRules: PointRule[],
): number {
  if (mode === "respect") {
    return Math.max(
      0,
      respectBasis === "raw"
        ? detailNumber(member.respect_gained_raw, member.respect_gained)
        : Number(member.respect_gained ?? 0),
    );
  }

  return pointRules.reduce(
    (total, rule) => total + Math.max(0, memberMetricValue(member, rule.metric)) * decimalInput(rule.points),
    0,
  );
}

function memberFlatPayment(member: MemberStats, rules: FlatPaymentRule[]): number {
  return rules.reduce(
    (total, rule) => total + Math.max(0, memberMetricValue(member, rule.metric)) * moneyInput(rule.amount),
    0,
  );
}

function memberPercentageAdjustments(
  member: MemberStats,
  rules: BonusRule[],
): { bonusPercent: number; penaltyPercent: number; netPercent: number } {
  const bestBonusByMetric = new Map<PayoutMetric, number>();
  const bestPenaltyByMetric = new Map<PayoutMetric, number>();

  for (const rule of rules) {
    const threshold = decimalInput(rule.threshold);
    const percent = decimalInput(rule.percent);
    if (!Number.isFinite(threshold) || !Number.isFinite(percent) || percent <= 0) {
      continue;
    }

    if (!bonusRuleMatches(memberMetricValue(member, rule.metric), rule.operator, threshold)) {
      continue;
    }

    const target = rule.type === "penalty" ? bestPenaltyByMetric : bestBonusByMetric;
    target.set(rule.metric, Math.max(target.get(rule.metric) ?? 0, percent));
  }

  const bonusPercent = Array.from(bestBonusByMetric.values()).reduce((total, percent) => total + percent, 0);
  const penaltyPercent = Array.from(bestPenaltyByMetric.values()).reduce((total, percent) => total + percent, 0);
  return {
    bonusPercent,
    penaltyPercent,
    netPercent: bonusPercent - penaltyPercent,
  };
}

function memberMetricValue(member: MemberStats, metric: PayoutMetric): number {
  if (metric === "defends_lost") {
    return memberDefendsLost(member);
  }
  return Number(member[metric] ?? 0);
}

function availableMetrics(usedMetrics: PayoutMetric[]): Array<{ value: PayoutMetric; label: string }> {
  const used = new Set(usedMetrics);
  return PAYOUT_METRICS.filter((metric) => !used.has(metric.value));
}

function payoutMetricLabel(metric: PayoutMetric): string {
  return PAYOUT_METRICS.find((option) => option.value === metric)?.label ?? metric;
}

function bonusRuleMatches(value: number, operator: BonusOperator, threshold: number): boolean {
  switch (operator) {
    case ">=":
      return value >= threshold;
    case ">":
      return value > threshold;
    case "<=":
      return value <= threshold;
    case "<":
      return value < threshold;
    case "=":
      return value === threshold;
    default:
      return false;
  }
}

function moneyInput(value: string): number {
  return Math.max(0, decimalInput(value));
}

function decimalInput(value: string): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return `$${formatNumber(Math.round(value))}`;
}

function formatDecimal(value: number): string {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function shopliftingRows(shoplifting: MiscellaneousResponse["shoplifting"]): Array<{
  shopKey: string;
  obstacles: Array<{
    title: string;
    disabled: boolean;
  }>;
}> {
  return Object.entries(shoplifting).map(([shopKey, obstacles]) => ({
    shopKey,
    obstacles,
  }));
}

function formatShopName(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\btc\b/i, "TC")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
