import type { PersonalStatsCoverageGap } from "../api/types";

export function groupPersonalStatsIssues(gaps: PersonalStatsCoverageGap[]) {
  const members = new Map<number, PersonalStatsCoverageGap & { missing_dates: string[] }>();
  for (const gap of [...gaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))) {
    const member = members.get(gap.member_id);
    if (member) {
      if (!member.missing_dates.includes(gap.snapshot_date)) member.missing_dates.push(gap.snapshot_date);
    } else {
      members.set(gap.member_id, { ...gap, missing_dates: [gap.snapshot_date] });
    }
  }
  return [...members.values()];
}
