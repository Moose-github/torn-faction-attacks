export type ChainWatchLiveResponse = {
  ok: true;
  now: number;
  faction_id: number;
  state: {
    faction_id: number;
    enabled: number;
    source: "stored" | "live_confirm" | "stale" | "dropped";
    current_chain: number | null;
    timeout_at: number | null;
    last_hit_at: number | null;
    last_hit_attacker_name: string | null;
    last_hit_defender_name: string | null;
    drop_sent_at: number | null;
    last_checked_at: number | null;
    last_error: string | null;
  } | null;
  demand: { active: boolean; watch_id: string | null; war_id: number | null };
  computed: { active: boolean; alert_eligible: boolean; remaining_seconds: number | null; dropped: boolean };
};
