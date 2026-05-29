import { Env } from "../types";
import { trackedTornFetch } from "../tornApiUsage";
import { cleanText, finiteNumber, json, nowSeconds, parseLimit } from "../utils";

import {
  COPY_MOVEMENT_ACTIVITY_RECENT_SECONDS,
  COPY_MOVEMENT_ACTIVITY_TIMEOUT_MS,
  COPY_MOVEMENT_MAX_EVENTS_PER_TICK,
  COPY_MOVEMENT_MIN_ABS_PRICE_CHANGE,
  COPY_MOVEMENT_MIN_STRENGTH,
  COPY_MOVEMENT_SOURCE_PLAYER_ID,
  COPY_MOVEMENT_SOURCE_PLAYER_NAME,
  COPY_MOVEMENT_TORN_API_BASE,
  COPY_MOVEMENT_WINDOW_SECONDS,
  DECISION_INTERVAL_SECONDS,
  DEFAULT_BUY_FEE_RATE,
  DEFAULT_CONFIG,
  DEFAULT_SIMULATION_SECONDS,
  DEFAULT_SELL_FEE_RATE,
  DEFAULT_STARTING_CASH,
  DEFAULT_STRATEGY_KEY,
  FRESH_SNAPSHOT_SECONDS,
  LOOKBACK_SECONDS,
  MAX_SIMULATION_SECONDS,
  MIN_POSITION_HOLD_SECONDS,
  MOMENTUM_ACCOUNT_ID,
  PAPER_BOTS,
  STALE_POSITION_SECONDS,
  STOP_LOSS_NET_RETURN,
  TAKE_PROFIT_NET_RETURN,
  WHALE_FLOW_BASELINE_MULTIPLIER,
  WHALE_FLOW_BASELINE_SECONDS,
  WHALE_FLOW_MAX_TARGETS,
  WHALE_FLOW_MIN_SCORE,
  WHALE_FLOW_STRONG_REVERSAL_SCORE,
} from "./model";
import type {
  CopyMovementActivity,
  CopyMovementEvent,
  DecisionResult,
  EquitySnapshot,
  MarketPoint,
  MarketStock,
  PaperAccount,
  PaperBotDefinition,
  PaperBotStatus,
  PaperBotStrategy,
  PaperPosition,
  PaperTrade,
  SimulationRun,
  StockSignal,
  StrategyConfig,
  StrategyState,
} from "./model";

export async function runLiveStockPaperBotTick(
  env: Env,
  scheduledTime: number,
): Promise<{ ok: true; results: Array<{ bot_id: string; skipped: boolean; reason?: string; account?: PaperAccount; snapshot?: EquitySnapshot; trades?: PaperTrade[] }> }> {
  const newestSnapshotAt = await readNewestStockSnapshotAt(env);
  const scheduledSeconds = Math.floor(scheduledTime / 1000);
  const eligibleSnapshotAt = newestSnapshotAt === null
    ? null
    : Math.floor(newestSnapshotAt / DECISION_INTERVAL_SECONDS) * DECISION_INTERVAL_SECONDS;
  if (!eligibleSnapshotAt || scheduledSeconds - eligibleSnapshotAt > FRESH_SNAPSHOT_SECONDS) {
    return {
      ok: true,
      results: PAPER_BOTS.map((bot) => ({
        bot_id: bot.id,
        skipped: true,
        reason: "No fresh stock snapshots available",
      })),
    };
  }

  const market = await readMarketStocksForDecision(env, eligibleSnapshotAt);
  if (market.length === 0) {
    return {
      ok: true,
      results: PAPER_BOTS.map((bot) => ({
        bot_id: bot.id,
        skipped: true,
        reason: "No market history available",
      })),
    };
  }

  const results: Array<{ bot_id: string; skipped: boolean; reason?: string; account?: PaperAccount; snapshot?: EquitySnapshot; trades?: PaperTrade[] }> = [];
  for (const bot of PAPER_BOTS) {
    results.push(await runLiveStockPaperBotForDefinition(env, bot, eligibleSnapshotAt, market));
  }
  return { ok: true, results };
}

async function runLiveStockPaperBotForDefinition(
  env: Env,
  bot: PaperBotDefinition,
  eligibleSnapshotAt: number,
  market: MarketStock[],
): Promise<{ bot_id: string; skipped: boolean; reason?: string; account?: PaperAccount; snapshot?: EquitySnapshot; trades?: PaperTrade[] }> {
  const account = await ensureLivePaperAccount(env, bot, nowSeconds());
  if (account.last_decision_at !== null && account.last_decision_at >= eligibleSnapshotAt) {
    return { bot_id: bot.id, skipped: true, reason: "Latest snapshot already evaluated", account };
  }

  const positions = await readAccountPositions(env, account.id);
  const state: StrategyState = {
    cash: account.cash_balance,
    realizedPnl: account.realized_pnl,
    positions: new Map(positions.map((position) => [position.stock_id, { ...position }])),
  };
  let result: DecisionResult;
  try {
    result = bot.strategy === "copy-movement"
      ? await applyCopyMovementDecision({
        env,
        state,
        market,
        config: account,
        observedAt: eligibleSnapshotAt,
        accountId: account.id,
        createdAt: nowSeconds(),
      })
      : applyPaperDecision({
        state,
        market,
        config: account,
        strategy: bot.strategy,
        observedAt: eligibleSnapshotAt,
        accountId: account.id,
        simulationRunId: null,
        createdAt: nowSeconds(),
      });
  } catch (err: any) {
    return { bot_id: bot.id, skipped: true, reason: err?.message || String(err), account };
  }

  await persistAccountDecision(env, account, state, result, eligibleSnapshotAt);
  return { bot_id: bot.id, skipped: false, account: { ...account, cash_balance: state.cash, realized_pnl: state.realizedPnl, last_decision_at: eligibleSnapshotAt }, snapshot: result.snapshot, trades: result.trades };
}

export async function simulateStockPaperBotFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const newest = await readNewestStockSnapshotAt(env);
  const oldest = await readOldestStockSnapshotAt(env);
  const startedAt = nowSeconds();
  const run: SimulationRun = {
    id: crypto.randomUUID(),
    strategy_key: DEFAULT_STRATEGY_KEY,
    started_at: startedAt,
    finished_at: null,
    simulation_start_at: null,
    simulation_end_at: null,
    status: "running",
    starting_cash: DEFAULT_STARTING_CASH,
    final_equity: null,
    return_percent: null,
    max_drawdown_percent: null,
    trade_count: 0,
    win_trade_count: 0,
    buy_fee_rate: DEFAULT_BUY_FEE_RATE,
    sell_fee_rate: DEFAULT_SELL_FEE_RATE,
    config_json: JSON.stringify(DEFAULT_CONFIG),
    error: null,
  };

  if (!newest || !oldest || newest - oldest < LOOKBACK_SECONDS) {
    run.status = "skipped";
    run.finished_at = nowSeconds();
    run.error = "At least 6 hours of stock snapshots are needed before a simulation can run.";
    await insertSimulationRun(env, run);
    return json({ ok: true, run, trades: [], equity: [], latest_signals: [] });
  }

  const requestedStart = positiveInteger(body.start_at);
  const requestedEnd = positiveInteger(body.end_at);
  const simulationEnd = requestedEnd ? Math.min(requestedEnd, newest) : newest;
  const defaultStart = Math.max(oldest + LOOKBACK_SECONDS, simulationEnd - DEFAULT_SIMULATION_SECONDS);
  const uncappedSimulationStart = requestedStart
    ? Math.max(requestedStart, oldest + LOOKBACK_SECONDS)
    : defaultStart;
  const simulationStart = Math.max(uncappedSimulationStart, simulationEnd - MAX_SIMULATION_SECONDS);

  run.simulation_start_at = simulationStart;
  run.simulation_end_at = simulationEnd;
  await insertSimulationRun(env, run);

  try {
    if (simulationEnd <= simulationStart) {
      throw new Error("Simulation window does not include any usable decision points.");
    }

    const market = await readMarketStocks(env, simulationStart - LOOKBACK_SECONDS, simulationEnd);
    const state: StrategyState = {
      cash: DEFAULT_STARTING_CASH,
      realizedPnl: 0,
      positions: new Map(),
    };
    const trades: PaperTrade[] = [];
    const equity: EquitySnapshot[] = [];
    let latestSignals: StockSignal[] = [];
    let peakEquity = DEFAULT_STARTING_CASH;
    let maxDrawdown = 0;

    for (let decisionAt = roundUpToInterval(simulationStart); decisionAt <= simulationEnd; decisionAt += DECISION_INTERVAL_SECONDS) {
      const result = applyPaperDecision({
        state,
        market,
        config: DEFAULT_CONFIG,
        strategy: "momentum",
        observedAt: decisionAt,
        accountId: null,
        simulationRunId: run.id,
        createdAt: nowSeconds(),
      });
      trades.push(...result.trades);
      equity.push(result.snapshot);
      latestSignals = result.signals;
      peakEquity = Math.max(peakEquity, result.snapshot.total_equity);
      if (peakEquity > 0) {
        maxDrawdown = Math.max(maxDrawdown, (peakEquity - result.snapshot.total_equity) / peakEquity);
      }
    }

    await savePaperTrades(env, trades);
    await saveEquitySnapshots(env, equity);

    const finalEquity = equity.at(-1)?.total_equity ?? DEFAULT_STARTING_CASH;
    run.status = "ok";
    run.finished_at = nowSeconds();
    run.final_equity = finalEquity;
    run.return_percent = ((finalEquity - DEFAULT_STARTING_CASH) / DEFAULT_STARTING_CASH) * 100;
    run.max_drawdown_percent = maxDrawdown * 100;
    run.trade_count = trades.length;
    run.win_trade_count = trades.filter((trade) => trade.side === "sell" && (trade.realized_pnl ?? 0) > 0).length;
    await updateSimulationRun(env, run);

    return json({ ok: true, run, trades: trades.slice(-25).reverse(), equity: equity.slice(-96), latest_signals: latestSignals.slice(0, 5) });
  } catch (err: any) {
    run.status = "error";
    run.finished_at = nowSeconds();
    run.error = err?.message || String(err);
    await updateSimulationRun(env, run);
    return json({ ok: false, error: run.error, run }, 500);
  }
}

export async function getStockPaperStatus(env: Env): Promise<Response> {
  const bots = await Promise.all(PAPER_BOTS.map((bot) => readPaperBotStatus(env, bot)));
  const momentum = bots.find((bot) => bot.bot.id === MOMENTUM_ACCOUNT_ID) ?? bots[0] ?? null;
  const latestSimulation = await readLatestSimulationRun(env);
  const simulationTrades = latestSimulation ? await readRecentPaperTrades(env, null, latestSimulation.id, 20) : [];

  return json({
    ok: true,
    bots,
    account: momentum?.account ?? null,
    positions: momentum?.positions ?? [],
    latest_equity: momentum?.latest_equity ?? null,
    recent_trades: momentum?.recent_trades ?? [],
    latest_simulation: latestSimulation,
    latest_simulation_trades: simulationTrades,
    latest_signals: momentum?.latest_signals.slice(0, 5) ?? [],
    defaults: DEFAULT_CONFIG,
  });
}

async function readPaperBotStatus(env: Env, bot: PaperBotDefinition): Promise<PaperBotStatus> {
  const account = await readLivePaperAccount(env, bot.id);
  const positions = account ? await readAccountPositionsWithMarket(env, account.id) : [];
  const latestEquity = account ? await readLatestAccountEquity(env, account.id) : null;
  const recentTrades = account ? await readRecentPaperTrades(env, account.id, null, 20) : [];
  const recentCopyEvents = bot.strategy === "copy-movement"
    ? await readRecentCopyMovementEvents(env, COPY_MOVEMENT_SOURCE_PLAYER_ID, 20)
    : [];
  const latestSignals = bot.strategy === "copy-movement"
    ? copyMovementSignalsFromEvents(recentCopyEvents).slice(0, 5)
    : account?.last_decision_at
    ? rankSignalsForStrategy(
      await readMarketStocksForDecision(env, account.last_decision_at),
      account.last_decision_at,
      account,
      bot.strategy,
    )
    : [];

  return {
    bot: publicBotDefinition(bot),
    account,
    positions,
    latest_equity: latestEquity,
    recent_trades: recentTrades,
    latest_signals: latestSignals.slice(0, 5),
    recent_copy_events: recentCopyEvents,
  };
}

export async function getStockPaperSimulations(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM stock_paper_simulation_runs
    ORDER BY started_at DESC
    LIMIT 20
    `,
  ).all<SimulationRun>();

  return json({ ok: true, simulations: rows.results ?? [] });
}

export async function getStockPaperTrades(url: URL, env: Env): Promise<Response> {
  const limit = parseLimit(url.searchParams.get("limit"), 100, 250);
  const bot = botDefinitionById(url.searchParams.get("bot_id")) ?? PAPER_BOTS[0];
  const trades = await readRecentPaperTrades(env, bot.id, null, limit);
  return json({ ok: true, trades });
}

export async function exportStockSnapshots(url: URL, env: Env): Promise<Response> {
  const newest = await readNewestStockSnapshotAt(env);
  const endAt = positiveInteger(url.searchParams.get("end_at")) ?? newest ?? nowSeconds();
  const startAt = positiveInteger(url.searchParams.get("start_at")) ?? endAt - 31 * 24 * 60 * 60;
  const afterAt = positiveInteger(url.searchParams.get("after_at"));
  const afterStockId = positiveInteger(url.searchParams.get("after_stock_id")) ?? 0;
  const limit = parseLimit(url.searchParams.get("limit"), 10_000, 20_000);

  if (endAt <= startAt) {
    return json({ ok: false, error: "Invalid snapshot export range", code: "INVALID_RANGE" }, 400);
  }

  const cursorWhere = afterAt === null
    ? ""
    : "AND (s.observed_at > ? OR (s.observed_at = ? AND s.stock_id > ?))";
  const bindings = afterAt === null
    ? [startAt, endAt, limit]
    : [startAt, endAt, afterAt, afterAt, afterStockId, limit];

  const rows = await env.DB.prepare(
    `
    SELECT s.stock_id, s.observed_at, s.price, s.market_cap, s.total_shares, s.investors
    FROM stock_price_snapshots s
    WHERE s.observed_at BETWEEN ? AND ?
    ${cursorWhere}
    ORDER BY s.observed_at ASC, s.stock_id ASC
    LIMIT ?
    `,
  )
    .bind(...bindings)
    .all<MarketPoint>();

  const snapshots = rows.results ?? [];
  const last = snapshots.at(-1);
  return json({
    ok: true,
    snapshots,
    range: { start_at: startAt, end_at: endAt },
    next_cursor: snapshots.length === limit && last
      ? { after_at: last.observed_at, after_stock_id: last.stock_id }
      : null,
  });
}

export async function resetStockPaperAccount(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const botId = typeof body.bot_id === "string" ? body.bot_id : MOMENTUM_ACCOUNT_ID;
  const bot = botDefinitionById(botId);
  if (!bot) {
    return json({ ok: false, error: "Unknown paper bot", code: "UNKNOWN_PAPER_BOT" }, 400);
  }

  const startingCash = positiveCurrency(body.starting_cash) ?? bot.starting_cash;
  if (startingCash <= 0) {
    return json({ ok: false, error: "Starting cash must be positive", code: "INVALID_STARTING_CASH" }, 400);
  }

  const now = nowSeconds();
  const resetStatements = [
    env.DB.prepare("DELETE FROM stock_paper_positions WHERE account_id = ?").bind(bot.id),
    env.DB.prepare("DELETE FROM stock_paper_trades WHERE account_id = ?").bind(bot.id),
    env.DB.prepare("DELETE FROM stock_paper_equity_snapshots WHERE account_id = ?").bind(bot.id),
  ];
  if (bot.strategy === "copy-movement") {
    resetStatements.push(
      env.DB.prepare("DELETE FROM stock_copy_movement_events WHERE source_player_id = ?").bind(COPY_MOVEMENT_SOURCE_PLAYER_ID),
    );
  }
  await env.DB.batch(resetStatements);
  const account = await upsertLivePaperAccount(env, bot, now, startingCash, startingCash, 0, null);
  return json({ ok: true, account, bot: publicBotDefinition(bot) });
}

export function rankStockPaperSignals(
  market: MarketStock[],
  observedAt: number,
  config: Pick<StrategyConfig, "sell_fee_rate"> = DEFAULT_CONFIG,
): StockSignal[] {
  const rawSignals = market
    .map((stock) => buildStockSignal(stock, observedAt, config.sell_fee_rate))
    .filter((signal): signal is Omit<StockSignal, "rank"> => Boolean(signal));

  if (rawSignals.length === 0) {
    return [];
  }

  const averageScore = rawSignals.reduce((total, signal) => total + signal.score, 0) / rawSignals.length;
  return rawSignals
    .map((signal) => ({
      ...signal,
      expected_return: signal.score - averageScore - config.sell_fee_rate,
      rank: 0,
    }))
    .sort((a, b) => b.expected_return - a.expected_return)
    .map((signal, index) => ({ ...signal, rank: index + 1 }));
}

export function rankWhaleFlowSignals(
  market: MarketStock[],
  observedAt: number,
  config: Pick<StrategyConfig, "sell_fee_rate"> = DEFAULT_CONFIG,
): StockSignal[] {
  return market
    .map((stock) => buildWhaleFlowSignal(stock, observedAt, config.sell_fee_rate))
    .filter((signal): signal is Omit<StockSignal, "rank"> => Boolean(signal))
    .sort((a, b) => b.expected_return - a.expected_return)
    .map((signal, index) => ({ ...signal, rank: index + 1 }));
}

function rankSignalsForStrategy(
  market: MarketStock[],
  observedAt: number,
  config: Pick<StrategyConfig, "sell_fee_rate">,
  strategy: PaperBotStrategy,
): StockSignal[] {
  if (strategy === "copy-movement") {
    return [];
  }
  return strategy === "whale-flow"
    ? rankWhaleFlowSignals(market, observedAt, config)
    : rankStockPaperSignals(market, observedAt, config);
}

async function applyCopyMovementDecision(options: {
  env: Env;
  state: StrategyState;
  market: MarketStock[];
  config: StrategyConfig;
  observedAt: number;
  accountId: string;
  createdAt: number;
}): Promise<DecisionResult> {
  const { env, state, market, config, observedAt, accountId, createdAt } = options;
  const prices = latestPricesByStock(market, observedAt);
  const activity = await fetchCopyMovementActivity(env, COPY_MOVEMENT_SOURCE_PLAYER_ID, COPY_MOVEMENT_SOURCE_PLAYER_NAME, observedAt);
  const signals = activity.active
    ? buildCopyMovementSignals(market, observedAt, config, activity)
    : [];
  const existingKeys = signals.length > 0
    ? await readExistingCopyMovementEventKeys(env, COPY_MOVEMENT_SOURCE_PLAYER_ID, observedAt)
    : new Set<string>();
  const trades: PaperTrade[] = [];
  const copyEvents: CopyMovementEvent[] = [];

  let equity = computeEquity(state, prices).total;
  for (const signal of signals) {
    const key = copyMovementEventKey(signal.stock_id, signal.copy_side ?? "buy");
    if (existingKeys.has(key)) {
      continue;
    }

    const event = copyMovementEventFromSignal(signal, activity, observedAt, createdAt);
    const price = prices.get(signal.stock_id);
    if (!price) {
      event.status = "skipped";
      event.reason = "missing_latest_price";
      copyEvents.push(event);
      continue;
    }

    if (signal.copy_side === "sell") {
      const position = state.positions.get(signal.stock_id);
      if (!position || position.shares <= 0) {
        event.status = "ignored";
        event.reason = "no_position_to_sell";
        copyEvents.push(event);
        continue;
      }

      const trade = sellShares(state, position, position.shares, price, observedAt, "copy_movement_sell", signal, config, accountId, null, createdAt);
      event.status = "executed";
      event.reason = "copied_directional_sell";
      event.paper_trade_id = trade.id;
      trades.push(trade);
      copyEvents.push(event);
      equity = computeEquity(state, prices).total;
      continue;
    }

    const currentPosition = state.positions.get(signal.stock_id);
    if (!currentPosition && state.positions.size >= config.max_open_positions) {
      event.status = "skipped";
      event.reason = "max_open_positions";
      copyEvents.push(event);
      continue;
    }

    const currentValue = (currentPosition?.shares ?? 0) * price;
    const targetValue = equity * config.max_position_fraction;
    const reserveCash = equity * config.min_cash_reserve_fraction;
    const spendableCash = Math.max(0, state.cash - reserveCash);
    const desiredSpend = Math.max(0, targetValue - currentValue);
    const grossSpend = Math.min(spendableCash, desiredSpend);
    const shares = Math.floor(grossSpend / price);
    if (shares <= 0) {
      event.status = "skipped";
      event.reason = "position_or_cash_cap";
      copyEvents.push(event);
      continue;
    }

    const trade = buyShares(state, signal.stock_id, shares, price, observedAt, "copy_movement_buy", signal, config, accountId, null, createdAt);
    event.status = "executed";
    event.reason = "copied_directional_buy";
    event.paper_trade_id = trade.id;
    trades.push(trade);
    copyEvents.push(event);
    equity = computeEquity(state, prices).total;
  }

  return {
    trades,
    snapshot: buildEquitySnapshot(state, prices, observedAt, accountId, null, createdAt),
    signals,
    copyEvents,
  };
}

function applyPaperDecision(options: {
  state: StrategyState;
  market: MarketStock[];
  config: StrategyConfig;
  strategy: PaperBotStrategy;
  observedAt: number;
  accountId: string | null;
  simulationRunId: string | null;
  createdAt: number;
}): DecisionResult {
  const { state, market, config, strategy, observedAt, accountId, simulationRunId, createdAt } = options;
  const signals = rankSignalsForStrategy(market, observedAt, config, strategy);
  const prices = latestPricesByStock(market, observedAt);
  const maxTargets = strategy === "whale-flow"
    ? Math.min(config.max_open_positions, WHALE_FLOW_MAX_TARGETS)
    : config.max_open_positions;
  const minEntryReturn = strategy === "whale-flow" ? 0 : config.sell_fee_rate;
  const tradableSignals = signals
    .filter((signal) => signal.expected_return > minEntryReturn)
    .slice(0, maxTargets);
  const targetIds = new Set(tradableSignals.map((signal) => signal.stock_id));
  const signalByStock = new Map(signals.map((signal) => [signal.stock_id, signal]));
  const trades: PaperTrade[] = [];

  for (const position of [...state.positions.values()]) {
    const price = prices.get(position.stock_id);
    const signal = signalByStock.get(position.stock_id);
    if (!price) {
      continue;
    }
    const exit = strategy === "whale-flow"
      ? shouldExitWhaleFlowPosition(position, signal, targetIds, price, config, observedAt)
      : shouldExitPosition(position, signal, targetIds, price, observedAt, config);
    if (exit.shouldExit) {
      trades.push(sellShares(state, position, position.shares, price, observedAt, exit.reason, signal, config, accountId, simulationRunId, createdAt));
    }
  }

  let equity = computeEquity(state, prices).total;
  for (const signal of tradableSignals) {
    const position = state.positions.get(signal.stock_id);
    const price = prices.get(signal.stock_id);
    if (!position || !price) {
      continue;
    }
    const maxValue = equity * config.max_position_fraction;
    const currentValue = position.shares * price;
    if (currentValue > maxValue) {
      const sharesToSell = Math.floor((currentValue - maxValue) / price);
      if (sharesToSell > 0) {
        trades.push(sellShares(state, position, sharesToSell, price, observedAt, "trim_excess", signal, config, accountId, simulationRunId, createdAt));
        equity = computeEquity(state, prices).total;
      }
    }
  }

  const targetCount = Math.max(1, tradableSignals.length);
  const targetFraction = Math.min(
    config.max_position_fraction,
    (1 - config.min_cash_reserve_fraction) / targetCount,
  );
  const reserveCash = equity * config.min_cash_reserve_fraction;

  for (const signal of tradableSignals) {
    const price = prices.get(signal.stock_id);
    if (!price) {
      continue;
    }
    const position = state.positions.get(signal.stock_id);
    const currentValue = (position?.shares ?? 0) * price;
    const targetValue = equity * targetFraction;
    const spendableCash = Math.max(0, state.cash - reserveCash);
    const desiredSpend = Math.max(0, targetValue - currentValue);
    const grossSpend = Math.min(spendableCash, desiredSpend);
    const shares = Math.floor(grossSpend / price);
    if (shares > 0) {
      trades.push(buyShares(state, signal.stock_id, shares, price, observedAt, "target_entry", signal, config, accountId, simulationRunId, createdAt));
    }
  }

  return {
    trades,
    snapshot: buildEquitySnapshot(state, prices, observedAt, accountId, simulationRunId, createdAt),
    signals,
  };
}

function shouldExitPosition(
  position: PaperPosition,
  signal: StockSignal | undefined,
  targetIds: Set<number>,
  price: number,
  observedAt: number,
  config: StrategyConfig,
): { shouldExit: boolean; reason: string } {
  const holdSeconds = observedAt - position.opened_at;
  if (holdSeconds < MIN_POSITION_HOLD_SECONDS) {
    return { shouldExit: false, reason: "min_hold" };
  }

  const netReturn = netReturnIfSold(position, price, config.sell_fee_rate);
  if (netReturn >= TAKE_PROFIT_NET_RETURN) {
    return { shouldExit: true, reason: "take_profit_exit" };
  }

  if (netReturn <= STOP_LOSS_NET_RETURN) {
    return { shouldExit: true, reason: "stop_loss_exit" };
  }

  if (targetIds.has(position.stock_id) && signal && signal.expected_return > config.sell_fee_rate) {
    return { shouldExit: false, reason: "hold_target" };
  }

  if (holdSeconds >= STALE_POSITION_SECONDS) {
    return { shouldExit: true, reason: "stale_position_exit" };
  }

  return { shouldExit: false, reason: "hold_wait_for_exit_threshold" };
}

function netReturnIfSold(position: PaperPosition, price: number, sellFeeRate: number): number {
  const netSellPrice = price * (1 - sellFeeRate);
  return position.average_entry_price > 0
    ? netSellPrice / position.average_entry_price - 1
    : 0;
}

async function fetchCopyMovementActivity(
  env: Env,
  playerId: number,
  playerName: string,
  observedAt: number,
): Promise<CopyMovementActivity> {
  const url = new URL(`${COPY_MOVEMENT_TORN_API_BASE}/user/${encodeURIComponent(String(playerId))}/basic`);
  const response = await trackedTornFetch(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
      "User-Agent": "buttgrass-stock-copy-movement/1.0",
    },
  }, {
    feature: "stock-copy-movement:activity",
    keySource: "env:TORN_API_KEY",
    timeoutMs: COPY_MOVEMENT_ACTIVITY_TIMEOUT_MS,
  });

  const data = await readCopyMovementJson(response);
  if (!response.ok) {
    throw new Error(`Torn copy movement activity API error: ${response.status}`);
  }
  if (isRecord(data) && isRecord(data.error)) {
    throw new Error(String(data.error.error ?? data.error.message ?? "Torn copy movement activity API error"));
  }

  const profile = isRecord(data) && isRecord(data.profile) ? data.profile : data;
  const lastAction = isRecord(profile) && isRecord(profile.last_action) ? profile.last_action : null;
  const status = cleanText(lastAction?.status);
  const timestamp = finiteNumber(lastAction?.timestamp);
  const relative = cleanText(lastAction?.relative);
  const normalizedStatus = status?.toLowerCase() ?? null;
  const active =
    normalizedStatus === "online" ||
    normalizedStatus === "idle" ||
    (timestamp !== null && observedAt - timestamp <= COPY_MOVEMENT_ACTIVITY_RECENT_SECONDS);

  return {
    source_player_id: playerId,
    source_player_name: playerName,
    status,
    timestamp,
    relative,
    active,
    raw_json: data,
  };
}

async function readCopyMovementJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text().catch(() => "") };
  }
}

function buildCopyMovementSignals(
  market: MarketStock[],
  observedAt: number,
  config: Pick<StrategyConfig, "sell_fee_rate">,
  activity: CopyMovementActivity,
): StockSignal[] {
  const windowStartAt = observedAt - COPY_MOVEMENT_WINDOW_SECONDS;
  const rawSignals: StockSignal[] = [];

  for (const stock of market) {
    const current = priceAtOrBefore(stock.points, observedAt);
    const previous = priceAtOrBefore(stock.points, windowStartAt);
    if (!current || !previous || current.observed_at <= previous.observed_at) {
      continue;
    }

    const priceChange = percentChange(previous.price, current.price);
    if (priceChange === null) {
      continue;
    }

    const flow = whaleFlowScoreBetween(previous, current);
    const buyStrength = Math.max(0, priceChange) * 0.55 + Math.max(0, flow?.score ?? 0) * 0.45;
    const sellStrength =
      Math.max(0, -priceChange) * 0.65 +
      Math.max(0, -(flow?.marketCapChange ?? 0)) * 0.25 +
      Math.max(0, -(flow?.sharePressure ?? 0)) * 0.1;
    const side = buyStrength > sellStrength * 1.25 ? "buy" : sellStrength > buyStrength * 1.25 ? "sell" : null;
    const strength = side === "buy" ? buyStrength : side === "sell" ? sellStrength : 0;

    if (
      !side ||
      strength < COPY_MOVEMENT_MIN_STRENGTH ||
      Math.abs(priceChange) < COPY_MOVEMENT_MIN_ABS_PRICE_CHANGE
    ) {
      continue;
    }

    rawSignals.push({
      stock_id: stock.stock_id,
      acronym: stock.acronym,
      name: stock.name,
      observed_at: current.observed_at,
      price: current.price,
      score: strength,
      expected_return: Math.max(0, strength - config.sell_fee_rate),
      momentum_30m: priceChange,
      momentum_1h: 0,
      momentum_3h: 0,
      momentum_6h: 0,
      volatility_1h: volatilityBetween(stock.points, windowStartAt, observedAt),
      flow_1m: flow?.score,
      investor_change: flow?.investorChange,
      share_pressure: flow?.sharePressure,
      market_cap_change: flow?.marketCapChange,
      copy_side: side,
      copy_source_player_id: activity.source_player_id,
      copy_source_player_name: activity.source_player_name,
      copy_activity_status: activity.status,
      copy_activity_timestamp: activity.timestamp,
      copy_reason: "activity_correlated_outlier",
      copy_window_start_at: windowStartAt,
      rank: 0,
    });
  }

  return rawSignals
    .sort((a, b) => b.expected_return - a.expected_return)
    .slice(0, COPY_MOVEMENT_MAX_EVENTS_PER_TICK)
    .map((signal, index) => ({ ...signal, rank: index + 1 }));
}

function copyMovementEventFromSignal(
  signal: StockSignal,
  activity: CopyMovementActivity,
  observedAt: number,
  createdAt: number,
): CopyMovementEvent {
  const details = {
    signal,
    activity_relative: activity.relative,
    active: activity.active,
  };

  return {
    id: crypto.randomUUID(),
    source_player_id: activity.source_player_id,
    source_player_name: activity.source_player_name,
    activity_status: activity.status,
    activity_timestamp: activity.timestamp,
    observed_at: observedAt,
    window_start_at: signal.copy_window_start_at ?? observedAt - COPY_MOVEMENT_WINDOW_SECONDS,
    stock_id: signal.stock_id,
    side: signal.copy_side ?? "buy",
    price: signal.price,
    strength: signal.score,
    price_change: signal.momentum_30m,
    investor_change: signal.investor_change ?? null,
    share_pressure: signal.share_pressure ?? null,
    market_cap_change: signal.market_cap_change ?? null,
    status: "ignored",
    reason: signal.copy_reason ?? "activity_correlated_outlier",
    paper_trade_id: null,
    details_json: JSON.stringify(details),
    created_at: createdAt,
  };
}

function shouldExitWhaleFlowPosition(
  position: PaperPosition,
  signal: StockSignal | undefined,
  targetIds: Set<number>,
  price: number,
  config: StrategyConfig,
  observedAt: number,
): { shouldExit: boolean; reason: string } {
  const holdSeconds = observedAt - position.opened_at;
  if (holdSeconds < MIN_POSITION_HOLD_SECONDS) {
    return { shouldExit: false, reason: "min_hold" };
  }

  const netReturn = netReturnIfSold(position, price, config.sell_fee_rate);
  if (netReturn >= TAKE_PROFIT_NET_RETURN) {
    return { shouldExit: true, reason: "take_profit_exit" };
  }

  if (netReturn <= STOP_LOSS_NET_RETURN) {
    return { shouldExit: true, reason: "stop_loss_exit" };
  }

  if (targetIds.has(position.stock_id) && signal && signal.expected_return > 0) {
    return { shouldExit: false, reason: "hold_whale_flow" };
  }

  if (signal && signal.score <= WHALE_FLOW_STRONG_REVERSAL_SCORE) {
    return { shouldExit: true, reason: "strong_flow_reversal" };
  }

  if (holdSeconds >= STALE_POSITION_SECONDS) {
    return { shouldExit: true, reason: "stale_position_exit" };
  }

  return { shouldExit: false, reason: "hold_wait_for_exit_threshold" };
}

function buyShares(
  state: StrategyState,
  stockId: number,
  shares: number,
  price: number,
  executedAt: number,
  reason: string,
  signal: StockSignal,
  config: StrategyConfig,
  accountId: string | null,
  simulationRunId: string | null,
  createdAt: number,
): PaperTrade {
  const gross = shares * price;
  const fee = gross * config.buy_fee_rate;
  const net = gross + fee;
  if (net > state.cash) {
    throw new Error("Paper trade attempted to spend more cash than available.");
  }

  const current = state.positions.get(stockId);
  if (current) {
    const currentCost = current.average_entry_price * current.shares;
    current.average_entry_price = (currentCost + gross) / (current.shares + shares);
    current.shares += shares;
    current.updated_at = executedAt;
  } else {
    state.positions.set(stockId, {
      stock_id: stockId,
      shares,
      average_entry_price: price,
      opened_at: executedAt,
      updated_at: executedAt,
    });
  }
  state.cash -= net;

  return makeTrade(accountId, simulationRunId, stockId, "buy", shares, price, gross, fee, net, null, executedAt, reason, signal, createdAt);
}

function sellShares(
  state: StrategyState,
  position: PaperPosition,
  shares: number,
  price: number,
  executedAt: number,
  reason: string,
  signal: StockSignal | undefined,
  config: StrategyConfig,
  accountId: string | null,
  simulationRunId: string | null,
  createdAt: number,
): PaperTrade {
  const sellSharesCount = Math.min(shares, position.shares);
  const gross = sellSharesCount * price;
  const fee = gross * config.sell_fee_rate;
  const net = gross - fee;
  const realizedPnl = net - position.average_entry_price * sellSharesCount;

  position.shares -= sellSharesCount;
  position.updated_at = executedAt;
  if (position.shares <= 0) {
    state.positions.delete(position.stock_id);
  }
  state.cash += net;
  state.realizedPnl += realizedPnl;

  return makeTrade(accountId, simulationRunId, position.stock_id, "sell", sellSharesCount, price, gross, fee, net, realizedPnl, executedAt, reason, signal, createdAt);
}

function makeTrade(
  accountId: string | null,
  simulationRunId: string | null,
  stockId: number,
  side: "buy" | "sell",
  shares: number,
  price: number,
  gross: number,
  fee: number,
  net: number,
  realizedPnl: number | null,
  executedAt: number,
  reason: string,
  signal: StockSignal | undefined,
  createdAt: number,
): PaperTrade {
  return {
    id: crypto.randomUUID(),
    account_id: accountId,
    simulation_run_id: simulationRunId,
    stock_id: stockId,
    side,
    shares,
    price,
    gross_value: gross,
    fee,
    net_value: net,
    realized_pnl: realizedPnl,
    executed_at: executedAt,
    reason,
    score: signal?.expected_return ?? null,
    details_json: signal ? JSON.stringify(signal) : null,
    created_at: createdAt,
  };
}

function buildEquitySnapshot(
  state: StrategyState,
  prices: Map<number, number>,
  observedAt: number,
  accountId: string | null,
  simulationRunId: string | null,
  createdAt: number,
): EquitySnapshot {
  const equity = computeEquity(state, prices);
  return {
    id: crypto.randomUUID(),
    account_id: accountId,
    simulation_run_id: simulationRunId,
    observed_at: observedAt,
    cash_balance: state.cash,
    holdings_value: equity.holdings,
    total_equity: equity.total,
    realized_pnl: state.realizedPnl,
    unrealized_pnl: equity.unrealized,
    exposure_fraction: equity.total > 0 ? equity.holdings / equity.total : 0,
    created_at: createdAt,
  };
}

function computeEquity(state: StrategyState, prices: Map<number, number>): { holdings: number; total: number; unrealized: number } {
  let holdings = 0;
  let costBasis = 0;
  for (const position of state.positions.values()) {
    const price = prices.get(position.stock_id);
    if (!price) {
      continue;
    }
    holdings += position.shares * price;
    costBasis += position.shares * position.average_entry_price;
  }

  return {
    holdings,
    total: state.cash + holdings,
    unrealized: holdings - costBasis,
  };
}

function buildStockSignal(stock: MarketStock, observedAt: number, sellFeeRate: number): Omit<StockSignal, "rank"> | null {
  const current = priceAtOrBefore(stock.points, observedAt);
  const p30 = priceAtOrBefore(stock.points, observedAt - 30 * 60);
  const p1h = priceAtOrBefore(stock.points, observedAt - 60 * 60);
  const p3h = priceAtOrBefore(stock.points, observedAt - 3 * 60 * 60);
  const p6h = priceAtOrBefore(stock.points, observedAt - 6 * 60 * 60);
  if (!current || !p30 || !p1h || !p3h || !p6h) {
    return null;
  }

  const momentum30m = current.price / p30.price - 1;
  const momentum1h = current.price / p1h.price - 1;
  const momentum3h = current.price / p3h.price - 1;
  const momentum6h = current.price / p6h.price - 1;
  const volatility1h = volatilityBetween(stock.points, observedAt - 60 * 60, observedAt);
  const score =
    momentum30m * 0.35 +
    momentum1h * 0.3 +
    momentum3h * 0.2 +
    momentum6h * 0.15 -
    volatility1h * 0.5;

  return {
    stock_id: stock.stock_id,
    acronym: stock.acronym,
    name: stock.name,
    observed_at: current.observed_at,
    price: current.price,
    score,
    expected_return: score - sellFeeRate,
    momentum_30m: momentum30m,
    momentum_1h: momentum1h,
    momentum_3h: momentum3h,
    momentum_6h: momentum6h,
    volatility_1h: volatility1h,
  };
}

function buildWhaleFlowSignal(stock: MarketStock, observedAt: number, sellFeeRate: number): Omit<StockSignal, "rank"> | null {
  const current = priceAtOrBefore(stock.points, observedAt);
  const previous = priceAtOrBefore(stock.points, observedAt - 60);
  if (!current || !previous) {
    return null;
  }

  const currentFlow = whaleFlowScoreBetween(previous, current);
  if (currentFlow === null) {
    return null;
  }

  const baseline = whaleFlowBaseline(stock.points, observedAt - WHALE_FLOW_BASELINE_SECONDS, observedAt - 60);
  const threshold = Math.max(
    WHALE_FLOW_MIN_SCORE,
    baseline.average + baseline.deviation * WHALE_FLOW_BASELINE_MULTIPLIER,
  );
  const expectedReturn = currentFlow.score - threshold - sellFeeRate;

  return {
    stock_id: stock.stock_id,
    acronym: stock.acronym,
    name: stock.name,
    observed_at: current.observed_at,
    price: current.price,
    score: currentFlow.score,
    expected_return: expectedReturn,
    momentum_30m: 0,
    momentum_1h: 0,
    momentum_3h: 0,
    momentum_6h: 0,
    volatility_1h: volatilityBetween(stock.points, observedAt - 60 * 60, observedAt),
    flow_1m: currentFlow.score,
    flow_threshold: threshold,
    investor_change: currentFlow.investorChange,
    share_pressure: currentFlow.sharePressure,
    market_cap_change: currentFlow.marketCapChange,
  };
}

function whaleFlowScoreBetween(previous: MarketPoint, current: MarketPoint): {
  score: number;
  investorChange: number;
  sharePressure: number;
  marketCapChange: number;
} | null {
  const marketCapChange = percentChange(previous.market_cap, current.market_cap);
  const sharePressure = inversePercentChange(previous.total_shares, current.total_shares);
  const investorChange = percentChange(previous.investors, current.investors);
  const priceChange = percentChange(previous.price, current.price);

  if (sharePressure === null && priceChange === null && investorChange === null) {
    return null;
  }

  const positiveSharePressure = Math.max(0, sharePressure ?? 0);
  const positivePriceMove = Math.max(0, priceChange ?? 0);
  const crowdPenalty = Math.abs(investorChange ?? 0) * 0.75;
  const score =
    positiveSharePressure * 0.65 +
    positivePriceMove * 0.35 -
    crowdPenalty;

  return {
    score,
    investorChange: investorChange ?? 0,
    sharePressure: sharePressure ?? 0,
    marketCapChange: marketCapChange ?? 0,
  };
}

function whaleFlowBaseline(points: MarketPoint[], startAt: number, endAt: number): { average: number; deviation: number } {
  const values: number[] = [];
  let previous: MarketPoint | null = null;
  for (const point of points) {
    if (point.observed_at < startAt || point.observed_at > endAt) {
      continue;
    }
    if (previous) {
      const flow = whaleFlowScoreBetween(previous, point);
      if (flow) {
        values.push(Math.abs(flow.score));
      }
    }
    previous = point;
  }

  if (values.length < 3) {
    return { average: 0, deviation: 0 };
  }
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return { average, deviation: Math.sqrt(variance) };
}

function percentChange(previous: unknown, current: unknown): number | null {
  const previousNumber = Number(previous);
  const currentNumber = Number(current);
  if (!Number.isFinite(previousNumber) || !Number.isFinite(currentNumber) || previousNumber <= 0) {
    return null;
  }
  return currentNumber / previousNumber - 1;
}

function inversePercentChange(previous: unknown, current: unknown): number | null {
  const change = percentChange(previous, current);
  return change === null ? null : -change;
}

function priceAtOrBefore(points: MarketPoint[], timestamp: number): MarketPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].observed_at <= timestamp) {
      return points[index];
    }
  }
  return null;
}

function volatilityBetween(points: MarketPoint[], startAt: number, endAt: number): number {
  const relevant = points.filter((point) => point.observed_at >= startAt && point.observed_at <= endAt);
  if (relevant.length < 3) {
    return 0;
  }

  const returns: number[] = [];
  for (let index = 1; index < relevant.length; index += 1) {
    returns.push(relevant[index].price / relevant[index - 1].price - 1);
  }
  const average = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - average) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function latestPricesByStock(market: MarketStock[], observedAt: number): Map<number, number> {
  const prices = new Map<number, number>();
  for (const stock of market) {
    const point = priceAtOrBefore(stock.points, observedAt);
    if (point) {
      prices.set(stock.stock_id, point.price);
    }
  }
  return prices;
}

async function persistAccountDecision(
  env: Env,
  account: PaperAccount,
  state: StrategyState,
  result: DecisionResult,
  decisionAt: number,
): Promise<void> {
  await savePaperTrades(env, result.trades);
  if (result.copyEvents?.length) {
    await saveCopyMovementEvents(env, result.copyEvents);
  }
  if (result.trades.length > 0) {
    await replaceAccountPositions(env, account.id, [...state.positions.values()]);
  }
  await saveEquitySnapshots(env, [result.snapshot]);
  await env.DB.prepare(
    `
    UPDATE stock_paper_accounts
    SET cash_balance = ?, realized_pnl = ?, last_decision_at = ?, updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(state.cash, state.realizedPnl, decisionAt, nowSeconds(), account.id)
    .run();
}

async function readExistingCopyMovementEventKeys(
  env: Env,
  sourcePlayerId: number,
  observedAt: number,
): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    `
    SELECT stock_id, side
    FROM stock_copy_movement_events
    WHERE source_player_id = ?
      AND observed_at = ?
    `,
  )
    .bind(sourcePlayerId, observedAt)
    .all<{ stock_id: number; side: "buy" | "sell" }>();

  return new Set((rows.results ?? []).map((row) => copyMovementEventKey(Number(row.stock_id), row.side)));
}

function copyMovementEventKey(stockId: number, side: "buy" | "sell"): string {
  return `${stockId}:${side}`;
}

async function savePaperTrades(env: Env, trades: PaperTrade[]): Promise<void> {
  const statements = trades.map((trade) =>
    env.DB.prepare(
      `
      INSERT INTO stock_paper_trades (
        id,
        account_id,
        simulation_run_id,
        stock_id,
        side,
        shares,
        price,
        gross_value,
        fee,
        net_value,
        realized_pnl,
        executed_at,
        reason,
        score,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      trade.id,
      trade.account_id,
      trade.simulation_run_id,
      trade.stock_id,
      trade.side,
      trade.shares,
      trade.price,
      trade.gross_value,
      trade.fee,
      trade.net_value,
      trade.realized_pnl,
      trade.executed_at,
      trade.reason,
      trade.score,
      trade.details_json,
      trade.created_at,
    )
  );

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function saveCopyMovementEvents(env: Env, events: CopyMovementEvent[]): Promise<void> {
  const statements = events.map((event) =>
    env.DB.prepare(
      `
      INSERT OR IGNORE INTO stock_copy_movement_events (
        id,
        source_player_id,
        source_player_name,
        activity_status,
        activity_timestamp,
        observed_at,
        window_start_at,
        stock_id,
        side,
        price,
        strength,
        price_change,
        investor_change,
        share_pressure,
        market_cap_change,
        status,
        reason,
        paper_trade_id,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      event.id,
      event.source_player_id,
      event.source_player_name,
      event.activity_status,
      event.activity_timestamp,
      event.observed_at,
      event.window_start_at,
      event.stock_id,
      event.side,
      event.price,
      event.strength,
      event.price_change,
      event.investor_change,
      event.share_pressure,
      event.market_cap_change,
      event.status,
      event.reason,
      event.paper_trade_id,
      event.details_json,
      event.created_at,
    )
  );

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function saveEquitySnapshots(env: Env, snapshots: EquitySnapshot[]): Promise<void> {
  const statements = snapshots.map((snapshot) =>
    env.DB.prepare(
      `
      INSERT INTO stock_paper_equity_snapshots (
        id,
        account_id,
        simulation_run_id,
        observed_at,
        cash_balance,
        holdings_value,
        total_equity,
        realized_pnl,
        unrealized_pnl,
        exposure_fraction,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      snapshot.id,
      snapshot.account_id,
      snapshot.simulation_run_id,
      snapshot.observed_at,
      snapshot.cash_balance,
      snapshot.holdings_value,
      snapshot.total_equity,
      snapshot.realized_pnl,
      snapshot.unrealized_pnl,
      snapshot.exposure_fraction,
      snapshot.created_at,
    )
  );

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function replaceAccountPositions(env: Env, accountId: string, positions: PaperPosition[]): Promise<void> {
  const statements = [
    env.DB.prepare("DELETE FROM stock_paper_positions WHERE account_id = ?").bind(accountId),
    ...positions.map((position) =>
      env.DB.prepare(
        `
        INSERT INTO stock_paper_positions (
          account_id,
          stock_id,
          shares,
          average_entry_price,
          opened_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        accountId,
        position.stock_id,
        position.shares,
        position.average_entry_price,
        position.opened_at,
        position.updated_at,
      )
    ),
  ];

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function insertSimulationRun(env: Env, run: SimulationRun): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO stock_paper_simulation_runs (
      id,
      strategy_key,
      started_at,
      finished_at,
      simulation_start_at,
      simulation_end_at,
      status,
      starting_cash,
      final_equity,
      return_percent,
      max_drawdown_percent,
      trade_count,
      win_trade_count,
      buy_fee_rate,
      sell_fee_rate,
      config_json,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      run.id,
      run.strategy_key,
      run.started_at,
      run.finished_at,
      run.simulation_start_at,
      run.simulation_end_at,
      run.status,
      run.starting_cash,
      run.final_equity,
      run.return_percent,
      run.max_drawdown_percent,
      run.trade_count,
      run.win_trade_count,
      run.buy_fee_rate,
      run.sell_fee_rate,
      run.config_json,
      run.error,
    )
    .run();
}

async function updateSimulationRun(env: Env, run: SimulationRun): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE stock_paper_simulation_runs
    SET
      finished_at = ?,
      simulation_start_at = ?,
      simulation_end_at = ?,
      status = ?,
      final_equity = ?,
      return_percent = ?,
      max_drawdown_percent = ?,
      trade_count = ?,
      win_trade_count = ?,
      error = ?
    WHERE id = ?
    `,
  )
    .bind(
      run.finished_at,
      run.simulation_start_at,
      run.simulation_end_at,
      run.status,
      run.final_equity,
      run.return_percent,
      run.max_drawdown_percent,
      run.trade_count,
      run.win_trade_count,
      run.error,
      run.id,
    )
    .run();
}

function botDefinitionById(botId: unknown): PaperBotDefinition | null {
  return PAPER_BOTS.find((bot) => bot.id === botId) ?? null;
}

function publicBotDefinition(bot: PaperBotDefinition): PaperBotStatus["bot"] {
  return {
    id: bot.id,
    name: bot.name,
    strategy_key: bot.strategy_key,
    strategy: bot.strategy,
    default_starting_cash: bot.starting_cash,
  };
}

async function ensureLivePaperAccount(env: Env, bot: PaperBotDefinition, now: number): Promise<PaperAccount> {
  const account = await readLivePaperAccount(env, bot.id);
  return account ?? upsertLivePaperAccount(env, bot, now, bot.starting_cash, bot.starting_cash, 0, null);
}

async function upsertLivePaperAccount(
  env: Env,
  bot: PaperBotDefinition,
  now: number,
  startingCash: number,
  cashBalance: number,
  realizedPnl: number,
  lastDecisionAt: number | null,
): Promise<PaperAccount> {
  await env.DB.prepare(
    `
    INSERT INTO stock_paper_accounts (
      id,
      name,
      mode,
      status,
      strategy_key,
      starting_cash,
      cash_balance,
      realized_pnl,
      buy_fee_rate,
      sell_fee_rate,
      max_open_positions,
      max_position_fraction,
      min_cash_reserve_fraction,
      last_decision_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, 'live', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'active',
      strategy_key = excluded.strategy_key,
      starting_cash = excluded.starting_cash,
      cash_balance = excluded.cash_balance,
      realized_pnl = excluded.realized_pnl,
      buy_fee_rate = excluded.buy_fee_rate,
      sell_fee_rate = excluded.sell_fee_rate,
      max_open_positions = excluded.max_open_positions,
      max_position_fraction = excluded.max_position_fraction,
      min_cash_reserve_fraction = excluded.min_cash_reserve_fraction,
      last_decision_at = excluded.last_decision_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      bot.id,
      bot.name,
      bot.strategy_key,
      startingCash,
      cashBalance,
      realizedPnl,
      bot.buy_fee_rate,
      bot.sell_fee_rate,
      bot.max_open_positions,
      bot.max_position_fraction,
      bot.min_cash_reserve_fraction,
      lastDecisionAt,
      now,
      now,
    )
    .run();

  const account = await readLivePaperAccount(env, bot.id);
  if (!account) {
    throw new Error("Unable to create live paper account.");
  }
  return account;
}

async function readLivePaperAccount(env: Env, accountId: string): Promise<PaperAccount | null> {
  return await env.DB.prepare("SELECT * FROM stock_paper_accounts WHERE id = ?")
    .bind(accountId)
    .first<PaperAccount>();
}

async function readAccountPositions(env: Env, accountId: string): Promise<PaperPosition[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM stock_paper_positions
    WHERE account_id = ?
    ORDER BY stock_id ASC
    `,
  )
    .bind(accountId)
    .all<PaperPosition>();

  return rows.results ?? [];
}

async function readAccountPositionsWithMarket(env: Env, accountId: string): Promise<Array<PaperPosition & {
  acronym: string | null;
  name: string | null;
  latest_price: number | null;
  market_value: number;
  unrealized_pnl: number;
}>> {
  const rows = await env.DB.prepare(
    `
    SELECT
      pos.*,
      p.acronym,
      p.name,
      s.price AS latest_price
    FROM stock_paper_positions pos
    LEFT JOIN stock_profiles p ON p.stock_id = pos.stock_id
    LEFT JOIN stock_price_snapshots s
      ON s.stock_id = pos.stock_id
      AND s.observed_at = (
        SELECT MAX(observed_at)
        FROM stock_price_snapshots
        WHERE stock_id = pos.stock_id
      )
    WHERE pos.account_id = ?
    ORDER BY pos.stock_id ASC
    `,
  )
    .bind(accountId)
    .all<PaperPosition & { acronym: string | null; name: string | null; latest_price: number | null }>();

  return (rows.results ?? []).map((position) => {
    const latestPrice = position.latest_price ?? 0;
    const marketValue = position.shares * latestPrice;
    return {
      ...position,
      market_value: marketValue,
      unrealized_pnl: marketValue - position.shares * position.average_entry_price,
    };
  });
}

async function readLatestAccountEquity(env: Env, accountId: string): Promise<EquitySnapshot | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM stock_paper_equity_snapshots
    WHERE account_id = ?
    ORDER BY observed_at DESC
    LIMIT 1
    `,
  )
    .bind(accountId)
    .first<EquitySnapshot>();
}

async function readRecentPaperTrades(
  env: Env,
  accountId: string | null,
  simulationRunId: string | null,
  limit: number,
): Promise<Array<PaperTrade & { acronym: string | null; name: string | null }>> {
  const where = accountId ? "t.account_id = ?" : "t.simulation_run_id = ?";
  const id = accountId ?? simulationRunId;
  if (!id) {
    return [];
  }

  const rows = await env.DB.prepare(
    `
    SELECT t.*, p.acronym, p.name
    FROM stock_paper_trades t
    LEFT JOIN stock_profiles p ON p.stock_id = t.stock_id
    WHERE ${where}
    ORDER BY t.executed_at DESC, t.created_at DESC
    LIMIT ?
    `,
  )
    .bind(id, limit)
    .all<PaperTrade & { acronym: string | null; name: string | null }>();

  return rows.results ?? [];
}

async function readRecentCopyMovementEvents(
  env: Env,
  sourcePlayerId: number,
  limit: number,
): Promise<CopyMovementEvent[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM stock_copy_movement_events
    WHERE source_player_id = ?
    ORDER BY observed_at DESC, created_at DESC
    LIMIT ?
    `,
  )
    .bind(sourcePlayerId, limit)
    .all<CopyMovementEvent>();

  return rows.results ?? [];
}

function copyMovementSignalsFromEvents(events: CopyMovementEvent[]): StockSignal[] {
  return events.map((event, index) => ({
    stock_id: event.stock_id,
    acronym: null,
    name: null,
    observed_at: event.observed_at,
    price: event.price,
    score: event.strength,
    expected_return: event.strength,
    momentum_30m: event.price_change ?? 0,
    momentum_1h: 0,
    momentum_3h: 0,
    momentum_6h: 0,
    volatility_1h: 0,
    investor_change: event.investor_change ?? undefined,
    share_pressure: event.share_pressure ?? undefined,
    market_cap_change: event.market_cap_change ?? undefined,
    copy_side: event.side,
    copy_source_player_id: event.source_player_id,
    copy_source_player_name: event.source_player_name,
    copy_activity_status: event.activity_status,
    copy_activity_timestamp: event.activity_timestamp,
    copy_reason: event.reason,
    copy_window_start_at: event.window_start_at,
    rank: index + 1,
  }));
}

async function readLatestSimulationRun(env: Env): Promise<SimulationRun | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM stock_paper_simulation_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<SimulationRun>();
}

async function readMarketStocks(env: Env, startAt: number, endAt: number): Promise<MarketStock[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      s.stock_id,
      s.observed_at,
      s.price,
      s.market_cap,
      s.total_shares,
      s.investors
    FROM stock_price_snapshots s
    WHERE s.observed_at BETWEEN ? AND ?
    ORDER BY s.observed_at ASC, s.stock_id ASC
    `,
  )
    .bind(startAt, endAt)
    .all<MarketPoint>();

  return marketStocksFromRows(rows.results ?? []);
}

async function readMarketStocksForDecision(env: Env, observedAt: number): Promise<MarketStock[]> {
  const recentStartAt = observedAt - 60 * 60;
  const anchor3h = observedAt - 3 * 60 * 60;
  const anchor6h = observedAt - 6 * 60 * 60;
  const rows = await env.DB.prepare(
    `
    SELECT stock_id, observed_at, price, market_cap, total_shares, investors
    FROM (
      SELECT stock_id, observed_at, price, market_cap, total_shares, investors
      FROM stock_price_snapshots
      WHERE observed_at BETWEEN ? AND ?
      UNION ALL
      SELECT stock_id, observed_at, price, market_cap, total_shares, investors
      FROM stock_price_snapshots
      WHERE observed_at IN (?, ?)
    )
    ORDER BY observed_at ASC, stock_id ASC
    `,
  )
    .bind(recentStartAt, observedAt, anchor3h, anchor6h)
    .all<MarketPoint>();

  return marketStocksFromRows(rows.results ?? []);
}

function marketStocksFromRows(rows: MarketPoint[]): MarketStock[] {
  const byStock = new Map<number, MarketStock>();
  for (const row of rows) {
    const stock = byStock.get(row.stock_id) ?? {
      stock_id: row.stock_id,
      acronym: null,
      name: null,
      points: [],
    };
    stock.points.push({
      stock_id: row.stock_id,
      observed_at: row.observed_at,
      price: row.price,
      market_cap: row.market_cap,
      total_shares: row.total_shares,
      investors: row.investors,
    });
    byStock.set(row.stock_id, stock);
  }

  return [...byStock.values()];
}

async function readNewestStockSnapshotAt(env: Env): Promise<number | null> {
  const row = await env.DB.prepare("SELECT MAX(observed_at) AS observed_at FROM stock_price_snapshots")
    .first<{ observed_at: number | null }>();
  return row?.observed_at === null || row?.observed_at === undefined ? null : Number(row.observed_at);
}

async function readOldestStockSnapshotAt(env: Env): Promise<number | null> {
  const row = await env.DB.prepare("SELECT MIN(observed_at) AS observed_at FROM stock_price_snapshots")
    .first<{ observed_at: number | null }>();
  return row?.observed_at === null || row?.observed_at === undefined ? null : Number(row.observed_at);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  const body = await request.json().catch(() => ({}));
  return isRecord(body) ? body : {};
}

function roundUpToInterval(timestamp: number): number {
  return Math.ceil(timestamp / DECISION_INTERVAL_SECONDS) * DECISION_INTERVAL_SECONDS;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveCurrency(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
