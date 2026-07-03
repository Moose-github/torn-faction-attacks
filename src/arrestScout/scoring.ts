import type {
  ArrestScoutScoreResult,
  ArrestScoutSettings,
  ArrestScoutTargetStats,
} from "./model";

export function classifyArrestScoutTarget(
  current: ArrestScoutTargetStats,
  historical: ArrestScoutTargetStats | null,
  settings: ArrestScoutSettings,
): ArrestScoutScoreResult {
  const notes: string[] = [];
  const currentForgeryskill = current.forgeryskill;

  if (!isUsableNumber(currentForgeryskill)) {
    return errorResult(current, historical, "missing_current_forgeryskill");
  }

  if (currentForgeryskill < settings.required_forgeryskill) {
    notes.push("forgeryskill_below_required");
    return {
      ...baseResult(current, historical),
      classification: "ignored",
      score: 0,
      notes,
    };
  }

  if (!historical) {
    return errorResult(current, historical, "missing_historical_stats");
  }

  if (!isUsableNumber(current.counterfeiting) || !isUsableNumber(historical.counterfeiting)) {
    return errorResult(current, historical, "missing_counterfeiting");
  }

  if (!isUsableNumber(current.jailed) || !isUsableNumber(historical.jailed)) {
    return errorResult(current, historical, "missing_jailed");
  }

  const counterfeitingDelta = current.counterfeiting - historical.counterfeiting;
  const jailedDelta = current.jailed - historical.jailed;

  if (counterfeitingDelta < 0 || jailedDelta < 0) {
    return {
      ...baseResult(current, historical),
      counterfeiting_delta: counterfeitingDelta,
      jailed_delta: jailedDelta,
      classification: "error",
      score: 0,
      notes: ["negative_delta"],
    };
  }

  if (counterfeitingDelta < settings.min_counterfeiting_delta) {
    return {
      ...baseResult(current, historical),
      counterfeiting_delta: counterfeitingDelta,
      jailed_delta: jailedDelta,
      classification: "inactive",
      score: counterfeitingDelta,
      notes: ["counterfeiting_below_threshold"],
    };
  }

  if (jailedDelta === 0) {
    return {
      ...baseResult(current, historical),
      counterfeiting_delta: counterfeitingDelta,
      jailed_delta: jailedDelta,
      classification: "current_target",
      score: counterfeitingDelta + 100,
      notes,
    };
  }

  return {
    ...baseResult(current, historical),
    counterfeiting_delta: counterfeitingDelta,
    jailed_delta: jailedDelta,
    classification: "future_target",
    score: counterfeitingDelta,
    notes: ["recent_jailed_delta_observed"],
  };
}

function baseResult(
  current: ArrestScoutTargetStats,
  historical: ArrestScoutTargetStats | null,
): Omit<ArrestScoutScoreResult, "classification" | "score" | "notes"> {
  return {
    current_forgeryskill: current.forgeryskill,
    current_counterfeiting: current.counterfeiting,
    historical_counterfeiting: historical?.counterfeiting ?? null,
    counterfeiting_delta: null,
    current_jailed: current.jailed,
    historical_jailed: historical?.jailed ?? null,
    jailed_delta: null,
  };
}

function errorResult(
  current: ArrestScoutTargetStats,
  historical: ArrestScoutTargetStats | null,
  note: string,
): ArrestScoutScoreResult {
  return {
    ...baseResult(current, historical),
    classification: "error",
    score: 0,
    notes: [note],
  };
}

function isUsableNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
