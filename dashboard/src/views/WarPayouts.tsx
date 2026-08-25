import { WarPayoutCalculator } from "./Miscellaneous";
import type { WarSummary } from "../api";

export function WarPayouts({
  isLoadingWars,
  wars,
}: {
  isLoadingWars: boolean;
  wars: WarSummary[];
}) {
  return (
    <>
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>
            War payouts
            <span
              className="data-wip-badge"
              title="War payouts is still being shaped and should be treated as work in progress."
            >
              WIP
            </span>
          </h2>
          <p>Build payout splits from recorded war member stats.</p>
        </div>
      </section>

      <section className="panel table-panel payout-calculator-panel">
        <WarPayoutCalculator initialWars={wars} isLoadingInitialWars={isLoadingWars} />
      </section>
    </>
  );
}
