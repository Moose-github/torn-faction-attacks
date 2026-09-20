export type DiscordSubscriptionSetting = {
  subscribable: boolean;
  subscriber_count: number;
};

export type AdminDiscordSubscriptionSettingsResponse = {
  ok: true;
  alerts: Record<string, DiscordSubscriptionSetting>;
};

export type UpdateDiscordSubscriptionSettingResponse = {
  ok: true;
  alert_key: string;
  setting: DiscordSubscriptionSetting;
};
