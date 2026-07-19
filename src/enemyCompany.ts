import { cleanText, finiteNumber } from "./utils";

export type EnemyCompanySnapshot = {
  company_type: string | null;
  company_rating: number | null;
  company_id: number | null;
};

const TORN_COMPANY_TYPES: Record<number, string> = {
  1: "Hair Salon",
  2: "Law Firm",
  3: "Flower Shop",
  4: "Car Dealership",
  5: "Clothing Store",
  6: "Gun Shop",
  7: "Game Shop",
  8: "Candle Shop",
  9: "Toy Shop",
  10: "Adult Novelties",
  11: "Cyber Cafe",
  12: "Grocery Store",
  13: "Theater",
  14: "Sweet Shop",
  15: "Cruise Line",
  16: "Television Network",
  18: "Zoo",
  19: "Firework Stand",
  20: "Property Broker",
  21: "Furniture Store",
  22: "Gas Station",
  23: "Music Store",
  24: "Nightclub",
  25: "Pub",
  26: "Gents Strip Club",
  27: "Restaurant",
  28: "Oil Rig",
  29: "Fitness Center",
  30: "Mechanic Shop",
  31: "Amusement Park",
  32: "Lingerie Store",
  33: "Meat Warehouse",
  34: "Farm",
  35: "Software Corporation",
  36: "Ladies Strip Club",
  37: "Private Security Firm",
  38: "Mining Corporation",
  39: "Detective Agency",
  40: "Logistics Management",
};

export function emptyEnemyCompanySnapshot(): EnemyCompanySnapshot {
  return {
    company_type: null,
    company_rating: null,
    company_id: null,
  };
}

export function resolveTornCompanyType(typeId: unknown): string | null {
  const id = integerNumber(typeId);
  if (id === null) {
    return null;
  }

  return TORN_COMPANY_TYPES[id] ?? `Type #${id}`;
}

export function parseTornUserJobCompanySnapshot(data: unknown): EnemyCompanySnapshot {
  const job = data && typeof data === "object"
    ? (data as { job?: unknown }).job
    : null;
  if (!job || typeof job !== "object") {
    return emptyEnemyCompanySnapshot();
  }

  const type = cleanText((job as { type?: unknown }).type);
  if (type === "company") {
    return {
      company_type: resolveTornCompanyType((job as { type_id?: unknown }).type_id),
      company_rating: integerNumber((job as { rating?: unknown }).rating),
      company_id: integerNumber((job as { id?: unknown }).id),
    };
  }

  if (type === "job") {
    return {
      company_type: cleanText((job as { name?: unknown }).name),
      company_rating: null,
      company_id: null,
    };
  }

  return emptyEnemyCompanySnapshot();
}

export async function collectEnemyCompanySnapshots<T extends { id: number }>(
  members: T[],
  readSnapshot: (member: T) => Promise<EnemyCompanySnapshot>,
  onError: (member: T, err: unknown) => void = () => {},
): Promise<Map<number, EnemyCompanySnapshot>> {
  const snapshots = new Map<number, EnemyCompanySnapshot>();

  for (const member of members) {
    try {
      snapshots.set(member.id, await readSnapshot(member));
    } catch (err) {
      onError(member, err);
      snapshots.set(member.id, emptyEnemyCompanySnapshot());
    }
  }

  return snapshots;
}

function integerNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}
