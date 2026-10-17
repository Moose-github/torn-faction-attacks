import { parseWarPayoutPresetConfig, parseWarPayoutPresetName, type WarPayoutPreset } from "../../shared/warPayoutPresets";
import { readAuthenticatedUserId } from "../auth";
import { json, nowSeconds } from "../utils";
import { withAdmin, type RouteContext, type RouteResult } from "./context";

type PresetRow = Omit<WarPayoutPreset, "config"> & { config_json: string };
function preset(row: PresetRow): WarPayoutPreset {
  const { config_json, ...metadata } = row;
  return { ...metadata, config: parseWarPayoutPresetConfig(JSON.parse(config_json)) };
}

export async function routeWarPayoutPresetApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url } = context;
  const base = "/api/war-payout-presets";
  const item = url.pathname.match(/^\/api\/war-payout-presets\/([a-zA-Z0-9-]+)$/);
  if (url.pathname !== base && !item) return null;
  return withAdmin(context, async () => {
    try {
      const id = item?.[1];
      if (request.method === "GET") {
        if (id) {
          const row = await env.DB.prepare("SELECT * FROM war_payout_presets WHERE id = ?").bind(id).first<PresetRow>();
          return row ? json({ ok: true, preset: preset(row) }) : json({ ok: false, error: "Preset no longer exists." }, 404);
        }
        const rows = await env.DB.prepare("SELECT * FROM war_payout_presets ORDER BY name COLLATE NOCASE, id").all<PresetRow>();
        return json({ ok: true, presets: rows.results.map(preset) });
      }
      if ((!id && request.method !== "POST") || (id && request.method !== "PUT" && request.method !== "DELETE")) {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }
      const actorId = await readAuthenticatedUserId(request, env);
      if (!actorId) return json({ ok: false, error: "Sign in to manage payout presets." }, 401);

      let name = "";
      let configJson = "";
      try {
        if (request.method !== "DELETE") {
          const text = await request.text();
          if (text.length > 64000) return json({ ok: false, error: "Preset is too large." }, 413);
          const parsed: unknown = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid preset request.");
          const body = parsed as Record<string, unknown>;
          name = parseWarPayoutPresetName(body.name);
          configJson = JSON.stringify(parseWarPayoutPresetConfig(body.config));
        }
      } catch (error) {
        return json({ ok: false, error: error instanceof SyntaxError ? "Invalid JSON request." : (error as Error).message }, 400);
      }

      const now = nowSeconds();
      if (!id) {
        const row = await env.DB.prepare(`INSERT INTO war_payout_presets
          (id, name, config_json, revision, created_at, updated_at, created_by, updated_by)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?) RETURNING *`)
          .bind(crypto.randomUUID(), name, configJson, now, now, actorId, actorId).first<PresetRow>();
        return json({ ok: true, preset: preset(row!) }, 201);
      }
      const row = request.method === "DELETE"
        ? await env.DB.prepare("DELETE FROM war_payout_presets WHERE id = ? RETURNING *").bind(id).first<PresetRow>()
        : await env.DB.prepare(`UPDATE war_payout_presets SET name = ?, config_json = ?, revision = revision + 1,
            updated_at = ?, updated_by = ? WHERE id = ? RETURNING *`)
          .bind(name, configJson, now, actorId, id).first<PresetRow>();
      if (!row) {
        return json({ ok: false, error: "Preset no longer exists." }, 404);
      }
      return request.method === "DELETE" ? json({ ok: true }) : json({ ok: true, preset: preset(row) });
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed: war_payout_presets.name")) {
        return json({ ok: false, error: "A preset with this name already exists. Choose another name or update that preset." }, 409);
      }
      console.error("War payout presets API failed", error);
      return json({ ok: false, error: "Payout presets are unavailable. Please try again." }, 500);
    }
  });
}
