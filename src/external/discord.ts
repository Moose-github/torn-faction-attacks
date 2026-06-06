import { assertExternalResponseOk, fetchExternal } from "./http";

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

export async function postDiscordForm(webhookUrl: string, form: FormData): Promise<void> {
  const response = await fetchExternal(webhookUrl, {
    method: "POST",
    body: form,
  });

  await assertExternalResponseOk(response, "Discord webhook");
}
