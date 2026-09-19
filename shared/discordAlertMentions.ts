export type DiscordAlertMentionSetting = {
  role_ids: string[];
  everyone: boolean;
  here: boolean;
};

export type DiscordMentionRole = { id: string; name: string };

export type AdminDiscordAlertMentionsResponse = {
  ok: true;
  alerts: Record<string, DiscordAlertMentionSetting>;
  roles: DiscordMentionRole[];
  roles_error: string | null;
};

export type UpdateDiscordAlertMentionsResponse = {
  ok: true;
  alert_key: string;
  mentions: DiscordAlertMentionSetting;
};
