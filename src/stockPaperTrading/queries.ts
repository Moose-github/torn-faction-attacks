import type { Env } from "../types";
import type {
  CopyMovementEvent,
  EquitySnapshot,
  MarketPoint,
  MarketStock,
  PaperAccount,
  PaperPosition,
  PaperTrade,
  SimulationRun,
} from "./model";

export type PaperPositionWithMarket = PaperPosition & {
  acronym: string | null;
  name: string | null;
  latest_price: number | null;
  market_value: number;
  unrealized_pnl: number;
};

export type PaperTradeWithProfile = PaperTrade & {
  acronym: string | null;
  name: string | null;
};

export async function readLivePaperAccount(env: Env, accountId: string): Promise<PaperAccount | null> {
  return await env.DB.prepare("SELECT * FROM stock_paper_accounts WHERE id = ?")
    .bind(accountId)
    .first<PaperAccount>();
}

export async function readAccountPositions(env: Env, accountId: string): Promise<PaperPosition[]> {
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

export async function readAccountPositionsWithMarket(
  env: Env,
  accountId: string,
): Promise<PaperPositionWithMarket[]> {
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

export async function readLatestAccountEquity(env: Env, accountId: string): Promise<EquitySnapshot | null> {
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

export async function readRecentPaperTrades(
  env: Env,
  accountId: string | null,
  simulationRunId: string | null,
  limit: number,
): Promise<PaperTradeWithProfile[]> {
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
    .all<PaperTradeWithProfile>();

  return rows.results ?? [];
}

export async function readRecentCopyMovementEvents(
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

export async function readLatestSimulationRun(env: Env): Promise<SimulationRun | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM stock_paper_simulation_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<SimulationRun>();
}

export async function readMarketStocks(env: Env, startAt: number, endAt: number): Promise<MarketStock[]> {
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

export async function readMarketStocksForDecision(env: Env, observedAt: number): Promise<MarketStock[]> {
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

export async function readNewestStockSnapshotAt(env: Env): Promise<number | null> {
  const row = await env.DB.prepare("SELECT MAX(observed_at) AS observed_at FROM stock_price_snapshots")
    .first<{ observed_at: number | null }>();
  return row?.observed_at === null || row?.observed_at === undefined ? null : Number(row.observed_at);
}

export async function readOldestStockSnapshotAt(env: Env): Promise<number | null> {
  const row = await env.DB.prepare("SELECT MIN(observed_at) AS observed_at FROM stock_price_snapshots")
    .first<{ observed_at: number | null }>();
  return row?.observed_at === null || row?.observed_at === undefined ? null : Number(row.observed_at);
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
