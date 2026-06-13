import { assertExternalResponseOk, fetchExternal, readExternalJson } from "./http";

export async function postDiscordJson(webhookUrl: string, body: unknown): Promise<void> {
  const response = await fetchExternal(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  await assertExternalResponseOk(response, "Discord webhook");
}

export async function postDiscordJsonAndRead<T>(webhookUrl: string, body: unknown): Promise<T> {
  const response = await fetchExternal(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await readExternalJson<T>(response);

  await assertExternalResponseOk(response, "Discord webhook", data);
  return data;
}

export async function patchDiscordJson(webhookUrl: string, body: unknown): Promise<void> {
  const response = await fetchExternal(webhookUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  await assertExternalResponseOk(response, "Discord webhook");
}

export async function postDiscordForm(webhookUrl: string, form: FormData): Promise<void> {
  const response = await fetchExternal(webhookUrl, {
    method: "POST",
    body: form,
  });

  await assertExternalResponseOk(response, "Discord webhook");
}
