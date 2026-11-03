import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStockPaperStatus, runLiveStockPaperBotTick } from "./stockPaperTrading";
import { PAPER_BOTS } from "./stockPaperTrading/model";
import type { MarketStock, PaperAccount, PaperBotStatus } from "./stockPaperTrading/model";
import * as queries from "./stockPaperTrading/queries";
import { rankSignalsForStrategy } from "./stockPaperTrading/strategies";
import type { Env } from "./types";

vi.mock("./stockPaperTrading/queries");

const decisionAt = 1_800_000_000;
const market: MarketStock[] = [{
  stock_id: 1,
  acronym: null,
  name: null,
  points: [21600, 10800, 3600, 1800, 120, 60, 0].map((offset) => ({
    stock_id: 1,
    observed_at: decisionAt - offset,
    price: 100,
    market_cap: 100_000,
    total_shares: 1000,
    investors: 100,
  })),
}];

let accounts: PaperAccount[];
const run = vi.fn().mockResolvedValue({ success: true });
const batch = vi.fn().mockResolvedValue([]);
const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run })) }));
const env = { STOCK_DB: { prepare, batch } } as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  accounts = PAPER_BOTS.map((bot) => ({
    ...bot,
    mode: "paper",
    status: "active",
    cash_balance: bot.starting_cash,
    realized_pnl: 0,
    last_decision_at: decisionAt,
    created_at: decisionAt - 60,
    updated_at: decisionAt,
  }));
  vi.mocked(queries.readLivePaperAccount).mockImplementation(async (_env, id) => accounts.find((account) => account.id === id) ?? null);
  vi.mocked(queries.readNewestStockSnapshotAt).mockResolvedValue(decisionAt);
  vi.mocked(queries.readMarketStocksForDecision).mockResolvedValue(market);
  vi.mocked(queries.readAccountPositions).mockResolvedValue([]);
  vi.mocked(queries.readAccountPositionsWithMarket).mockResolvedValue([]);
  vi.mocked(queries.readLatestAccountEquity).mockResolvedValue(null);
  vi.mocked(queries.readRecentPaperTrades).mockResolvedValue([]);
  vi.mocked(queries.readLatestSimulationRun).mockResolvedValue(null);
});

describe("paper bot status history reads", () => {
  it("shares an in-flight history read while retaining each bot's own signals", async () => {
    let resolveHistory!: (value: MarketStock[]) => void;
    const history = new Promise<MarketStock[]>((resolve) => { resolveHistory = resolve; });
    vi.mocked(queries.readMarketStocksForDecision).mockReturnValue(history);
    const pendingStatus = getStockPaperStatus(env);
    await vi.waitFor(() => expect(queries.readMarketStocksForDecision).toHaveBeenCalledTimes(1));
    resolveHistory(market);
    const body = await (await pendingStatus).json() as { bots: PaperBotStatus[] };

    expect(queries.readMarketStocksForDecision).toHaveBeenCalledTimes(1);
    const expectedSignals = PAPER_BOTS.map((bot, index) =>
      rankSignalsForStrategy(market, decisionAt, accounts[index], bot.strategy).slice(0, 5),
    );
    expect(body.bots.map((bot) => bot.latest_signals)).toEqual(JSON.parse(JSON.stringify(expectedSignals)));
  });

  it("reads separate history for different decision timestamps", async () => {
    accounts[1].last_decision_at = decisionAt - 60;
    await getStockPaperStatus(env);
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledTimes(2);
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledWith(env, decisionAt);
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledWith(env, decisionAt - 60);
  });

  it("loads fresh history again on the next request", async () => {
    await getStockPaperStatus(env);
    await getStockPaperStatus(env);
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledTimes(2);
  });

  it("does not load history for accounts without a decision", async () => {
    accounts.forEach((account) => { account.last_decision_at = null; });
    await getStockPaperStatus(env);
    expect(queries.readMarketStocksForDecision).not.toHaveBeenCalled();
  });
});

describe("paper bot tick history reads", () => {
  it("skips history, positions and writes when all bots already processed the decision", async () => {
    accounts[1].last_decision_at = decisionAt + 60;
    const result = await runLiveStockPaperBotTick(env, decisionAt * 1000);
    expect(result.results.map((bot) => bot.reason)).toEqual(PAPER_BOTS.map(() => "Latest snapshot already evaluated"));
    expect(queries.readMarketStocksForDecision).not.toHaveBeenCalled();
    expect(queries.readAccountPositions).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("processes a pending bot even when the other bot is already up to date", async () => {
    accounts[1].last_decision_at = decisionAt - 60;
    const result = await runLiveStockPaperBotTick(env, decisionAt * 1000);
    expect(result.results[0]).toMatchObject({ bot_id: accounts[0].id, skipped: true });
    expect(result.results[1]).toMatchObject({ bot_id: accounts[1].id, skipped: false, account: { last_decision_at: decisionAt } });
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledExactlyOnceWith(env, decisionAt);
    expect(queries.readAccountPositions).toHaveBeenCalledExactlyOnceWith(env, accounts[1].id);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shares one history read when both bots need a decision", async () => {
    accounts.forEach((account) => { account.last_decision_at = null; });
    const result = await runLiveStockPaperBotTick(env, decisionAt * 1000);
    expect(result.results.map((bot) => bot.skipped)).toEqual([false, false]);
    expect(result.results.map((bot) => bot.snapshot?.observed_at)).toEqual([decisionAt, decisionAt]);
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledExactlyOnceWith(env, decisionAt);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares an empty history result without persisting decisions", async () => {
    accounts.forEach((account) => { account.last_decision_at = null; });
    vi.mocked(queries.readMarketStocksForDecision).mockResolvedValue([]);
    const result = await runLiveStockPaperBotTick(env, decisionAt * 1000);
    expect(result.results.map((bot) => bot.reason)).toEqual(PAPER_BOTS.map(() => "No market history available"));
    expect(queries.readMarketStocksForDecision).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("does not load history when snapshots are stale", async () => {
    await runLiveStockPaperBotTick(env, (decisionAt + 3600) * 1000);
    expect(queries.readMarketStocksForDecision).not.toHaveBeenCalled();
    expect(queries.readLivePaperAccount).not.toHaveBeenCalled();
  });
});
