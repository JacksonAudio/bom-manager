// Vercel Serverless Function — Fetch Facebook/Meta ad spend per campaign
// Uses the Marketing API to pull cost data and map to products

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { access_token, ad_account_id, days } = req.query;
  if (!access_token || !ad_account_id) {
    return res.status(400).json({ error: "Missing access_token or ad_account_id" });
  }

  const lookback = parseInt(days) || 90;
  const since = new Date();
  since.setDate(since.getDate() - lookback);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = new Date().toISOString().slice(0, 10);

  try {
    // Fetch campaign-level insights with spend, impressions, purchases, cost per purchase
    const url = `https://graph.facebook.com/v19.0/${ad_account_id}/insights?` +
      `fields=campaign_name,spend,impressions,clicks,actions,cost_per_action_type,cpc,cpm,ctr` +
      `&time_range={"since":"${sinceStr}","until":"${untilStr}"}` +
      `&level=campaign` +
      `&limit=500` +
      `&access_token=${encodeURIComponent(access_token)}`;

    const fbRes = await fetch(url);
    if (!fbRes.ok) {
      const err = await fbRes.text();
      console.error("Facebook API error:", fbRes.status, err);
      return res.status(502).json({ error: `Facebook API error: ${fbRes.status}`, details: err.substring(0, 500) });
    }

    const data = await fbRes.json();
    const campaigns = (data.data || []).map(row => {
      const spend = parseFloat(row.spend) || 0;
      const impressions = parseInt(row.impressions) || 0;
      const clicks = parseInt(row.clicks) || 0;
      // Extract purchases from actions array
      const purchaseAction = (row.actions || []).find(a =>
        a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase"
      );
      const purchases = purchaseAction ? parseInt(purchaseAction.value) || 0 : 0;
      // Cost per purchase
      const costPerPurchaseAction = (row.cost_per_action_type || []).find(a =>
        a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase"
      );
      const costPerPurchase = costPerPurchaseAction ? parseFloat(costPerPurchaseAction.value) || 0 : (purchases > 0 ? spend / purchases : 0);

      return {
        campaignName: row.campaign_name,
        spend,
        impressions,
        clicks,
        purchases,
        costPerPurchase,
        cpc: parseFloat(row.cpc) || 0,
        ctr: parseFloat(row.ctr) || 0,
        roas: purchases > 0 ? (purchases * costPerPurchase > 0 ? spend / (purchases * costPerPurchase) : 0) : 0,
      };
    });

    // Aggregate totals
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);
    const avgCostPerPurchase = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);

    return res.status(200).json({
      campaigns,
      summary: {
        totalSpend,
        totalPurchases,
        avgCostPerPurchase,
        totalClicks,
        totalImpressions,
        avgCPC: totalClicks > 0 ? totalSpend / totalClicks : 0,
        avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        lookbackDays: lookback,
        since: sinceStr,
        until: untilStr,
      },
    });
  } catch (err) {
    console.error("facebook-ad-spend error:", err);
    return res.status(500).json({ error: err.message });
  }
}
