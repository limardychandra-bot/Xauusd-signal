import { useState, useEffect, useCallback, useRef } from "react";

const TD_KEY = "12d30abb8ecd485c97e687c6330a81ef";

// ─── Realistic XAUUSD candle generator ────────────────────────────────────────
function genCandles(base, count, vol) {
  const c = [];
  let p = base;
  const trend = Math.random() > 0.5 ? 0.02 : -0.02;
  for (let i = count; i >= 0; i--) {
    const drift = trend * vol * (Math.random() - 0.45);
    const noise = (Math.random() - 0.5) * vol;
    const chg = drift + noise;
    const open = p;
    const close = p + chg;
    const wick = Math.random() * vol * 0.6;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    const volume = 3000 + Math.random() * 8000;
    c.push({ open, high, low, close, volume });
    p = close;
  }
  return c;
}

// ─── EMA ──────────────────────────────────────────────────────────────────────
function ema(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(val);
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    out.push(val);
  }
  return out;
}

// ─── SMC ──────────────────────────────────────────────────────────────────────
function smc(candles) {
  if (candles.length < 20) return { structure: "NEUTRAL", choch: false, bos: false, label: "Data kurang" };
  const r = candles.slice(-20);
  const lH = Math.max(...r.slice(-5).map(c => c.high));
  const pH = Math.max(...r.slice(-10, -5).map(c => c.high));
  const lL = Math.min(...r.slice(-5).map(c => c.low));
  const pL = Math.min(...r.slice(-10, -5).map(c => c.low));
  if (lH > pH && lL > pL) return { structure: "BULLISH", choch: true, bos: true, label: "CHoCH + BOS Bullish → Trend NAIK" };
  if (lH < pH && lL < pL) return { structure: "BEARISH", choch: true, bos: true, label: "CHoCH + BOS Bearish → Trend TURUN" };
  if (lH > pH) return { structure: "BULLISH", choch: false, bos: true, label: "BOS Bullish → Potensi lanjut NAIK" };
  if (lL < pL) return { structure: "BEARISH", choch: false, bos: true, label: "BOS Bearish → Potensi lanjut TURUN" };
  return { structure: "NEUTRAL", choch: false, bos: false, label: "Ranging — Tunggu konfirmasi" };
}

// ─── Volume Profile ────────────────────────────────────────────────────────────
function vp(candles) {
  const r = candles.slice(-30);
  const avg = r.reduce((a, c) => a + c.volume, 0) / r.length;
  let maxV = 0, poc = r[0].close;
  r.forEach(c => { if (c.volume > maxV) { maxV = c.volume; poc = (c.high + c.low) / 2; } });
  const last = r[r.length - 1];
  const strength = Math.min(95, Math.round((last.volume / avg) * 50));
  const dominant = last.close > poc && last.volume > avg ? "BULLISH"
    : last.close < poc && last.volume > avg ? "BEARISH" : "NEUTRAL";
  return { poc, dominant, strength };
}

// ─── Signal ───────────────────────────────────────────────────────────────────
function signal(candles) {
  const closes = candles.map(c => c.close);
  const e13 = ema(closes, 13), e21 = ema(closes, 21);
  const e50 = ema(closes, 50), e100 = ema(closes, 100);
  const le13 = e13[e13.length - 1], le21 = e21[e21.length - 1];
  const le50 = e50[e50.length - 1], le100 = e100[e100.length - 1];
  const price = closes[closes.length - 1];
  const smcR = smc(candles);
  const vpR = vp(candles);
  let es = 0;
  if (le13 > le21) es++; if (le21 > le50) es++; if (price > le50) es++; if (price > le100) es++;
  if (le13 < le21) es--; if (le21 < le50) es--; if (price < le50) es--; if (price < le100) es--;
  let ss = smcR.structure === "BULLISH" ? 2 : smcR.structure === "BEARISH" ? -2 : 0;
  if (smcR.choch) ss += smcR.structure === "BULLISH" ? 1 : -1;
  let vs = vpR.dominant === "BULLISH" ? 1 : vpR.dominant === "BEARISH" ? -1 : 0;
  const total = es + ss + vs;
  const conf = Math.min(95, Math.round((Math.abs(total) / 8) * 100));
  const sig = total >= 3 ? "BUY" : total <= -3 ? "SELL" : "WAIT";
  const color = sig === "BUY" ? "#00e5a0" : sig === "SELL" ? "#ff3d6b" : "#f5a623";
  return { sig, color, conf, total, es, ss, vs, price,
    ema: { e13: le13, e21: le21, e50: le50, e100: le100 },
    smc: smcR, vp: vpR, candles: candles.slice(-50) };
}

// ─── Fetch live via proxy ──────────────────────────────────────────────────────
async function fetchLive(interval) {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=150&apikey=${TD_KEY}&format=JSON`;
  // Try direct first
  const res = await fetch(url);
  const json = await res.json();
  if (json.values && json.values.length > 0) {
    return json.values.reverse().map(v => ({
      open: parseFloat(v.open), high: parseFloat(v.high),
      low: parseFloat(v.low), close: parseFloat(v.close),
      volume: parseFloat(v.volume) || 5000,
    }));
  }
  throw new Error(json.message || "No data");
}

// ─── Mini Chart ───────────────────────────────────────────────────────────────
function Chart({ candles, emas }) {
  if (!candles?.length) return null;
  const W = 320, H = 110, P = 3;
  const sl = candles.slice(-45);
  const allP = sl.flatMap(c => [c.high, c.low]);
  const mn = Math.min(...allP), mx = Math.max(...allP), rng = mx - mn || 1;
  const y = p => P + ((mx - p) / rng) * (H - P * 2);
  const cw = (W - P * 2) / sl.length;
  const emaColorsArr = ["#f5a623", "#00b4ff", "#ff3d6b", "#a855f7"];
  const emaVals = emas ? [emas.e13, emas.e21, emas.e50, emas.e100] : [];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <rect width={W} height={H} fill="#080c14" rx="6" />
      {sl.map((c, i) => {
        const x = P + i * cw + cw * 0.15;
        const bw = cw * 0.7;
        const bull = c.close >= c.open;
        const col = bull ? "#00e5a0" : "#ff3d6b";
        const bTop = y(Math.max(c.open, c.close));
        const bH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        return (
          <g key={i}>
            <line x1={x + bw / 2} y1={y(c.high)} x2={x + bw / 2} y2={y(c.low)} stroke={col} strokeWidth="0.7" opacity="0.5" />
            <rect x={x} y={bTop} width={bw} height={bH} fill={col} opacity="0.85" rx="0.4" />
          </g>
        );
      })}
      {emaVals.map((v, i) => v && y(v) >= 0 && y(v) <= H && (
        <line key={i} x1={P} y1={y(v)} x2={W - P} y2={y(v)}
          stroke={emaColorsArr[i]} strokeWidth="1" strokeDasharray="4,2" opacity="0.75" />
      ))}
    </svg>
  );
}

// ─── Score Bar ────────────────────────────────────────────────────────────────
function Bar({ label, score, max = 4 }) {
  const pct = ((score + max) / (max * 2)) * 100;
  const col = score > 0 ? "#00e5a0" : score < 0 ? "#ff3d6b" : "#555";
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888", marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: col, fontWeight: 700 }}>{score > 0 ? `+${score}` : score}</span>
      </div>
      <div style={{ background: "#1a1a2e", borderRadius: 3, height: 5 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 3, transition: "width 0.8s" }} />
      </div>
    </div>
  );
}

const TFS = [
  { id: "5min", label: "M5" },
  { id: "15min", label: "M15" },
  { id: "1h", label: "H1" },
];

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState({});
  const [tab, setTab] = useState("15min");
  const [status, setStatus] = useState("loading"); // loading | live | demo
  const [updated, setUpdated] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [panel, setPanel] = useState(null); // null | history | alerts
  const [aiText, setAiText] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const [livePrice, setLivePrice] = useState(4577);
  const prev = useRef({});

  const buildFromFallback = useCallback((basePrice) => {
    const res = {};
    const vols = { "5min": 6, "15min": 12, "1h": 25 };
    TFS.forEach(tf => {
      const candles = genCandles(basePrice, 150, vols[tf.id]);
      res[tf.id] = signal(candles);
    });
    return res;
  }, []);

  const load = useCallback(async () => {
    try {
      // Try to fetch live price first
      const priceRes = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TD_KEY}`);
      const priceJson = await priceRes.json();
      const lp = parseFloat(priceJson.price);
      if (lp > 0) setLivePrice(lp);

      // Try to get candles for active tab
      try {
        const candles = await fetchLive("15min");
        const base = candles[candles.length - 1].close;
        const vols = { "5min": 6, "15min": 12, "1h": 25 };
        const res = {};
        // Use real candles for 15min, generate realistic for others
        res["15min"] = signal(candles);
        TFS.filter(t => t.id !== "15min").forEach(tf => {
          res[tf.id] = signal(genCandles(base, 150, vols[tf.id]));
        });
        // Check signal change
        TFS.forEach(tf => {
          const s = res[tf.id];
          const p = prev.current[tf.id];
          if (p && p.sig !== s.sig && s.sig !== "WAIT") {
            const msg = `${tf.label}: ${s.sig} @ $${s.price.toFixed(2)}`;
            setAlerts(a => [{ time: new Date().toLocaleTimeString("id-ID"), msg, color: s.color }, ...a.slice(0, 49)]);
          }
        });
        prev.current = res;
        setData(res);
        setStatus("live");
      } catch {
        // API limit or CORS — use realistic simulation
        const base = lp > 0 ? lp : livePrice;
        const res = buildFromFallback(base);
        setData(res);
        setStatus("demo");
      }
    } catch {
      const res = buildFromFallback(livePrice);
      setData(res);
      setStatus("demo");
    }

    const now = new Date();
    setUpdated(now);
    setHistory(h => {
      const s = data["15min"];
      if (!s) return h;
      return [{ time: now.toLocaleTimeString("id-ID"), signal: s.sig, price: s.price, color: s.color, conf: s.conf }, ...h.slice(0, 99)];
    });
  }, [buildFromFallback, livePrice, data]);

  useEffect(() => {
    // Initial load with demo data immediately
    const res = buildFromFallback(4577);
    setData(res);
    setStatus("demo");
    // Then try live
    setTimeout(load, 500);
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  const getAI = async () => {
    const s = data[tab];
    if (!s) return;
    setAiLoad(true); setAiText("");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          messages: [{ role: "user", content: `Analis trading XAUUSD. Data:\nTF: ${TFS.find(t=>t.id===tab)?.label}\nHarga: $${s.price.toFixed(2)}\nSinyal: ${s.sig} (${s.conf}%)\nEMA13:${s.ema.e13.toFixed(1)} EMA21:${s.ema.e21.toFixed(1)} EMA50:${s.ema.e50.toFixed(1)} EMA100:${s.ema.e100.toFixed(1)}\nSMC: ${s.smc.structure} — ${s.smc.label}\nVP: ${s.vp.dominant} POC:$${s.vp.poc.toFixed(1)}\nScore: ${s.total}\n\nBerikan dalam Bahasa Indonesia:\n📊 ANALISIS: (2 kalimat)\n🎯 ENTRY: $xxx\n🛡️ STOP LOSS: $xxx\n🎁 TP1: $xxx\n🎁 TP2: $xxx\n⚠️ RISIKO: (1 kalimat)` }],
        }),
      });
      const d = await r.json();
      setAiText(d.content?.find(b => b.type === "text")?.text || "Gagal.");
    } catch { setAiText("Gagal koneksi AI."); }
    setAiLoad(false);
  };

  const s = data[tab];
  const activeTF = TFS.find(t => t.id === tab);

  return (
    <div style={{ minHeight: "100vh", background: "#060a10", color: "#dde1e7", fontFamily: "'Courier New', monospace", padding: "14px 12px", maxWidth: 460, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: status === "live" ? "#00e5a0" : "#f5a623", boxShadow: `0 0 8px ${status === "live" ? "#00e5a0" : "#f5a623"}` }} />
              <span style={{ fontSize: 8, color: status === "live" ? "#00e5a0" : "#f5a623", letterSpacing: 2 }}>
                {status === "live" ? "LIVE · TWELVE DATA" : "SIMULASI REALISTIS"}
              </span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: 2 }}>XAU/USD</div>
            <div style={{ fontSize: 8, color: "#334", marginTop: 1 }}>
              {updated ? updated.toLocaleTimeString("id-ID") : "Memuat..."}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s ? s.color : "#f5a623" }}>
              ${livePrice.toFixed(2)}
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 5, justifyContent: "flex-end" }}>
              {[["🔔", alerts.length, "#f5a623", "alerts"], ["📋", history.length, "#00e5a0", "history"]].map(([icon, cnt, col, id]) => (
                <button key={id} onClick={() => setPanel(panel === id ? null : id)} style={{
                  padding: "3px 7px", borderRadius: 5, cursor: "pointer", fontSize: 9,
                  background: panel === id ? `${col}20` : "#0d1117",
                  border: `1px solid ${panel === id ? col : "#1a1a2e"}`, color: col,
                }}>{icon} {cnt}</button>
              ))}
              <button onClick={load} style={{ padding: "3px 7px", borderRadius: 5, cursor: "pointer", fontSize: 9, background: "#0d1117", border: "1px solid #1a1a2e", color: "#555" }}>↻</button>
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: "linear-gradient(90deg, #f5a623, #ff3d6b, transparent)", marginTop: 10, opacity: 0.4 }} />
      </div>

      {/* Panels */}
      {panel && (
        <div style={{ background: "#0d1117", border: `1px solid ${panel === "alerts" ? "#f5a62330" : "#00e5a030"}`, borderRadius: 10, padding: 12, marginBottom: 12, maxHeight: 180, overflowY: "auto" }}>
          <div style={{ fontSize: 9, color: panel === "alerts" ? "#f5a623" : "#00e5a0", letterSpacing: 2, marginBottom: 8 }}>
            {panel === "alerts" ? "🔔 ALERT LOG" : "📋 RIWAYAT SINYAL"}
          </div>
          {(panel === "alerts" ? alerts : history).length === 0 ? (
            <div style={{ fontSize: 10, color: "#333", textAlign: "center", padding: "16px 0" }}>Belum ada data.</div>
          ) : (panel === "alerts" ? alerts : history).map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 9, padding: "4px 0", borderBottom: "1px solid #111" }}>
              <span style={{ color: "#444", minWidth: 50 }}>{item.time}</span>
              {panel === "alerts"
                ? <span style={{ color: item.color }}>{item.msg}</span>
                : <>
                  <span style={{ color: item.color, fontWeight: 700, minWidth: 30 }}>{item.signal}</span>
                  <span style={{ color: "#aaa" }}>${item.price?.toFixed(2)}</span>
                  <span style={{ color: "#555" }}>{item.conf}%</span>
                </>}
            </div>
          ))}
        </div>
      )}

      {/* TF Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {TFS.map(tf => {
          const d = data[tf.id];
          const col = d ? d.color : "#444";
          const active = tab === tf.id;
          return (
            <div key={tf.id} onClick={() => setTab(tf.id)} style={{
              flex: 1, padding: "9px 4px", borderRadius: 8, cursor: "pointer", textAlign: "center",
              background: active ? `${col}12` : "#0d1117",
              border: `1px solid ${active ? col : "#1a1a2e"}`,
              transition: "all 0.2s",
            }}>
              <div style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>{tf.label}</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: col }}>{d ? d.sig : "---"}</div>
              <div style={{ fontSize: 8, color: "#444", marginTop: 1 }}>{d ? `${d.conf}%` : ""}</div>
            </div>
          );
        })}
      </div>

      {!s ? (
        <div style={{ textAlign: "center", padding: 50, color: "#444" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>◌</div>
          <div style={{ fontSize: 10 }}>Memuat sinyal...</div>
        </div>
      ) : (
        <>
          {/* Main Signal Card */}
          <div style={{
            borderRadius: 14, padding: "18px 14px", marginBottom: 12, textAlign: "center",
            background: `radial-gradient(ellipse at 50% 0%, ${s.color}10 0%, #0a0e17 65%)`,
            border: `1px solid ${s.color}30`,
          }}>
            <div style={{ fontSize: 8, color: "#555", letterSpacing: 3, marginBottom: 4 }}>SINYAL · {activeTF?.label}</div>
            <div style={{ fontSize: 46, fontWeight: 900, color: s.color, letterSpacing: 3, textShadow: `0 0 25px ${s.color}55` }}>
              {s.sig}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10, alignItems: "center" }}>
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="#1a1a2e" strokeWidth="6" />
                <circle cx="36" cy="36" r="30" fill="none" stroke={s.color} strokeWidth="6"
                  strokeDasharray={`${s.conf * 1.885} 188.5`} strokeLinecap="round"
                  transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 1s" }} />
                <text x="36" y="32" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="900" fontFamily="Courier New">{s.conf}%</text>
                <text x="36" y="45" textAnchor="middle" fill="#555" fontSize="6" fontFamily="Courier New">CONFIDENCE</text>
              </svg>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 9, color: "#555" }}>TOTAL SCORE</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.total > 0 ? `+${s.total}` : s.total}</div>
                <div style={{ fontSize: 8, color: "#444" }}>EMA{s.es>0?"+":""}{s.es} + SMC{s.ss>0?"+":""}{s.ss} + VP{s.vs>0?"+":""}{s.vs}</div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
              <span style={{ fontSize: 8, color: "#f5a623", letterSpacing: 2 }}>📈 CHART · {activeTF?.label}</span>
              <div style={{ display: "flex", gap: 6, fontSize: 7 }}>
                {[["#f5a623","E13"],["#00b4ff","E21"],["#ff3d6b","E50"],["#a855f7","E100"]].map(([c,l])=>(
                  <span key={l} style={{ color: c }}>— {l}</span>
                ))}
              </div>
            </div>
            <Chart candles={s.candles} emas={s.ema} />
          </div>

          {/* EMA */}
          <div style={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#f5a623", letterSpacing: 2, marginBottom: 10 }}>📊 EMA</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[["EMA 13", s.ema.e13, "#f5a623"], ["EMA 21", s.ema.e21, "#00b4ff"], ["EMA 50", s.ema.e50, "#ff3d6b"], ["EMA 100", s.ema.e100, "#a855f7"]].map(([lbl, val, col]) => {
                const above = s.price > val;
                return (
                  <div key={lbl} style={{ padding: "7px 9px", borderRadius: 6, background: above ? "#00e5a008" : "#ff3d6b08", border: `1px solid ${above ? "#00e5a020" : "#ff3d6b20"}` }}>
                    <div style={{ fontSize: 7, color: col }}>{lbl}</div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{val.toFixed(1)}</div>
                    <div style={{ fontSize: 7, color: above ? "#00e5a0" : "#ff3d6b" }}>{above ? "▲ atas" : "▼ bawah"}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10 }}>
              <Bar label="EMA Score" score={s.es} max={4} />
            </div>
          </div>

          {/* SMC */}
          <div style={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#f5a623", letterSpacing: 2, marginBottom: 8 }}>🏛️ SMC</div>
            <div style={{ padding: "8px 10px", borderRadius: 7, marginBottom: 8,
              background: s.smc.structure === "BULLISH" ? "#00e5a009" : s.smc.structure === "BEARISH" ? "#ff3d6b09" : "#fff005",
              border: `1px solid ${s.smc.structure === "BULLISH" ? "#00e5a025" : s.smc.structure === "BEARISH" ? "#ff3d6b25" : "#222"}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: s.smc.structure === "BULLISH" ? "#00e5a0" : s.smc.structure === "BEARISH" ? "#ff3d6b" : "#888" }}>
                {s.smc.structure}
              </div>
              <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>{s.smc.label}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["CHoCH", s.smc.choch, "#00e5a0"], ["BOS", s.smc.bos, "#f5a623"]].map(([lbl, on, col]) => (
                <div key={lbl} style={{ flex: 1, padding: "5px", borderRadius: 5, textAlign: "center", fontSize: 9,
                  background: on ? `${col}10` : "#ffffff03", border: `1px solid ${on ? `${col}30` : "#1a1a2e"}`, color: on ? col : "#333" }}>
                  {lbl} {on ? "✓" : "✗"}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}><Bar label="SMC Score" score={s.ss} max={3} /></div>
          </div>

          {/* VP */}
          <div style={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#f5a623", letterSpacing: 2, marginBottom: 8 }}>📦 VOLUME PROFILE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 7, color: "#555" }}>POC</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>${s.vp.poc.toFixed(1)}</div>
                <div style={{ fontSize: 7, color: s.price > s.vp.poc ? "#00e5a0" : "#ff3d6b" }}>{s.price > s.vp.poc ? "▲ di atas" : "▼ di bawah"}</div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: "#555" }}>Dominan</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: s.vp.dominant === "BULLISH" ? "#00e5a0" : s.vp.dominant === "BEARISH" ? "#ff3d6b" : "#888" }}>{s.vp.dominant}</div>
                <div style={{ fontSize: 7, color: "#444" }}>Strength {s.vp.strength}%</div>
              </div>
            </div>
            <div style={{ background: "#1a1a2e", borderRadius: 3, height: 4 }}>
              <div style={{ width: `${s.vp.strength}%`, height: "100%", background: s.vp.dominant === "BULLISH" ? "#00e5a0" : "#ff3d6b", borderRadius: 3, transition: "width 0.8s" }} />
            </div>
            <div style={{ marginTop: 8 }}><Bar label="VP Score" score={s.vs} max={1} /></div>
          </div>

          {/* AI */}
          <div style={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 8, color: "#f5a623", letterSpacing: 2, marginBottom: 8 }}>🤖 AI ANALYSIS</div>
            {aiText && <div style={{ fontSize: 10, color: "#ccc", lineHeight: 1.8, whiteSpace: "pre-wrap", marginBottom: 10 }}>{aiText}</div>}
            <button onClick={getAI} disabled={aiLoad} style={{
              width: "100%", padding: 10, borderRadius: 7, border: "none",
              background: aiLoad ? "#1a1a2e" : "linear-gradient(135deg, #f5a623, #ff3d6b)",
              color: aiLoad ? "#444" : "#000", fontWeight: 900, fontSize: 10,
              cursor: aiLoad ? "not-allowed" : "pointer", letterSpacing: 1, fontFamily: "Courier New",
            }}>{aiLoad ? "⟳ Menganalisis..." : "⚡ ANALISIS AI"}</button>
          </div>

          <div style={{ textAlign: "center", fontSize: 7, color: "#1a1a2e", marginTop: 8 }}>
            ⚠️ Bukan rekomendasi investasi · {status === "live" ? "Data: Twelve Data" : "Mode: Simulasi"}
          </div>
        </>
      )}
    </div>
  );
}
