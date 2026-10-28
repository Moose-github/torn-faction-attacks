import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventCompetitionChartTooltip } from "./EventCompetitionChartTooltip";
import { formatDate } from "../utils/format";
import type { EventCompetitionChartPoint } from "../utils/eventCompetitionChart";

const point: EventCompetitionChartPoint = {
  observed_at: 1793408400, treats_gained: 12500, treats_sampled_at: 1793404800,
  chain: 900, chain_sampled_at: 1793408400, treats_point: null, treats_trend: 12400.4,
};
function render(overrides: Partial<EventCompetitionChartPoint> = {}) {
  return renderToStaticMarkup(<EventCompetitionChartTooltip active payload={[{ payload: { ...point, ...overrides } }]} />);
}

describe("Halloween graph infobox", () => {
  it("identifies the actual reading times for independently sampled series", () => {
    const html = render();
    expect(html).toContain("12,500");
    expect(html).toContain(`Collected ${formatDate(point.treats_sampled_at!)}`);
    expect(html).toContain(`Sampled ${formatDate(point.chain_sampled_at!)}`);
    expect(html).not.toContain("axis");
  });

  it("labels trend estimates separately and hides them outside the fitted range", () => {
    expect(render()).toContain("12,400");
    expect(render()).toContain("Best-fit estimate, not a reading");
    expect(render({ treats_trend: null })).not.toContain("Treats trend");
  });

  it("distinguishes zero from missing data even when both series have a gap", () => {
    expect(render({ chain: 0 })).not.toContain("No reading");
    const html = render({ chain: null, treats_gained: null, treats_sampled_at: null });
    expect(html.match(/No reading/g)).toHaveLength(2);
    expect(html).toContain("No reliable sample for this hour");
    expect(html).toContain("Awaiting first reading");
  });

  it("stays hidden when inactive or no chart point is selected", () => {
    expect(renderToStaticMarkup(<EventCompetitionChartTooltip payload={[{ payload: point }]} />)).toBe("");
    expect(renderToStaticMarkup(<EventCompetitionChartTooltip active />)).toBe("");
  });
});
