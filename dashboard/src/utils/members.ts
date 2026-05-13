import { MemberAttack, MemberStats, WarSummary } from "../api";

export type MemberSortKey =
  | "member_name"
  | "attacks_vs_enemy_successful"
  | "defends_total"
  | "defends_lost"
  | "defends_lost_non_hospitalized"
  | "outside_hits"
  | "respect_gained"
  | "respect_lost"
  | "respect_lost_non_hospitalized"
  | "respect_lost_raw"
  | "assists_vs_enemy"
  | "retaliations_vs_enemy"
  | "friendly_hosps"
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
      b.attacks_vs_enemy_successful - a.attacks_vs_enemy_successful ||
      b.respect_gained - a.respect_gained
    );
  });
}

export function sumMembers(members: MemberStats[], key: keyof MemberStats): number {
  return members.reduce((total, member) => {
    const value = member[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

export function memberDefendsLost(member: MemberStats): number {
  return Math.max(0, member.defends_total - member.defends_won - Number(member.defends_other ?? 0));
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
    case "defend_other":
      return "Defend other";
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
    case "defend_other":
      return "Other defends";
    default:
      return key;
  }
}

export function memberSortLabel(key: MemberSortKey): string {
  switch (key) {
    case "member_name":
      return "Attacks";
    case "attacks_vs_enemy_successful":
      return "Attacks";
    case "defends_total":
      return "Defends";
    case "defends_lost":
      return "Defends lost";
    case "defends_lost_non_hospitalized":
      return "Non-hosp defends lost";
    case "outside_hits":
      return "Outside hits";
    case "respect_gained":
      return "Respect gained";
    case "respect_lost":
      return "Respect lost";
    case "respect_lost_non_hospitalized":
      return "Non-hosp respect lost";
    case "respect_lost_raw":
      return "Respect lost raw";
    case "assists_vs_enemy":
      return "Assists";
    case "friendly_hosps":
      return "Friendly hosps";
    case "retaliations_vs_enemy":
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

  if (key === "defends_lost") {
    return memberDefendsLost(member);
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
