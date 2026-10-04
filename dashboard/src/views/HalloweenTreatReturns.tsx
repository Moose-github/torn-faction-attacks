import { useState } from "react";

// Fixed teaching example: Nightmarish, scary weapon/clothing, all return upgrades,
// no Mortal Coil or Revitalize. The simulator's selected-strategy results stay separate.
const INITIAL_TREATS = 1.72224;
const CASHBACK = 0.1;
const DARK_POWER_TREATS = 5.5 / 25 * INITIAL_TREATS;
const RETURN_RATIO = CASHBACK + DARK_POWER_TREATS;
const TOTAL_TREATS = INITIAL_TREATS / (1 - RETURN_RATIO);
const format = (value: number, digits = 5) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const names = ["Original attack", "First returns", "Second returns", "Third returns", "Fourth returns", "All later returns"];
const rounds = (() => {
  const regions: { x: number; y: number; width: number; height: number; treats: number }[] = [];
  let x = 0, width = 1, height = 1;
  for (let index = 0; index < 5; index++) {
    if (index % 2 === 0) {
      const slice = width * (1 - RETURN_RATIO);
      regions.push({ x, y: 0, width: slice, height, treats: INITIAL_TREATS * RETURN_RATIO ** index });
      x += slice; width -= slice;
    } else {
      const slice = height * (1 - RETURN_RATIO);
      regions.push({ x, y: height - slice, width, height: slice, treats: INITIAL_TREATS * RETURN_RATIO ** index });
      height -= slice;
    }
  }
  regions.push({ x, y: 0, width, height, treats: TOTAL_TREATS * RETURN_RATIO ** 5 });
  return regions;
})();

export function HalloweenTreatReturns() {
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const detail = activeRound === null
    ? "Every new batch generates another, smaller batch. All the blocks together form the final total."
    : activeRound === 0
      ? `Original 25E → one attack → ${format(INITIAL_TREATS)} treats.`
      : activeRound < 5
        ? `${format(rounds[activeRound - 1].treats)} × ${format(RETURN_RATIO * 100)}% = ${format(rounds[activeRound].treats)} more treats.`
        : `All further rounds together add ${format(rounds[5].treats)} treats.`;

  return <section className="halloween-distribution-card halloween-treat-returns" aria-label="How 25E keeps producing treats">
    <div className="halloween-return-explanation">
      <h3>How 25E keeps producing treats</h3>
      <p className="halloween-return-example">Simplified geometric-series example</p>
      <p>Your original <strong>25E</strong> funds one attack, earning <strong>{format(INITIAL_TREATS)} treats</strong> on average. Exchanging those treats gives Cashback and Dark Power energy, which funds more attacks.</p>
      <p>Each treat exchanged generates another <strong>{format(RETURN_RATIO, 7)} treats</strong>: <strong>{format(CASHBACK)}</strong> from Cashback and <strong>{format(DARK_POWER_TREATS, 7)}</strong> from attacks funded by Dark Power, including Freebie’s energy bonus.</p>
      <p>Those new treats generate returns too. Each new round is <strong>{format(RETURN_RATIO * 100)}%</strong> of the previous round.</p>
      <dl className="halloween-return-rounds">{rounds.map((round, index) => <div key={names[index]} className={activeRound === index ? "active" : undefined}>
        <dt>{names[index]}</dt><dd>{index > 0 && "+"}{format(round.treats)}</dd>
      </div>)}</dl>
      <p className="halloween-return-total">≈<strong>{format(TOTAL_TREATS, 3)} treats exchanged</strong> per original 25E supplied</p>
      <p className="halloween-return-assumptions">Fixed example: Nightmarish basket, scary clothing and scary weapon; Dark Power, Freebie and Cashback enabled. No Mortal Coil or Revitalize. Ignores batch rounding, energy caps and the event cutoff. Freebie’s bonus item rewards are separate from treats exchanged.</p>
    </div>
    <figure className="halloween-return-figure">
      <figcaption>Whole square: <strong>≈{format(TOTAL_TREATS, 3)} treats exchanged</strong></figcaption>
      <div className="halloween-return-square" role="group" aria-label="Shrinking rounds of treats from the original 25 energy">
        {rounds.map((round, index) => <button key={names[index]} type="button"
          className={`halloween-return-region halloween-return-region-${index}${activeRound === index ? " active" : ""}`}
          style={{ left: `${round.x * 100}%`, top: `${round.y * 100}%`, width: `${round.width * 100}%`, height: `${round.height * 100}%` }}
          aria-label={`${names[index]}: ${format(round.treats)} treats per original 25E`}
          onMouseEnter={() => setActiveRound(index)} onMouseLeave={() => setActiveRound(null)}
          onFocus={() => setActiveRound(index)} onBlur={() => setActiveRound(null)} onClick={() => setActiveRound(index)}>
          <span className="halloween-return-amount">{index > 0 && "+"}{format(round.treats, 3)}</span>
          {index < 2 && <span className="halloween-return-label">{names[index]}</span>}
          {index >= 4 && <span className="halloween-return-short" aria-hidden="true">{index === 5 ? "…" : "4"}</span>}
        </button>)}
      </div>
      <p className="halloween-return-detail" aria-live="polite">{detail}</p>
    </figure>
  </section>;
}
