export type ArmoryBonus = { id: number; title: string; description: string; value: number };
export type ArmoryDetails = {
  uid: string; id: number; name: string; type: string; sub_type: string | null;
  stats: { damage: number; accuracy: number; quality: number };
  bonuses: ArmoryBonus[]; rarity: string | null;
};
export type ArmoryCopy = {
  uid: string; id: number; name: string; type: string;
  loaned: { id: number; name: string } | null;
  loan_first_seen_at: number | null;
  details: ArmoryDetails | null;
};
export type ArmoryResponse = {
  ok: true; items: ArmoryCopy[];
  inventory_timestamp: number | null; checked_at: number | null;
  next_inventory_at: number; next_sync_at: number; syncing: boolean;
  pending: number; refreshing: number; error: string | null;
};
export function weaponClass(item: ArmoryCopy): "standard" | "special" | "pending" {
  if (!item.details) return "pending";
  // Ordinary weapons can have built-in bonuses; rarity determines their class.
  return item.details.rarity === null ? "standard" : "special";
}
