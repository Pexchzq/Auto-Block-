import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  console.error("Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
const now = new Date().toISOString();

const { data: expiredRows, error: selectError } = await supabase
  .from("job_inputs")
  .select("job_id")
  .neq("status", "deleted")
  .lt("expires_at", now);

if (selectError) {
  console.error(selectError.message);
  process.exit(1);
}

const expiredJobIds = (expiredRows || []).map((row) => row.job_id);
if (expiredJobIds.length === 0) {
  console.log("No expired job inputs to clean.");
  process.exit(0);
}

const { error: updateError } = await supabase
  .from("job_inputs")
  .update({
    account_text: "",
    status: "deleted",
  })
  .in("job_id", expiredJobIds);

if (updateError) {
  console.error(updateError.message);
  process.exit(1);
}

await supabase.from("audit_logs").insert({
  actor_user_id: null,
  action: "system_cleanup_expired_job_inputs",
  target_type: "job_inputs",
  target_id: null,
  metadata: { cleaned: expiredJobIds.length },
});

console.log(`Cleaned ${expiredJobIds.length} expired job input(s).`);
