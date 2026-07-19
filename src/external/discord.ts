import { assertExternalResponseOk, fetchExternal, readExternalJson } from "./http";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

export async function postDiscordBotJsonAndRead<T>(
  botToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetchExternal(discordApiUrl(path), {
    method: "POST",
    headers: discordBotJsonHeaders(botToken),
    body: JSON.stringify(body),
  });
  const data = await readExternalJson<T>(response);

  await assertExternalResponseOk(response, "Discord bot", data);
  return data;
}

export async function patchDiscordBotJson(
  botToken: string,
  path: string,
  body: unknown,
): Promise<void> {
  const response = await fetchExternal(discordApiUrl(path), {
    method: "PATCH",
    headers: discordBotJsonHeaders(botToken),
    body: JSON.stringify(body),
  });

  await assertExternalResponseOk(response, "Discord bot");
}

export async function postDiscordBotFormAndRead<T>(
  botToken: string,
  path: string,
  form: FormData,
): Promise<T> {
  const response = await fetchExternal(discordApiUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: form,
  });
  const data = await readExternalJson<T>(response);

  await assertExternalResponseOk(response, "Discord bot", data);
  return data;
}

function discordBotJsonHeaders(botToken: string): Record<string, string> {
  return {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };
}

function discordApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${DISCORD_API_BASE_URL}${normalizedPath}`;
}
