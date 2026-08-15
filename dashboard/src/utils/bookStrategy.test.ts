import { describe, expect, it } from "vitest";
import {
  bookTimingStatAtDayWithoutBook,
  calculateBookTimingComparison,
  calculateBookStrategy,
  calculateFhcPlan,
  calculateIgnoranceIsBliss,
  defaultBookTimingComparisonInputs,
  defaultBookStrategyInputs,
  defaultIgnoranceIsBlissInputs,
  findEnhancerLeadMilestone,
  findEnhancerLeadMilestones,
  perkProduct,
} from "./bookStrategy";

describe("book strategy calculator", () => {
  it("calculates the default FHC stack and multiplicative perks", () => {
    const fhcs = calculateFhcPlan(defaultBookStrategyInputs);

    expect(fhcs).toEqual({
      initialFhcs: 8,
      furtherFhcs: 123,
      totalFhcs: 131,
      energy: 19_650,
      cost: 1_834_000_000,
    });
    expect(defaultBookStrategyInputs.investmentEnabled).toBe(false);
    expect(defaultBookStrategyInputs.postBookTrainingMonthsOutOfFour).toBe(4);
    expect(perkProduct(defaultBookStrategyInputs)).toBeCloseTo(1.22779236, 8);
  });

  it("matches the 500m book-end example without investment growth", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyOneStat).toBeCloseTo(817_700_000, -5);
    expect(result.bookEnd.strategyTwoStat).toBeCloseTo(727_400_000, -5);
    expect(result.bookEnd.lead).toBeCloseTo(90_300_000, -5);
    expect(result.enhancerUse.strategyTwoBeforeEnhancers).toBeCloseTo(3_411_000_000, -7);
    expect(result.enhancerUse.day).toBeCloseTo(409.1, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(4);
  });

  it("matches the 500m investment-assisted five-enhancer example", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
    });

    expect(result.enhancerUse.day).toBeCloseTo(334.39, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(5);
    expect(result.enhancerUse.strategyOneStat ?? 0).toBeCloseTo(2_914_600_000, -6);
    expect(result.enhancerUse.strategyTwoBeforeEnhancers ?? 0).toBeCloseTo(2_787_100_000, -6);
    expect(result.enhancerUse.strategyTwoAfterEnhancers ?? 0).toBeCloseTo(2_929_200_000, -6);
    expect(result.enhancerUse.lead ?? 0).toBeCloseTo(14_600_000, -5);
  });

  it("supports one-month-in-four target-stat post-book training", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: false,
      postBookTrainingMonthsOutOfFour: 1,
    });

    expect(result.enhancerUse.strategyTwoBeforeEnhancers).toBeCloseTo(3_411_000_000, -7);
    expect(result.enhancerUse.day).toBeCloseTo(1618.1, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(4);
  });

  it("shows flat post-book sections when the target stat is not being trained", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      postBookTrainingMonthsOutOfFour: 1,
      graphDurationDays: 160,
      investmentEnabled: false,
    });
    const day31 = result.series.find((point) => point.day === 31);
    const day62 = result.series.find((point) => point.day === 62);
    const day100 = result.series.find((point) => point.day === 100);
    const day156 = result.series.find((point) => point.day === 156);

    expect(day31).toBeDefined();
    expect(day62).toBeDefined();
    expect(day100).toBeDefined();
    expect(day156).toBeDefined();
    expect(day62?.strategyOneStat).toBeCloseTo(day31?.strategyOneStat ?? 0, 8);
    expect(day62?.strategyTwoStat).toBeCloseTo(day31?.strategyTwoStat ?? 0, 8);
    expect(day100?.strategyOneStat).toBeCloseTo(day62?.strategyOneStat ?? 0, 8);
    expect(day100?.strategyTwoStat).toBeCloseTo(day62?.strategyTwoStat ?? 0, 8);
    expect(day156?.strategyOneStat ?? 0).toBeGreaterThan(day100?.strategyOneStat ?? 0);
    expect(day156?.strategyTwoStat ?? 0).toBeGreaterThan(day100?.strategyTwoStat ?? 0);
  });

  it("moves the earliest overtake when FHC price funds enhancers sooner", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      fhcPrice: 15_000_000,
      investmentEnabled: true,
      postBookTrainingMonthsOutOfFour: 4,
    });

    expect(result.fhcPlan.cost).toBe(1_965_000_000);
    expect(result.enhancerUse.day).toBeCloseTo(277.81, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(5);
    expect(result.enhancerUse.lead ?? 0).toBeGreaterThan(0);
  });

  it("finds the earliest immediate enhancer lead beyond the displayed graph range", () => {
    const cashMilestone = findEnhancerLeadMilestone(defaultBookStrategyInputs, 100_000_000, 3_650);

    const milestone = findEnhancerLeadMilestone({
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
    }, 100_000_000, 3_650);

    expect(cashMilestone?.day).toBeCloseTo(801.82, 1);
    expect(cashMilestone?.lead).toBeGreaterThanOrEqual(100_000_000);
    expect(milestone?.day).toBeCloseTo(606.14, 1);
    expect(milestone?.lead).toBeGreaterThanOrEqual(100_000_000);
  });

  it("uses the milestone horizon when the prerequisite overtake is delayed", () => {
    const milestone = findEnhancerLeadMilestone({
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
      statEnhancerPrice: 1_200_000_000,
    }, 1, 3_650);

    expect(milestone?.day).toBeGreaterThan(defaultBookStrategyInputs.bookDurationDays + 730);
    expect(milestone?.lead).toBeGreaterThanOrEqual(1);
  });

  it("finds immediate lead milestones independently of selected enhancer timing", () => {
    const milestone = findEnhancerLeadMilestone({
      ...defaultBookStrategyInputs,
      graphDurationDays: 700,
      investmentEnabled: true,
      enhancerUseMode: { kind: "targetDay", day: 607 },
    }, 100_000_000, 3_650);

    expect(milestone?.day).toBeCloseTo(606.14, 1);
    expect(milestone?.lead).toBeGreaterThanOrEqual(100_000_000);
  });

  it("finds immediate enhancer lead milestones for smaller lead targets", () => {
    const inputs = {
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
    };
    const twentyFiveMillion = findEnhancerLeadMilestone(inputs, 25_000_000, 3_650);
    const fiftyMillion = findEnhancerLeadMilestone(inputs, 50_000_000, 3_650);
    const oneHundredMillion = findEnhancerLeadMilestone(inputs, 100_000_000, 3_650);

    expect(twentyFiveMillion?.day).toBeLessThan(fiftyMillion?.day ?? Number.POSITIVE_INFINITY);
    expect(fiftyMillion?.day).toBeLessThan(oneHundredMillion?.day ?? Number.POSITIVE_INFINITY);
    expect(twentyFiveMillion?.lead).toBeGreaterThanOrEqual(25_000_000);
    expect(fiftyMillion?.lead).toBeGreaterThanOrEqual(50_000_000);
    expect(oneHundredMillion?.lead).toBeGreaterThanOrEqual(100_000_000);
  });

  it("finds multiple enhancer lead milestones in one pass", () => {
    const inputs = {
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
    };
    const milestones = findEnhancerLeadMilestones(inputs, [0, 25_000_000, 50_000_000, 100_000_000], 3_650);

    expect(milestones.map((entry) => entry.target)).toEqual([0, 25_000_000, 50_000_000, 100_000_000]);
    expect(milestones[0].milestone?.day).toBeCloseTo(findEnhancerLeadMilestone(inputs, 0, 3_650)?.day ?? 0, 8);
    expect(milestones[1].milestone?.day).toBeCloseTo(findEnhancerLeadMilestone(inputs, 25_000_000, 3_650)?.day ?? 0, 8);
    expect(milestones[2].milestone?.day).toBeCloseTo(findEnhancerLeadMilestone(inputs, 50_000_000, 3_650)?.day ?? 0, 8);
    expect(milestones[3].milestone?.day).toBeCloseTo(findEnhancerLeadMilestone(inputs, 100_000_000, 3_650)?.day ?? 0, 8);
    expect(milestones.every((entry) => entry.milestone === null || entry.milestone.enhancersUsed > 0)).toBe(true);
  });

  it("matches the 4b example without investment growth", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      startingStat: 4_000_000_000,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyOneStat).toBeCloseTo(4_548_700_000, -6);
    expect(result.bookEnd.strategyTwoStat).toBeCloseTo(4_393_100_000, -6);
    expect(result.enhancerUse.enhancersUsed).toBe(4);
    expect(result.enhancerUse.day).toBeCloseTo(31, 4);
    expect(result.enhancerUse.strategyTwoAfterEnhancers ?? 0).toBeCloseTo(4_571_500_000, -6);
    expect(result.enhancerUse.lead ?? 0).toBeCloseTo(22_800_000, -5);
  });

  it("carries energy that is not divisible by train cost", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      startingEnergy: 100,
      graphDurationDays: 31,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyTwoStat).toBeLessThan(723_500_000);
    expect(result.bookEnd.strategyOneStat).toBeLessThan(813_700_000);
  });

  it("handles insufficient enhancer funds", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      fhcPrice: 1,
      investmentEnabled: false,
    });

    expect(result.fhcPlan.cost).toBe(131);
    expect(result.enhancerUse.enhancersUsed).toBe(0);
    expect(result.enhancerUse.day).toBeNull();
  });

  it("does not report manual enhancer use as break-even while enhancers are still behind", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: false,
      graphDurationDays: 450,
      enhancerUseMode: { kind: "targetDay", day: defaultBookStrategyInputs.bookDurationDays },
    });
    const firstOvertakePoint = result.series.find((point) => point.difference > 0);

    expect(result.enhancerUse.day).toBe(defaultBookStrategyInputs.bookDurationDays);
    expect(result.enhancerUse.lead ?? 0).toBeLessThan(0);
    expect(result.breakEvenDay).toBe(firstOvertakePoint?.day ?? null);
    expect(result.breakEvenDay).not.toBe(result.enhancerUse.day);
  });

  it("finds target-stat enhancer use at train-event precision", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      graphDurationDays: 120,
      enhancerUseMode: { kind: "targetStat", stat: 1_000_000_000 },
    });

    expect(result.enhancerUse.day).not.toBeNull();
    expect(result.enhancerUse.day ?? 0).toBeGreaterThan(defaultBookStrategyInputs.bookDurationDays);
    expect(result.enhancerUse.day ?? 0).not.toBe(Math.round(result.enhancerUse.day ?? 0));
    expect(result.enhancerUse.strategyTwoBeforeEnhancers ?? 0).toBeGreaterThanOrEqual(1_000_000_000);
  });

  it("compares book timing with the same flat energy timeline", () => {
    const result = calculateBookTimingComparison(defaultBookTimingComparisonInputs);

    expect(result.inputs.happiness).toBe(5_000);
    expect(result.inputs.gymMultiplier).toBe(7.3);
    expect(result.delayedBookStartDay).not.toBeNull();
    expect(result.delayedBookStartDay ?? 0).toBeGreaterThan(0);
    expect(result.delayedBookStartDay ?? 0).toBeLessThan(300);
    expect(result.totalTrains).toBe(Math.floor(1_620 * 300 / 50));
    expect(result.endpoint.trainsConsumed).toBe(result.totalTrains);
  });

  it("starts the immediate book at day 0 and delayed book at the target stat", () => {
    const result = calculateBookTimingComparison(defaultBookTimingComparisonInputs);
    const delayedStartPoint = result.series.find((point) =>
      Math.abs(point.day - (result.delayedBookStartDay ?? 0)) < 0.000001,
    );

    expect(result.immediateBook.startDay).toBe(0);
    expect(result.immediateBook.endDay).toBe(defaultBookTimingComparisonInputs.bookDurationDays);
    expect(result.delayedBook.startDay).toBe(result.delayedBookStartDay);
    expect(result.delayedBook.startStat ?? 0).toBeGreaterThanOrEqual(1_000_000_000);
    expect(delayedStartPoint?.waitBookActive).toBe(false);
  });

  it("can convert a dragged delayed-book day into a matching target stat", () => {
    const targetStat = bookTimingStatAtDayWithoutBook(defaultBookTimingComparisonInputs, 150);
    const result = calculateBookTimingComparison({
      ...defaultBookTimingComparisonInputs,
      delayedBookTargetStat: targetStat,
    });

    expect(result.delayedBookStartDay).toBeCloseTo(150, 8);
    expect(result.delayedBook.startStat ?? 0).toBeCloseTo(targetStat, 4);
  });

  it("does not apply starting energy or a fresh delayed-book energy stack", () => {
    const noBookResult = calculateBookTimingComparison({
      ...defaultBookTimingComparisonInputs,
      bookBonusPercent: 0,
    });

    expect(noBookResult.series[0]).toMatchObject({
      day: 0,
      trainsConsumed: 0,
      useNowStat: defaultBookTimingComparisonInputs.lowStat,
      waitStat: defaultBookTimingComparisonInputs.lowStat,
    });
    expect(noBookResult.endpoint.useNowStat).toBeCloseTo(noBookResult.endpoint.waitStat, 5);
  });

  it("reports timing book gains as percent of stat at book start", () => {
    const result = calculateBookTimingComparison(defaultBookTimingComparisonInputs);

    expect(result.immediateBook.extraGain ?? 0).toBeGreaterThan(0);
    expect(result.delayedBook.extraGain ?? 0).toBeGreaterThan(0);
    expect(result.immediateBook.percentGain).toBeCloseTo(
      ((result.immediateBook.extraGain ?? 0) / (result.immediateBook.startStat ?? 1)) * 100,
      8,
    );
    expect(result.delayedBook.percentGain).toBeCloseTo(
      ((result.delayedBook.extraGain ?? 0) / (result.delayedBook.startStat ?? 1)) * 100,
      8,
    );
  });

  it("handles book timing targets that are not reached in the graph range", () => {
    const result = calculateBookTimingComparison({
      ...defaultBookTimingComparisonInputs,
      delayedBookTargetStat: 10_000_000_000_000,
    });

    expect(result.delayedBookStartDay).toBeNull();
    expect(result.delayedBook.startDay).toBeNull();
    expect(result.delayedBook.percentGain).toBeNull();
    expect(result.series.every((point) => !point.waitBookActive)).toBe(true);
  });

  it("caps duration-based charts at ten years", () => {
    const enhancerResult = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      graphDurationDays: 20_000,
    });
    const timingResult = calculateBookTimingComparison({
      ...defaultBookTimingComparisonInputs,
      graphDurationDays: 20_000,
    });

    expect(enhancerResult.inputs.graphDurationDays).toBe(3_650);
    expect(enhancerResult.endpoint.day).toBe(3_650);
    expect(timingResult.inputs.graphDurationDays).toBe(3_650);
    expect(timingResult.endpoint.day).toBe(3_650);
  });

  it("calculates Ignorance Is Bliss gain uplift for the selected starting stat", () => {
    const result = calculateIgnoranceIsBliss(defaultIgnoranceIsBlissInputs);

    expect(result.inputs.startingStat).toBe(500_000_000);
    expect(result.inputs.graphMaxStat).toBe(10_000_000_000);
    expect(result.totalTrains).toBe(Math.floor(1_620 * 31 / 50));
    expect(result.selected.bookGain).toBeGreaterThan(result.selected.normalGain);
    expect(result.selected.percentIncrease).toBeCloseTo(
      (result.selected.extraGain / result.selected.normalGain) * 100,
      8,
    );
    expect(result.series.some((point) => point.startingStat === result.inputs.startingStat)).toBe(true);
  });

  it("allows Ignorance Is Bliss starting stats as low as 1", () => {
    const result = calculateIgnoranceIsBliss({
      ...defaultIgnoranceIsBlissInputs,
      startingStat: 0,
      graphMaxStat: 10,
    });

    expect(result.inputs.startingStat).toBe(1);
    expect(result.series[0].startingStat).toBe(1);
    expect(result.series.at(-1)?.startingStat).toBe(10);
    expect(result.selected.bookEndingStat).toBeGreaterThan(result.selected.normalEndingStat);
  });

  it("clamps Ignorance Is Bliss standard happiness to realistic values", () => {
    const lowResult = calculateIgnoranceIsBliss({
      ...defaultIgnoranceIsBlissInputs,
      normalHappiness: 0,
    });
    const highResult = calculateIgnoranceIsBliss({
      ...defaultIgnoranceIsBlissInputs,
      normalHappiness: 99_999,
    });

    expect(lowResult.inputs.normalHappiness).toBe(1);
    expect(highResult.inputs.normalHappiness).toBe(10_000);
    expect(highResult.selected.extraGain).toBeGreaterThan(0);
    expect(highResult.selected.percentIncrease).toBeGreaterThan(0);
  });
});
