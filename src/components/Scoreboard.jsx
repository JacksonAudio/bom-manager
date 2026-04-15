// ============================================================
// src/components/Scoreboard.jsx — Production Scoreboard
// TV-optimized display for the factory floor
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";

const THEMES = {
  dark: { bg: "#0a0a0f", card: "#12121a", border: "#1e1e2e", text: "#e0e0e0", textDim: "#6b6b80", textMuted: "#4a4a5a", white: "#ffffff", accent: "#f8d377", hover: "rgba(255,255,255,0.05)" },
  light: { bg: "#f0f0f5", card: "#ffffff", border: "#e3e8ee", text: "#061b31", textDim: "#64748d", textMuted: "#8898aa", white: "#061b31", accent: "#533afd", hover: "rgba(0,0,0,0.03)" },
};

function formatBuildTime(minutes) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function formatWeekLabel(monday) {
  return monday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function Scoreboard({ standalone = false, teamMembers: propTM, buildOrders: propBO, buildAssignments: propBA, products: propProducts, scrapLog: propScrap }) {
  const [teamMembers, setTeamMembers] = useState(propTM || []);
  const [buildOrders, setBuildOrders] = useState(propBO || []);
  const [buildAssignments, setBuildAssignments] = useState(propBA || []);
  const [products, setProducts] = useState(propProducts || []);
  const [scrapLog, setScrapLog] = useState(propScrap || []);
  const [now, setNow] = useState(new Date());
  const [loaded, setLoaded] = useState(!standalone);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("scoreboard_theme") || "dark"; } catch { return "dark"; }
  });
  const T = THEMES[theme];
  const intervalRef = useRef(null);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Standalone data fetching
  useEffect(() => {
    if (!standalone) return;
    async function load() {
      try {
        const [tm, bo, ba, pr, sl] = await Promise.all([
          supabase.from("team_members").select("*").order("name"),
          supabase.from("build_orders").select("*").order("created_at", { ascending: false }),
          supabase.from("build_assignments").select("*").order("created_at", { ascending: false }),
          supabase.from("products").select("*"),
          supabase.from("scrap_log").select("*").order("created_at", { ascending: false }),
        ]);
        setTeamMembers(tm.data || []);
        setBuildOrders(bo.data || []);
        setBuildAssignments(ba.data || []);
        setProducts(pr.data || []);
        setScrapLog(sl.data || []);
        setLoaded(true);
      } catch (e) { console.error("Scoreboard load error:", e); }
    }
    load();
    intervalRef.current = setInterval(load, 30000);
    return () => clearInterval(intervalRef.current);
  }, [standalone]);

  // Standalone realtime subscriptions
  useEffect(() => {
    if (!standalone) return;
    const channels = [
      supabase.channel("sb-bo").on("postgres_changes", { event: "*", schema: "public", table: "build_orders" }, () => {
        supabase.from("build_orders").select("*").order("created_at", { ascending: false }).then(r => setBuildOrders(r.data || []));
      }).subscribe(),
      supabase.channel("sb-ba").on("postgres_changes", { event: "*", schema: "public", table: "build_assignments" }, () => {
        supabase.from("build_assignments").select("*").order("created_at", { ascending: false }).then(r => setBuildAssignments(r.data || []));
      }).subscribe(),
      supabase.channel("sb-tm").on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, () => {
        supabase.from("team_members").select("*").order("name").then(r => setTeamMembers(r.data || []));
      }).subscribe(),
      supabase.channel("sb-pr").on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        supabase.from("products").select("*").then(r => setProducts(r.data || []));
      }).subscribe(),
    ];
    return () => channels.forEach(c => c.unsubscribe());
  }, [standalone]);

  // Sync props when embedded
  useEffect(() => { if (!standalone && propTM) setTeamMembers(propTM); }, [propTM, standalone]);
  useEffect(() => { if (!standalone && propBO) setBuildOrders(propBO); }, [propBO, standalone]);
  useEffect(() => { if (!standalone && propBA) setBuildAssignments(propBA); }, [propBA, standalone]);
  useEffect(() => { if (!standalone && propProducts) setProducts(propProducts); }, [propProducts, standalone]);
  useEffect(() => { if (!standalone && propScrap) setScrapLog(propScrap); }, [propScrap, standalone]);

  const { monday, sunday } = getWeekRange();

  // ── Compute builder rankings for current week
  const weeklyCompletedOrders = buildOrders.filter(bo => {
    if (bo.status !== "completed") return false;
    const updated = bo.updated_at ? new Date(bo.updated_at) : null;
    return updated && updated >= monday && updated <= sunday;
  });

  const weeklyCompletedAssignments = buildAssignments.filter(a => {
    if (a.status !== "completed") return false;
    const completed = a.completed_at ? new Date(a.completed_at) : null;
    return completed && completed >= monday && completed <= sunday;
  });

  // Map build_order_id -> build order for quick lookup
  const boMap = {};
  buildOrders.forEach(bo => { boMap[bo.id] = bo; });
  const prodMap = {};
  products.forEach(p => { prodMap[p.id] = p; });

  // Aggregate per builder
  const builderMap = {};
  weeklyCompletedAssignments.forEach(a => {
    const memberId = a.team_member_id;
    if (!memberId) return;
    const bo = boMap[a.build_order_id];
    if (!bo) return;
    const prod = prodMap[bo.product_id];
    const buildMinutes = prod?.build_minutes || 15;
    const qty = bo.quantity || 0;

    if (!builderMap[memberId]) {
      builderMap[memberId] = { memberId, units: 0, points: 0, productCounts: {} };
    }
    builderMap[memberId].units += qty;
    builderMap[memberId].points += qty * buildMinutes;
    const prodName = prod?.name || "Unknown";
    builderMap[memberId].productCounts[prodName] = (builderMap[memberId].productCounts[prodName] || 0) + qty;
  });

  // Also count build orders with no assignments (direct completions)
  weeklyCompletedOrders.forEach(bo => {
    const hasAssignment = weeklyCompletedAssignments.some(a => a.build_order_id === bo.id);
    if (hasAssignment) return;
    // No assignment — skip (can't attribute to a builder)
  });

  const rankingsRaw = Object.values(builderMap)
    .map(b => {
      const member = teamMembers.find(m => m.id === b.memberId);
      const productList = Object.entries(b.productCounts)
        .sort((a, c) => c[1] - a[1])
        .map(([name, count]) => `${count}\u00d7 ${name}`)
        .join(", ");
      const scrapped = scrapLog.filter(s => s.team_member_id === b.memberId).reduce((s, e) => s + (e.quantity || 0), 0);
      const yieldPct = b.units > 0 ? ((b.units - scrapped) / b.units) * 100 : 100;
      return { ...b, name: member?.name || "Unknown", productList, scrapped, yieldPct };
    });
  // Compute quality score
  const bySpeed = [...rankingsRaw].filter(r => r.units > 0).sort((a, b) => b.points - a.points);
  const totalBuildersCount = rankingsRaw.length || 1;
  rankingsRaw.forEach(r => {
    const speedRank = bySpeed.findIndex(x => x.memberId === r.memberId);
    const speedPctile = speedRank >= 0 ? 100 - (speedRank / totalBuildersCount * 100) : 50;
    r.qualityScore = r.yieldPct * 0.6 + speedPctile * 0.4;
  });
  const rankings = rankingsRaw.sort((a, b) => b.qualityScore - a.qualityScore || b.points - a.points);

  const maxPoints = rankings.length > 0 ? rankings[0].points : 1;

  // ── Active builds in progress
  const activeBuilds = buildOrders
    .filter(bo => bo.status === "in-progress" || bo.status === "assigned")
    .map(bo => {
      const assignment = buildAssignments.find(a => a.build_order_id === bo.id && a.status !== "completed");
      const member = assignment ? teamMembers.find(m => m.id === assignment.team_member_id) : null;
      const prod = prodMap[bo.product_id];
      return {
        id: bo.id,
        builderName: member?.name || "Unassigned",
        productName: prod?.name || "Unknown",
        completed: bo.completed_count || 0,
        total: bo.quantity || 0,
        priority: bo.priority,
        status: bo.status,
        forOrder: bo.for_order || bo.notes || "",
        dueDate: bo.due_date || "",
      };
    })
    .slice(0, 8);

  // ── Team totals
  const totalUnits = rankings.reduce((s, r) => s + r.units, 0);
  const totalPoints = rankings.reduce((s, r) => s + r.points, 0);

  const rankColors = ["#ffd700", "#c0c0c0", "#cd7f32"];

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("scoreboard_theme", next); } catch {}
  };

  if (!loaded) {
    return (
      <div style={{ background: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.accent, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif", fontSize: 24 }}>Loading Scoreboard...</div>
      </div>
    );
  }

  return (
    <div style={{
      background: T.bg, minHeight: "100vh", color: T.text,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif", padding: standalone ? "24px 32px" : "20px 24px",
      display: "flex", flexDirection: "column", overflow: "hidden",
      animation: "scoreboardFadeIn 0.8s ease-out", transition: "background 0.3s, color 0.3s",
    }}>
      <style>{`
        @keyframes scoreboardFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes leaderPulse { 0%, 100% { box-shadow: 0 0 20px ${theme==="dark"?"rgba(248,211,119,0.15)":"rgba(83,58,253,0.15)"}; } 50% { box-shadow: 0 0 40px ${theme==="dark"?"rgba(248,211,119,0.3)":"rgba(83,58,253,0.3)"}; } }
        @keyframes progressGrow { from { width: 0; } }
      `}</style>

      {/* ── TOP SECTION */}
      <div style={{ textAlign: "center", marginBottom: standalone ? 28 : 20, flexShrink: 0, position: "relative" }}>
        {/* Day/Night toggle */}
        <button onClick={toggleTheme}
          style={{ position:"absolute",right:0,top:0,background:T.card,border:`1px solid ${T.border}`,
            borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:16,color:T.text,
            transition:"background 0.2s" }}
          onMouseOver={e=>e.currentTarget.style.background=T.hover}
          onMouseOut={e=>e.currentTarget.style.background=T.card}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <div style={{ fontSize: standalone ? 42 : 28, fontWeight: 800, color: T.accent, letterSpacing: "6px", textTransform: "uppercase" }}>
          JACKSON AUDIO
        </div>
        <div style={{ fontSize: standalone ? 16 : 13, fontWeight: 400, color: T.textDim, letterSpacing: "4px", textTransform: "uppercase", marginTop: 4 }}>
          PRODUCTION SCOREBOARD
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 32, fontSize: standalone ? 15 : 12, color: T.textDim }}>
          <span>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
          <span style={{ color: T.accent, fontWeight: 700 }}>{now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
      </div>

      {/* ── MAIN CONTENT */}
      <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>

        {/* ── LEFT: Builder Rankings */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: standalone ? 14 : 11, fontWeight: 700, color: T.textDim, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 12 }}>
            BUILDER RANKINGS — THIS WEEK
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {rankings.length === 0 && (
              <div style={{ textAlign: "center", padding: 60, color: T.textMuted, fontSize: 18 }}>
                No completed builds this week yet
              </div>
            )}
            {rankings.map((builder, idx) => {
              const isLeader = idx === 0 && rankings.length > 1;
              const rankColor = idx < 3 ? rankColors[idx] : "#6b6b80";
              const progressPct = maxPoints > 0 ? (builder.points / maxPoints) * 100 : 0;

              return (
                <div key={builder.memberId} style={{
                  background: T.card,
                  border: `1px solid ${isLeader ? (theme==="dark"?"rgba(248,211,119,0.3)":"rgba(83,58,253,0.3)") : T.border}`,
                  borderRadius: 12,
                  padding: standalone ? "16px 20px" : "12px 16px",
                  animation: isLeader ? "leaderPulse 3s ease-in-out infinite" : undefined,
                  transition: "all 0.3s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: standalone ? 16 : 12 }}>
                    {/* Rank */}
                    <div style={{
                      fontSize: standalone ? 48 : 32,
                      fontWeight: 800,
                      color: rankColor,
                      minWidth: standalone ? 60 : 44,
                      textAlign: "center",
                      lineHeight: 1,
                      textShadow: idx === 0 ? "0 0 20px rgba(255,215,0,0.4)" : "none",
                    }}>
                      #{idx + 1}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: standalone ? 32 : 22,
                          fontWeight: 700,
                          color: isLeader ? T.accent : T.white,
                        }}>
                          {builder.name}
                        </span>
                        <span style={{
                          fontSize: standalone ? 13 : 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                          background: builder.qualityScore >= 90 ? "rgba(52,199,89,0.18)" : builder.qualityScore >= 70 ? "rgba(83,58,253,0.18)" : "rgba(255,149,0,0.18)",
                          color: builder.qualityScore >= 90 ? "#34c759" : builder.qualityScore >= 70 ? "#533afd" : "#ff9500",
                        }}>
                          Q:{builder.qualityScore.toFixed(0)}
                        </span>
                        <span style={{ fontSize: standalone ? 15 : 12, color: T.textDim }}>
                          {builder.units} unit{builder.units !== 1 ? "s" : ""} built
                        </span>
                        <span style={{ fontSize: standalone ? 12 : 10, color: builder.yieldPct >= 98 ? "#34c759" : builder.yieldPct >= 95 ? "#ff9500" : "#ff3b30" }}>
                          Yield: {builder.yieldPct.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{
                        fontSize: standalone ? 13 : 11,
                        color: T.textMuted,
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {builder.productList}
                      </div>
                      {/* Progress bar */}
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          flex: 1, height: standalone ? 8 : 6, background: theme==="dark"?"#1a1a28":"#e5e5ea",
                          borderRadius: 4, overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${progressPct}%`,
                            height: "100%",
                            background: `linear-gradient(90deg, ${T.accent}, #533afd)`,
                            borderRadius: 4,
                            animation: "progressGrow 1s ease-out",
                            transition: "width 0.5s ease",
                          }} />
                        </div>
                        <span style={{
                          fontSize: standalone ? 18 : 14,
                          fontWeight: 700,
                          color: T.accent,
                          minWidth: standalone ? 80 : 60,
                          textAlign: "right",
                        }}>
                          {builder.points.toLocaleString()} pts
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Active Builds */}
        <div style={{ width: standalone ? 340 : 280, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: standalone ? 14 : 11, fontWeight: 700, color: T.textDim, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 12 }}>
            ACTIVE BUILDS
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {activeBuilds.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: T.textMuted, fontSize: 14 }}>
                No active builds
              </div>
            )}
            {activeBuilds.map(build => {
              const pct = build.total > 0 ? (build.completed / build.total) * 100 : 0;
              return (
                <div key={build.id} style={{
                  background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 10, padding: standalone ? "14px 16px" : "10px 14px",
                }}>
                  <div style={{ fontSize: standalone ? 15 : 12, fontWeight: 700, color: T.white, marginBottom: 2 }}>
                    {build.productName}
                  </div>
                  <div style={{ fontSize: standalone ? 12 : 10, color: T.textDim, marginBottom: 4 }}>
                    {build.builderName}
                    {build.priority === "urgent" && <span style={{ color: "#ff3b30", marginLeft: 6 }}>URGENT</span>}
                    {build.priority === "high" && <span style={{ color: "#ff9500", marginLeft: 6 }}>HIGH</span>}
                  </div>
                  {build.forOrder && (
                    <div style={{ fontSize: standalone ? 11 : 9, color: T.accent, marginBottom: 4, fontWeight: 600 }}>
                      FOR: {build.forOrder}
                      {build.dueDate && <span style={{ color: T.textDim, fontWeight: 400, marginLeft: 6 }}>Due {new Date(build.dueDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: theme==="dark"?"#1a1a28":"#e5e5ea", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        width: `${pct}%`, height: "100%",
                        background: pct >= 80 ? "#34c759" : pct >= 40 ? "#533afd" : "#5856d6",
                        borderRadius: 3, transition: "width 0.5s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: standalone ? 14 : 11, fontWeight: 700, color: T.textDim, minWidth: 50, textAlign: "right" }}>
                      {build.completed}/{build.total}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── BOTTOM SECTION */}
      <div style={{
        marginTop: standalone ? 20 : 14,
        padding: standalone ? "16px 24px" : "12px 18px",
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: standalone ? 48 : 32, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: standalone ? 12 : 10, color: T.textDim, letterSpacing: "2px", textTransform: "uppercase" }}>TOTAL UNITS</div>
            <div style={{ fontSize: standalone ? 32 : 22, fontWeight: 800, color: T.white }}>{totalUnits.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: standalone ? 12 : 10, color: T.textDim, letterSpacing: "2px", textTransform: "uppercase" }}>PRODUCTION POINTS</div>
            <div style={{ fontSize: standalone ? 32 : 22, fontWeight: 800, color: T.accent }}>{totalPoints.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: standalone ? 12 : 10, color: T.textDim, letterSpacing: "2px", textTransform: "uppercase" }}>BUILDERS ACTIVE</div>
            <div style={{ fontSize: standalone ? 32 : 22, fontWeight: 800, color: T.white }}>{rankings.length}</div>
          </div>
          {(() => {
            const orderBuilds = activeBuilds.filter(b => b.forOrder);
            const uniqueOrders = [...new Set(orderBuilds.map(b => b.forOrder))];
            if (uniqueOrders.length === 0) return null;
            return (
              <div style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: standalone ? 24 : 16 }}>
                <div style={{ fontSize: standalone ? 12 : 10, color: T.textDim, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 4 }}>BUILDING FOR ORDERS</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {uniqueOrders.map(order => {
                    const builds = orderBuilds.filter(b => b.forOrder === order);
                    const totalUnitsForOrder = builds.reduce((s, b) => s + b.total, 0);
                    const completedForOrder = builds.reduce((s, b) => s + b.completed, 0);
                    return (
                      <span key={order} style={{
                        fontSize: standalone ? 12 : 10, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
                        background: T.accent + "18", color: T.accent,
                      }}>
                        {order} ({completedForOrder}/{totalUnitsForOrder})
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
        <div style={{ fontSize: standalone ? 14 : 11, color: T.textDim }}>
          Week of {formatWeekLabel(monday)}
        </div>
      </div>
    </div>
  );
}
