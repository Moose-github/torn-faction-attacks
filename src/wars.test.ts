import { describe, expect, it } from "vitest";
import type { Env } from "./types";
import { createManualEvent, previewHistoricalEventImport } from "./wars";

describe("event war mutations", () => {
  it("keeps manual real war creation disabled on the event creation route", async () => {
    const response = await createManualEvent(jsonRequest({
      war_type: "real",
      name: "manual-real-war",
      practical_start_time: 100,
    }), {} as Env);

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "MANUAL_WAR_CREATION_DISABLED",
    });
  });

  it("requires a finish time when previewing historical event imports", async () => {
    const response = await previewHistoricalEventImport(jsonRequest({
      practical_start_time: 100,
    }), {} as Env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "MISSING_FINISH_TIME",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/wars", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
