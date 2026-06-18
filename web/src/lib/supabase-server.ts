import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { roundBaht } from "@/lib/pricing";

export type LedgerType = "topup" | "reserve" | "capture" | "refund" | "manual_adjust";

export type WalletLedgerRow = {
  id: string;
  user_id: string;
  job_id: string | null;
  type: LedgerType;
  amount_baht: number;
  label: string;
  provider: string | null;
  reference: string | null;
  status: string;
  created_at: string;
};

let adminClient: SupabaseClient | null = null;

export function hasSupabaseAdminConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!hasSupabaseAdminConfig()) return null;
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false } },
    );
  }
  return adminClient;
}

export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  await admin
    .from("profiles")
    .upsert({
      id: data.user.id,
      email: data.user.email ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  return data.user.id;
}

export async function getWalletBalanceBaht(userId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) return 0;
  const { data, error } = await admin
    .from("wallet_ledger")
    .select("amount_baht,status")
    .eq("user_id", userId);

  if (error || !data) return 0;
  return roundBaht(data
    .filter((row) => row.status === "posted" || row.status === "reserved")
    .reduce((sum, row) => sum + Number(row.amount_baht || 0), 0));
}

export async function getRecentWalletEvents(userId: string, limit = 8): Promise<WalletLedgerRow[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("wallet_ledger")
    .select("id,user_id,job_id,type,amount_baht,label,provider,reference,status,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as WalletLedgerRow[];
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return !error && data?.role === "admin";
}
