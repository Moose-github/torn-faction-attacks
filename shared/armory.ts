export type ArmoryCategory = "weapons" | "armor";
export type ArmoryInventoryCategory = ArmoryCategory | "medical";
export type ArmoryBorrowerActivity = {
  last_action_status: string | null; last_action_timestamp: number | null; fetched_at: number | null;
};
export type ArmoryBorrower = { id: number; name: string; activity?: ArmoryBorrowerActivity | null };
export type ArmoryStack = {
  id: number; name: string; type: string; amount: number;
  loaned: ArmoryBorrower | null;
};
export type ArmoryBonus = { id: number; title: string; description: string; value: number };
export type ArmoryDetails = {
  uid: string; id: number; name: string; type: string; sub_type: string | null;
  stats: { damage: number | null; accuracy: number | null; armor: number | null; quality: number };
  bonuses: ArmoryBonus[]; rarity: string | null;
};
export type ArmoryCopy = {
  uid: string; id: number; name: string; type: string;
  loaned: ArmoryBorrower | null;
  loan_first_seen_at: number | null;
  details: ArmoryDetails | null;
};
export type ArmoryResponse = {
  ok: true; items: ArmoryCopy[];
  inventory_timestamp: number | null; checked_at: number | null;
  next_inventory_at: number; next_sync_at: number; syncing: boolean;
  pending: number; refreshing: number; error: string | null;
};
export type ArmoryStockSetting = { name: string; threshold: number; enabled: boolean };
export type ArmoryMedicalResponse = Omit<ArmoryResponse, "items"> & {
  items: ArmoryStack[]; stock_settings: Record<string, ArmoryStockSetting>;
};
export function weaponClass(item: ArmoryCopy): "standard" | "special" | "pending" {
  if (!item.details) return "pending";
  // Ordinary weapons can have built-in bonuses; rarity determines their class.
  return item.details.rarity === null ? "standard" : "special";
}
