import type { ChainWatchLiveResponse } from "../../../shared/chainWatchLive";

export function chainWatchLiveDisplay(data: ChainWatchLiveResponse | null, now: number, failed: boolean) {
  const state = data?.state;
  const remaining = state?.timeout_at == null ? null : Math.max(0, state.timeout_at - now);
  const checkedAge = state?.last_checked_at == null ? null : Math.max(0, now - state.last_checked_at);
  let status = "Loading";
  let tone = "quiet";
  let detail = "Loading live chain monitoring…";
  let countdown = "—";
  if (failed) {
    status = data ? "Updates unavailable" : "Unavailable";
    tone = "warning";
    detail = "Live updates are temporarily unavailable. Sign-ups are still available.";
  } else if (data && !data.demand.active) {
    status = "Stopped";
    detail = "Monitoring starts when a scheduled watch begins or an enabled war is active.";
  } else if (data && (!data.computed.active || !state || checkedAge === null)) {
    status = "Starting";
    detail = "Waiting for the monitor's first update.";
  } else if (data && state) {
    if (state.last_error || state.source === "stale" || (checkedAge !== null && checkedAge > 120)) {
      status = "Stale data";
      tone = "warning";
      detail = "Chain data may be delayed. Waiting for a fresh update before showing the countdown.";
    } else if (state.drop_sent_at !== null || (state.source === "dropped" && Number(state.current_chain) > 0)) {
      status = "Dropped";
      tone = "critical";
      detail = "The monitor reports a dropped chain. The watch remains active.";
    } else if (!state.current_chain || state.source === "dropped") {
      status = "Waiting for chain";
      detail = "Monitoring is active. Waiting for a new faction chain.";
    } else if (remaining === 0) {
      status = "Awaiting update";
      tone = "warning";
      detail = "The last reported timer has expired. Waiting for the monitor to confirm the chain's status.";
      countdown = "Checking…";
    } else {
      status = data.computed.alert_eligible && remaining !== null && remaining <= 30 ? "Critical"
        : data.computed.alert_eligible && remaining !== null && remaining <= 60 ? "Warning" : "Watching";
      tone = status === "Critical" ? "critical" : status === "Warning" ? "warning" : "live";
      detail = data.computed.alert_eligible ? "Warnings at 60 and 30 seconds remaining."
        : "Warnings begin when the chain is above 100.";
      countdown = remaining === null ? "Unknown" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    }
  }
  return { status, tone, detail, countdown, checkedAge,
    current: status === "Watching" || status === "Warning" || status === "Critical" };
}
