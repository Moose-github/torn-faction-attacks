import { beforeEach, expect, it, vi } from "vitest";
import { sendMedicalStockAlert } from "./armoryStock";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import { discordAlertRouteByKey } from "./discordAlerts";
import type { Env } from "./types";

vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn() }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn() }));
vi.mock("./discordMentions", async importOriginal => ({ ...await importOriginal<typeof import("./discordMentions")>(), readDiscordAlertMentions: vi.fn() }));
const env = {} as Env;
beforeEach(() => {
  vi.mocked(upsertDiscordAlertMessage).mockReset().mockResolvedValue("123456");
  vi.mocked(isDiscordAlertEnabled).mockReset().mockResolvedValue(true);
  vi.mocked(readDiscordAlertMentions).mockReset().mockResolvedValue({ messageSuffix: "", allowedMentions: undefined });
});

it("sends an orange embed with quantities, threshold and configured mentions", async () => {
  expect(discordAlertRouteByKey("item_stock_low")?.name).toBe("Item stock low");
  vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "<@&123456>", allowedMentions: { roles: ["123456"], users: [] } });
  expect(await sendMedicalStockAlert(env, "First Aid Kit", 1000, 1000)).toBe(true);
  expect(isDiscordAlertEnabled).toHaveBeenCalledWith(env, "item_stock_low");
  expect(upsertDiscordAlertMessage).toHaveBeenCalledExactlyOnceWith(env, "item_stock_low", null,
    "**Item stock low**\nFirst Aid Kit: **1,000 available** (threshold: 1,000).\n<@&123456>",
    { roles: ["123456"], users: [] }, { embedColor: 0xffa500 });
});

it("keeps delivery pending when the global alert is off or no route/delivery confirmation exists", async () => {
  vi.mocked(isDiscordAlertEnabled).mockResolvedValueOnce(false);
  expect(await sendMedicalStockAlert(env, "Morphine", 0, 0)).toBe(false);
  expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  vi.mocked(upsertDiscordAlertMessage).mockResolvedValueOnce(null);
  expect(await sendMedicalStockAlert(env, "Morphine", 0, 0)).toBe(false);
});

it("only permits configured mentions and leaves delivery failures retryable", async () => {
  await sendMedicalStockAlert(env, "@everyone **Morphine**", 0, 0);
  expect(vi.mocked(upsertDiscordAlertMessage).mock.calls[0][3]).not.toContain("@everyone");
  expect(vi.mocked(upsertDiscordAlertMessage).mock.calls[0][4]).toEqual({ users: [], roles: [] });
  vi.mocked(upsertDiscordAlertMessage).mockRejectedValueOnce(new Error("Rate limited"));
  await expect(sendMedicalStockAlert(env, "Morphine", 0, 0)).rejects.toThrow("Rate limited");
});
