import {
  DEFAULT_CONFIG,
  WHALE_FLOW_BASELINE_MULTIPLIER,
  WHALE_FLOW_BASELINE_SECONDS,
  WHALE_FLOW_MIN_SCORE,
} from "./model";
import type {
  MarketPoint,
  MarketStock,
  PaperBotStrategy,
  StockSignal,
  StrategyConfig,
} from "./model";

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

export function rankSignalsForStrategy(
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

export function whaleFlowScoreBetween(previous: MarketPoint, current: MarketPoint): {
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

export function percentChange(previous: unknown, current: unknown): number | null {
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

export function priceAtOrBefore(points: MarketPoint[], timestamp: number): MarketPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].observed_at <= timestamp) {
      return points[index];
    }
  }
  return null;
}

export function volatilityBetween(points: MarketPoint[], startAt: number, endAt: number): number {
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
