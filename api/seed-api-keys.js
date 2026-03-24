// api/seed-api-keys.js — Ensure all expected api_key rows exist in DB
// Uses service role to bypass RLS. Called once from Settings when keys are missing.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://qzyxekyrzddoxtdqcnfp.supabase.co",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const ALL_KEY_NAMES = [
  "nexar_client_id", "nexar_client_secret",
  "mouser_api_key", "mouser_order_api_key",
  "digikey_client_id", "digikey_client_secret",
  "arrow_api_key", "arrow_login",
  "notify_email", "supplier_emails", "tariffs_json", "shipping_json",
  "shopify_stores_json", "company_name", "company_address",
  "distributor_names", "supplier_contacts", "supplier_po_names",
  "supplier_order_modes", "anthropic_api_key",
  "twilio_account_sid", "twilio_auth_token", "twilio_phone_number",
  "labor_rate_hourly", "preferred_supplier", "preferred_supplier_margin",
  "ti_api_key", "ti_api_secret",
  "zoho_client_id", "zoho_client_secret", "zoho_refresh_token", "zoho_org_id",
  "zoho_orgs_json",
  "shipstation_api_key", "shipstation_api_secret",
  "fulfillment_goal_direct", "fulfillment_goal_dealer",
  "timezone", "build_goals_json",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // Get existing rows
    const { data: existing, error: fetchErr } = await supabase
      .from("api_keys")
      .select("key_name");
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const existingNames = new Set((existing || []).map(r => r.key_name));
    const missing = ALL_KEY_NAMES.filter(n => !existingNames.has(n));

    if (missing.length === 0) {
      return res.status(200).json({ message: "All key rows exist", inserted: 0 });
    }

    const rows = missing.map(key_name => ({ key_name, key_value: "" }));
    const { error: insertErr } = await supabase.from("api_keys").insert(rows);
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    return res.status(200).json({ message: `Inserted ${missing.length} rows`, inserted: missing.length, keys: missing });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
