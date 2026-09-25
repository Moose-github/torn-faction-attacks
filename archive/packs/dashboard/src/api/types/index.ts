export type PackRewardRarity = "standard" | "select" | "elite" | "legendary";

export type AdminPackReward = {
  id: string;
  torn_item_id: number;
  name: string;
  image_url: string;
  image_url_large: string;
  rarity: PackRewardRarity;
  weight: number;
  enabled: boolean;
  display_order: number;
};

export type AdminPackDefinition = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rewards: AdminPackReward[];
};

export type AdminPacksResponse = {
  ok: true;
  packs: AdminPackDefinition[];
};
