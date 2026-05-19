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
type BonusMetric =
  | "average_fair_fight"
  | "defends_lost"
  | "attacks_vs_enemy_successful"
  | "outside_hits"
  | "assists_vs_enemy"
  | "friendly_hosps"
  | "respect_gained"
  | "respect_lost";
type BonusOperator = ">=" | ">" | "<=" | "<" | "=";

type BonusRule = {
  id: string;
  group: string;
  metric: BonusMetric;
  operator: BonusOperator;
  threshold: string;
  percent: string;
};

type PayoutRow = {
  member: MemberStats;
  basis: number;
  bonusPercent: number;
  adjustedBasis: number;
  flatPayment: number;
  variablePayment: number;
  finalPayment: number;
};

const DEFAULT_BONUS_RULES: BonusRule[] = [
  {
    id: "fair-fight-3",
    group: "Average fair fight",
    metric: "average_fair_fight",
    operator: ">=",
    threshold: "3",
    percent: "10",
  },
  {
    id: "fair-fight-25",
    group: "Average fair fight",
    metric: "average_fair_fight",
    operator: ">=",
    threshold: "2.5",
    percent: "8",
  },
  {
    id: "defends-lost-10",
    group: "Defends lost",
    metric: "defends_lost",
    operator: "<",
    threshold: "10",
    percent: "10",
  },
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

      <WarPayoutCalculator />

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

function WarPayoutCalculator() {
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState("");
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
  const [isLoadingWars, setIsLoadingWars] = React.useState(true);
  const [isLoadingWar, setIsLoadingWar] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [poolInput, setPoolInput] = React.useState("");
  const [mode, setMode] = React.useState<PayoutMode>("points");
  const [respectBasis, setRespectBasis] = React.useState<RespectBasis>("adjusted");
  const [warHitWeight, setWarHitWeight] = React.useState("1");
  const [outsideHitWeight, setOutsideHitWeight] = React.useState("0.9");
  const [assistWeight, setAssistWeight] = React.useState("0.75");
  const [friendlyHospPayment, setFriendlyHospPayment] = React.useState("2000000");
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
        warHitWeight: decimalInput(warHitWeight),
        outsideHitWeight: decimalInput(outsideHitWeight),
        assistWeight: decimalInput(assistWeight),
        friendlyHospPayment: moneyInput(friendlyHospPayment),
        bonusRules,
      }),
    [
      assistWeight,
      bonusRules,
      friendlyHospPayment,
      members,
      mode,
      outsideHitWeight,
      poolInput,
      respectBasis,
      warHitWeight,
    ],
  );

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
        group: "New bonus",
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
    <section className="panel table-panel payout-calculator-panel">
      <PanelHeader
        title="War payout calculator (WIP)"
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
        <div className="payout-controls compact">
          <label>
            <span>War hit points</span>
            <input inputMode="decimal" value={warHitWeight} onChange={(event) => setWarHitWeight(event.target.value)} />
          </label>
          <label>
            <span>Outside hit points</span>
            <input inputMode="decimal" value={outsideHitWeight} onChange={(event) => setOutsideHitWeight(event.target.value)} />
          </label>
          <label>
            <span>Assist points</span>
            <input inputMode="decimal" value={assistWeight} onChange={(event) => setAssistWeight(event.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="payout-controls compact">
        <label>
          <span>Friendly hosp flat payment</span>
          <input
            inputMode="numeric"
            value={friendlyHospPayment}
            onChange={(event) => setFriendlyHospPayment(event.target.value)}
          />
        </label>
      </div>

      <div className="payout-bonus-rules">
        <div className="payout-section-header">
          <strong>Bonus rules</strong>
          <button type="button" className="panel-action-button" onClick={addBonusRule}>
            Add rule
          </button>
        </div>
        <div className="table-scroll">
          <table className="payout-rules-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Value</th>
                <th>Bonus</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bonusRules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <input value={rule.group} onChange={(event) => updateBonusRule(rule.id, { group: event.target.value })} />
                  </td>
                  <td>
                    <select
                      value={rule.metric}
                      onChange={(event) => updateBonusRule(rule.id, { metric: event.target.value as BonusMetric })}
                    >
                      <option value="average_fair_fight">Average fair fight</option>
                      <option value="defends_lost">Defends lost</option>
                      <option value="attacks_vs_enemy_successful">War hits</option>
                      <option value="outside_hits">Outside hits</option>
                      <option value="assists_vs_enemy">Assists</option>
                      <option value="friendly_hosps">Friendly hosps</option>
                      <option value="respect_gained">Respect gained</option>
                      <option value="respect_lost">Respect lost</option>
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
                    <input inputMode="decimal" value={rule.percent} onChange={(event) => updateBonusRule(rule.id, { percent: event.target.value })} />
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

      <div className="payout-summary-grid">
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
                <th>Bonus</th>
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
    </section>
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
  warHitWeight,
  outsideHitWeight,
  assistWeight,
  friendlyHospPayment,
  bonusRules,
}: {
  members: MemberStats[];
  totalPool: number;
  mode: PayoutMode;
  respectBasis: RespectBasis;
  warHitWeight: number;
  outsideHitWeight: number;
  assistWeight: number;
  friendlyHospPayment: number;
  bonusRules: BonusRule[];
}): { rows: PayoutRow[]; totalPool: number; flatTotal: number; remainingPool: number; finalTotal: number } {
  const flatRows = members.map((member) => ({
    member,
    basis: memberPayoutBasis(member, mode, respectBasis, warHitWeight, outsideHitWeight, assistWeight),
    bonusPercent: memberBonusPercent(member, bonusRules),
    flatPayment: Math.max(0, Number(member.friendly_hosps ?? 0)) * friendlyHospPayment,
  }));
  const flatTotal = flatRows.reduce((total, row) => total + row.flatPayment, 0);
  const remainingPool = Math.max(0, totalPool - flatTotal);
  const weightedRows = flatRows.map((row) => ({
    ...row,
    adjustedBasis: row.basis * (1 + row.bonusPercent / 100),
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
  warHitWeight: number,
  outsideHitWeight: number,
  assistWeight: number,
): number {
  if (mode === "respect") {
    return Math.max(
      0,
      respectBasis === "raw"
        ? detailNumber(member.respect_gained_raw, member.respect_gained)
        : Number(member.respect_gained ?? 0),
    );
  }

  return Math.max(0, Number(member.attacks_vs_enemy_successful ?? 0)) * warHitWeight +
    Math.max(0, Number(member.outside_hits ?? 0)) * outsideHitWeight +
    Math.max(0, Number(member.assists_vs_enemy ?? 0)) * assistWeight;
}

function memberBonusPercent(member: MemberStats, rules: BonusRule[]): number {
  const bestByGroup = new Map<string, number>();

  for (const rule of rules) {
    const threshold = decimalInput(rule.threshold);
    const percent = decimalInput(rule.percent);
    const group = rule.group.trim() || rule.metric;
    if (!Number.isFinite(threshold) || !Number.isFinite(percent) || percent <= 0) {
      continue;
    }

    if (!bonusRuleMatches(memberBonusMetricValue(member, rule.metric), rule.operator, threshold)) {
      continue;
    }

    bestByGroup.set(group, Math.max(bestByGroup.get(group) ?? 0, percent));
  }

  return Array.from(bestByGroup.values()).reduce((total, percent) => total + percent, 0);
}

function memberBonusMetricValue(member: MemberStats, metric: BonusMetric): number {
  if (metric === "defends_lost") {
    return memberDefendsLost(member);
  }
  return Number(member[metric] ?? 0);
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
