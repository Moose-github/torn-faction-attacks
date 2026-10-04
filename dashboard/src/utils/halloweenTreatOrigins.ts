// Rounds 0–5 are individual generations; index 6 holds every later generation.
// Mortal Coil and all of its descendants keep their own origin, at index 7.
export const HALLOWEEN_RETURN_ROUNDS = 7;
const MORTAL_COIL = HALLOWEEN_RETURN_ROUNDS;
const ORIGINS = MORTAL_COIL + 1;
const empty = () => Array<number>(ORIGINS).fill(0);
const direct = [1, ...Array<number>(ORIGINS - 1).fill(0)];

export type HalloweenTreatOrigins = {
  /** Exchanged treats attributed to energy-funded generations, averaged for estimates. */
  energyRounds: number[];
  /** Freebie item rewards originating from supplied energy; excludes Mortal Coil's branch. */
  energyFreebieRewards: number;
  /** Hourly Mortal Coil treats plus all their Cashback/energy-return descendants. */
  mortalCoil: number;
};

function nextRound(shares: readonly number[]) {
  const next = empty();
  for (let i = 0; i < ORIGINS; i++) {
    next[i === MORTAL_COIL ? MORTAL_COIL : Math.min(i + 1, HALLOWEEN_RETURN_ROUNDS - 1)] += shares[i];
  }
  return next;
}

/** Observes completed simulator actions; never rolls RNG or decides when to act.
 * Energy is spent FIFO. An attack sharing energy origins splits its observed drops
 * proportionally. Exchanges split the already-rounded Cashback and accepted Dark
 * Power energy proportionally across the basket's origins. These fractional labels
 * are bookkeeping only: attacks, drops and exchange bonuses remain whole in-game.
 */
export class HalloweenTreatOriginTracker {
  private energy: { amount: number; shares: readonly number[] }[] = [];
  private basket = empty();
  private exchanged = empty();
  private energyFreebieRewards = 0;

  private addEnergy(amount: number, shares: readonly number[]) {
    if (amount > 0) this.energy.push({ amount, shares });
  }

  addDirectEnergy(amount: number) { this.addEnergy(amount, direct); }

  addMortalCoilTreat() { this.basket[MORTAL_COIL]++; }

  recordAttack(droppedTreats: number, revitalizeEnergy: number) {
    let shares: readonly number[];
    const first = this.energy[0];
    if (first && first.amount >= 25) {
      // Almost every attack fits in a single lot; reuse its immutable shares.
      shares = first.shares;
      first.amount -= 25;
      if (first.amount === 0) this.energy.shift();
    } else {
      const spent = empty();
      let remaining = 25;
      while (remaining > 0) {
        const lot = this.energy[0];
        if (!lot) {
          if (remaining > 1e-7) throw new Error("Attack energy is missing its origin.");
          break;
        }
        const amount = Math.min(remaining, lot.amount);
        for (let i = 0; i < ORIGINS; i++) spent[i] += amount * lot.shares[i];
        remaining -= amount;
        lot.amount -= amount;
        if (lot.amount === 0) this.energy.shift();
      }
      const totalSpent = spent.reduce((sum, amount) => sum + amount, 0);
      shares = spent.map(amount => amount / totalSpent);
    }
    for (let i = 0; i < ORIGINS; i++) this.basket[i] += droppedTreats * shares[i];
    if (revitalizeEnergy > 0) this.addEnergy(revitalizeEnergy, nextRound(shares));
  }

  recordExchange(quantity: number, cashback: number, acceptedDarkEnergy: number, freebieRewards = 0) {
    const total = this.basket.reduce((sum, amount) => sum + amount, 0);
    if (Math.abs(total - quantity) > 1e-7) throw new Error("Exchanged treats are missing their origin.");
    if (total === 0) return;
    const shares = this.basket.map(amount => amount / total);
    for (let i = 0; i < ORIGINS; i++) this.exchanged[i] += quantity * shares[i];
    // Attribute the actual rounded bonus for this exchange, not an event-wide 10% estimate.
    for (let i = 0; i < MORTAL_COIL; i++) this.energyFreebieRewards += freebieRewards * shares[i];
    const next = nextRound(shares);
    this.basket = next.map(share => cashback * share);
    this.addEnergy(acceptedDarkEnergy, next);
  }

  result(): HalloweenTreatOrigins {
    return { energyRounds: this.exchanged.slice(0, HALLOWEEN_RETURN_ROUNDS), mortalCoil: this.exchanged[MORTAL_COIL], energyFreebieRewards: this.energyFreebieRewards };
  }
}
