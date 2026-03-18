// ============================================================
// src/components/BuildView.jsx — Mobile Build View
// Phone-optimized view for production floor workers
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif";

export default function BuildView({ standalone = false }) {
  const [teamMembers, setTeamMembers] = useState([]);
  const [buildOrders, setBuildOrders] = useState([]);
  const [buildAssignments, setBuildAssignments] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [incrementing, setIncrementing] = useState(null); // orderId being incremented
  const intervalRef = useRef(null);
  const [pinMode, setPinMode] = useState(false); // show PIN entry instead of name tap
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [tmRes, boRes, baRes, pRes] = await Promise.all([
        supabase.from("team_members").select("*").order("name"),
        supabase.from("build_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("build_assignments").select("*").order("created_at", { ascending: false }),
        supabase.from("products").select("*"),
      ]);
      if (tmRes.error || boRes.error || baRes.error || pRes.error) {
        const err = tmRes.error || boRes.error || baRes.error || pRes.error;
        setError("Data access error: " + err.message + ". Ask your admin to enable public read access.");
        return;
      }
      setTeamMembers(tmRes.data || []);
      setBuildOrders(boRes.data || []);
      setBuildAssignments(baRes.data || []);
      setProducts(pRes.data || []);
      setError("");
    } catch (e) {
      setError("Failed to load data: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 15000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  const getProductName = (productId) => {
    const p = products.find((pr) => pr.id === productId);
    return p ? p.name : "Unknown Product";
  };

  const getMyOrders = () => {
    if (!selectedMember) return [];
    const myAssignmentOrderIds = buildAssignments
      .filter((a) => a.team_member_id === selectedMember.id && !a.completed_at)
      .map((a) => a.build_order_id);
    return buildOrders.filter(
      (o) => myAssignmentOrderIds.includes(o.id) && o.status !== "completed"
    );
  };

  const handleIncrement = async (order) => {
    if (incrementing) return;
    setIncrementing(order.id);
    try {
      const newCount = (order.completed_count || 0) + 1;
      const updates = { completed_count: newCount };

      if (newCount >= order.quantity) {
        updates.status = "completed";
        updates.updated_at = new Date().toISOString();
      }

      const { error: updateErr } = await supabase
        .from("build_orders")
        .update(updates)
        .eq("id", order.id);

      if (updateErr) throw updateErr;

      // If completed, also mark the assignment
      if (newCount >= order.quantity) {
        const assignment = buildAssignments.find(
          (a) => a.build_order_id === order.id && a.team_member_id === selectedMember.id
        );
        if (assignment) {
          await supabase
            .from("build_assignments")
            .update({ completed_at: new Date().toISOString() })
            .eq("id", assignment.id);
        }
      }

      // Refresh data immediately
      await fetchAll();
    } catch (e) {
      setError("Failed to update: " + e.message);
    } finally {
      setIncrementing(null);
    }
  };

  // ── Loading screen
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.centered}>
          <div style={{ fontSize: 18, color: "#86868b", fontFamily: FONT }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── Error screen
  if (error && !teamMembers.length) {
    return (
      <div style={styles.container}>
        <div style={styles.centered}>
          <div style={{ fontSize: 16, color: "#ff453a", fontFamily: FONT, padding: 24, textAlign: "center" }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  // Handle PIN submission
  const handlePinSubmit = async () => {
    if (pinValue.length < 4) { setPinError("Enter at least 4 digits"); return; }
    setPinError("");
    const match = teamMembers.find(m => m.active !== false && m.pin_code === pinValue);
    if (match) {
      setSelectedMember(match);
      setPinValue("");
      setPinMode(false);
    } else {
      // Also try DB lookup in case pin_code wasn't fetched
      try {
        const { data } = await supabase.from("team_members").select("*").eq("pin_code", pinValue).eq("active", true).single();
        if (data) { setSelectedMember(data); setPinValue(""); setPinMode(false); }
        else { setPinError("Invalid PIN"); setPinValue(""); }
      } catch { setPinError("Invalid PIN"); setPinValue(""); }
    }
  };

  // ── Member selection screen
  if (!selectedMember) {
    return (
      <div style={styles.container}>
        <div style={{ padding: "24px 16px", maxWidth: 480, margin: "0 auto" }}>
          <h1 style={styles.title}>{pinMode ? "Enter Your PIN" : "Who are you?"}</h1>
          <p style={{ color: "#86868b", fontFamily: FONT, fontSize: 14, marginBottom: 24, textAlign: "center" }}>
            {pinMode ? "Enter your 4-6 digit PIN to sign in" : "Tap your name or use PIN to sign in"}
          </p>

          {pinMode ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} style={{ width: 44, height: 52, borderRadius: 10, border: "2px solid " + (pinValue.length > i ? "#0071e3" : "#3a3a3e"),
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700,
                    color: "#f5f5f7", fontFamily: FONT, background: "#1c1c1e" }}>
                    {pinValue.length > i ? "\u2022" : ""}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 72px)", gap: 10, justifyContent: "center" }}>
                {[1,2,3,4,5,6,7,8,9,null,0,"del"].map((d, i) => {
                  if (d === null) return <div key={i} />;
                  return (
                    <button key={i} onClick={() => {
                      if (d === "del") { setPinValue(v => v.slice(0, -1)); setPinError(""); }
                      else if (pinValue.length < 6) { setPinValue(v => v + d); setPinError(""); }
                    }}
                    style={{ width: 72, height: 56, borderRadius: 12, border: "1px solid #3a3a3e", background: "#1c1c1e",
                      color: "#f5f5f7", fontSize: d === "del" ? 16 : 24, fontWeight: 600, fontFamily: FONT, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {d === "del" ? "\u232B" : d}
                    </button>
                  );
                })}
              </div>
              {pinError && <div style={{ color: "#ff453a", fontSize: 14, fontFamily: FONT, fontWeight: 600 }}>{pinError}</div>}
              <button onClick={handlePinSubmit}
                disabled={pinValue.length < 4}
                style={{ padding: "14px 48px", borderRadius: 980, border: "none", background: pinValue.length >= 4 ? "#0071e3" : "#2c2c2e",
                  color: "#fff", fontSize: 16, fontWeight: 700, fontFamily: FONT, cursor: pinValue.length >= 4 ? "pointer" : "default",
                  opacity: pinValue.length >= 4 ? 1 : 0.5, marginTop: 8 }}>
                Sign In
              </button>
              <button onClick={() => { setPinMode(false); setPinValue(""); setPinError(""); }}
                style={{ background: "none", border: "none", color: "#0071e3", fontSize: 14, fontFamily: FONT, cursor: "pointer", fontWeight: 600 }}>
                Use Name Instead
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {teamMembers
                  .filter((t) => t.active !== false)
                  .map((member) => (
                    <button
                      key={member.id}
                      onClick={() => setSelectedMember(member)}
                      style={styles.memberButton}
                    >
                      <span style={{ fontSize: 22, fontWeight: 700 }}>{member.name}</span>
                      {member.role && (
                        <span style={{ fontSize: 13, color: "#86868b", marginTop: 2 }}>{member.role}</span>
                      )}
                    </button>
                  ))}
              </div>
              {teamMembers.filter((t) => t.active !== false).length === 0 && (
                <div style={{ textAlign: "center", color: "#86868b", fontFamily: FONT, fontSize: 15, marginTop: 40 }}>
                  No team members found.
                </div>
              )}
              {teamMembers.some(m => m.pin_code) && (
                <button onClick={() => setPinMode(true)}
                  style={{ display: "block", margin: "24px auto 0", padding: "12px 32px", borderRadius: 980,
                    border: "1px solid #3a3a3e", background: "transparent", color: "#0071e3", fontSize: 14,
                    fontWeight: 600, fontFamily: FONT, cursor: "pointer" }}>
                  Use PIN Instead
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Build orders screen
  const myOrders = getMyOrders();

  return (
    <div style={styles.container}>
      <div style={{ padding: "16px 16px", maxWidth: 480, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: "#86868b", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
              Builder
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f5f5f7", fontFamily: FONT }}>
              {selectedMember.name}
            </div>
          </div>
          <button
            onClick={() => setSelectedMember(null)}
            style={{
              padding: "10px 18px", borderRadius: 980, border: "1px solid #3a3a3e",
              background: "transparent", color: "#86868b", fontSize: 13, fontWeight: 600,
              fontFamily: FONT, cursor: "pointer",
            }}
          >
            Switch Builder
          </button>
        </div>

        {error && (
          <div style={{ color: "#ff453a", fontSize: 13, fontFamily: FONT, marginBottom: 12, padding: "8px 12px", background: "#1c1c1e", borderRadius: 10 }}>
            {error}
          </div>
        )}

        {/* Orders */}
        {myOrders.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#34c759", fontFamily: FONT, marginBottom: 8 }}>
              No tasks assigned
            </div>
            <div style={{ fontSize: 14, color: "#86868b", fontFamily: FONT }}>
              You're all caught up! Check back later.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {myOrders.map((order) => {
              const completed = order.completed_count || 0;
              const total = order.quantity || 1;
              const pct = Math.min((completed / total) * 100, 100);
              const productName = getProductName(order.product_id);

              return (
                <div key={order.id} style={styles.orderCard}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#f5f5f7", fontFamily: FONT, marginBottom: 4 }}>
                      {productName}
                    </div>
                    {order.notes && (
                      <div style={{ fontSize: 13, color: "#86868b", fontFamily: FONT }}>{order.notes}</div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#f5f5f7", fontFamily: FONT }}>
                        {completed} of {total}
                      </span>
                      <span style={{ fontSize: 13, color: "#86868b", fontFamily: FONT }}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div style={{ height: 10, background: "#2c2c2e", borderRadius: 5, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: pct >= 100 ? "#34c759" : "#f8d377",
                          borderRadius: 5,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>

                  {/* +1 Button */}
                  <button
                    onClick={() => handleIncrement(order)}
                    disabled={incrementing === order.id || completed >= total}
                    style={{
                      width: "100%",
                      height: 80,
                      borderRadius: 16,
                      border: "none",
                      background: completed >= total ? "#2c2c2e" : "#34c759",
                      color: completed >= total ? "#86868b" : "#fff",
                      fontSize: 28,
                      fontWeight: 800,
                      fontFamily: FONT,
                      cursor: completed >= total ? "default" : "pointer",
                      opacity: incrementing === order.id ? 0.6 : 1,
                      transition: "opacity 0.15s, transform 0.1s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {incrementing === order.id ? "..." : completed >= total ? "Done" : "+1"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#0a0a0f",
    fontFamily: FONT,
    WebkitTapHighlightColor: "transparent",
  },
  centered: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    color: "#f5f5f7",
    fontFamily: FONT,
    textAlign: "center",
    marginBottom: 8,
    marginTop: 40,
  },
  memberButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 24px",
    borderRadius: 16,
    border: "1px solid #3a3a3e",
    background: "#1c1c1e",
    color: "#f5f5f7",
    fontFamily: FONT,
    cursor: "pointer",
    minHeight: 72,
    WebkitTapHighlightColor: "transparent",
  },
  orderCard: {
    background: "#1c1c1e",
    borderRadius: 16,
    padding: "18px 18px 16px",
    border: "1px solid #2c2c2e",
  },
};
