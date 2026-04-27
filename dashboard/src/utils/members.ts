import { MemberAttack, MemberStats, WarSummary } from "../api";

export type MemberSortKey =
  | "member_name"
  | "enemy_attacks_successful"
  | "defends_total"
  | "outside_attacks"
  | "enemy_respect_gained"
  | "enemy_assists"
  | "friendly_hospitals";

export type MemberSort = {
  key: MemberSortKey;
  direction: "asc" | "desc";
};

export function displayMember(member: MemberStats): string {
  return member.member_name ?? `#${member.member_id}`;
}

export function sortMembers(members: MemberStats[], sort: MemberSort): MemberStats[] {
  return [...members].sort((a, b) => {
    const direction = sort.direction === "desc" ? -1 : 1;
    const aValue = sortValue(a, sort.key);
    const bValue = sortValue(b, sort.key);

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue) * direction;
    }

    if (aValue < bValue) {
      return -1 * direction;
    }

    if (aValue > bValue) {
      return 1 * direction;
    }

    return (
      b.enemy_attacks_successful - a.enemy_attacks_successful ||
      b.enemy_respect_gained - a.enemy_respect_gained
    );
  });
}

export function sumMembers(members: MemberStats[], key: keyof MemberStats): number {
  return members.reduce((total, member) => {
    const value = member[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

export function warOutcome(war: WarSummary, gained: number, lost: number): string {
  if (war.status === "scheduled") {
    return "Upcoming";
  }

  if (!hasOfficialEnd(war)) {
    return "Ongoing";
  }

  if (war.winner_faction_id === 8803) {
    return "Buttgrass won";
  }

  if (war.faction_id !== null && war.winner_faction_id === war.faction_id) {
    return `${war.name} won`;
  }

  if (war.winner_faction_id !== null) {
    return `Faction #${war.winner_faction_id} won`;
  }

  if (gained === lost) {
    return "Draw";
  }

  return gained > lost ? "Victory" : "Loss";
}

export function hasOfficialEnd(war: WarSummary): boolean {
  return Boolean(war.official_end_time || war.torn_report_end);
}

export function classificationLabel(classification: MemberAttack["classification"]): string {
  switch (classification) {
    case "enemy_success":
      return "Enemy hit";
    case "enemy_assist":
      return "Assist";
    case "outside":
      return "Outside";
    case "defend_lost":
      return "Defend lost";
    case "defend_won":
      return "Defend won";
    case "enemy_attempt":
      return "Attempt";
    default:
      return "Other";
  }
}

export function activityLabel(key: string): string {
  switch (key) {
    case "enemy_success":
      return "Enemy hits";
    case "enemy_assist":
      return "Assists";
    case "outside":
      return "Outside hits";
    case "defend_lost":
      return "Defends lost";
    case "defend_won":
      return "Defends won";
    default:
      return key;
  }
}

function sortValue(member: MemberStats, key: MemberSortKey): string | number {
  if (key === "member_name") {
    return displayMember(member).toLowerCase();
  }

  return Number(member[key] ?? 0);
}
