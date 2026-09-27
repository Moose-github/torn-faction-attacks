import type { ArmoryBorrower as Borrower } from "../../../shared/armory";
import { activityElapsed } from "../utils/armory";

export function ArmoryBorrower({ borrower }: { borrower: Borrower }) {
  const activity = borrower.activity;
  const lastAction = activityElapsed(activity?.last_action_timestamp);
  const hasActivity = !!activity?.last_action_status || lastAction !== null;
  const dataAge = hasActivity ? activityElapsed(activity?.fetched_at) : null;
  return <div className="armory-borrower-availability">
    <a href={`https://www.torn.com/profiles.php?XID=${borrower.id}`} target="_blank" rel="noreferrer">{borrower.name}</a>
    <small>{activity?.last_action_status || "Unknown"} - last action {lastAction ? `${lastAction} ago` : "unknown"}</small>
    <small>Data age: {dataAge ? `${dataAge} old` : "unknown"}</small>
  </div>;
}
