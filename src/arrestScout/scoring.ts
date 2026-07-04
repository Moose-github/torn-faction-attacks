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
  const currentForgeryskill = current.forgeryskill ?? 0;
  const currentScammingSkill = current.scammingskill ?? 0;
  const tracks = [
    evaluateTrack("counterfeiting", currentForgeryskill, current.counterfeiting, historical?.counterfeiting ?? null, settings),
    evaluateTrack("fraud", currentScammingSkill, current.fraud, historical?.fraud ?? null, settings),
  ];
  const eligibleTracks = tracks.filter((track) => track.eligible);

  if (eligibleTracks.length === 0) {
    return {
      ...baseResult(current, historical),
      classification: "ignored",
      score: 0,
      notes: ["forgeryskill_below_required", "scammingskill_below_required"],
    };
  }

  if (!historical) {
    return errorResult(current, historical, "missing_historical_stats");
  }

  if (!isUsableNumber(current.jailed) || !isUsableNumber(historical.jailed)) {
    return errorResult(current, historical, "missing_jailed");
  }

  const base = baseResult(current, historical);
  const jailedDelta = current.jailed - historical.jailed;

  if (jailedDelta < 0) {
    return {
      ...base,
      jailed_delta: jailedDelta,
      classification: "error",
      score: 0,
      notes: ["negative_delta"],
    };
  }

  const trackErrors = eligibleTracks.filter((track) => track.errorNote !== null);
  const validTracks = eligibleTracks.filter((track): track is EvaluatedTrack & { delta: number } => track.delta !== null && track.errorNote === null);

  if (validTracks.some((track) => track.delta < 0)) {
    return {
      ...base,
      jailed_delta: jailedDelta,
      ...deltaFieldsFromTracks(validTracks),
      classification: "error",
      score: 0,
      notes: ["negative_delta"],
    };
  }

  const activeTracks = validTracks.filter((track) => track.delta >= thresholdForTrack(track.name, settings));
  if (activeTracks.length === 0) {
    if (validTracks.length === 0) {
      return {
        ...base,
        jailed_delta: jailedDelta,
        classification: "error",
        score: 0,
        notes: trackErrors.map((track) => track.errorNote as string),
      };
    }

    const bestDelta = Math.max(...validTracks.map((track) => track.delta));
    return {
      ...base,
      jailed_delta: jailedDelta,
      ...deltaFieldsFromTracks(validTracks),
      classification: "inactive",
      score: bestDelta,
      notes: validTracks.map((track) => `${track.name}_below_threshold`),
    };
  }

  const bestActiveDelta = Math.max(...activeTracks.map((track) => track.delta));
  if (jailedDelta === 0) {
    return {
      ...base,
      jailed_delta: jailedDelta,
      ...deltaFieldsFromTracks(validTracks),
      classification: "current_target",
      score: bestActiveDelta + 100,
      notes: activeTracks.map((track) => `${track.name}_active`),
    };
  }

  return {
    ...base,
    jailed_delta: jailedDelta,
    ...deltaFieldsFromTracks(validTracks),
    classification: "future_target",
    score: bestActiveDelta,
    notes: ["recent_jailed_delta_observed", ...activeTracks.map((track) => `${track.name}_active`)],
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
    current_scammingskill: current.scammingskill,
    current_fraud: current.fraud,
    historical_fraud: historical?.fraud ?? null,
    fraud_delta: null,
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

type TrackName = "counterfeiting" | "fraud";

type EvaluatedTrack = {
  name: TrackName;
  eligible: boolean;
  delta: number | null;
  errorNote: string | null;
};

function evaluateTrack(
  name: TrackName,
  skill: number,
  currentValue: number | null,
  historicalValue: number | null,
  settings: ArrestScoutSettings,
): EvaluatedTrack {
  if (skill < settings.required_forgeryskill) {
    return { name, eligible: false, delta: null, errorNote: null };
  }

  if (!isUsableNumber(currentValue) || !isUsableNumber(historicalValue)) {
    return { name, eligible: true, delta: null, errorNote: `missing_${name}` };
  }

  return { name, eligible: true, delta: currentValue - historicalValue, errorNote: null };
}

function thresholdForTrack(name: TrackName, settings: ArrestScoutSettings): number {
  return name === "fraud" ? settings.min_fraud_delta : settings.min_counterfeiting_delta;
}

function deltaFieldsFromTracks(
  tracks: Array<EvaluatedTrack & { delta: number }>,
): Pick<ArrestScoutScoreResult, "counterfeiting_delta" | "fraud_delta"> {
  const output: Pick<ArrestScoutScoreResult, "counterfeiting_delta" | "fraud_delta"> = {
    counterfeiting_delta: null,
    fraud_delta: null,
  };
  for (const track of tracks) {
    if (track.name === "counterfeiting") {
      output.counterfeiting_delta = track.delta;
    } else {
      output.fraud_delta = track.delta;
    }
  }
  return output;
}
