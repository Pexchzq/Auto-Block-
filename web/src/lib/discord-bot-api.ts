import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const DISCORD_ID_PATTERN = /^\d{5,30}$/;

export function verifyBotToken(request: Request): boolean {
  const expected = process.env.BOT_API_TOKEN || "";
  const auth = request.headers.get("authorization") || "";
  const actual = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function normalizeDiscordUserId(value: unknown): string {
  const discordUserId = String(value || "").trim();
  if (!DISCORD_ID_PATTERN.test(discordUserId)) {
    throw new Error("Invalid Discord user id");
  }
  return discordUserId;
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 100) break;
  }
  return null;
}

export async function resolveDiscordProfile(discordUserIdInput: unknown): Promise<{
  discordUserId: string;
  profileId: string;
}> {
  const discordUserId = normalizeDiscordUserId(discordUserIdInput);
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Supabase admin client unavailable");

  const { data: existing, error: readError } = await admin
    .from("discord_identities")
    .select("profile_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.profile_id) return { discordUserId, profileId: existing.profile_id };

  const email = `discord+${discordUserId}@blockmesh.local`;
  const password = `${randomBytes(36).toString("base64url")}Aa1!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "discord", discord_user_id: discordUserId },
  });

  let profileId = created.user?.id || null;
  if (createError) {
    const { data: raced } = await admin
      .from("discord_identities")
      .select("profile_id")
      .eq("discord_user_id", discordUserId)
      .maybeSingle();
    profileId = raced?.profile_id || await findAuthUserByEmail(admin, email);
  }
  if (!profileId) throw createError || new Error("Discord shadow profile create failed");

  const { error: profileError } = await admin.from("profiles").upsert({
    id: profileId,
    email,
    role: "user",
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const { error: mappingError } = await admin.from("discord_identities").upsert({
    discord_user_id: discordUserId,
    profile_id: profileId,
  }, { onConflict: "discord_user_id" });
  if (mappingError) throw mappingError;

  return { discordUserId, profileId };
}

export async function getDiscordProfileId(discordUserIdInput: unknown): Promise<string | null> {
  const discordUserId = normalizeDiscordUserId(discordUserIdInput);
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("discord_identities")
    .select("profile_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.profile_id || null;
}
