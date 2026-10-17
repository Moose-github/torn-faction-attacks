export type PayoutMode = "points" | "respect";
export type RespectBasis = "adjusted" | "raw";
export type PercentageRuleType = "bonus" | "penalty";
export type BonusOperator = ">=" | ">" | "<=" | "<" | "=";

export const PAYOUT_METRICS = [
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
] as const;

export type PayoutMetric = typeof PAYOUT_METRICS[number]["value"];
export type PointRule = { id: string; metric: PayoutMetric; points: string };
export type FlatPaymentRule = { id: string; metric: PayoutMetric; amount: string };
export type BonusRule = {
  id: string; type: PercentageRuleType; metric: PayoutMetric;
  operator: BonusOperator; threshold: string; percent: string;
};

/** Reusable rules only: the war, reward pool, and respect cap belong to each calculation. */
export type WarPayoutPresetConfig = {
  schemaVersion: 1;
  mode: PayoutMode;
  respectBasis: RespectBasis;
  pointRules: PointRule[];
  flatPaymentRules: FlatPaymentRule[];
  bonusRules: BonusRule[];
};

export type WarPayoutPreset = {
  id: string;
  name: string;
  config: WarPayoutPresetConfig;
  revision: number;
  created_at: number;
  updated_at: number;
  created_by: number;
  updated_by: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid preset settings.");
  return value as Record<string, unknown>;
}

function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error(`Choose a valid ${label}.`);
  return value as T;
}

function numericInput(value: unknown, label: string, allowNegative = false): string {
  if (typeof value !== "string" || value.length > 64) throw new Error(`${label} must be a number or blank.`);
  const text = value.replace(/,/g, "").trim();
  const number = Number(text);
  if ((text && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) ||
      !Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || (!allowNegative && number < 0)) {
    throw new Error(`${label} must be a ${allowNegative ? "finite" : "non-negative"} number or blank.`);
  }
  return text;
}

function rules(value: unknown, label: string, maximum: number, uniqueMetrics: boolean): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must contain at most ${maximum} rules.`);
  const ids = new Set<string>();
  const metrics = new Set<string>();
  return value.map(item => {
    const rule = record(item);
    if (typeof rule.id !== "string" || !rule.id.trim() || rule.id.length > 80 || ids.has(rule.id)) {
      throw new Error(`${label} contains an invalid or duplicate rule ID.`);
    }
    ids.add(rule.id);
    const metric = choice(rule.metric, PAYOUT_METRICS.map(item => item.value), "payout metric");
    if (uniqueMetrics && metrics.has(metric)) throw new Error(`${label} contains a duplicate metric.`);
    metrics.add(metric);
    return rule;
  });
}

export function parseWarPayoutPresetConfig(value: unknown): WarPayoutPresetConfig {
  const config = record(value);
  if (config.schemaVersion !== 1) throw new Error("Unsupported payout preset version.");
  return {
    schemaVersion: 1,
    mode: choice(config.mode, ["points", "respect"], "payout mode"),
    respectBasis: choice(config.respectBasis, ["adjusted", "raw"], "respect basis"),
    pointRules: rules(config.pointRules, "Points", PAYOUT_METRICS.length, true).map(rule => ({
      id: rule.id as string, metric: rule.metric as PayoutMetric,
      points: numericInput(rule.points, "Points per", true),
    })),
    flatPaymentRules: rules(config.flatPaymentRules, "Flat payments", PAYOUT_METRICS.length, true).map(rule => ({
      id: rule.id as string, metric: rule.metric as PayoutMetric,
      amount: numericInput(rule.amount, "Flat payment"),
    })),
    bonusRules: rules(config.bonusRules, "Percentage adjustments", 100, false).map(rule => ({
      id: rule.id as string, metric: rule.metric as PayoutMetric,
      type: choice(rule.type, ["bonus", "penalty"], "adjustment type"),
      operator: choice(rule.operator, [">=", ">", "<=", "<", "="], "adjustment condition"),
      threshold: numericInput(rule.threshold, "Adjustment threshold", true),
      percent: numericInput(rule.percent, "Adjustment percentage"),
    })),
  };
}

export function parseWarPayoutPresetName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Enter a preset name between 1 and 80 characters.");
  }
  return value.trim();
}
