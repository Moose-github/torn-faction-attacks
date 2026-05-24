import { WarPayoutCalculator } from "./Miscellaneous";

export function WarPayouts() {
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
        <WarPayoutCalculator />
      </section>
    </>
  );
}
