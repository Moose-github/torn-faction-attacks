import { MemberAttack, MemberStats, WarSummary } from "../api";

export type MemberSortKey =
  | "member_name"
  | "enemy_attacks_successful"
  | "defends_total"
  | "outside_attacks"
  | "enemy_respect_gained"
  | "enemy_assists"
  | "enemy_retaliations"
  | "friendly_hospitals"
  | "average_fair_fight"
  | "member_respect_limit_percent";

export type MemberSort = {
  key: MemberSortKey;
  direction: "asc" | "desc";
};

export type SortDirection = "asc" | "desc";

export type MemberAttackSortKey =
  | "started"
  | "classification"
  | "attacker_name"
  | "defender_name"
  | "defender_faction_id"
  | "result"
  | "respect_gain";

export type MemberAttackSort = {
  key: MemberAttackSortKey;
  direction: SortDirection;
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

export function sortMemberAttacks(
  attacks: MemberAttack[],
  sort: MemberAttackSort,
): MemberAttack[] {
  return [...attacks].sort((a, b) => {
    const direction = sort.direction === "desc" ? -1 : 1;
    const aValue = attackSortValue(a, sort.key);
    const bValue = attackSortValue(b, sort.key);

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue) * direction;
    }

    if (aValue < bValue) {
      return -1 * direction;
    }

    if (aValue > bValue) {
      return 1 * direction;
    }

    return (Number(b.started ?? 0) - Number(a.started ?? 0)) || b.id - a.id;
  });
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

  if (war.enemy_faction_id !== null && war.winner_faction_id === war.enemy_faction_id) {
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

export function displayWarStatus(war: WarSummary): string {
  if (war.status === "scheduled") {
    return "upcoming";
  }

  if (!hasOfficialEnd(war)) {
    return "ongoing";
  }

  return war.status;
}

function hasOfficialEnd(war: WarSummary): boolean {
  return Boolean(war.official_end_time);
}

export function classificationLabel(classification: MemberAttack["classification"]): string {
  switch (classification) {
    case "enemy_success":
      return "Enemy hit";
    case "enemy_assist":
      return "Assist";
    case "retaliation":
      return "Retaliation";
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

export function memberSortLabel(key: MemberSortKey): string {
  switch (key) {
    case "member_name":
      return "Attacks";
    case "enemy_attacks_successful":
      return "Attacks";
    case "defends_total":
      return "Defends";
    case "outside_attacks":
      return "Outside hits";
    case "enemy_respect_gained":
      return "Respect gained";
    case "enemy_assists":
      return "Assists";
    case "friendly_hospitals":
      return "Friendly hosps";
    case "enemy_retaliations":
      return "Retaliations";
    case "average_fair_fight":
      return "Average fair fight";
    case "member_respect_limit_percent":
      return "Percent limit";
    default:
      return "Value";
  }
}

function sortValue(member: MemberStats, key: MemberSortKey): string | number {
  if (key === "member_name") {
    return displayMember(member).toLowerCase();
  }

  return Number(member[key] ?? 0);
}

function attackSortValue(
  attack: MemberAttack,
  key: MemberAttackSortKey,
): string | number {
  switch (key) {
    case "started":
      return Number(attack.started ?? 0);
    case "classification":
      return classificationLabel(attack.classification).toLowerCase();
    case "attacker_name":
      return (attack.attacker_name ?? `#${attack.attacker_id ?? ""}`).toLowerCase();
    case "defender_name":
      return (attack.defender_name ?? `#${attack.defender_id ?? ""}`).toLowerCase();
    case "defender_faction_id":
      return Number(attack.defender_faction_id ?? 0);
    case "result":
      return (attack.result ?? "").toLowerCase();
    case "respect_gain":
      return Number(attack.respect_gain ?? 0);
    default:
      return 0;
  }
}
