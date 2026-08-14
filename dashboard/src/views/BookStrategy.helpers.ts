import {
  calculateBookStrategy,
  defaultBookStrategyInputs,
  defaultBookTimingComparisonInputs,
  defaultIgnoranceIsBlissInputs,
  type BookStrategyInputs,
  type BookTimingComparisonInputs,
  type EnhancerUseMode,
  type IgnoranceIsBlissInputs,
} from "../utils/bookStrategy";

export type BookStrategyMode = "enhancers" | "timing" | "iib" | "conclusions";
export type EnergyMode = "total" | "breakdown";
export type EnhancerModeKind = EnhancerUseMode["kind"];
export type PopoutKind = "energy" | "perks" | "investment" | "prices";
export type BookTimingPopoutKind = "energy" | "perks";
export type IgnoranceIsBlissPopoutKind = "energy" | "perks";

export const CHART_Y_AXIS_WIDTH = 58;
export const CHART_RIGHT_MARGIN = 18;
export const LEAD_MILESTONE_TARGETS = [25_000_000, 50_000_000, 100_000_000] as const;
export const LEAD_MILESTONE_MAX_DAY = 3_650;

export type ChartClickState = {
  activeLabel?: number | string | null;
  activePayload?: Array<{ payload?: { day?: number | string | null } }>;
} | null;

export type BookStrategyForm = {
  startingStat: string;
  dailyEnergy: string;
  startingEnergy: string;
  happiness: string;
  naturalEnergy: string;
  xanaxPerDay: string;
  dailyRefill: string;
  otherDailyEnergy: string;
  privateIslandPercent: string;
  generalEducationPercent: string;
  statEducationPercent: string;
  steadfastPercent: string;
  customPerksPercent: string;
  gymMultiplier: string;
  statEnhancerPrice: string;
  fhcPrice: string;
  investmentEnabled: boolean;
  annualRoiPercent: string;
  graphDurationDays: string;
  bookBonusPercent: string;
  postBookTrainingMonthsOutOfFour: string;
  enhancerMode: EnhancerModeKind;
  enhancerTargetStat: string;
  enhancerTargetDay: string;
};

export type BookTimingForm = {
  lowStat: string;
  delayedBookTargetStat: string;
  dailyEnergy: string;
  naturalEnergy: string;
  xanaxPerDay: string;
  dailyRefill: string;
  otherDailyEnergy: string;
  privateIslandPercent: string;
  generalEducationPercent: string;
  statEducationPercent: string;
  steadfastPercent: string;
  customPerksPercent: string;
  graphDurationDays: string;
  bookBonusPercent: string;
};

export type IgnoranceIsBlissForm = {
  startingStat: string;
  dailyEnergy: string;
  normalHappiness: string;
  naturalEnergy: string;
  xanaxPerDay: string;
  dailyRefill: string;
  otherDailyEnergy: string;
  privateIslandPercent: string;
  generalEducationPercent: string;
  statEducationPercent: string;
  steadfastPercent: string;
  customPerksPercent: string;
  gymMultiplier: string;
  graphMaxStat: string;
};

export type SharedPopoutField =
  | "dailyEnergy"
  | "naturalEnergy"
  | "xanaxPerDay"
  | "dailyRefill"
  | "otherDailyEnergy"
  | "privateIslandPercent"
  | "generalEducationPercent"
  | "statEducationPercent"
  | "steadfastPercent"
  | "customPerksPercent";

const FIXED_ENERGY_PER_XANAX = 250;
const IIB_X_AXIS_TICKS = [
  1,
  1_000,
  100_000,
  1_000_000,
  10_000_000,
  100_000_000,
  1_000_000_000,
  10_000_000_000,
];
const IIB_Y_AXIS_TICKS = [
  10,
  50,
  100,
  500,
  1_000,
  2_000,
  5_000,
];

export const DEFAULT_FORM = formFromInputs(defaultBookStrategyInputs);
export const DEFAULT_TIMING_FORM = timingFormFromInputs(defaultBookTimingComparisonInputs);
export const DEFAULT_IIB_FORM = ignoranceIsBlissFormFromInputs(defaultIgnoranceIsBlissInputs);
export const SHARED_POPOUT_FIELDS = new Set<string>([
  "dailyEnergy",
  "naturalEnergy",
  "xanaxPerDay",
  "dailyRefill",
  "otherDailyEnergy",
  "privateIslandPercent",
  "generalEducationPercent",
  "statEducationPercent",
  "steadfastPercent",
  "customPerksPercent",
]);

export function inputsFromForm(form: BookStrategyForm, energyMode: EnergyMode): BookStrategyInputs {
  return {
    ...defaultBookStrategyInputs,
    startingStat: parseNumber(form.startingStat, defaultBookStrategyInputs.startingStat),
    dailyEnergy: energyMode === "breakdown"
      ? calculatedDailyEnergy(form)
      : parseNumber(form.dailyEnergy, defaultBookStrategyInputs.dailyEnergy),
    startingEnergy: parseNumber(form.startingEnergy, defaultBookStrategyInputs.startingEnergy),
    happiness: parseNumber(form.happiness, defaultBookStrategyInputs.happiness),
    privateIslandPercent: parseNumber(form.privateIslandPercent, defaultBookStrategyInputs.privateIslandPercent),
    generalEducationPercent: parseNumber(form.generalEducationPercent, defaultBookStrategyInputs.generalEducationPercent),
    statEducationPercent: parseNumber(form.statEducationPercent, defaultBookStrategyInputs.statEducationPercent),
    steadfastPercent: parseNumber(form.steadfastPercent, defaultBookStrategyInputs.steadfastPercent),
    customPerksPercent: parseNumber(form.customPerksPercent, defaultBookStrategyInputs.customPerksPercent),
    statEnhancerPrice: parseNumber(form.statEnhancerPrice, defaultBookStrategyInputs.statEnhancerPrice),
    fhcPrice: parseNumber(form.fhcPrice, defaultBookStrategyInputs.fhcPrice),
    investmentEnabled: form.investmentEnabled,
    annualRoiPercent: parseNumber(form.annualRoiPercent, defaultBookStrategyInputs.annualRoiPercent),
    graphDurationDays: parseNumber(form.graphDurationDays, defaultBookStrategyInputs.graphDurationDays),
    bookBonusPercent: parseNumber(form.bookBonusPercent, defaultBookStrategyInputs.bookBonusPercent),
    gymMultiplier: parseNumber(form.gymMultiplier, defaultBookStrategyInputs.gymMultiplier),
    postBookTrainingMonthsOutOfFour: parseNumber(form.postBookTrainingMonthsOutOfFour, defaultBookStrategyInputs.postBookTrainingMonthsOutOfFour),
    enhancerUseMode: enhancerModeFromForm(form),
  };
}

export function expandGraphDurationForEarliestOvertake(form: BookStrategyForm, energyMode: EnergyMode): BookStrategyForm {
  const currentDuration = parseNumber(form.graphDurationDays, defaultBookStrategyInputs.graphDurationDays);
  const earliestInputs = {
    ...inputsFromForm(form, energyMode),
    graphDurationDays: currentDuration,
    enhancerUseMode: { kind: "earliestOvertake" },
  } satisfies BookStrategyInputs;
  const earliestResult = calculateBookStrategy(earliestInputs);
  const earliestDay = earliestResult.enhancerUse.day;
  if (earliestDay === null || earliestDay <= currentDuration) {
    return form;
  }

  return {
    ...form,
    graphDurationDays: String(roundGraphDurationPastDay(earliestDay)),
  };
}

export function timingInputsFromForm(form: BookTimingForm, energyMode: EnergyMode): BookTimingComparisonInputs {
  return {
    ...defaultBookTimingComparisonInputs,
    lowStat: parseNumber(form.lowStat, defaultBookTimingComparisonInputs.lowStat),
    delayedBookTargetStat: parseNumber(form.delayedBookTargetStat, defaultBookTimingComparisonInputs.delayedBookTargetStat),
    dailyEnergy: energyMode === "breakdown"
      ? calculatedTimingDailyEnergy(form)
      : parseNumber(form.dailyEnergy, defaultBookTimingComparisonInputs.dailyEnergy),
    happiness: defaultBookTimingComparisonInputs.happiness,
    privateIslandPercent: parseNumber(form.privateIslandPercent, defaultBookTimingComparisonInputs.privateIslandPercent),
    generalEducationPercent: parseNumber(form.generalEducationPercent, defaultBookTimingComparisonInputs.generalEducationPercent),
    statEducationPercent: parseNumber(form.statEducationPercent, defaultBookTimingComparisonInputs.statEducationPercent),
    steadfastPercent: parseNumber(form.steadfastPercent, defaultBookTimingComparisonInputs.steadfastPercent),
    customPerksPercent: parseNumber(form.customPerksPercent, defaultBookTimingComparisonInputs.customPerksPercent),
    graphDurationDays: parseNumber(form.graphDurationDays, defaultBookTimingComparisonInputs.graphDurationDays),
    bookBonusPercent: parseNumber(form.bookBonusPercent, defaultBookTimingComparisonInputs.bookBonusPercent),
    gymMultiplier: defaultBookTimingComparisonInputs.gymMultiplier,
  };
}

export function ignoranceIsBlissInputsFromForm(
  form: IgnoranceIsBlissForm,
  energyMode: EnergyMode,
): IgnoranceIsBlissInputs {
  return {
    ...defaultIgnoranceIsBlissInputs,
    startingStat: parseNumber(form.startingStat, defaultIgnoranceIsBlissInputs.startingStat),
    dailyEnergy: energyMode === "breakdown"
      ? calculatedIibDailyEnergy(form)
      : parseNumber(form.dailyEnergy, defaultIgnoranceIsBlissInputs.dailyEnergy),
    normalHappiness: parseNumber(form.normalHappiness, defaultIgnoranceIsBlissInputs.normalHappiness),
    privateIslandPercent: parseNumber(form.privateIslandPercent, defaultIgnoranceIsBlissInputs.privateIslandPercent),
    generalEducationPercent: parseNumber(form.generalEducationPercent, defaultIgnoranceIsBlissInputs.generalEducationPercent),
    statEducationPercent: parseNumber(form.statEducationPercent, defaultIgnoranceIsBlissInputs.statEducationPercent),
    steadfastPercent: parseNumber(form.steadfastPercent, defaultIgnoranceIsBlissInputs.steadfastPercent),
    customPerksPercent: parseNumber(form.customPerksPercent, defaultIgnoranceIsBlissInputs.customPerksPercent),
    graphMaxStat: parseNumber(form.graphMaxStat, defaultIgnoranceIsBlissInputs.graphMaxStat),
    gymMultiplier: parseNumber(form.gymMultiplier, defaultIgnoranceIsBlissInputs.gymMultiplier),
  };
}

export function ignoranceIsBlissFormFromInputs(inputs: IgnoranceIsBlissInputs): IgnoranceIsBlissForm {
  return {
    startingStat: formatInputCompact(inputs.startingStat),
    dailyEnergy: String(inputs.dailyEnergy),
    normalHappiness: String(inputs.normalHappiness),
    naturalEnergy: "720",
    xanaxPerDay: "3",
    dailyRefill: "150",
    otherDailyEnergy: "0",
    privateIslandPercent: String(inputs.privateIslandPercent),
    generalEducationPercent: String(inputs.generalEducationPercent),
    statEducationPercent: String(inputs.statEducationPercent),
    steadfastPercent: String(inputs.steadfastPercent),
    customPerksPercent: String(inputs.customPerksPercent),
    gymMultiplier: String(inputs.gymMultiplier),
    graphMaxStat: formatInputCompact(inputs.graphMaxStat),
  };
}

export function timingFormFromInputs(inputs: BookTimingComparisonInputs): BookTimingForm {
  return {
    lowStat: formatInputCompact(inputs.lowStat),
    delayedBookTargetStat: formatInputCompact(inputs.delayedBookTargetStat),
    dailyEnergy: String(inputs.dailyEnergy),
    naturalEnergy: "720",
    xanaxPerDay: "3",
    dailyRefill: "150",
    otherDailyEnergy: "0",
    privateIslandPercent: String(inputs.privateIslandPercent),
    generalEducationPercent: String(inputs.generalEducationPercent),
    statEducationPercent: String(inputs.statEducationPercent),
    steadfastPercent: String(inputs.steadfastPercent),
    customPerksPercent: String(inputs.customPerksPercent),
    graphDurationDays: String(inputs.graphDurationDays),
    bookBonusPercent: String(inputs.bookBonusPercent),
  };
}

export function formFromInputs(inputs: BookStrategyInputs): BookStrategyForm {
  return {
    startingStat: formatInputCompact(inputs.startingStat),
    dailyEnergy: String(inputs.dailyEnergy),
    startingEnergy: String(inputs.startingEnergy),
    happiness: String(inputs.happiness),
    naturalEnergy: "720",
    xanaxPerDay: "3",
    dailyRefill: "150",
    otherDailyEnergy: "0",
    privateIslandPercent: String(inputs.privateIslandPercent),
    generalEducationPercent: String(inputs.generalEducationPercent),
    statEducationPercent: String(inputs.statEducationPercent),
    steadfastPercent: String(inputs.steadfastPercent),
    customPerksPercent: String(inputs.customPerksPercent),
    gymMultiplier: String(inputs.gymMultiplier),
    statEnhancerPrice: formatInputCompact(inputs.statEnhancerPrice),
    fhcPrice: formatInputCompact(inputs.fhcPrice),
    investmentEnabled: inputs.investmentEnabled,
    annualRoiPercent: String(inputs.annualRoiPercent),
    graphDurationDays: String(inputs.graphDurationDays),
    bookBonusPercent: String(inputs.bookBonusPercent),
    postBookTrainingMonthsOutOfFour: String(inputs.postBookTrainingMonthsOutOfFour),
    enhancerMode: inputs.enhancerUseMode.kind,
    enhancerTargetStat: "3.411b",
    enhancerTargetDay: "334",
  };
}

export function calculatedIibDailyEnergy(form: IgnoranceIsBlissForm): number {
  return calculatedEnergyFromForm(form);
}

export function calculatedTimingDailyEnergy(form: BookTimingForm): number {
  return calculatedEnergyFromForm(form);
}

export function calculatedDailyEnergy(form: BookStrategyForm): number {
  return calculatedEnergyFromForm(form);
}

export function buildLogStatTicks(maxStat: number): number[] {
  const cappedMax = Math.max(1, maxStat);
  const ticks = IIB_X_AXIS_TICKS.filter((tick) => tick <= cappedMax);

  if (ticks.length === 0) {
    ticks.push(1);
  }

  const lastTick = ticks[ticks.length - 1];
  if (cappedMax > lastTick && !IIB_X_AXIS_TICKS.includes(cappedMax)) {
    ticks.push(cappedMax);
  }

  return ticks;
}

export function statToEvenTickPosition(stat: number, ticks: number[]): number {
  if (ticks.length <= 1) {
    return 0;
  }

  const clampedStat = clampNumber(stat, ticks[0], ticks[ticks.length - 1]);
  for (let index = 0; index < ticks.length - 1; index += 1) {
    const start = ticks[index];
    const end = ticks[index + 1];
    if (clampedStat <= end) {
      const startLog = Math.log10(start);
      const endLog = Math.log10(end);
      const ratio = (Math.log10(clampedStat) - startLog) / Math.max(0.000001, endLog - startLog);
      return index + clampNumber(ratio, 0, 1);
    }
  }

  return ticks.length - 1;
}

export function evenTickPositionToStat(position: number, ticks: number[]): number {
  if (ticks.length <= 1) {
    return ticks[0] ?? 1;
  }

  const clampedPosition = clampNumber(position, 0, ticks.length - 1);
  const index = Math.min(ticks.length - 2, Math.floor(clampedPosition));
  const ratio = clampedPosition - index;
  const startLog = Math.log10(ticks[index]);
  const endLog = Math.log10(ticks[index + 1]);

  return 10 ** (startLog + (endLog - startLog) * ratio);
}

export function buildLogPercentTicks(): number[] {
  return IIB_Y_AXIS_TICKS;
}

export function parseNumber(value: string, fallback: number): number {
  const normalized = value.trim().toLowerCase().replace(/[$,%\s,_]/g, "");
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/^(-?(?:\d+|\d*\.\d+))(k|m|b|t)?$/);
  if (!match) {
    return fallback;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  }[match[2] ?? ""] ?? 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDayInput(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function formatEnergy(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
}

export function formatMoney(value: number): string {
  return `$${formatCompact(value)}`;
}

export function formatStat(value: number): string {
  return formatCompact(value);
}

export function formatSignedStat(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatStat(Math.abs(value))}`;
}

export function formatPercent(value: number): string {
  return `${trimFixed(value)}%`;
}

export function formatLogPercentTick(value: number): string {
  return formatPercent(value);
}

export function formatSignedPercentFixed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}%`;
}

export function relativeDifferencePercent(difference: number, firstValue: number, secondValue: number): number {
  const comparisonBase = Math.min(Math.abs(firstValue), Math.abs(secondValue));
  return comparisonBase > 0 ? difference / comparisonBase * 100 : 0;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${trimFixed(value / 1_000_000_000_000)}t`;
  }
  if (abs >= 1_000_000_000) {
    return `${trimFixed(value / 1_000_000_000)}b`;
  }
  if (abs >= 1_000_000) {
    return `${trimFixed(value / 1_000_000)}m`;
  }

  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: abs < 10 ? 2 : 1 }).format(value);
}

export function formatInputCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${formatInputScaled(value / 1_000_000_000_000)}t`;
  }
  if (abs >= 1_000_000_000) {
    return `${formatInputScaled(value / 1_000_000_000)}b`;
  }
  if (abs >= 1_000_000) {
    return `${formatInputScaled(value / 1_000_000)}m`;
  }
  if (abs >= 1_000) {
    return `${formatInputScaled(value / 1_000)}k`;
  }

  return String(Math.round(value));
}

function roundGraphDurationPastDay(day: number): number {
  return Math.ceil((day + 51) / 100) * 100;
}

function enhancerModeFromForm(form: BookStrategyForm): EnhancerUseMode {
  if (form.enhancerMode === "targetStat") {
    return { kind: "targetStat", stat: parseNumber(form.enhancerTargetStat, defaultBookStrategyInputs.startingStat) };
  }

  if (form.enhancerMode === "targetDay") {
    return { kind: "targetDay", day: parseNumber(form.enhancerTargetDay, defaultBookStrategyInputs.bookDurationDays) };
  }

  return { kind: "earliestOvertake" };
}

function calculatedEnergyFromForm(form: Pick<BookStrategyForm, "naturalEnergy" | "xanaxPerDay" | "dailyRefill" | "otherDailyEnergy">): number {
  return (
    parseNumber(form.naturalEnergy, 0) +
    parseNumber(form.xanaxPerDay, 0) * FIXED_ENERGY_PER_XANAX +
    parseNumber(form.dailyRefill, 0) +
    parseNumber(form.otherDailyEnergy, 0)
  );
}

function formatInputScaled(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function trimFixed(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 100 ? 1 : 2,
  }).format(value);
}
