export type DiscordAlertSubscriber = {
  torn_user_id: number;
  name: string;
};

export type DiscordSubscriptionSetting = {
  subscribable: boolean;
  subscriber_count: number;
  subscribers: DiscordAlertSubscriber[];
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
