export type DiscordPermissionChannel = {
  id: string; guild_id?: string; name?: string; type?: number; parent_id?: string | null;
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
};
export type DiscordPermissionGuild = { id: string; owner_id: string; roles: Array<{ id: string; permissions: string }> };
export type DiscordPermissionMember = { user?: { id: string }; roles: string[] };

const ADMINISTRATOR = 8n;
const MANAGE_MESSAGES = 8192n;
const bits = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("Invalid permission bits");
  return BigInt(value);
};

// null means the response is incomplete: callers must not assume limited access.
// https://docs.discord.com/developers/topics/permissions#permission-overwrites
export function canDeleteOtherDiscordMessages(guild: DiscordPermissionGuild, member: DiscordPermissionMember,
  channel: DiscordPermissionChannel, botId: string): boolean | null {
  try {
    if (!guild || !member || guild.id !== channel.guild_id || !guild.owner_id || member.user?.id !== botId ||
      !Array.isArray(guild.roles) || !Array.isArray(member.roles) || !member.roles.every(id => typeof id === "string") ||
      !Array.isArray(channel.permission_overwrites) || ![0, 2, 5, 13, 15, 16].includes(channel.type ?? -1)) return null;
    if (guild.owner_id === botId) return true;
    const roleIds = new Set([guild.id, ...member.roles]);
    let permissions = 0n;
    for (const id of roleIds) {
      const roles = guild.roles.filter(role => role.id === id);
      if (roles.length !== 1) return null;
      permissions |= bits(roles[0].permissions);
    }
    if (permissions & ADMINISTRATOR) return true;
    const overwrites = channel.permission_overwrites;
    const seen = new Set<string>();
    for (const overwrite of overwrites) {
      if (typeof overwrite.id !== "string" || ![0, 1].includes(overwrite.type)) return null;
      const key = `${overwrite.type}:${overwrite.id}`;
      if (seen.has(key)) return null;
      seen.add(key);
      bits(overwrite.allow); bits(overwrite.deny);
    }
    const everyone = overwrites.find(overwrite => overwrite.type === 0 && overwrite.id === guild.id);
    if (everyone) permissions = (permissions & ~bits(everyone.deny)) | bits(everyone.allow);
    let allow = 0n, deny = 0n;
    for (const overwrite of overwrites) {
      if (overwrite.type === 0 && overwrite.id !== guild.id && roleIds.has(overwrite.id)) {
        allow |= bits(overwrite.allow); deny |= bits(overwrite.deny);
      }
    }
    permissions = (permissions & ~deny) | allow;
    const individual = overwrites.find(overwrite => overwrite.type === 1 && overwrite.id === botId);
    if (individual) permissions = (permissions & ~bits(individual.deny)) | bits(individual.allow);
    // Do not treat temporary loss of visibility or a timeout as ownership protection.
    return (permissions & MANAGE_MESSAGES) !== 0n;
  } catch { return null; }
}
