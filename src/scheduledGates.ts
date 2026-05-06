import { Env } from "./types";

export type DailyBatchGateResult = {
  completeStateName: string;
  locked: boolean;
  completed: boolean;
};

export async function claimDailyBatchGate(
  env: Env,
  options: {
    completeStateName: string;
    lockStateName: string;
    now: number;
    lockSeconds?: number;
  },
): Promise<DailyBatchGateResult> {
  const existing = await env.DB.prepare(
    `
    SELECT name
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(options.completeStateName)
    .first();

  if (existing) {
    return {
      completeStateName: options.completeStateName,
      locked: false,
      completed: true,
    };
  }

  const lockSeconds = options.lockSeconds ?? 75;
  const result = await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    WHERE sync_state.last_started < ?
    `,
  )
    .bind(options.lockStateName, options.now, options.now - lockSeconds)
    .run();

  return {
    completeStateName: options.completeStateName,
    locked: Number(result.meta?.changes ?? 0) > 0,
    completed: false,
  };
}
