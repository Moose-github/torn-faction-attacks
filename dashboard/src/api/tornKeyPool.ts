import { deleteJson, getJson, postJson, putJson } from "./client";

export type TornKeyPoolFeature =
  | "arrest_scout"
  | "hospital_monitor"
  | "enemy_scouting"
  | "faction_lifestyle_stats"
  | "faction_contributor_stats"
  | "war_live_data"
  | "stock_tools"
  | "misc_utilities"
  | "experimental_features";

export type TornKeyPoolFeatureOption = {
  key: TornKeyPoolFeature;
  label: string;
  required_access: "public" | "faction";
};

export type TornKeyMetadata = {
  id: string;
  label: string | null;
  submitted_by_torn_user_id: number | null;
  owner_torn_user_id: number | null;
  owner_name: string | null;
  access_level: number | null;
  access_type: string | null;
  faction_access: boolean;
  status: string;
  allowed_features: TornKeyPoolFeature[];
  max_requests_per_minute: number | null;
  last_validated_at: number | null;
  last_used_at: number | null;
  last_used_feature: string | null;
  monitor_last_used_at: number | null;
  paused_until: number | null;
  failure_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type TornKeyPreviewMetadata = {
  key_name: string | null;
  owner_torn_user_id: number;
  owner_name: string | null;
  access_level: number | null;
  access_type: string | null;
  faction_access: boolean;
  duplicate: boolean;
};

export type MyTornKeyPoolResponse = {
  ok: boolean;
  features: TornKeyPoolFeatureOption[];
  default_allowed_features: TornKeyPoolFeature[];
  keys: TornKeyMetadata[];
};

export type AdminTornKeyPoolResponse = {
  ok: boolean;
  features: TornKeyPoolFeatureOption[];
  keys: TornKeyMetadata[];
};

export type TornKeyUpdatePayload = {
  status?: "active" | "disabled";
  allowed_features?: TornKeyPoolFeature[];
  max_requests_per_minute?: number;
  submitted_by_name?: string | null;
};

export async function getMyTornKeyPool(): Promise<MyTornKeyPoolResponse> {
  return getJson<MyTornKeyPoolResponse>("/api/me/torn-key-pool/keys");
}

export async function submitMyTornKeyPoolKey(payload: TornKeyUpdatePayload & { key: string }): Promise<{ ok: boolean; key: TornKeyMetadata }> {
  return postJson<{ ok: boolean; key: TornKeyMetadata }>("/api/me/torn-key-pool/keys", payload);
}

export async function previewMyTornKeyPoolKey(key: string): Promise<{ ok: boolean; key: TornKeyPreviewMetadata }> {
  return postJson<{ ok: boolean; key: TornKeyPreviewMetadata }>("/api/me/torn-key-pool/keys/preview", { key });
}

export async function updateMyTornKeyPoolKey(keyId: string, payload: TornKeyUpdatePayload): Promise<{ ok: boolean; key: TornKeyMetadata }> {
  return putJson<{ ok: boolean; key: TornKeyMetadata }>(`/api/me/torn-key-pool/keys/${encodeURIComponent(keyId)}`, payload);
}

export async function deleteMyTornKeyPoolKey(keyId: string): Promise<{ ok: boolean; key: TornKeyMetadata }> {
  return deleteJson<{ ok: boolean; key: TornKeyMetadata }>(`/api/me/torn-key-pool/keys/${encodeURIComponent(keyId)}`);
}

export async function getAdminTornKeyPool(): Promise<AdminTornKeyPoolResponse> {
  return getJson<AdminTornKeyPoolResponse>("/api/admin/torn-key-pool/keys", true);
}
