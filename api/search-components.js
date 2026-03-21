// ============================================================
// api/search-components.js — Nexar/Octopart Component Search
//
// Searches Nexar for real manufacturer part numbers matching
// a query string (MPN prefix, series name, etc.)
// ============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { q, token, limit } = req.query;

  if (!q) return res.status(400).json({ error: "q (search query) is required" });
  if (!token) return res.status(400).json({ error: "token (Nexar access token) is required" });

  const maxResults = Math.min(parseInt(limit) || 100, 200);

  const query = `query SearchParts($q: String!, $limit: Int!) {
  supSearchMpn(q: $q, limit: $limit) {
    results {
      part {
        mpn
        manufacturer { name }
        shortDescription
        category { name }
        bestDatasheet { url }
        specs { attribute { name } displayValue }
      }
    }
  }
}`;

  try {
    const response = await fetch("https://api.nexar.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: { q, limit: maxResults } }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[search-components] Nexar error:", errText.slice(0, 500));
      return res.status(response.status).json({ error: `Nexar API error: ${response.status}` });
    }

    const data = await response.json();

    if (data.errors) {
      return res.status(400).json({ error: data.errors[0]?.message || "Nexar GraphQL error" });
    }

    const results = (data?.data?.supSearchMpn?.results || []).map(r => {
      const part = r.part;
      return {
        mpn: part.mpn || "",
        manufacturer: part.manufacturer?.name || "",
        description: part.shortDescription || "",
        category: part.category?.name || "",
        datasheetUrl: part.bestDatasheet?.url || null,
        specs: (part.specs || []).reduce((acc, s) => {
          if (s.attribute?.name && s.displayValue) acc[s.attribute.name] = s.displayValue;
          return acc;
        }, {}),
      };
    });

    return res.status(200).json({ results, count: results.length });
  } catch (err) {
    console.error("[search-components] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
