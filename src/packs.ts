import { Env } from "./types";
import { json } from "./utils";

type PackRow = {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
  pack_enabled: number;
  reward_id: string;
  torn_item_id: number;
  item_name: string | null;
  image_url: string | null;
  image_url_large: string | null;
  rarity: string;
  weight: number;
  reward_enabled: number;
  display_order: number;
};

type PackRewardResponse = {
  id: string;
  torn_item_id: number;
  name: string;
  image_url: string;
  image_url_large: string;
  rarity: string;
  weight: number;
  enabled: boolean;
  display_order: number;
};

type PackResponse = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rewards: PackRewardResponse[];
};

export async function listPacks(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT
      p.id AS pack_id,
      p.name AS pack_name,
      p.description AS pack_description,
      p.enabled AS pack_enabled,
      r.id AS reward_id,
      r.torn_item_id,
      COALESCE(i.name, 'Item ' || r.torn_item_id) AS item_name,
      i.image_url,
      i.image_url_large,
      r.rarity,
      r.weight,
      r.enabled AS reward_enabled,
      r.display_order
    FROM pack_definitions p
    JOIN pack_reward_entries r
      ON r.pack_id = p.id
    JOIN torn_items i
      ON i.torn_item_id = r.torn_item_id
    WHERE p.enabled = 1
      AND r.enabled = 1
    ORDER BY p.created_at ASC, p.id ASC, r.display_order ASC, r.torn_item_id ASC
    `,
  ).all<PackRow>();

  const packsById = new Map<string, PackResponse>();
  for (const row of rows.results ?? []) {
    const pack = packsById.get(row.pack_id) ?? {
      id: row.pack_id,
      name: row.pack_name,
      description: row.pack_description,
      enabled: Boolean(row.pack_enabled),
      rewards: [],
    };

    pack.rewards.push({
      id: row.reward_id,
      torn_item_id: Number(row.torn_item_id),
      name: row.item_name ?? `Item ${row.torn_item_id}`,
      image_url: row.image_url ?? tornItemImageUrl(row.torn_item_id, "medium"),
      image_url_large: row.image_url_large ?? tornItemImageUrl(row.torn_item_id, "large"),
      rarity: row.rarity,
      weight: Number(row.weight),
      enabled: Boolean(row.reward_enabled),
      display_order: Number(row.display_order),
    });

    packsById.set(row.pack_id, pack);
  }

  return json({
    ok: true,
    packs: Array.from(packsById.values()),
  });
}

function tornItemImageUrl(itemId: number, size: "medium" | "large"): string {
  return `https://www.torn.com/images/items/${itemId}/${size}@2x.png`;
}
