import { StockSnapshotExportRow } from "../api";

type BacktestRequest = {
  type: "run";
  snapshots: StockSnapshotExportRow[];
  startAt: number;
  endAt: number;
  startingCash: number;
};

type Position = {
  stock_id: number;
  shares: number;
  average_entry_price: number;
  opened_at: number;
};

type Signal = {
  stock_id: number;
  price: number;
  score: number;
  expected_return: number;
  rank: number;
};

const BUY_FEE_RATE = 0;
const SELL_FEE_RATE = 0.001;
const DECISION_INTERVAL_SECONDS = 5 * 60;
const LOOKBACK_SECONDS = 6 * 60 * 60;
const MAX_OPEN_POSITIONS = 5;
const MAX_POSITION_FRACTION = 0.25;
const MIN_CASH_RESERVE_FRACTION = 0.05;
const MIN_POSITION_HOLD_SECONDS = 60 * 60;
const EXIT_RANK_THRESHOLD = 10;
const MIN_NET_EXIT_RETURN = 0;

self.onmessage = (event: MessageEvent<BacktestRequest>) => {
  if (event.data.type !== "run") {
    return;
  }

  try {
    const result = runBacktest(event.data);
    self.postMessage({ type: "complete", result });
  } catch (err) {
    self.postMessage({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};

function runBacktest({ snapshots, startAt, endAt, startingCash }: BacktestRequest) {
  const byStock = groupSnapshots(snapshots);
  let cash = startingCash;
  let realizedPnl = 0;
  const positions = new Map<number, Position>();
  const equity: Array<{ observed_at: number; total_equity: number }> = [];
  const trades: Array<{
    stock_id: number;
    side: "buy" | "sell";
    shares: number;
    price: number;
    fee: number;
    realized_pnl: number | null;
    executed_at: number;
    reason: string;
  }> = [];
  let peakEquity = startingCash;
  let maxDrawdown = 0;

  const firstDecision = Math.ceil(Math.max(startAt, minSnapshotTime(snapshots) + LOOKBACK_SECONDS) / DECISION_INTERVAL_SECONDS) * DECISION_INTERVAL_SECONDS;
  for (let decisionAt = firstDecision; decisionAt <= endAt; decisionAt += DECISION_INTERVAL_SECONDS) {
    const signals = rankSignals(byStock, decisionAt);
    const prices = latestPrices(byStock, decisionAt);
    const targets = signals.filter((signal) => signal.expected_return > SELL_FEE_RATE).slice(0, MAX_OPEN_POSITIONS);
    const targetIds = new Set(targets.map((signal) => signal.stock_id));
    const signalByStock = new Map(signals.map((signal) => [signal.stock_id, signal]));

    for (const position of [...positions.values()]) {
      const price = prices.get(position.stock_id);
      const signal = signalByStock.get(position.stock_id);
      if (!price) continue;
      const exit = shouldExit(position, signal, targetIds, price, decisionAt);
      if (exit.shouldExit) {
        const trade = sell(position, position.shares, price, decisionAt, exit.reason);
        trades.push(trade);
        cash += trade.shares * trade.price - trade.fee;
        realizedPnl += trade.realized_pnl ?? 0;
        positions.delete(position.stock_id);
      }
    }

    const totalEquity = cash + holdingsValue(positions, prices);
    const targetCount = Math.max(1, targets.length);
    const targetFraction = Math.min(MAX_POSITION_FRACTION, (1 - MIN_CASH_RESERVE_FRACTION) / targetCount);
    const reserveCash = totalEquity * MIN_CASH_RESERVE_FRACTION;

    for (const signal of targets) {
      const price = prices.get(signal.stock_id);
      if (!price) continue;
      const current = positions.get(signal.stock_id);
      const currentValue = (current?.shares ?? 0) * price;
      const targetValue = totalEquity * targetFraction;
      const spend = Math.min(Math.max(0, cash - reserveCash), Math.max(0, targetValue - currentValue));
      const shares = Math.floor(spend / price);
      if (shares <= 0) continue;

      const gross = shares * price;
      const fee = gross * BUY_FEE_RATE;
      cash -= gross + fee;
      if (current) {
        const currentCost = current.average_entry_price * current.shares;
        current.average_entry_price = (currentCost + gross) / (current.shares + shares);
        current.shares += shares;
      } else {
        positions.set(signal.stock_id, {
          stock_id: signal.stock_id,
          shares,
          average_entry_price: price,
          opened_at: decisionAt,
        });
      }
      trades.push({ stock_id: signal.stock_id, side: "buy", shares, price, fee, realized_pnl: null, executed_at: decisionAt, reason: "target_entry" });
    }

    const markedEquity = cash + holdingsValue(positions, prices);
    equity.push({ observed_at: decisionAt, total_equity: markedEquity });
    peakEquity = Math.max(peakEquity, markedEquity);
    if (peakEquity > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peakEquity - markedEquity) / peakEquity);
    }
  }

  const finalEquity = equity.length > 0 ? equity[equity.length - 1].total_equity : startingCash;
  return {
    started_at: startAt,
    finished_at: endAt,
    starting_cash: startingCash,
    final_equity: finalEquity,
    return_percent: ((finalEquity - startingCash) / startingCash) * 100,
    max_drawdown_percent: maxDrawdown * 100,
    trade_count: trades.length,
    win_trade_count: trades.filter((trade) => trade.side === "sell" && (trade.realized_pnl ?? 0) > 0).length,
    equity: equity.slice(-96),
    trades: trades.slice(-100).reverse(),
    realized_pnl: realizedPnl,
  };
}

function groupSnapshots(snapshots: StockSnapshotExportRow[]): Map<number, StockSnapshotExportRow[]> {
  const byStock = new Map<number, StockSnapshotExportRow[]>();
  snapshots.forEach((snapshot) => {
    const stockSnapshots = byStock.get(snapshot.stock_id) ?? [];
    stockSnapshots.push(snapshot);
    byStock.set(snapshot.stock_id, stockSnapshots);
  });
  byStock.forEach((rows) => rows.sort((a, b) => a.observed_at - b.observed_at));
  return byStock;
}

function rankSignals(byStock: Map<number, StockSnapshotExportRow[]>, observedAt: number): Signal[] {
  const rawSignals: Array<Omit<Signal, "rank">> = [];
  byStock.forEach((points, stockId) => {
    const current = priceAt(points, observedAt);
    const p30 = priceAt(points, observedAt - 30 * 60);
    const p1h = priceAt(points, observedAt - 60 * 60);
    const p3h = priceAt(points, observedAt - 3 * 60 * 60);
    const p6h = priceAt(points, observedAt - 6 * 60 * 60);
    if (!current || !p30 || !p1h || !p3h || !p6h) return;
    const momentum30m = current.price / p30.price - 1;
    const momentum1h = current.price / p1h.price - 1;
    const momentum3h = current.price / p3h.price - 1;
    const momentum6h = current.price / p6h.price - 1;
    const score = momentum30m * 0.35 + momentum1h * 0.3 + momentum3h * 0.2 + momentum6h * 0.15;
    rawSignals.push({ stock_id: stockId, price: current.price, score, expected_return: score - SELL_FEE_RATE });
  });

  const averageScore = rawSignals.reduce((total, signal) => total + signal.score, 0) / Math.max(1, rawSignals.length);
  return rawSignals
    .map((signal) => ({ ...signal, expected_return: signal.score - averageScore - SELL_FEE_RATE }))
    .sort((a, b) => b.expected_return - a.expected_return)
    .map((signal, index) => ({ ...signal, rank: index + 1 }));
}

function latestPrices(byStock: Map<number, StockSnapshotExportRow[]>, observedAt: number): Map<number, number> {
  const prices = new Map<number, number>();
  byStock.forEach((points, stockId) => {
    const point = priceAt(points, observedAt);
    if (point) prices.set(stockId, point.price);
  });
  return prices;
}

function priceAt(points: StockSnapshotExportRow[], observedAt: number): StockSnapshotExportRow | null {
  let low = 0;
  let high = points.length - 1;
  let result: StockSnapshotExportRow | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].observed_at <= observedAt) {
      result = points[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

function holdingsValue(positions: Map<number, Position>, prices: Map<number, number>): number {
  let total = 0;
  positions.forEach((position) => {
    total += position.shares * (prices.get(position.stock_id) ?? 0);
  });
  return total;
}

function shouldExit(
  position: Position,
  signal: Signal | undefined,
  targetIds: Set<number>,
  price: number,
  observedAt: number,
): { shouldExit: boolean; reason: string } {
  if (targetIds.has(position.stock_id) && signal && signal.expected_return > SELL_FEE_RATE) {
    return { shouldExit: false, reason: "hold_target" };
  }

  if (observedAt - position.opened_at < MIN_POSITION_HOLD_SECONDS) {
    return { shouldExit: false, reason: "min_hold" };
  }

  if (netReturnIfSold(position, price) >= MIN_NET_EXIT_RETURN) {
    return { shouldExit: true, reason: "fee_covered_exit" };
  }

  const severeSignalDeterioration =
    !signal ||
    signal.expected_return <= -SELL_FEE_RATE ||
    signal.rank > EXIT_RANK_THRESHOLD;
  if (severeSignalDeterioration) {
    return { shouldExit: true, reason: "severe_signal_exit" };
  }

  return { shouldExit: false, reason: "hold_fee_buffer" };
}

function netReturnIfSold(position: Position, price: number): number {
  const netSellPrice = price * (1 - SELL_FEE_RATE);
  return position.average_entry_price > 0
    ? netSellPrice / position.average_entry_price - 1
    : 0;
}

function sell(position: Position, shares: number, price: number, executedAt: number, reason: string) {
  const gross = shares * price;
  const fee = gross * SELL_FEE_RATE;
  const net = gross - fee;
  const realizedPnl = net - position.average_entry_price * shares;
  return { stock_id: position.stock_id, side: "sell" as const, shares, price, fee, realized_pnl: realizedPnl, executed_at: executedAt, reason };
}

function minSnapshotTime(snapshots: StockSnapshotExportRow[]): number {
  return snapshots.reduce((min, snapshot) => Math.min(min, snapshot.observed_at), Number.POSITIVE_INFINITY);
}
