import { PanelHeader } from "../components/Common";
import { HALLOWEEN_BOOKS, HALLOWEEN_BOOSTERS, type HalloweenResult, type HalloweenSettings } from "../utils/halloweenProfit";
import { formatMoney } from "./BookStrategy.helpers";

const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const money = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const signed = (value: number, currency = false) => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${currency ? formatMoney(Math.abs(rounded)) : count(Math.abs(rounded))}`;
};
const source = (row: HalloweenResult, name: string) => row.sources.find(item => item.name === name);
const energy = (row: HalloweenResult, name: string) => source(row, name)?.energy ?? 0;
const directEnergy = (row: HalloweenResult) => row.sources
  .filter(item => item.name !== "Revitalize returns" && item.name !== "Dark Power returns")
  .reduce((total, item) => total + item.energy, 0);

export function HalloweenStrategyBreakdown({ selected, baseline, noBook, settings }: {
  selected: HalloweenResult; baseline: HalloweenResult; noBook: HalloweenResult; settings: HalloweenSettings;
}) {
  const book = HALLOWEEN_BOOKS.find(item => item.id === selected.book)!;
  const booster = HALLOWEEN_BOOSTERS.find(item => item.id === selected.booster)!;
  const paid = source(selected, booster.name);
  const unboosted = source(noBook, booster.name);
  const usesCans = selected.booster.startsWith("can");
  const normalCap = settings.donor ? 150 : 100;
  const attackDifference = selected.attacks - baseline.attacks;
  const exchangedDifference = selected.exchangedTreats - baseline.exchangedTreats;
  const costDifference = selected.cost - baseline.cost;
  const revenueDifference = selected.revenue - baseline.revenue;
  const profitDifference = selected.profit - baseline.profit;
  const returnedEnergy = energy(selected, "Revitalize returns");
  const suppliedEnergy = directEnergy(selected);
  const suppliedDifference = suppliedEnergy - directEnergy(baseline);
  const basketEnergy = energy(selected, "Dark Power returns");
  const totalEnergy = suppliedEnergy + basketEnergy + returnedEnergy;
  const rate = selected.treatsPerAttack.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return <section className="panel halloween-strategy-breakdown">
    <PanelHeader title="Selected strategy breakdown" aside={`${book.name} · ${booster.name}`} />
    <p className="halloween-note">Strategy differences compare with no book and no paid boosters, using the same weapon and energy settings. Book effects compare with the same boosters without a book.</p>
    {paid && paid.count > 0 ? <p>
      You use <strong>{count(paid.count)} {booster.name}</strong> at <strong>{money(paid.cost / paid.count)} each</strong>, costing <strong>{formatMoney(paid.cost)}</strong>.
      {" "}They supply <strong>{count(paid.energy)}E</strong> directly over the event, including your applicable perks and book effect.
    </p> : <p><strong>No paid boosters are used.</strong>{selected.booster !== "none" && " Your cooldown settings and other booster use leave no room for this booster during the event."}</p>}

    {selected.book !== "none" && <div className="halloween-book-effect">
      <h3>Book effect · {book.name}</h3>
      {selected.book === "higher" && <p>
        This book increases natural energy regeneration by <strong>20%</strong>, providing <strong>{count(energy(selected, "Natural regeneration") - energy(noBook, "Natural regeneration"))}E more</strong> during the event. That energy supports additional attacks without increasing your booster spend.
      </p>}
      {selected.book === "fuel" && (usesCans ? <p>
        This book doubles energy from cans. {paid && unboosted && paid.count > 0 && unboosted.count > 0 ? <>
          Each can provides <strong>{count(paid.energy / paid.count)}E</strong> instead of <strong>{count(unboosted.energy / unboosted.count)}E</strong>, adding <strong>{count(paid.energy - unboosted.energy)}E</strong> across <strong>{count(paid.count)} cans</strong>, for the same can cost.
        </> : "No cans are used with your current settings, so this book adds no energy."}
      </p> : <p>This book provides no additional energy with this strategy because it only affects energy drinks.</p>)}
      {selected.book === "ugly" && <>
        <p>This book raises maximum energy to <strong>250E</strong> from <strong>{normalCap}E</strong>. Each daily refill provides <strong>{250 - normalCap}E more</strong>, adding <strong>{count(energy(selected, "Daily point refills") - energy(noBook, "Daily point refills"))}E</strong> across <strong>{count(source(selected, "Daily point refills")?.count ?? 0)} daily refills</strong>.</p>
        {energy(selected, "Special refills") > 0 && <p>Your special refills also add <strong>{count(energy(selected, "Special refills") - energy(noBook, "Special refills"))}E more</strong> with this book.</p>}
        {selected.booster === "fhc" && <p>Each FHC also provides <strong>250E</strong> instead of <strong>{normalCap}E</strong>, adding another <strong>{count(energy(selected, booster.name) - energy(noBook, booster.name))}E</strong>.</p>}
        {usesCans && <p>Energy per can is unchanged.</p>}
      </>}
      {selected.book === "self" && (usesCans ? <p>
        This book halves energy-drink cooldown, allowing <strong>{count(selected.boosterCount)} cans</strong> instead of <strong>{count(noBook.boosterCount)}</strong>. Those additional cans provide <strong>{count(energy(selected, booster.name) - energy(noBook, booster.name))}E</strong> and cost <strong>{formatMoney((paid?.cost ?? 0) - (unboosted?.cost ?? 0))}</strong>.
      </p> : <p>This book provides no benefit with this strategy because it only reduces energy-drink cooldown.</p>)}
      <p>Compared with <strong>the same boosters without a book</strong>, the book gives <strong>{signed(selected.attacks - noBook.attacks)}</strong> attacks, <strong>{signed(selected.exchangedTreats - noBook.exchangedTreats)}</strong> treats, and <strong>{signed(selected.profit - noBook.profit, true)}</strong> net profit.</p>
    </div>}

    <p className="halloween-energy-summary"><strong>Energy before returns:</strong> This strategy provides <strong>{count(suppliedEnergy)}E</strong> from energy sources such as regeneration, drugs, refills and boosters—<strong>{count(Math.abs(suppliedDifference))}E {suppliedDifference < 0 ? "less" : "more"} than the baseline</strong>.</p>
    <p className="halloween-energy-summary"><strong>Energy returned:</strong> Dark Power provides another <strong>{count(basketEnergy)}E</strong>, including energy from Freebie &amp; Cashback.
      {settings.weapon === "revitalize" && <> Revitalize adds a further <strong>{count(returnedEnergy)}E</strong>.</>}
    </p>
    <p className="halloween-energy-summary"><strong>Total energy and attacks:</strong> Together, this gives <strong>{count(totalEnergy)}E</strong>, supporting approximately <strong>{count(selected.attacks)} attacks</strong>—<strong>{count(Math.abs(attackDifference))} {attackDifference < 0 ? "fewer" : "more"} than the baseline</strong>.</p>
    {settings.weapon === "revitalize" ? <p>
      Your <strong>{count(settings.revitalize)}% Revitalize weapon</strong> earns approximately <strong>{rate} treats per attack</strong>.
    </p> : <p>Your <strong>scary weapon</strong> earns approximately <strong>{rate} treats per attack</strong>.</p>}
    <p>The change in attacks produces <strong>{signed(attackDifference * selected.treatsPerAttack)} treats from attacks</strong> compared with baseline. After basket bonuses and exchanges, the difference is <strong>{signed(exchangedDifference)} treats exchanged</strong>.</p>
    <p>At <strong>{money(settings.treatPrice)} per treat</strong>, this strategy generates <strong>{formatMoney(Math.abs(revenueDifference))} {revenueDifference < 0 ? "less" : "more"} revenue than the baseline</strong>. After subtracting <strong>{formatMoney(costDifference)} in additional costs</strong>, it delivers <strong className={profitDifference >= 0 ? "halloween-positive" : "halloween-negative"}>{formatMoney(Math.abs(profitDifference))} {profitDifference < 0 ? "less" : "more"} net profit than the baseline</strong>.</p>
    <p>Total event net profit: <strong>{formatMoney(selected.profit)}</strong>, from <strong>{formatMoney(selected.revenue)}</strong> in rewards minus <strong>{formatMoney(selected.cost)}</strong> in costs.</p>
  </section>;
}
