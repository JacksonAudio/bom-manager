// ============================================================
// api/digikey-cart.js — DigiKey Cart URL Builder
//
// DigiKey does not have a public "add to cart" API without OAuth2,
// but they support a URL-based cart scheme:
//   https://www.digikey.com/ordering/shoppingcart?newproducts=PART1|QTY1,PART2|QTY2
//
// This serverless function builds the cart URL and can be extended
// to support DigiKey's OAuth2 API flow in the future.
// ============================================================

export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body;
    // items: [{ partNumber: "DK-PART-123", quantity: 10 }, ...]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    // Build DigiKey cart URL
    // Format: PART1|QTY1,PART2|QTY2
    const productStr = items
      .map(i => `${encodeURIComponent(i.partNumber)}|${i.quantity}`)
      .join(",");

    const cartUrl = `https://www.digikey.com/ordering/shoppingcart?newproducts=${productStr}`;

    // Also build individual search URLs for fallback
    const searchUrls = items.map(i => ({
      partNumber: i.partNumber,
      quantity: i.quantity,
      searchUrl: `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(i.partNumber)}`,
    }));

    return res.status(200).json({
      success: true,
      cartUrl,
      itemCount: items.length,
      totalQuantity: items.reduce((s, i) => s + (i.quantity || 0), 0),
      searchUrls,
      note: "Open cartUrl in browser to add all parts to DigiKey shopping cart",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
