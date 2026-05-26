import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

type PaperAccount = {
  id: string;
  name: string;
  mode: string;
  status: string;
  strategy_key: string;
  starting_cash: number;
  cash_balance: number;
  realized_pnl: number;
  buy_fee_rate: number;
  sell_fee_rate: number;
  max_open_positions: number;
  max_position_fraction: number;
  min_cash_reserve_fraction: number;
  last_decision_at: number | null;
  created_at: number;
  updated_at: number;
};

type PaperPosition = {
  account_id?: string;
  stock_id: number;
  shares: number;
  average_entry_price: number;
  opened_at: number;
  updated_at: number;
};

type MarketPoint = {
  stock_id: number;
  observed_at: number;
  price: number;
  market_cap?: number | null;
  total_shares?: number | null;
  investors?: number | null;
};

type MarketStock = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  points: MarketPoint[];
};

type StrategyConfig = Pick<
  PaperAccount,
  | "strategy_key"
  | "starting_cash"
  | "buy_fee_rate"
  | "sell_fee_rate"
  | "max_open_positions"
  | "max_position_fraction"
  | "min_cash_reserve_fraction"
>;

type StrategyState = {
  cash: number;
  realizedPnl: number;
  positions: Map<number, PaperPosition>;
};

type StockSignal = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  observed_at: number;
  price: number;
  score: number;
  expected_return: number;
  momentum_30m: number;
  momentum_1h: number;
  momentum_3h: number;
  momentum_6h: number;
  volatility_1h: number;
  rank: number;
};

type PaperTrade = {
  id: string;
  account_id: string | null;
  simulation_run_id: string | null;
  stock_id: number;
  side: "buy" | "sell";
  shares: number;
  price: number;
  gross_value: number;
  fee: number;
  net_value: number;
  realized_pnl: number | null;
  executed_at: number;
  reason: string;
  score: number | null;
  details_json: string | null;
  created_at: number;
};

type EquitySnapshot = {
  id: string;
  account_id: string | null;
  simulation_run_id: string | null;
  observed_at: number;
  cash_balance: number;
  holdings_value: number;
  total_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  exposure_fraction: number;
  created_at: number;
};

type DecisionResult = {
  trades: PaperTrade[];
  snapshot: EquitySnapshot;
  signals: StockSignal[];
};

type SimulationRun = {
  id: string;
  strategy_key: string;
  started_at: number;
  finished_at: number | null;
  simulation_start_at: number | null;
  simulation_end_at: number | null;
  status: string;
  starting_cash: number;
  final_equity: number | null;
  return_percent: number | null;
  max_drawdown_percent: number | null;
  trade_count: number;
  win_trade_count: number;
  buy_fee_rate: number;
  sell_fee_rate: number;
  config_json: string | null;
  error: string | null;
};

const LIVE_ACCOUNT_ID = "stock-paper-live";
const DEFAULT_STRATEGY_KEY = "momentum-relative-v1";
const DEFAULT_STARTING_CASH = 1_000_000_000;
const DEFAULT_BUY_FEE_RATE = 0;
const DEFAULT_SELL_FEE_RATE = 0.001;
const DEFAULT_MAX_OPEN_POSITIONS = 5;
const DEFAULT_MAX_POSITION_FRACTION = 0.25;
const DEFAULT_MIN_CASH_RESERVE_FRACTION = 0.05;
const DECISION_INTERVAL_SECONDS = 5 * 60;
const LOOKBACK_SECONDS = 6 * 60 * 60;
const DEFAULT_SIMULATION_SECONDS = 24 * 60 * 60;
const MAX_SIMULATION_SECONDS = 24 * 60 * 60;
const FRESH_SNAPSHOT_SECONDS = 45 * 60;

const DEFAULT_CONFIG: StrategyConfig = {
  strategy_key: DEFAULT_STRATEGY_KEY,
  starting_cash: DEFAULT_STARTING_CASH,
  buy_fee_rate: DEFAULT_BUY_FEE_RATE,
  sell_fee_rate: DEFAULT_SELL_FEE_RATE,
  max_open_positions: DEFAULT_MAX_OPEN_POSITIONS,
  max_position_fraction: DEFAULT_MAX_POSITION_FRACTION,
  min_cash_reserve_fraction: DEFAULT_MIN_CASH_RESERVE_FRACTION,
};

export async function runLiveStockPaperBotTick(
  env: Env,
  scheduledTime: number,
): Promise<{ ok: true; skipped: boolean; reason?: string; account?: PaperAccount; snapshot?: EquitySnapshot; trades?: PaperTrade[] }> {
  const newestSnapshotAt = await readNewestStockSnapshotAt(env);
  const scheduledSeconds = Math.floor(scheduledTime / 1000);
  const eligibleSnapshotAt = newestSnapshotAt === null
    ? null
    : Math.floor(newestSnapshotAt / DECISION_INTERVAL_SECONDS) * DECISION_INTERVAL_SECONDS;
  if (!eligibleSnapshotAt || scheduledSeconds - eligibleSnapshotAt > FRESH_SNAPSHOT_SECONDS) {
    return { ok: true, skipped: true, reason: "No fresh stock snapshots available" };
  }

  const account = await ensureLivePaperAccount(env, nowSeconds());
  if (account.last_decision_at !== null && account.last_decision_at >= eligibleSnapshotAt) {
    return { ok: true, skipped: true, reason: "Latest snapshot already evaluated", account };
  }

  const market = await readMarketStocks(env, eligibleSnapshotAt - LOOKBACK_SECONDS, eligibleSnapshotAt);
  if (market.length === 0) {
    return { ok: true, skipped: true, reason: "No market history available", account };
  }

  const positions = await readAccountPositions(env, account.id);
  const state: StrategyState = {
    cash: account.cash_balance,
    realizedPnl: account.realized_pnl,
    positions: new Map(positions.map((position) => [position.stock_id, { ...position }])),
  };
  const result = applyPaperDecision({
    state,
    market,
    config: account,
    observedAt: eligibleSnapshotAt,
    accountId: account.id,
    simulationRunId: null,
    createdAt: nowSeconds(),
  });

  await persistAccountDecision(env, account, state, result, eligibleSnapshotAt);
  return { ok: true, skipped: false, account: { ...account, cash_balance: state.cash, realized_pnl: state.realizedPnl, last_decision_at: eligibleSnapshotAt }, snapshot: result.snapshot, trades: result.trades };
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
  const account = await readLivePaperAccount(env);
  const positions = account ? await readAccountPositionsWithMarket(env, account.id) : [];
  const latestEquity = account ? await readLatestAccountEquity(env, account.id) : null;
  const recentTrades = account ? await readRecentPaperTrades(env, account.id, null, 20) : [];
  const latestSimulation = await readLatestSimulationRun(env);
  const simulationTrades = latestSimulation ? await readRecentPaperTrades(env, null, latestSimulation.id, 20) : [];
  const latestSignals = account?.last_decision_at
    ? rankStockPaperSignals(await readMarketStocks(env, account.last_decision_at - LOOKBACK_SECONDS, account.last_decision_at), account.last_decision_at, account)
    : [];

  return json({
    ok: true,
    account,
    positions,
    latest_equity: latestEquity,
    recent_trades: recentTrades,
    latest_simulation: latestSimulation,
    latest_simulation_trades: simulationTrades,
    latest_signals: latestSignals.slice(0, 5),
    defaults: DEFAULT_CONFIG,
  });
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
  const trades = await readRecentPaperTrades(env, LIVE_ACCOUNT_ID, null, limit);
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

export async function resetStockPaperAccount(env: Env): Promise<Response> {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stock_paper_positions WHERE account_id = ?").bind(LIVE_ACCOUNT_ID),
    env.DB.prepare("DELETE FROM stock_paper_trades WHERE account_id = ?").bind(LIVE_ACCOUNT_ID),
    env.DB.prepare("DELETE FROM stock_paper_equity_snapshots WHERE account_id = ?").bind(LIVE_ACCOUNT_ID),
  ]);
  const account = await upsertLivePaperAccount(env, now, DEFAULT_STARTING_CASH, 0, null);
  return json({ ok: true, account });
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

function applyPaperDecision(options: {
  state: StrategyState;
  market: MarketStock[];
  config: StrategyConfig;
  observedAt: number;
  accountId: string | null;
  simulationRunId: string | null;
  createdAt: number;
}): DecisionResult {
  const { state, market, config, observedAt, accountId, simulationRunId, createdAt } = options;
  const signals = rankStockPaperSignals(market, observedAt, config);
  const prices = latestPricesByStock(market, observedAt);
  const tradableSignals = signals
    .filter((signal) => signal.expected_return > config.sell_fee_rate)
    .slice(0, config.max_open_positions);
  const targetIds = new Set(tradableSignals.map((signal) => signal.stock_id));
  const signalByStock = new Map(signals.map((signal) => [signal.stock_id, signal]));
  const trades: PaperTrade[] = [];

  for (const position of [...state.positions.values()]) {
    const price = prices.get(position.stock_id);
    const signal = signalByStock.get(position.stock_id);
    if (!price) {
      continue;
    }
    if (!targetIds.has(position.stock_id) || !signal || signal.expected_return <= config.sell_fee_rate) {
      trades.push(sellShares(state, position, position.shares, price, observedAt, "signal_exit", signal, config, accountId, simulationRunId, createdAt));
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
  await replaceAccountPositions(env, account.id, [...state.positions.values()]);
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

async function ensureLivePaperAccount(env: Env, now: number): Promise<PaperAccount> {
  const account = await readLivePaperAccount(env);
  return account ?? upsertLivePaperAccount(env, now, DEFAULT_STARTING_CASH, 0, null);
}

async function upsertLivePaperAccount(
  env: Env,
  now: number,
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
      LIVE_ACCOUNT_ID,
      "Torn paper bot",
      DEFAULT_STRATEGY_KEY,
      DEFAULT_STARTING_CASH,
      cashBalance,
      realizedPnl,
      DEFAULT_BUY_FEE_RATE,
      DEFAULT_SELL_FEE_RATE,
      DEFAULT_MAX_OPEN_POSITIONS,
      DEFAULT_MAX_POSITION_FRACTION,
      DEFAULT_MIN_CASH_RESERVE_FRACTION,
      lastDecisionAt,
      now,
      now,
    )
    .run();

  const account = await readLivePaperAccount(env);
  if (!account) {
    throw new Error("Unable to create live paper account.");
  }
  return account;
}

async function readLivePaperAccount(env: Env): Promise<PaperAccount | null> {
  return await env.DB.prepare("SELECT * FROM stock_paper_accounts WHERE id = ?")
    .bind(LIVE_ACCOUNT_ID)
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
      p.acronym,
      p.name,
      s.observed_at,
      s.price
    FROM stock_price_snapshots s
    LEFT JOIN stock_profiles p ON p.stock_id = s.stock_id
    WHERE s.observed_at BETWEEN ? AND ?
    ORDER BY s.stock_id ASC, s.observed_at ASC
    `,
  )
    .bind(startAt, endAt)
    .all<MarketPoint & { acronym: string | null; name: string | null }>();

  const byStock = new Map<number, MarketStock>();
  for (const row of rows.results ?? []) {
    const stock = byStock.get(row.stock_id) ?? {
      stock_id: row.stock_id,
      acronym: row.acronym,
      name: row.name,
      points: [],
    };
    stock.points.push({
      stock_id: row.stock_id,
      observed_at: row.observed_at,
      price: row.price,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
