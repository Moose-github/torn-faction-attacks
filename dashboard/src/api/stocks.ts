import { getJson, postJson } from "./client";
import { queryString } from "./query";
import type { StockIngestionStatusResponse, StockPaperSimulationResponse, StockPaperStatusResponse, StockSnapshotExportResponse } from "./types";

export async function getStockIngestionStatus(): Promise<StockIngestionStatusResponse> {
  return getJson<StockIngestionStatusResponse>("/api/admin/stocks/ingestion-status", true);
}

export async function getStockPaperStatus(): Promise<StockPaperStatusResponse> {
  return getJson<StockPaperStatusResponse>("/api/admin/stocks/paper/status", true);
}

export async function simulateStockPaperBot(): Promise<StockPaperSimulationResponse> {
  return postJson<StockPaperSimulationResponse>("/api/admin/stocks/paper/simulate");
}

export async function resetStockPaperAccount(options?: {
  botId?: string;
  startingCash?: number;
}): Promise<StockPaperStatusResponse> {
  await postJson("/api/admin/stocks/paper/reset", {
    bot_id: options?.botId,
    starting_cash: options?.startingCash,
  });
  return getStockPaperStatus();
}

export async function exportStockSnapshots(options: {
  startAt: number;
  endAt: number;
  afterAt?: number;
  afterStockId?: number;
  limit?: number;
}): Promise<StockSnapshotExportResponse> {
  const query = queryString({
    start_at: options.startAt,
    end_at: options.endAt,
    limit: options.limit ?? 20_000,
    after_at: options.afterAt,
    after_stock_id: options.afterStockId,
  });
  return getJson<StockSnapshotExportResponse>(`/api/admin/stocks/export-snapshots${query}`, true);
}
