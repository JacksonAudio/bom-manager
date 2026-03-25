// ============================================================
// api/backup.js — Daily database backup to GitHub
//
// Triggered by Vercel cron (daily) or manually via GET request.
// Exports all Supabase tables to JSON and commits to the
// 'backups' branch of the GitHub repo.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY — Supabase connection
//   GITHUB_TOKEN — GitHub PAT with repo write access
// ============================================================

import { createClient } from "@supabase/supabase-js";

const GITHUB_OWNER = "JacksonAudio";
const GITHUB_REPO = "bom-manager";
const GITHUB_BRANCH = "backups";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars" });
  }
  if (!githubToken) {
    return res.status(500).json({ error: "Missing GITHUB_TOKEN env var. Create a GitHub PAT at github.com/settings/tokens with 'repo' scope and add it to Vercel env vars." });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");

    // Export all tables
    const tables = [
      "parts", "products", "api_keys", "team_members",
      "build_orders", "build_assignments", "price_history",
      "bom_snapshots", "po_history", "scrap_log", "demand_cache",
    ];

    const backup = {
      exportedAt: now.toISOString(),
      exportedBy: "automated-daily-backup",
      tables: {},
    };

    for (const table of tables) {
      try {
        const { data, error } = await supabase.from(table).select("*");
        if (error) {
          backup.tables[table] = { error: error.message, count: 0 };
        } else {
          backup.tables[table] = { count: (data || []).length, rows: data || [] };
        }
      } catch (e) {
        backup.tables[table] = { error: e.message, count: 0 };
      }
    }

    // Summary stats
    const totalParts = backup.tables.parts?.count || 0;
    const totalProducts = backup.tables.products?.count || 0;
    const totalOrders = backup.tables.po_history?.count || 0;

    // Commit to GitHub
    const filePath = `backups/${dateStr}/bom-backup-${dateStr}-${timeStr}.json`;
    const content = Buffer.from(JSON.stringify(backup, null, 2)).toString("base64");
    const commitMessage = `Daily backup ${dateStr} — ${totalParts} parts, ${totalProducts} products, ${totalOrders} POs`;

    // Ensure branch exists
    const branchExists = await ensureBranch(githubToken);

    // Create or update file via GitHub Contents API
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: commitMessage,
          content,
          branch: GITHUB_BRANCH,
        }),
      }
    );

    if (!ghRes.ok) {
      const errBody = await ghRes.text().catch(() => "");
      return res.status(ghRes.status).json({
        error: `GitHub API error: ${ghRes.status}`,
        detail: errBody.slice(0, 500),
        hint: branchExists ? "Check GITHUB_TOKEN permissions" : "Could not create 'backups' branch",
      });
    }

    const ghData = await ghRes.json();

    return res.status(200).json({
      success: true,
      file: filePath,
      commit: ghData.commit?.sha?.slice(0, 7),
      url: ghData.content?.html_url,
      stats: { parts: totalParts, products: totalProducts, orders: totalOrders },
      tables: Object.fromEntries(Object.entries(backup.tables).map(([k, v]) => [k, v.count])),
    });
  } catch (e) {
    console.error("[backup] Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// Ensure the 'backups' branch exists; create from main/master if not
async function ensureBranch(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
  };

  // Check if branch exists
  const checkRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
    { headers }
  );
  if (checkRes.ok) return true;

  // Get the SHA of the default branch
  const mainRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/master`,
    { headers }
  );
  if (!mainRes.ok) return false;
  const mainData = await mainRes.json();
  const sha = mainData.object?.sha;
  if (!sha) return false;

  // Create the branch
  const createRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${GITHUB_BRANCH}`, sha }),
    }
  );
  return createRes.ok;
}
