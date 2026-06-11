import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type BracketRow = {
  id: number;
  user_id: string;
  display_name: string;
};

async function userIdForEmail(supabase: SupabaseClient, email: string) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 100) return null;
    page += 1;
  }
  return null;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const target = String(formData.get("target") ?? "").trim();
  const providedSecret = String(formData.get("adminSecret") ?? "").trim();
  const configuredSecret = process.env.ADMIN_ACTION_SECRET || process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const redirect = (message: string) =>
    NextResponse.redirect(new URL(`/admin?unlock=${encodeURIComponent(message)}`, request.url), 303);

  if (!configuredSecret) {
    return redirect("Set ADMIN_ACTION_SECRET in Vercel/local env before using unlock controls.");
  }
  if (providedSecret !== configuredSecret) {
    return redirect("Wrong admin secret.");
  }
  if (!url || !serviceKey) {
    return redirect("Set SUPABASE_SERVICE_ROLE_KEY before using unlock controls.");
  }
  if (!target) {
    return redirect("Enter the person's email or exact display name.");
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let match: BracketRow | null = null;
    if (target.includes("@")) {
      const userId = await userIdForEmail(supabase, target);
      if (!userId) return redirect(`No Supabase user found for ${target}.`);
      const { data, error } = await supabase.from("brackets").select("id, user_id, display_name").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      match = data as BracketRow | null;
    } else {
      const { data, error } = await supabase.from("brackets").select("id, user_id, display_name").eq("display_name", target);
      if (error) throw error;
      const rows = (data ?? []) as BracketRow[];
      if (rows.length > 1) return redirect(`Multiple entries named ${target}. Use their email instead.`);
      match = rows[0] ?? null;
    }

    if (!match) return redirect(`No submitted bracket found for ${target}.`);

    const { error } = await supabase.from("brackets").delete().eq("id", match.id);
    if (error) throw error;

    return redirect(`Unlocked ${match.display_name}. They can reload, sign in, and submit again.`);
  } catch (caught) {
    return redirect(caught instanceof Error ? caught.message : "Unlock failed.");
  }
}
