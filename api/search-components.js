// ============================================================
// api/search-components.js — Component Search via Mouser API
//
// Searches Mouser for real manufacturer part numbers matching
// a query string (MPN prefix, series name, etc.)
// Falls back to Nexar if Mouser key not provided.
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { q, mouserKey, token, limit } = req.query;
  if (!q) return res.status(400).json({ error: "q (search query) is required" });

  const maxResults = Math.min(parseInt(limit) || 100, 200);

  // Try Mouser first (free, no monthly part limit)
  if (mouserKey) {
    try {
      const mouserRes = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(mouserKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SearchByKeywordRequest: {
            keyword: q,
            records: maxResults,
            startingRecord: 0,
            searchOptions: "",
            searchWithYourSignUpLanguage: "",
          },
        }),
      });

      if (!mouserRes.ok) {
        const err = await mouserRes.text();
        console.error("[search-components] Mouser error:", err.slice(0, 500));
        return res.status(mouserRes.status).json({ error: `Mouser API error: ${mouserRes.status}` });
      }

      const data = await mouserRes.json();
      const parts = data?.SearchResults?.Parts || [];

      const results = parts.slice(0, maxResults).map(p => ({
        mpn: p.ManufacturerPartNumber || "",
        manufacturer: p.Manufacturer || "",
        description: p.Description || "",
        category: p.Category || "",
        datasheetUrl: p.DataSheetUrl || null,
        mouserPN: p.MouserPartNumber || "",
        stock: parseInt(String(p.Availability || "0").replace(/[^0-9]/g, "")) || 0,
        price: (() => {
          const breaks = p.PriceBreaks || [];
          if (breaks.length === 0) return null;
          return parseFloat(String(breaks[0].Price || "0").replace(/[^0-9.]/g, "")) || null;
        })(),
        reelQty: (() => {
          const breaks = p.PriceBreaks || [];
          if (breaks.length === 0) return null;
          const last = breaks[breaks.length - 1];
          return parseInt(last.Quantity) || null;
        })(),
        specs: {},
      }));

      return res.status(200).json({ results, count: results.length, source: "mouser" });
    } catch (err) {
      console.error("[search-components] Mouser error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Fallback to Nexar
  if (token) {
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
        return res.status(response.status).json({ error: `Nexar API error: ${response.status}` });
      }

      const data = await response.json();
      if (data.errors) return res.status(400).json({ error: data.errors[0]?.message || "Nexar error" });

      const results = (data?.data?.supSearchMpn?.results || []).map(r => ({
        mpn: r.part.mpn || "",
        manufacturer: r.part.manufacturer?.name || "",
        description: r.part.shortDescription || "",
        category: r.part.category?.name || "",
        datasheetUrl: r.part.bestDatasheet?.url || null,
        specs: (r.part.specs || []).reduce((acc, s) => {
          if (s.attribute?.name && s.displayValue) acc[s.attribute.name] = s.displayValue;
          return acc;
        }, {}),
      }));

      return res.status(200).json({ results, count: results.length, source: "nexar" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Provide mouserKey or token" });
}
