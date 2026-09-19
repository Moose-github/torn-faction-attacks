export type DiscordRouteDestination = {
  id: string;
  name: string;
  kind: "channel" | "thread";
  parent_name: string | null;
};

export type DiscordRouteDestinationsResponse = {
  ok: true;
  destinations: DiscordRouteDestination[];
  threads_error: string | null;
};
