// Vercel Serverless Function — Shopify Products Proxy
// Fetches product list for mapping BOM products to Shopify products
// Accepts ?domain=xxx&token=xxx query params

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const domain = req.query.domain;
    const token = req.query.token;

    if (!domain || !token) {
      return res.status(400).json({ error: "Missing domain or token query params" });
    }

    const shopRes = await fetch(
      `https://${domain}/admin/api/2024-01/products.json?fields=id,title,variants,status&limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    if (!shopRes.ok) {
      const errText = await shopRes.text().catch(() => "");
      return res.status(shopRes.status).json({
        error: `Shopify API error: ${shopRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const data = await shopRes.json();
    const products = (data.products || []).map(p => ({
      id: String(p.id),
      title: p.title,
      status: p.status,
      variants: (p.variants || []).map(v => ({
        id: String(v.id),
        title: v.title,
      })),
    }));

    return res.status(200).json({ products });
  } catch (e) {
    console.error("shopify-products error:", e);
    return res.status(500).json({ error: e.message });
  }
}
