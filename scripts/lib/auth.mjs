// Local lead account provisioning against a running local Supabase.

import { setTimeout as sleep } from "node:timers/promises";
import { LOCAL_LEAD } from "./stack.mjs";

async function listUsers(apiUrl, headers) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!response.ok) throw new Error(`Could not list local auth users (${response.status}): ${await response.text()}`);
  return (await response.json()).users ?? [];
}

/** Creates (if missing) and activates lead@local.test. Retries while the API warms up. */
export async function ensureLocalLead(apiUrl, serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  let users;
  for (let attempt = 1; ; attempt++) {
    try {
      users = await listUsers(apiUrl, headers);
      break;
    } catch (error) {
      if (attempt >= 30) throw new Error(`Supabase API at ${apiUrl} never became reachable: ${error.cause?.code ?? error.message}`);
      await sleep(1000);
    }
  }

  let user = users.find((candidate) => candidate.email === LOCAL_LEAD.email);
  if (!user) {
    const created = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...LOCAL_LEAD, email_confirm: true, user_metadata: { name: "Local Lead" } }),
    });
    if (!created.ok) throw new Error(`Could not create the local lead: ${await created.text()}`);
    user = await created.json();
  }

  const profile = await fetch(`${apiUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ membership_status: "active", role: "lead" }),
  });
  if (!profile.ok) throw new Error(`Could not activate the local lead: ${await profile.text()}`);
}

/** True if the lead can actually sign in with the documented password. */
export async function canLogin(apiUrl, anonKey) {
  try {
    const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(LOCAL_LEAD),
    });
    return response.ok;
  } catch {
    return false;
  }
}
