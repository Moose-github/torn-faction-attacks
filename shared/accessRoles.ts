// Independent assignments, with no implied hierarchy or additional permissions.
// Keep Discord snowflakes as strings to avoid losing precision.
export const ACCESS_ROLES = {
  event_organizer: { label: "Event organizer", discordRoleId: "889777697268576276" },
  officer: { label: "Officer", discordRoleId: "1551674982701076621" },
} as const;

export type AccessRole = keyof typeof ACCESS_ROLES;

export function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACCESS_ROLES, value);
}

export function accessRolesFromDiscord(roleIds: string[]): AccessRole[] {
  return (Object.keys(ACCESS_ROLES) as AccessRole[])
    .filter(role => roleIds.includes(ACCESS_ROLES[role].discordRoleId));
}
