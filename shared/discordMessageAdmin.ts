export type DiscordMessagePreview = {
  ok: true;
  message_link: string;
  message_id: string;
  channel_name: string;
  author_name: string;
  timestamp: string | null;
  content: string;
  embeds: Array<{ title: string; description: string; fields: Array<{ name: string; value: string }>; footer: string }>;
  attachments: string[];
};

export type DiscordMessageDeleteResult = { ok: true; already_deleted: boolean };
