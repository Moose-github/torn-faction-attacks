export type PaperAccount = {
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

export type PaperPosition = {
  account_id?: string;
  stock_id: number;
  shares: number;
  average_entry_price: number;
  opened_at: number;
  updated_at: number;
};

export type MarketPoint = {
  stock_id: number;
  observed_at: number;
  price: number;
  market_cap?: number | null;
  total_shares?: number | null;
  investors?: number | null;
};

export type MarketStock = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  points: MarketPoint[];
};

export type StrategyConfig = Pick<
  PaperAccount,
  | "strategy_key"
  | "starting_cash"
  | "buy_fee_rate"
  | "sell_fee_rate"
  | "max_open_positions"
  | "max_position_fraction"
  | "min_cash_reserve_fraction"
>;

export type PaperBotStrategy = "momentum" | "whale-flow" | "copy-movement";

export type PaperBotDefinition = StrategyConfig & {
  id: string;
  name: string;
  strategy: PaperBotStrategy;
};

export type StrategyState = {
  cash: number;
  realizedPnl: number;
  positions: Map<number, PaperPosition>;
};

export type StockSignal = {
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
  flow_1m?: number;
  flow_threshold?: number;
  investor_change?: number;
  share_pressure?: number;
  market_cap_change?: number;
  copy_side?: "buy" | "sell";
  copy_source_player_id?: number;
  copy_source_player_name?: string;
  copy_activity_status?: string | null;
  copy_activity_timestamp?: number | null;
  copy_reason?: string;
  copy_window_start_at?: number;
  rank: number;
};

export type PaperTrade = {
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

export type EquitySnapshot = {
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

export type DecisionResult = {
  trades: PaperTrade[];
  snapshot: EquitySnapshot;
  signals: StockSignal[];
  copyEvents?: CopyMovementEvent[];
};

export type CopyMovementActivity = {
  source_player_id: number;
  source_player_name: string;
  status: string | null;
  timestamp: number | null;
  relative: string | null;
  active: boolean;
  raw_json: unknown;
};

export type CopyMovementEvent = {
  id: string;
  source_player_id: number;
  source_player_name: string;
  activity_status: string | null;
  activity_timestamp: number | null;
  observed_at: number;
  window_start_at: number;
  stock_id: number;
  side: "buy" | "sell";
  price: number;
  strength: number;
  price_change: number | null;
  investor_change: number | null;
  share_pressure: number | null;
  market_cap_change: number | null;
  status: "executed" | "skipped" | "ignored";
  reason: string;
  paper_trade_id: string | null;
  details_json: string | null;
  created_at: number;
};

export type PaperBotStatus = {
  bot: {
    id: string;
    name: string;
    strategy_key: string;
    strategy: PaperBotStrategy;
    default_starting_cash: number;
  };
  account: PaperAccount | null;
  positions: Array<PaperPosition & {
    acronym: string | null;
    name: string | null;
    latest_price: number | null;
    market_value: number;
    unrealized_pnl: number;
  }>;
  latest_equity: EquitySnapshot | null;
  recent_trades: Array<PaperTrade & { acronym: string | null; name: string | null }>;
  latest_signals: StockSignal[];
  recent_copy_events: CopyMovementEvent[];
};

export type SimulationRun = {
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

export const MOMENTUM_ACCOUNT_ID = "stock-paper-live";
export const WHALE_FLOW_ACCOUNT_ID = "stock-paper-flow-live";
export const COPY_MOVEMENT_ACCOUNT_ID = "stock-paper-matzstonks-live";
export const DEFAULT_STRATEGY_KEY = "momentum-relative-v2";
export const WHALE_FLOW_STRATEGY_KEY = "whale-flow-mimic-v1";
export const COPY_MOVEMENT_STRATEGY_KEY = "copy-movement-matzstonks-v1";
export const DEFAULT_STARTING_CASH = 1_000_000_000;
export const WHALE_FLOW_STARTING_CASH = 10_000_000_000;
export const DEFAULT_BUY_FEE_RATE = 0;
export const DEFAULT_SELL_FEE_RATE = 0.001;
export const DEFAULT_MAX_OPEN_POSITIONS = 5;
export const DEFAULT_MAX_POSITION_FRACTION = 0.25;
export const DEFAULT_MIN_CASH_RESERVE_FRACTION = 0.05;
export const DECISION_INTERVAL_SECONDS = 60;
export const LOOKBACK_SECONDS = 6 * 60 * 60;
export const DEFAULT_SIMULATION_SECONDS = 24 * 60 * 60;
export const MAX_SIMULATION_SECONDS = 24 * 60 * 60;
export const FRESH_SNAPSHOT_SECONDS = 45 * 60;
export const MIN_POSITION_HOLD_SECONDS = 60 * 60;
export const TAKE_PROFIT_NET_RETURN = 0.0025;
export const STOP_LOSS_NET_RETURN = -0.015;
export const STALE_POSITION_SECONDS = 6 * 60 * 60;
export const WHALE_FLOW_MAX_TARGETS = 3;
export const WHALE_FLOW_BASELINE_SECONDS = 60 * 60;
export const WHALE_FLOW_MIN_SCORE = 0.001;
export const WHALE_FLOW_BASELINE_MULTIPLIER = 2;
export const WHALE_FLOW_STRONG_REVERSAL_SCORE = -0.0015;
export const COPY_MOVEMENT_SOURCE_PLAYER_ID = 2566807;
export const COPY_MOVEMENT_SOURCE_PLAYER_NAME = "MatzStonks";
export const COPY_MOVEMENT_TORN_API_BASE = "https://api.torn.com/v2";
export const COPY_MOVEMENT_ACTIVITY_TIMEOUT_MS = 12_000;
export const COPY_MOVEMENT_ACTIVITY_RECENT_SECONDS = 10 * 60;
export const COPY_MOVEMENT_WINDOW_SECONDS = 10 * 60;
export const COPY_MOVEMENT_MAX_EVENTS_PER_TICK = 3;
export const COPY_MOVEMENT_MIN_STRENGTH = 0.004;
export const COPY_MOVEMENT_MIN_ABS_PRICE_CHANGE = 0.0015;

export const DEFAULT_CONFIG: StrategyConfig = {
  strategy_key: DEFAULT_STRATEGY_KEY,
  starting_cash: DEFAULT_STARTING_CASH,
  buy_fee_rate: DEFAULT_BUY_FEE_RATE,
  sell_fee_rate: DEFAULT_SELL_FEE_RATE,
  max_open_positions: DEFAULT_MAX_OPEN_POSITIONS,
  max_position_fraction: DEFAULT_MAX_POSITION_FRACTION,
  min_cash_reserve_fraction: DEFAULT_MIN_CASH_RESERVE_FRACTION,
};

export const PAPER_BOTS: PaperBotDefinition[] = [
  {
    id: MOMENTUM_ACCOUNT_ID,
    name: "Momentum bot",
    strategy: "momentum",
    ...DEFAULT_CONFIG,
  },
  {
    id: WHALE_FLOW_ACCOUNT_ID,
    name: "Whale Flow bot",
    strategy: "whale-flow",
    strategy_key: WHALE_FLOW_STRATEGY_KEY,
    starting_cash: WHALE_FLOW_STARTING_CASH,
    buy_fee_rate: DEFAULT_BUY_FEE_RATE,
    sell_fee_rate: DEFAULT_SELL_FEE_RATE,
    max_open_positions: DEFAULT_MAX_OPEN_POSITIONS,
    max_position_fraction: DEFAULT_MAX_POSITION_FRACTION,
    min_cash_reserve_fraction: DEFAULT_MIN_CASH_RESERVE_FRACTION,
  },
  {
    id: COPY_MOVEMENT_ACCOUNT_ID,
    name: "MatzStonks copy bot",
    strategy: "copy-movement",
    strategy_key: COPY_MOVEMENT_STRATEGY_KEY,
    starting_cash: WHALE_FLOW_STARTING_CASH,
    buy_fee_rate: DEFAULT_BUY_FEE_RATE,
    sell_fee_rate: DEFAULT_SELL_FEE_RATE,
    max_open_positions: DEFAULT_MAX_OPEN_POSITIONS,
    max_position_fraction: DEFAULT_MAX_POSITION_FRACTION,
    min_cash_reserve_fraction: DEFAULT_MIN_CASH_RESERVE_FRACTION,
  },
];
