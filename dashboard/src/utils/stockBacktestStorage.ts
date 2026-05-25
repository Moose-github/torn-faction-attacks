import { StockSnapshotExportRow } from "../api";

export type StockBacktestCacheMeta = {
  oldest_observed_at: number | null;
  newest_observed_at: number | null;
  snapshot_count: number;
  updated_at: number | null;
};

const DB_NAME = "torn-stock-backtesting";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const META_STORE = "meta";
const META_KEY = "cache";

export async function saveStockSnapshotsToCache(snapshots: StockSnapshotExportRow[]): Promise<StockBacktestCacheMeta> {
  if (snapshots.length === 0) {
    return getStockBacktestCacheMeta();
  }

  const db = await openStockBacktestDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOT_STORE], "readwrite");
    const store = tx.objectStore(SNAPSHOT_STORE);
    snapshots.forEach((snapshot) => store.put(snapshot));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to write stock snapshots"));
  });

  return refreshStockBacktestCacheMeta();
}

export async function getStockBacktestCacheMeta(): Promise<StockBacktestCacheMeta> {
  const db = await openStockBacktestDb();
  const meta = await new Promise<StockBacktestCacheMeta | undefined>((resolve, reject) => {
    const request = db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(META_KEY);
    request.onsuccess = () => resolve(request.result as StockBacktestCacheMeta | undefined);
    request.onerror = () => reject(request.error ?? new Error("Unable to read stock cache metadata"));
  });

  return meta ?? {
    oldest_observed_at: null,
    newest_observed_at: null,
    snapshot_count: 0,
    updated_at: null,
  };
}

export async function readCachedStockSnapshots(startAt: number, endAt: number): Promise<StockSnapshotExportRow[]> {
  const db = await openStockBacktestDb();
  return new Promise((resolve, reject) => {
    const snapshots: StockSnapshotExportRow[] = [];
    const tx = db.transaction(SNAPSHOT_STORE, "readonly");
    const index = tx.objectStore(SNAPSHOT_STORE).index("observed_at");
    const request = index.openCursor(IDBKeyRange.bound(startAt, endAt));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(snapshots);
        return;
      }
      snapshots.push(cursor.value as StockSnapshotExportRow);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to read cached stock snapshots"));
  });
}

export async function clearStockBacktestCache(): Promise<StockBacktestCacheMeta> {
  const db = await openStockBacktestDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOT_STORE, META_STORE], "readwrite");
    tx.objectStore(SNAPSHOT_STORE).clear();
    tx.objectStore(META_STORE).delete(META_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to clear stock backtest cache"));
  });
  return getStockBacktestCacheMeta();
}

async function refreshStockBacktestCacheMeta(): Promise<StockBacktestCacheMeta> {
  const db = await openStockBacktestDb();
  const meta = await new Promise<StockBacktestCacheMeta>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOT_STORE, META_STORE], "readwrite");
    const store = tx.objectStore(SNAPSHOT_STORE);
    const index = store.index("observed_at");
    let oldest: number | null = null;
    let newest: number | null = null;
    let count = 0;

    const oldestRequest = index.openCursor();
    oldestRequest.onsuccess = () => {
      oldest = Number(oldestRequest.result?.key ?? null) || null;
    };

    const newestRequest = index.openCursor(null, "prev");
    newestRequest.onsuccess = () => {
      newest = Number(newestRequest.result?.key ?? null) || null;
    };

    const countRequest = store.count();
    countRequest.onsuccess = () => {
      count = Number(countRequest.result ?? 0);
    };

    tx.oncomplete = () => {
      const nextMeta: StockBacktestCacheMeta = {
        oldest_observed_at: oldest,
        newest_observed_at: newest,
        snapshot_count: count,
        updated_at: Math.floor(Date.now() / 1000),
      };
      const writeTx = db.transaction(META_STORE, "readwrite");
      writeTx.objectStore(META_STORE).put({ key: META_KEY, ...nextMeta });
      writeTx.oncomplete = () => resolve(nextMeta);
      writeTx.onerror = () => reject(writeTx.error ?? new Error("Unable to write stock cache metadata"));
    };
    tx.onerror = () => reject(tx.error ?? new Error("Unable to refresh stock cache metadata"));
  });

  return meta;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openStockBacktestDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: ["stock_id", "observed_at"] });
        store.createIndex("observed_at", "observed_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open stock backtest cache"));
  });
  return dbPromise;
}
