import { NextResponse } from "next/server";
import { getRecentWalletEvents, getUserIdFromRequest, getWalletBalanceBaht, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { WalletSnapshot } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({
      authenticated: false,
      backend: "local",
      balanceBaht: 0,
      events: [],
    } satisfies WalletSnapshot);
  }

  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({
      authenticated: false,
      backend: "supabase",
      balanceBaht: 0,
      events: [],
    } satisfies WalletSnapshot, { status: 401 });
  }

  const [balanceBaht, rows] = await Promise.all([
    getWalletBalanceBaht(userId),
    getRecentWalletEvents(userId),
  ]);

  return NextResponse.json({
    authenticated: true,
    backend: "supabase",
    balanceBaht,
    events: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amountBaht: Number(row.amount_baht),
      label: row.label,
      status: row.status,
      createdAt: row.created_at,
    })),
  } satisfies WalletSnapshot);
}
