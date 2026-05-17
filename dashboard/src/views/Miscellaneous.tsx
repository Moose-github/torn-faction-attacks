import React from "react";
import { getMiscellaneousData, MiscellaneousResponse } from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatRelativeTime } from "../utils/format";

export function Miscellaneous() {
  const [data, setData] = React.useState<MiscellaneousResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getMiscellaneousData();
        if (!cancelled) {
          setData(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = shopliftingRows(data?.shoplifting ?? {});
  const fetchedAt = data?.fetched_at ?? null;

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Miscellaneous</p>
          <h2>Miscellaneous</h2>
          <p>Cached Torn shoplifting information from the five-minute refresh.</p>
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Shoplifting"
          aside={isLoading ? "Loading" : fetchedAt ? `Updated ${formatRelativeTime(fetchedAt)}` : "No data"}
        />
        {data?.error ? <p className="form-error">{data.error}</p> : null}
        {fetchedAt ? (
          <p className="panel-description">Last fetched {formatLongDateTime(fetchedAt)}.</p>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState text={isLoading ? "Loading shoplifting data" : "No shoplifting data cached yet"} />
        ) : (
          <div className="table-scroll">
            <table className="shoplifting-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Obstacle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.shopKey}>
                    <td>{formatShopName(row.shopKey)}</td>
                    <td>
                      <div className="shoplifting-obstacle-stack">
                        {row.obstacles.map((obstacle) => (
                          <span key={obstacle.title}>{obstacle.title}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="shoplifting-obstacle-stack">
                        {row.obstacles.map((obstacle) => (
                          <span
                            className={obstacle.disabled ? "shoplifting-status disabled" : "shoplifting-status active"}
                            key={obstacle.title}
                          >
                            {obstacle.disabled ? "Disabled" : "Active"}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function shopliftingRows(shoplifting: MiscellaneousResponse["shoplifting"]): Array<{
  shopKey: string;
  obstacles: Array<{
    title: string;
    disabled: boolean;
  }>;
}> {
  return Object.entries(shoplifting).map(([shopKey, obstacles]) => ({
    shopKey,
    obstacles,
  }));
}

function formatShopName(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\btc\b/i, "TC")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
