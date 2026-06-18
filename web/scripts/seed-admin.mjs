import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL || "admin@blockmesh.local";
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceRole || !password) {
  console.error("Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD");
  process.exit(1);
}

const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error && !String(error.message).toLowerCase().includes("already")) {
  console.error(error.message);
  process.exit(1);
}

let userId = data.user?.id;
if (!userId) {
  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error(listError.message);
    process.exit(1);
  }
  userId = users.users.find((user) => user.email === email)?.id;
}

if (!userId) {
  console.error("Admin user not found after create/list.");
  process.exit(1);
}

const { error: profileError } = await supabase
  .from("profiles")
  .upsert({ id: userId, email, role: "admin", updated_at: new Date().toISOString() }, { onConflict: "id" });

if (profileError) {
  console.error(profileError.message);
  process.exit(1);
}

console.log(`Admin ready: ${email}`);
