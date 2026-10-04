"use server";

import { redirect } from "next/navigation";
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from "../../../lib/supabase";

export async function masterSignInAction(formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    redirect("/entrar/master?erro=dados-invalidos");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    redirect("/entrar/master?erro=credenciais-invalidas");
  }

  const admin = createAdminSupabaseClient();
  const { data: master } = await admin
    .from("system_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!master) {
    await supabase.auth.signOut();
    redirect("/entrar/master?erro=nao-e-master");
  }

  redirect("/");
}
