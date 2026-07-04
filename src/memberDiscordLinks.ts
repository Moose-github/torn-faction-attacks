import { TORN_USER_API_BASE_URL } from "./constants";
import { fetchTrackedTornJson } from "./external/torn";
import { withTornKeyPool } from "./tornKeyPool";
import { Env } from "./types";
import { d1Changes, json } from "./utils";

const DISCORD_LINK_FETCH_TIMEOUT_MS = 10_000;

type HomeMemberRow = {
  member_id: number;
  name: string;
};

type TornDiscordResponse = {
  discord?: {
    userID?: unknown;
    discordID?: unknown;
  };
};

export type DiscordLinkSyncMetrics = {
  fetched: number;
  linked: number;
  skipped: number;
  failed: number;
  changedRows: number;
};

type DiscordLink = {
  tornUserId: number;
  discordUserId: string;
};

export async function syncMemberDiscordLinksFromRequest(env: Env): Promise<Response> {
  const result = await syncMemberDiscordLinks(env);
  return json({ ok: true, ...result });
}

export async function syncMemberDiscordLinks(env: Env): Promise<DiscordLinkSyncMetrics> {
  const members = await readCurrentHomeMembers(env);
  const links: DiscordLink[] = [];
  let skipped = 0;
  let failed = 0;

  for (const member of members) {
    try {
      const link = normalizeDiscordLink(await fetchMemberDiscordLink(env, member.member_id), member.member_id);
      if (link) {
        links.push(link);
      } else {
        skipped += 1;
      }
    } catch (err: any) {
      failed += 1;
      console.warn(`Unable to sync Discord ID for Torn member ${member.member_id}:`, err?.message || err);
    }
  }

  const changedRows = await upsertMemberDiscordLinks(env, links);

  return {
    fetched: members.length,
    linked: links.length,
    skipped,
    failed,
    changedRows,
  };
}

async function readCurrentHomeMembers(env: Env): Promise<HomeMemberRow[]> {
  const result = await env.DB.prepare(
    `
    SELECT member_id, name
    FROM home_faction_members
    WHERE is_current = 1
    ORDER BY member_id ASC
    `,
  ).all<HomeMemberRow>();

  return result.results ?? [];
}

async function fetchMemberDiscordLink(env: Env, tornUserId: number): Promise<TornDiscordResponse> {
  const url = new URL(`${TORN_USER_API_BASE_URL}/${tornUserId}`);
  url.searchParams.set("selections", "discord");

  return withTornKeyPool(env, {
    feature: "misc_utilities",
    run: ({ key, keySource }) => {
      url.searchParams.set("key", key);
      return fetchTrackedTornJson<TornDiscordResponse>(
        env,
        url,
        { headers: { Accept: "application/json" } },
        {
          feature: "discord-links",
          keySource,
          timeoutMs: DISCORD_LINK_FETCH_TIMEOUT_MS,
        },
        { service: "Torn Discord lookup" },
      );
    },
  });
}

export function normalizeDiscordLink(data: TornDiscordResponse, expectedTornUserId: number): DiscordLink | null {
  const tornUserId = Number(data.discord?.userID);
  const discordUserId = typeof data.discord?.discordID === "string"
    ? data.discord.discordID.trim()
    : "";

  if (
    !Number.isInteger(tornUserId) ||
    tornUserId <= 0 ||
    tornUserId !== expectedTornUserId ||
    !/^\d{5,32}$/.test(discordUserId)
  ) {
    return null;
  }

  return { tornUserId, discordUserId };
}

async function upsertMemberDiscordLinks(env: Env, links: DiscordLink[]): Promise<number> {
  if (links.length === 0) {
    return 0;
  }

  const results = await env.DB.batch(
    links.map((link) =>
      env.DB.prepare(
        `
        INSERT INTO discord_member_links (torn_user_id, discord_user_id)
        VALUES (?, ?)
        ON CONFLICT(torn_user_id) DO UPDATE SET
          discord_user_id = excluded.discord_user_id
        WHERE discord_member_links.discord_user_id IS NOT excluded.discord_user_id
        `,
      ).bind(link.tornUserId, link.discordUserId)
    ),
  );

  return results.reduce((total: number, result: unknown) => total + d1Changes(result), 0);
}
