export type EnhancerUseMode =
  | { kind: "earliestOvertake" }
  | { kind: "targetStat"; stat: number }
  | { kind: "targetDay"; day: number };

export type BookStrategyInputs = {
  startingStat: number;
  dailyEnergy: number;
  startingEnergy: number;
  happiness: number;
  privateIslandPercent: number;
  generalEducationPercent: number;
  statEducationPercent: number;
  steadfastPercent: number;
  customPerksPercent: number;
  statEnhancerPrice: number;
  fhcPrice: number;
  investmentEnabled: boolean;
  annualRoiPercent: number;
  graphDurationDays: number;
  bookDurationDays: number;
  bookBonusPercent: number;
  gymMultiplier: number;
  energyPerTrain: number;
  fhcEnergy: number;
  fhcCooldownHours: number;
  maxBoosterCooldownHours: number;
  postBookTrainingMonthsOutOfFour: number;
  enhancerUseMode: EnhancerUseMode;
};

export type FhcPlan = {
  initialFhcs: number;
  furtherFhcs: number;
  totalFhcs: number;
  energy: number;
  cost: number;
};

export type BookStrategyPoint = {
  day: number;
  strategyOneStat: number;
  strategyTwoStat: number;
  strategyTwoBeforeEnhancers: number;
  investmentBalance: number;
  enhancersAffordable: number;
  enhancersUsed: number;
  difference: number;
};

export type BookStrategyResult = {
  inputs: BookStrategyInputs;
  perkMultiplier: number;
  fhcPlan: FhcPlan;
  bookEnd: {
    strategyOneStat: number;
    strategyTwoStat: number;
    lead: number;
  };
  enhancerUse: {
    day: number | null;
    strategyOneStat: number | null;
    strategyTwoBeforeEnhancers: number | null;
    strategyTwoAfterEnhancers: number | null;
    investmentBalance: number | null;
    enhancersUsed: number;
    lead: number | null;
  };
  endpoint: BookStrategyPoint;
  breakEvenDay: number | null;
  winningStrategy: "strategyOne" | "strategyTwo" | "tied";
  series: BookStrategyPoint[];
};

export type BookStrategyLeadMilestone = {
  day: number;
  lead: number;
};

export type BookTimingComparisonInputs = {
  lowStat: number;
  delayedBookTargetStat: number;
  dailyEnergy: number;
  happiness: number;
  privateIslandPercent: number;
  generalEducationPercent: number;
  statEducationPercent: number;
  steadfastPercent: number;
  customPerksPercent: number;
  graphDurationDays: number;
  bookDurationDays: number;
  bookBonusPercent: number;
  gymMultiplier: number;
  energyPerTrain: number;
};

export type BookTimingComparisonPoint = {
  day: number;
  useNowStat: number;
  waitStat: number;
  difference: number;
  useNowBookActive: boolean;
  waitBookActive: boolean;
  trainsConsumed: number;
};

export type BookTimingBookImpact = {
  startDay: number | null;
  endDay: number | null;
  startStat: number | null;
  extraGain: number | null;
  percentGain: number | null;
};

export type BookTimingComparisonResult = {
  inputs: BookTimingComparisonInputs;
  delayedBookStartDay: number | null;
  totalTrains: number;
  endpoint: BookTimingComparisonPoint;
  immediateBook: BookTimingBookImpact;
  delayedBook: BookTimingBookImpact;
  series: BookTimingComparisonPoint[];
};

export type IgnoranceIsBlissInputs = {
  startingStat: number;
  dailyEnergy: number;
  normalHappiness: number;
  privateIslandPercent: number;
  generalEducationPercent: number;
  statEducationPercent: number;
  steadfastPercent: number;
  customPerksPercent: number;
  graphMaxStat: number;
  bookDurationDays: number;
  gymMultiplier: number;
  energyPerTrain: number;
};

export type IgnoranceIsBlissPoint = {
  startingStat: number;
  normalGain: number;
  bookGain: number;
  extraGain: number;
  percentIncrease: number;
  normalEndingStat: number;
  bookEndingStat: number;
};

export type IgnoranceIsBlissResult = {
  inputs: IgnoranceIsBlissInputs;
  selected: IgnoranceIsBlissPoint;
  totalTrains: number;
  series: IgnoranceIsBlissPoint[];
};

type PerkPercentInputs = {
  privateIslandPercent: number;
  generalEducationPercent: number;
  statEducationPercent: number;
  steadfastPercent: number;
  customPerksPercent: number;
};

type GymFormulaInputs = {
  happiness: number;
  bookBonusPercent: number;
  gymMultiplier: number;
  energyPerTrain: number;
};

const CANONICAL_A = 1600;
const CANONICAL_B = 1700;
const STAT_ENHANCER_MULTIPLIER = 1.01;
const GRAPH_STEP_DAYS = 1;
const MAX_SIMULATION_DAYS = 20_000;
const IGNORANCE_IS_BLISS_HAPPINESS = 99_999;

export const defaultBookStrategyInputs: BookStrategyInputs = {
  startingStat: 500_000_000,
  dailyEnergy: 1_620,
  startingEnergy: 1_000,
  happiness: 5_000,
  privateIslandPercent: 2,
  generalEducationPercent: 1,
  statEducationPercent: 1,
  steadfastPercent: 18,
  customPerksPercent: 0,
  statEnhancerPrice: 450_000_000,
  fhcPrice: 14_000_000,
  investmentEnabled: false,
  annualRoiPercent: 25,
  graphDurationDays: 450,
  bookDurationDays: 31,
  bookBonusPercent: 30,
  gymMultiplier: 8,
  energyPerTrain: 50,
  fhcEnergy: 150,
  fhcCooldownHours: 6,
  maxBoosterCooldownHours: 48,
  postBookTrainingMonthsOutOfFour: 4,
  enhancerUseMode: { kind: "earliestOvertake" },
};

export const defaultBookTimingComparisonInputs: BookTimingComparisonInputs = {
  lowStat: 5_000_000,
  delayedBookTargetStat: 1_000_000_000,
  dailyEnergy: defaultBookStrategyInputs.dailyEnergy,
  happiness: 5_000,
  privateIslandPercent: defaultBookStrategyInputs.privateIslandPercent,
  generalEducationPercent: defaultBookStrategyInputs.generalEducationPercent,
  statEducationPercent: defaultBookStrategyInputs.statEducationPercent,
  steadfastPercent: defaultBookStrategyInputs.steadfastPercent,
  customPerksPercent: defaultBookStrategyInputs.customPerksPercent,
  graphDurationDays: 300,
  bookDurationDays: defaultBookStrategyInputs.bookDurationDays,
  bookBonusPercent: defaultBookStrategyInputs.bookBonusPercent,
  gymMultiplier: 7.3,
  energyPerTrain: defaultBookStrategyInputs.energyPerTrain,
};

export const defaultIgnoranceIsBlissInputs: IgnoranceIsBlissInputs = {
  startingStat: 500_000_000,
  dailyEnergy: defaultBookStrategyInputs.dailyEnergy,
  normalHappiness: defaultBookStrategyInputs.happiness,
  privateIslandPercent: defaultBookStrategyInputs.privateIslandPercent,
  generalEducationPercent: defaultBookStrategyInputs.generalEducationPercent,
  statEducationPercent: defaultBookStrategyInputs.statEducationPercent,
  steadfastPercent: defaultBookStrategyInputs.steadfastPercent,
  customPerksPercent: defaultBookStrategyInputs.customPerksPercent,
  graphMaxStat: 5_000_000_000,
  bookDurationDays: defaultBookStrategyInputs.bookDurationDays,
  gymMultiplier: defaultBookStrategyInputs.gymMultiplier,
  energyPerTrain: defaultBookStrategyInputs.energyPerTrain,
};

export function calculateBookStrategy(rawInputs: BookStrategyInputs): BookStrategyResult {
  const inputs = normalizeInputs(rawInputs);
  const perkMultiplier = perkProduct(inputs);
  const fhcPlan = calculateFhcPlan(inputs);
  const bookEnd = calculateBookEnd(inputs, perkMultiplier, fhcPlan);
  const enhancerUse = findEnhancerUse(inputs, perkMultiplier, fhcPlan, bookEnd);
  const series = buildSeries(inputs, perkMultiplier, fhcPlan, enhancerUse.day, enhancerUse.enhancersUsed);
  const endpoint = series[series.length - 1];
  const breakEvenDay = enhancerUse.day ?? firstSeriesOvertake(series);
  const winningStrategy =
    Math.abs(endpoint.difference) < 0.5
      ? "tied"
      : endpoint.difference > 0
        ? "strategyTwo"
        : "strategyOne";

  return {
    inputs,
    perkMultiplier,
    fhcPlan,
    bookEnd,
    enhancerUse,
    endpoint,
    breakEvenDay,
    winningStrategy,
    series,
  };
}

export function calculateBookTimingComparison(
  rawInputs: BookTimingComparisonInputs,
): BookTimingComparisonResult {
  const inputs = normalizeBookTimingInputs(rawInputs);
  const delayedBookStartDay = findDelayedBookStartDay(inputs);
  const series = buildBookTimingSeries(inputs, delayedBookStartDay);
  const endpoint = series[series.length - 1];
  const immediateBook = calculateBookTimingImpact(inputs, 0);
  const delayedBook = delayedBookStartDay === null
    ? emptyBookTimingImpact()
    : calculateBookTimingImpact(inputs, delayedBookStartDay);

  return {
    inputs,
    delayedBookStartDay,
    totalTrains: completeTrains(inputs.dailyEnergy * inputs.graphDurationDays, inputs.energyPerTrain),
    endpoint,
    immediateBook,
    delayedBook,
    series,
  };
}

export function bookTimingStatAtDayWithoutBook(
  rawInputs: BookTimingComparisonInputs,
  day: number,
): number {
  const inputs = normalizeBookTimingInputs(rawInputs);
  return statAtBookTimingDay(inputs.lowStat, finiteAtLeast(day, 0), null, inputs);
}

export function calculateIgnoranceIsBliss(
  rawInputs: IgnoranceIsBlissInputs,
): IgnoranceIsBlissResult {
  const inputs = normalizeIgnoranceIsBlissInputs(rawInputs);
  const totalTrains = completeTrains(inputs.dailyEnergy * inputs.bookDurationDays, inputs.energyPerTrain);
  const selected = ignoranceIsBlissPoint(inputs.startingStat, inputs, totalTrains);
  const series = buildIgnoranceIsBlissSeries(inputs, totalTrains, selected);

  return {
    inputs,
    selected,
    totalTrains,
    series,
  };
}

export function findEnhancerLeadMilestone(
  rawInputs: BookStrategyInputs,
  targetLead: number,
  maxDay: number,
): BookStrategyLeadMilestone | null {
  const inputs = normalizeInputs({ ...rawInputs, enhancerUseMode: { kind: "earliestOvertake" } });
  const leadTarget = finiteAtLeast(targetLead, 0);
  const cappedMaxDay = Math.min(MAX_SIMULATION_DAYS, finiteAtLeast(maxDay, inputs.bookDurationDays));
  const perkMultiplier = perkProduct(inputs);
  const fhcPlan = calculateFhcPlan(inputs);
  const bookEnd = calculateBookEnd(inputs, perkMultiplier, fhcPlan);
  const bookState = createPostBookState(inputs, bookEnd, fhcPlan);
  const enhancerUse = findEarliestOvertake(inputs, perkMultiplier, fhcPlan, bookState, cappedMaxDay, leadTarget);
  if (enhancerUse.day === null || enhancerUse.lead === null || enhancerUse.enhancersUsed <= 0) {
    return null;
  }

  return { day: enhancerUse.day, lead: enhancerUse.lead };
}

function normalizeIgnoranceIsBlissInputs(inputs: IgnoranceIsBlissInputs): IgnoranceIsBlissInputs {
  const startingStat = finiteAtLeast(inputs.startingStat, 1);

  return {
    ...inputs,
    startingStat,
    dailyEnergy: finiteAtLeast(inputs.dailyEnergy, 0),
    normalHappiness: finiteAtLeast(inputs.normalHappiness, 0),
    privateIslandPercent: finiteAtLeast(inputs.privateIslandPercent, -99),
    generalEducationPercent: finiteAtLeast(inputs.generalEducationPercent, -99),
    statEducationPercent: finiteAtLeast(inputs.statEducationPercent, -99),
    steadfastPercent: finiteAtLeast(inputs.steadfastPercent, -99),
    customPerksPercent: finiteAtLeast(inputs.customPerksPercent, -99),
    graphMaxStat: Math.max(startingStat, finiteAtLeast(inputs.graphMaxStat, 1)),
    bookDurationDays: finiteAtLeast(inputs.bookDurationDays, 1),
    gymMultiplier: finiteAtLeast(inputs.gymMultiplier, 0),
    energyPerTrain: finiteAtLeast(inputs.energyPerTrain, 1),
  };
}

function normalizeBookTimingInputs(inputs: BookTimingComparisonInputs): BookTimingComparisonInputs {
  return {
    ...inputs,
    lowStat: finiteAtLeast(inputs.lowStat, 0),
    delayedBookTargetStat: finiteAtLeast(inputs.delayedBookTargetStat, 0),
    dailyEnergy: finiteAtLeast(inputs.dailyEnergy, 0),
    happiness: finiteAtLeast(inputs.happiness, 0),
    privateIslandPercent: finiteAtLeast(inputs.privateIslandPercent, -99),
    generalEducationPercent: finiteAtLeast(inputs.generalEducationPercent, -99),
    statEducationPercent: finiteAtLeast(inputs.statEducationPercent, -99),
    steadfastPercent: finiteAtLeast(inputs.steadfastPercent, -99),
    customPerksPercent: finiteAtLeast(inputs.customPerksPercent, -99),
    graphDurationDays: Math.min(MAX_SIMULATION_DAYS, finiteAtLeast(inputs.graphDurationDays, 1)),
    bookDurationDays: finiteAtLeast(inputs.bookDurationDays, 0),
    bookBonusPercent: finiteAtLeast(inputs.bookBonusPercent, -99),
    gymMultiplier: finiteAtLeast(inputs.gymMultiplier, 0),
    energyPerTrain: finiteAtLeast(inputs.energyPerTrain, 1),
  };
}

function buildIgnoranceIsBlissSeries(
  inputs: IgnoranceIsBlissInputs,
  totalTrains: number,
  selected: IgnoranceIsBlissPoint,
): IgnoranceIsBlissPoint[] {
  const sampleStats = new Set<number>([1, inputs.startingStat, inputs.graphMaxStat]);
  const minLog = Math.log10(1);
  const maxLog = Math.log10(inputs.graphMaxStat);
  const steps = 90;

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    sampleStats.add(10 ** (minLog + (maxLog - minLog) * ratio));
  }

  return [...sampleStats]
    .filter((startingStat) => startingStat >= 1 && startingStat <= inputs.graphMaxStat)
    .sort((a, b) => a - b)
    .map((startingStat) => (
      Math.abs(startingStat - selected.startingStat) < 1e-8
        ? selected
        : ignoranceIsBlissPoint(startingStat, inputs, totalTrains)
    ));
}

function ignoranceIsBlissPoint(
  startingStat: number,
  inputs: IgnoranceIsBlissInputs,
  totalTrains: number,
): IgnoranceIsBlissPoint {
  const perkMultiplier = perkProductFromPercents(inputs);
  const normalEndingStat = advanceStat(
    startingStat,
    totalTrains,
    {
      happiness: inputs.normalHappiness,
      bookBonusPercent: 0,
      gymMultiplier: inputs.gymMultiplier,
      energyPerTrain: inputs.energyPerTrain,
    },
    perkMultiplier,
    false,
  );
  const bookEndingStat = advanceStat(
    startingStat,
    totalTrains,
    {
      happiness: IGNORANCE_IS_BLISS_HAPPINESS,
      bookBonusPercent: 0,
      gymMultiplier: inputs.gymMultiplier,
      energyPerTrain: inputs.energyPerTrain,
    },
    perkMultiplier,
    false,
  );
  const normalGain = normalEndingStat - startingStat;
  const bookGain = bookEndingStat - startingStat;
  const extraGain = bookGain - normalGain;

  return {
    startingStat,
    normalGain,
    bookGain,
    extraGain,
    percentIncrease: normalGain > 0 ? extraGain / normalGain * 100 : 0,
    normalEndingStat,
    bookEndingStat,
  };
}

export function normalizeInputs(inputs: BookStrategyInputs): BookStrategyInputs {
  return {
    ...inputs,
    startingStat: finiteAtLeast(inputs.startingStat, 0),
    dailyEnergy: finiteAtLeast(inputs.dailyEnergy, 0),
    startingEnergy: finiteAtLeast(inputs.startingEnergy, 0),
    happiness: finiteAtLeast(inputs.happiness, 0),
    privateIslandPercent: finiteAtLeast(inputs.privateIslandPercent, -99),
    generalEducationPercent: finiteAtLeast(inputs.generalEducationPercent, -99),
    statEducationPercent: finiteAtLeast(inputs.statEducationPercent, -99),
    steadfastPercent: finiteAtLeast(inputs.steadfastPercent, -99),
    customPerksPercent: finiteAtLeast(inputs.customPerksPercent, -99),
    statEnhancerPrice: finiteAtLeast(inputs.statEnhancerPrice, 1),
    fhcPrice: finiteAtLeast(inputs.fhcPrice, 0),
    annualRoiPercent: finiteAtLeast(inputs.annualRoiPercent, -99),
    graphDurationDays: Math.min(MAX_SIMULATION_DAYS, finiteAtLeast(inputs.graphDurationDays, 1)),
    bookDurationDays: finiteAtLeast(inputs.bookDurationDays, 0),
    bookBonusPercent: finiteAtLeast(inputs.bookBonusPercent, -99),
    gymMultiplier: finiteAtLeast(inputs.gymMultiplier, 0),
    energyPerTrain: finiteAtLeast(inputs.energyPerTrain, 1),
    fhcEnergy: finiteAtLeast(inputs.fhcEnergy, 0),
    fhcCooldownHours: finiteAtLeast(inputs.fhcCooldownHours, 0.001),
    maxBoosterCooldownHours: finiteAtLeast(inputs.maxBoosterCooldownHours, 0),
    postBookTrainingMonthsOutOfFour: Math.min(4, finiteAtLeast(inputs.postBookTrainingMonthsOutOfFour, 0)),
    enhancerUseMode: normalizeEnhancerUseMode(inputs.enhancerUseMode),
  };
}

function buildBookTimingSeries(
  inputs: BookTimingComparisonInputs,
  delayedBookStartDay: number | null,
): BookTimingComparisonPoint[] {
  const sampleDays = new Set<number>([0, inputs.bookDurationDays, inputs.graphDurationDays]);
  if (delayedBookStartDay !== null) {
    sampleDays.add(delayedBookStartDay);
    sampleDays.add(delayedBookStartDay + inputs.bookDurationDays);
  }
  for (let day = 0; day <= inputs.graphDurationDays; day += GRAPH_STEP_DAYS) {
    sampleDays.add(Number(day.toFixed(8)));
  }

  return [...sampleDays]
    .filter((day) => day >= 0 && day <= inputs.graphDurationDays)
    .sort((a, b) => a - b)
    .map((day) => {
      const useNowStat = statAtBookTimingDay(inputs.lowStat, day, 0, inputs);
      const waitStat = statAtBookTimingDay(inputs.lowStat, day, delayedBookStartDay, inputs);

      return {
        day,
        useNowStat,
        waitStat,
        difference: waitStat - useNowStat,
        useNowBookActive: isBookActiveAtDay(day, 0, inputs.bookDurationDays),
        waitBookActive: isBookActiveAtDay(day, delayedBookStartDay, inputs.bookDurationDays),
        trainsConsumed: completeTrains(inputs.dailyEnergy * day, inputs.energyPerTrain),
      };
    });
}

function findDelayedBookStartDay(inputs: BookTimingComparisonInputs): number | null {
  if (inputs.delayedBookTargetStat <= inputs.lowStat) {
    return 0;
  }

  const maxTrains = completeTrains(inputs.dailyEnergy * inputs.graphDurationDays, inputs.energyPerTrain);
  let stat = inputs.lowStat;
  const perkMultiplier = perkProductFromPercents(inputs);

  for (let trainNumber = 1; trainNumber <= maxTrains; trainNumber += 1) {
    stat += gainPerTrain(stat, inputs, perkMultiplier, false);
    if (stat >= inputs.delayedBookTargetStat) {
      return trainNumber * inputs.energyPerTrain / inputs.dailyEnergy;
    }
  }

  return null;
}

function calculateBookTimingImpact(
  inputs: BookTimingComparisonInputs,
  bookStartDay: number,
): BookTimingBookImpact {
  const bookEndDay = bookStartDay + inputs.bookDurationDays;
  const startStat = statAtBookTimingDay(inputs.lowStat, bookStartDay, null, inputs);
  const withBookStat = statAtBookTimingDay(inputs.lowStat, bookEndDay, bookStartDay, inputs);
  const withoutBookStat = statAtBookTimingDay(inputs.lowStat, bookEndDay, null, inputs);
  const extraGain = withBookStat - withoutBookStat;

  return {
    startDay: bookStartDay,
    endDay: bookEndDay,
    startStat,
    extraGain,
    percentGain: startStat > 0 ? extraGain / startStat * 100 : null,
  };
}

function emptyBookTimingImpact(): BookTimingBookImpact {
  return {
    startDay: null,
    endDay: null,
    startStat: null,
    extraGain: null,
    percentGain: null,
  };
}

function statAtBookTimingDay(
  startingStat: number,
  day: number,
  bookStartDay: number | null,
  inputs: BookTimingComparisonInputs,
): number {
  const perkMultiplier = perkProductFromPercents(inputs);
  const trains = completeTrains(inputs.dailyEnergy * Math.max(0, day), inputs.energyPerTrain);
  let stat = startingStat;

  for (let index = 0; index < trains; index += 1) {
    const trainDay = (index + 1) * inputs.energyPerTrain / inputs.dailyEnergy;
    stat += gainPerTrain(stat, inputs, perkMultiplier, isBookActiveForTrain(trainDay, bookStartDay, inputs.bookDurationDays));
  }

  return stat;
}

function isBookActiveForTrain(trainDay: number, bookStartDay: number | null, bookDurationDays: number): boolean {
  return bookStartDay !== null && trainDay > bookStartDay + 1e-10 && trainDay <= bookStartDay + bookDurationDays + 1e-10;
}

function isBookActiveAtDay(day: number, bookStartDay: number | null, bookDurationDays: number): boolean {
  return bookStartDay !== null && day > bookStartDay && day <= bookStartDay + bookDurationDays;
}

export function calculateFhcPlan(inputs: BookStrategyInputs): FhcPlan {
  const initialFhcs = Math.floor(inputs.maxBoosterCooldownHours / inputs.fhcCooldownHours);
  const bookHours = inputs.bookDurationDays * 24;
  const furtherFhcs = Math.max(0, Math.ceil(bookHours / inputs.fhcCooldownHours) - 1);
  const totalFhcs = initialFhcs + furtherFhcs;

  return {
    initialFhcs,
    furtherFhcs,
    totalFhcs,
    energy: totalFhcs * inputs.fhcEnergy,
    cost: totalFhcs * inputs.fhcPrice,
  };
}

export function perkProduct(inputs: BookStrategyInputs): number {
  return perkProductFromPercents(inputs);
}

function perkProductFromPercents(inputs: PerkPercentInputs): number {
  return [
    inputs.privateIslandPercent,
    inputs.generalEducationPercent,
    inputs.statEducationPercent,
    inputs.steadfastPercent,
    inputs.customPerksPercent,
  ].reduce((product, percent) => product * (1 + percent / 100), 1);
}

export function effectiveStat(stat: number): number {
  if (stat < 50_000_000) {
    return stat;
  }

  return 50_000_000 + (stat - 50_000_000) / (8.77635 * Math.log10(stat));
}

export function gainPerTrain(
  stat: number,
  inputs: GymFormulaInputs,
  perkMultiplier: number,
  bookActive: boolean,
): number {
  const happy = inputs.happiness;
  const happyTerm = roundTo(1 + 0.07 * roundTo(Math.log(1 + happy / 250), 4), 4);
  const baseGain =
    effectiveStat(stat) * happyTerm +
    8 * happy ** 1.05 +
    CANONICAL_A * (1 - (happy / 99_999) ** 2) +
    CANONICAL_B;
  const bookMultiplier = bookActive ? 1 + inputs.bookBonusPercent / 100 : 1;

  return (
    (1 / 200_000) *
    inputs.gymMultiplier *
    inputs.energyPerTrain *
    perkMultiplier *
    baseGain *
    bookMultiplier
  );
}

function calculateBookEnd(
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
): BookStrategyResult["bookEnd"] {
  const normalBookEnergy = inputs.startingEnergy + inputs.dailyEnergy * inputs.bookDurationDays;
  const strategyTwoTrains = completeTrains(normalBookEnergy, inputs.energyPerTrain);
  const strategyOneTrains = completeTrains(normalBookEnergy + fhcPlan.energy, inputs.energyPerTrain);
  const strategyTwoStat = advanceStat(inputs.startingStat, strategyTwoTrains, inputs, perkMultiplier, true);
  const strategyOneStat = advanceStat(inputs.startingStat, strategyOneTrains, inputs, perkMultiplier, true);

  return {
    strategyOneStat,
    strategyTwoStat,
    lead: strategyOneStat - strategyTwoStat,
  };
}

function findEnhancerUse(
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookEnd: BookStrategyResult["bookEnd"],
  earliestSearchMaxDay?: number,
): BookStrategyResult["enhancerUse"] {
  const mode = inputs.enhancerUseMode;
  const bookState = createPostBookState(inputs, bookEnd, fhcPlan);

  if (mode.kind === "targetDay") {
    return enhancerUseAtDay(Math.max(inputs.bookDurationDays, mode.day), inputs, perkMultiplier, fhcPlan, bookState);
  }

  if (mode.kind === "targetStat") {
    const day = findDayForTargetStat(inputs, perkMultiplier, fhcPlan, bookState, mode.stat);
    return day === null
      ? emptyEnhancerUse()
      : enhancerUseAtDay(day, inputs, perkMultiplier, fhcPlan, bookState);
  }

  return findEarliestOvertake(inputs, perkMultiplier, fhcPlan, bookState, earliestSearchMaxDay);
}

function findEarliestOvertake(
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookState: PostBookState,
  searchMaxDay?: number,
  targetLead = 0,
): BookStrategyResult["enhancerUse"] {
  const trainingMonths = Math.max(1, inputs.postBookTrainingMonthsOutOfFour);
  const defaultMaxDay = Math.max(inputs.graphDurationDays, inputs.bookDurationDays + 730 * (4 / trainingMonths));
  const maxDay = Math.min(
    MAX_SIMULATION_DAYS,
    finiteAtLeast(searchMaxDay ?? defaultMaxDay, inputs.bookDurationDays),
  );
  const maxEnhancers = affordableEnhancers(
    investmentBalanceAtDay(inputs, fhcPlan.cost, maxDay),
    inputs.statEnhancerPrice,
  );
  if (maxEnhancers <= 0) {
    return emptyEnhancerUse();
  }

  const fundingDays = Array.from({ length: maxEnhancers }, (_, index) =>
    nextEnhancerFundingDay(inputs, fhcPlan.cost, inputs.bookDurationDays, index + 1),
  )
    .map((day) => Math.max(inputs.bookDurationDays, day))
    .filter((day) => Number.isFinite(day) && day <= maxDay)
    .sort((a, b) => a - b);
  let nextFundingIndex = 0;

  let day = inputs.bookDurationDays;
  let strategyOneStat = bookState.strategyOneBookStat;
  let strategyTwoStat = bookState.strategyTwoBookStat;
  const postBookDailyEnergy = targetStatPostBookDailyEnergy(inputs);
  let nextStrategyOneTrainDay = postBookDailyEnergy > 0
    ? nextPostBookTrainDay(inputs, bookState.strategyOneLeftoverEnergy, 1)
    : Number.POSITIVE_INFINITY;
  let nextStrategyTwoTrainDay = postBookDailyEnergy > 0
    ? nextPostBookTrainDay(inputs, bookState.strategyTwoLeftoverEnergy, 1)
    : Number.POSITIVE_INFINITY;
  const postBookTrainInterval = postBookDailyEnergy > 0
    ? inputs.energyPerTrain / postBookDailyEnergy
    : Number.POSITIVE_INFINITY;

  const evaluateCurrentDay = (): BookStrategyResult["enhancerUse"] => {
    return enhancerUseFromStatsAtDay(day, strategyOneStat, strategyTwoStat, inputs, fhcPlan);
  };

  let candidate = evaluateCurrentDay();
  if (candidate.lead !== null && meetsEnhancerLeadTarget(candidate.lead, targetLead)) {
    return candidate;
  }

  while (day <= maxDay) {
    while (nextFundingIndex < fundingDays.length && fundingDays[nextFundingIndex] <= day + 1e-10) {
      nextFundingIndex += 1;
    }

    const nextFundingDay = nextFundingIndex < fundingDays.length
      ? fundingDays[nextFundingIndex]
      : Number.POSITIVE_INFINITY;
    const nextDay = Math.min(nextStrategyOneTrainDay, nextStrategyTwoTrainDay, nextFundingDay);
    if (!Number.isFinite(nextDay) || nextDay > maxDay) {
      break;
    }

    day = nextDay;
    while (Math.abs(day - nextStrategyOneTrainDay) < 1e-10) {
      strategyOneStat += gainPerTrain(strategyOneStat, inputs, perkMultiplier, false);
      nextStrategyOneTrainDay += postBookTrainInterval;
    }
    while (Math.abs(day - nextStrategyTwoTrainDay) < 1e-10) {
      strategyTwoStat += gainPerTrain(strategyTwoStat, inputs, perkMultiplier, false);
      nextStrategyTwoTrainDay += postBookTrainInterval;
    }

    candidate = evaluateCurrentDay();
    if (candidate.lead !== null && meetsEnhancerLeadTarget(candidate.lead, targetLead)) {
      return candidate;
    }
  }

  return emptyEnhancerUse();
}

function meetsEnhancerLeadTarget(lead: number, targetLead: number): boolean {
  return targetLead <= 0 ? lead > 0 : lead >= targetLead;
}

function nextPostBookTrainDay(inputs: BookStrategyInputs, leftoverEnergy: number, trainNumber: number): number {
  return inputs.bookDurationDays + (trainNumber * inputs.energyPerTrain - leftoverEnergy) / targetStatPostBookDailyEnergy(inputs);
}

function enhancerUseAtDay(
  day: number,
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookState: PostBookState,
): BookStrategyResult["enhancerUse"] {
  const strategyOneStat = statAtDayWithoutEnhancers(day, "strategyOne", inputs, perkMultiplier, fhcPlan, bookState);
  const strategyTwoBeforeEnhancers = statAtDayWithoutEnhancers(day, "strategyTwo", inputs, perkMultiplier, fhcPlan, bookState);
  const investmentBalance = investmentBalanceAtDay(inputs, fhcPlan.cost, day);
  const enhancersUsed = affordableEnhancers(investmentBalance, inputs.statEnhancerPrice);

  if (enhancersUsed <= 0) {
    return emptyEnhancerUse();
  }

  const strategyTwoAfterEnhancers = applyEnhancers(strategyTwoBeforeEnhancers, enhancersUsed);

  return {
    day,
    strategyOneStat,
    strategyTwoBeforeEnhancers,
    strategyTwoAfterEnhancers,
    investmentBalance,
    enhancersUsed,
    lead: strategyTwoAfterEnhancers - strategyOneStat,
  };
}

function enhancerUseFromStatsAtDay(
  day: number,
  strategyOneStat: number,
  strategyTwoBeforeEnhancers: number,
  inputs: BookStrategyInputs,
  fhcPlan: FhcPlan,
): BookStrategyResult["enhancerUse"] {
  const investmentBalance = investmentBalanceAtDay(inputs, fhcPlan.cost, day);
  const enhancersUsed = affordableEnhancers(investmentBalance, inputs.statEnhancerPrice);
  const strategyTwoAfterEnhancers = applyEnhancers(strategyTwoBeforeEnhancers, enhancersUsed);

  return {
    day,
    strategyOneStat,
    strategyTwoBeforeEnhancers,
    strategyTwoAfterEnhancers,
    investmentBalance,
    enhancersUsed,
    lead: strategyTwoAfterEnhancers - strategyOneStat,
  };
}

function buildSeries(
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  enhancerDay: number | null,
  enhancersUsed: number,
): BookStrategyPoint[] {
  const bookEnd = calculateBookEnd(inputs, perkMultiplier, fhcPlan);
  const bookState = createPostBookState(inputs, bookEnd, fhcPlan);
  const sampleDays = new Set<number>([0, inputs.bookDurationDays, inputs.graphDurationDays]);
  for (let day = 0; day <= inputs.graphDurationDays; day += GRAPH_STEP_DAYS) {
    sampleDays.add(Number(day.toFixed(8)));
  }
  if (enhancerDay !== null && enhancerDay <= inputs.graphDurationDays) {
    sampleDays.add(Number(enhancerDay.toFixed(8)));
  }

  return [...sampleDays]
    .filter((day) => day >= 0 && day <= inputs.graphDurationDays)
    .sort((a, b) => a - b)
    .map((day) => pointAtDay(day, inputs, perkMultiplier, fhcPlan, bookState, enhancerDay, enhancersUsed));
}

function pointAtDay(
  day: number,
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookState: PostBookState,
  enhancerDay: number | null,
  enhancersUsed: number,
): BookStrategyPoint {
  const strategyOneStat = statAtDayWithoutEnhancers(day, "strategyOne", inputs, perkMultiplier, fhcPlan, bookState);
  const strategyTwoBeforeEnhancers = statAtDayWithoutEnhancers(day, "strategyTwo", inputs, perkMultiplier, fhcPlan, bookState);
  let strategyTwoStat = strategyTwoBeforeEnhancers;
  let used = 0;

  if (enhancerDay !== null && day >= enhancerDay && enhancersUsed > 0) {
    const eventBeforeStat = statAtDayWithoutEnhancers(enhancerDay, "strategyTwo", inputs, perkMultiplier, fhcPlan, bookState);
    const eventAfterStat = applyEnhancers(eventBeforeStat, enhancersUsed);
    const eventPostEnergy = postBookEnergyAtDay(inputs, bookState.strategyTwoLeftoverEnergy, enhancerDay);
    const eventPostTrains = completeTrains(eventPostEnergy, inputs.energyPerTrain);
    const currentPostEnergy = postBookEnergyAtDay(inputs, bookState.strategyTwoLeftoverEnergy, day);
    const currentPostTrains = completeTrains(currentPostEnergy, inputs.energyPerTrain);
    const trainsAfterEnhancers = Math.max(0, currentPostTrains - eventPostTrains);
    strategyTwoStat = advanceStat(eventAfterStat, trainsAfterEnhancers, inputs, perkMultiplier, false);
    used = enhancersUsed;
  }

  return {
    day,
    strategyOneStat,
    strategyTwoStat,
    strategyTwoBeforeEnhancers,
    investmentBalance: investmentBalanceAtDay(inputs, fhcPlan.cost, day),
    enhancersAffordable: affordableEnhancers(investmentBalanceAtDay(inputs, fhcPlan.cost, day), inputs.statEnhancerPrice),
    enhancersUsed: used,
    difference: strategyTwoStat - strategyOneStat,
  };
}

function statAtDayWithoutEnhancers(
  day: number,
  strategy: "strategyOne" | "strategyTwo",
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookState: PostBookState,
): number {
  if (day <= inputs.bookDurationDays) {
    const energy = bookEnergyAtDay(day, strategy, inputs, fhcPlan);
    const trains = completeTrains(energy, inputs.energyPerTrain);
    return advanceStat(inputs.startingStat, trains, inputs, perkMultiplier, true);
  }

  const bookEndStat = strategy === "strategyOne" ? bookState.strategyOneBookStat : bookState.strategyTwoBookStat;
  const leftover = strategy === "strategyOne" ? bookState.strategyOneLeftoverEnergy : bookState.strategyTwoLeftoverEnergy;
  const trains = completeTrains(postBookEnergyAtDay(inputs, leftover, day), inputs.energyPerTrain);
  return advanceStat(bookEndStat, trains, inputs, perkMultiplier, false);
}

function findDayForTargetStat(
  inputs: BookStrategyInputs,
  perkMultiplier: number,
  fhcPlan: FhcPlan,
  bookState: PostBookState,
  targetStat: number,
): number | null {
  for (let day = inputs.bookDurationDays; day <= MAX_SIMULATION_DAYS; day += GRAPH_STEP_DAYS) {
    const stat = statAtDayWithoutEnhancers(day, "strategyTwo", inputs, perkMultiplier, fhcPlan, bookState);
    if (stat >= targetStat) {
      return day;
    }
  }

  return null;
}

function bookEnergyAtDay(
  day: number,
  strategy: "strategyOne" | "strategyTwo",
  inputs: BookStrategyInputs,
  fhcPlan: FhcPlan,
): number {
  const normalEnergy = inputs.startingEnergy + inputs.dailyEnergy * Math.max(0, day);
  if (strategy === "strategyTwo") {
    return normalEnergy;
  }

  return normalEnergy + fhcsAvailableAtDay(day, inputs, fhcPlan) * inputs.fhcEnergy;
}

function fhcsAvailableAtDay(day: number, inputs: BookStrategyInputs, fhcPlan: FhcPlan): number {
  if (day < 0) {
    return 0;
  }

  const furtherUsed = Math.min(
    fhcPlan.furtherFhcs,
    Math.floor((day * 24 + 1e-9) / inputs.fhcCooldownHours),
  );
  return fhcPlan.initialFhcs + furtherUsed;
}

function createPostBookState(
  inputs: BookStrategyInputs,
  bookEnd: BookStrategyResult["bookEnd"],
  fhcPlan: FhcPlan,
): PostBookState {
  const strategyOneBookEnergy = bookEnergyAtDay(inputs.bookDurationDays, "strategyOne", inputs, fhcPlan);
  const strategyTwoBookEnergy = bookEnergyAtDay(inputs.bookDurationDays, "strategyTwo", inputs, fhcPlan);

  return {
    strategyOneBookStat: bookEnd.strategyOneStat,
    strategyTwoBookStat: bookEnd.strategyTwoStat,
    strategyOneLeftoverEnergy: leftoverEnergy(strategyOneBookEnergy, inputs.energyPerTrain),
    strategyTwoLeftoverEnergy: leftoverEnergy(strategyTwoBookEnergy, inputs.energyPerTrain),
  };
}

function postBookEnergyAtDay(inputs: BookStrategyInputs, leftover: number, day: number): number {
  return leftover + targetStatPostBookDailyEnergy(inputs) * Math.max(0, day - inputs.bookDurationDays);
}

function targetStatPostBookDailyEnergy(inputs: BookStrategyInputs): number {
  return inputs.dailyEnergy * inputs.postBookTrainingMonthsOutOfFour / 4;
}

function investmentBalanceAtDay(inputs: BookStrategyInputs, principal: number, day: number): number {
  if (!inputs.investmentEnabled) {
    return principal;
  }

  return principal * (1 + inputs.annualRoiPercent / 100) ** (Math.max(0, day) / 365);
}

function nextEnhancerFundingDay(
  inputs: BookStrategyInputs,
  principal: number,
  currentDay: number,
  targetEnhancers: number,
): number {
  const targetBalance = targetEnhancers * inputs.statEnhancerPrice;
  if (principal >= targetBalance) {
    return currentDay;
  }

  if (!inputs.investmentEnabled || inputs.annualRoiPercent <= 0 || principal <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const growthFactor = 1 + inputs.annualRoiPercent / 100;
  return 365 * Math.log(targetBalance / principal) / Math.log(growthFactor);
}

function advanceStat(
  startingStat: number,
  trains: number,
  inputs: GymFormulaInputs,
  perkMultiplier: number,
  bookActive: boolean,
): number {
  let stat = startingStat;
  for (let index = 0; index < trains; index += 1) {
    stat += gainPerTrain(stat, inputs, perkMultiplier, bookActive);
  }
  return stat;
}

function firstSeriesOvertake(series: BookStrategyPoint[]): number | null {
  return series.find((point) => point.difference > 0)?.day ?? null;
}

function affordableEnhancers(balance: number, price: number): number {
  return Math.max(0, Math.floor(balance / price));
}

function applyEnhancers(stat: number, count: number): number {
  return stat * STAT_ENHANCER_MULTIPLIER ** count;
}

function completeTrains(energy: number, energyPerTrain: number): number {
  return Math.floor((energy + 1e-9) / energyPerTrain);
}

function leftoverEnergy(energy: number, energyPerTrain: number): number {
  return energy - completeTrains(energy, energyPerTrain) * energyPerTrain;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteAtLeast(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : minimum;
}

function normalizeEnhancerUseMode(mode: EnhancerUseMode): EnhancerUseMode {
  if (mode.kind === "targetDay") {
    return { kind: "targetDay", day: finiteAtLeast(mode.day, 0) };
  }

  if (mode.kind === "targetStat") {
    return { kind: "targetStat", stat: finiteAtLeast(mode.stat, 0) };
  }

  return { kind: "earliestOvertake" };
}

function emptyEnhancerUse(): BookStrategyResult["enhancerUse"] {
  return {
    day: null,
    strategyOneStat: null,
    strategyTwoBeforeEnhancers: null,
    strategyTwoAfterEnhancers: null,
    investmentBalance: null,
    enhancersUsed: 0,
    lead: null,
  };
}

type PostBookState = {
  strategyOneBookStat: number;
  strategyTwoBookStat: number;
  strategyOneLeftoverEnergy: number;
  strategyTwoLeftoverEnergy: number;
};
