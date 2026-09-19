import { describe, expect, it } from "vitest";
import { resolveLandedTravelTripType, resolveTravelTripType } from "./enemyTravel";

const departure = 1_800_000_000;
const businessArrival = departure + 81 * 60;
const standardArrival = departure + 271 * 60;
const ambiguous = "Business Class/Standard";

describe("ambiguous airliner classification", () => {
  it.each([0, 299, 300, 301])("applies the five-minute airborne grace at %s seconds after Business Class arrival", (delay) => {
    const fetchedAt = businessArrival + delay;
    expect(resolveTravelTripType("United Arab Emirates", "airliner", departure, ambiguous, null, fetchedAt)).toEqual({
      type: delay > 300 ? "Standard" : ambiguous,
      inferredAt: delay > 300 ? fetchedAt : null,
    });
  });

  it.each([0, 60, 300])("identifies a Business Class landing observed %s seconds after the expected arrival", (delay) => {
    const arrivedBy = businessArrival + delay;
    expect(resolveLandedTravelTripType("United Arab Emirates", {
      startedAfter: departure - 60,
      startedBefore: departure,
      lastTravelingAt: businessArrival - 120,
      arrivedBy,
    }, ambiguous, null)).toEqual({ type: "Business Class", inferredAt: arrivedBy });
  });

  it("uses the arrival window instead of treating a delayed landing observation as Standard", () => {
    const arrivedBy = businessArrival + 10 * 60;
    expect(resolveLandedTravelTripType("United Arab Emirates", {
      startedAfter: departure,
      startedBefore: departure,
      lastTravelingAt: businessArrival - 60,
      arrivedBy,
    }, ambiguous, null)).toEqual({ type: "Business Class", inferredAt: arrivedBy });
  });

  it("can identify Standard at landing when the last airborne observation rules out Business Class", () => {
    expect(resolveLandedTravelTripType("United Arab Emirates", {
      startedAfter: departure,
      startedBefore: departure,
      lastTravelingAt: businessArrival + 301,
      arrivedBy: standardArrival,
    }, ambiguous, null)).toEqual({ type: "Standard", inferredAt: standardArrival });
  });

  it.each([
    { startedAfter: null },
    { startedBefore: null },
    { startedAfter: departure - 4 * 3600 },
    { arrivedBy: businessArrival - 61 },
    { arrivedBy: standardArrival + 60 },
    { lastTravelingAt: businessArrival + 301 },
    { lastTravelingAt: businessArrival + 60 },
  ])("retains ambiguity for inconclusive or inconsistent observations: %j", (overrides) => {
    expect(resolveLandedTravelTripType("United Arab Emirates", {
      startedAfter: departure - 60,
      startedBefore: departure,
      lastTravelingAt: businessArrival - 120,
      arrivedBy: businessArrival + 60,
      ...overrides,
    }, ambiguous, null)).toEqual({ type: ambiguous, inferredAt: null });
  });

  it.each(["Standard", "Business Class", "Airstrip", "WLT benefit"] as const)("preserves an already resolved %s trip", (type) => {
    expect(resolveLandedTravelTripType("United Arab Emirates", {
      startedAfter: departure,
      startedBefore: departure,
      lastTravelingAt: businessArrival - 60,
      arrivedBy: businessArrival,
    }, type, departure + 60)).toEqual({ type, inferredAt: departure + 60 });
  });
});
