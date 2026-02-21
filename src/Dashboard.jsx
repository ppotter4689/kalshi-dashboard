import { useState, useEffect, useCallback, useRef } from "react";

// ── CONFIG ──────────────────────────────────────────────────────────
// Option 1: Set VITE_BACKEND_URL at build time (e.g. in Railway/Render env vars)
// Option 2: Hardcode your backend URL below after deploying
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

function getBackendUrl() {
  if (BACKEND_URL) return BACKEND_URL.replace(/\/+$/, ""); // trim trailing slash
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return "";
}

// ── Parse Kalshi market data into dashboard format ──────────────────
function parseMarkets(rawMarkets, orderbooks) {
  return rawMarkets.map((m) => {
    const ob = orderbooks[m.ticker] || {};
    const yesBids = ob.yes || [];
    const noBids = ob.no || [];
    const bestYesBid = yesBids.length > 0 ? yesBids[0][0] : 0;
    const bestYesAsk = noBids.length > 0 ? 100 - noBids[0][0] : 0;
    const mid = bestYesBid && bestYesAsk ? Math.round((bestYesBid + bestYesAsk) / 2) : (m.last_price || 50);
    const spread = bestYesAsk - bestYesBid;
    return {
      ticker: m.ticker,
      title: m.title || m.subtitle || m.ticker,
      yesBid: bestYesBid || mid - 2,
      yesAsk: bestYesAsk || mid + 2,
      noBid: 100 - (bestYesAsk || mid + 2),
      noAsk: 100 - (bestYesBid || mid - 2),
      mid,
      spread: Math.max(0, spread),
      volume: m.volume || 0,
      status: m.status,
      openInterest: m.open_interest || 0,
      expirationTime: m.expiration_time || "",
    };
  });
}

// ── Simulated data (fallback) ───────────────────────────────────────
function generateSimMarkets(count = 8) {
  const types = ["HIGHTEMP", "LOWTEMP", "RAIN", "SP500", "CPI", "NFPAY", "BTCUSD", "FEDRATE"];
  const titles = [
    "NYC High Temp > 45°F Tomorrow", "Chicago Low Temp < 20°F Tomorrow",
    "LA Rain > 0.5in This Week", "S&P 500 Close > 6000 Friday",
    "January CPI > 3.0%", "Nonfarm Payrolls > 200K",
    "Bitcoin > $100K by March", "Fed Holds Rates in March",
  ];
  return Array.from({ length: count }, (_, i) => {
    const mid = 20 + Math.random() * 60;
    const spread = 2 + Math.random() * 8;
    const yesBid = Math.max(1, Math.round(mid - spread / 2));
    const noBid = Math.max(1, Math.round(100 - mid - spread / 2));
    return {
      ticker: `${types[i]}-SIM`, title: titles[i], yesBid,
      yesAsk: Math.min(99, yesBid + Math.round(spread)),
      noBid, noAsk: Math.min(99, noBid + Math.round(spread)),
      mid: Math.round(mid), spread: Math.round(spread),
      volume: Math.round(500 + Math.random() * 50000), status: "open",
    };
  });
}

function driftSimMarkets(markets) {
  return markets.map((m) => {
    const drift = (Math.random() - 0.5) * 4;
    const newMid = Math.max(5, Math.min(95, m.mid + drift));
    const s = Math.max(2, Math.round(m.spread + (Math.random() - 0.5) * 2));
    return {
      ...m, mid: Math.round(newMid),
      yesBid: Math.max(1, Math.round(newMid - s / 2)),
      yesAsk: Math.min(99, Math.round(newMid + s / 2)),
      noBid: Math.max(1, Math.round(100 - newMid - s / 2)),
      noAsk: Math.min(99, Math.round(100 - newMid + s / 2)),
      spread: s, volume: m.volume + Math.round(Math.random() * 100),
    };
  });
}

// ── Strategy evaluation ─────────────────────────────────────────────
function evaluateValueStrategy(market, params) {
  const { threshold, maxContracts, minConfidence } = params;
  const signals = [];
  const fair = market.mid + (Math.random() - 0.5) * 15;
  if (fair - market.yesAsk >= threshold) {
    const conf = Math.min((fair - market.yesAsk) / 100, 1.0);
    if (conf >= minConfidence) {
      signals.push({
        ticker: market.ticker, title: market.title, side: "YES", action: "BUY",
        price: market.yesAsk + 1, count: Math.min(maxContracts, 3),
        reason: `YES undervalued: ask=${market.yesAsk}¢, fair=${fair.toFixed(0)}¢`,
        confidence: conf, edge: fair - market.yesAsk,
      });
    }
  }
  const noFair = 100 - fair;
  const noAsk = 100 - market.yesBid;
  if (noFair - noAsk >= threshold) {
    const conf = Math.min((noFair - noAsk) / 100, 1.0);
    if (conf >= minConfidence) {
      signals.push({
        ticker: market.ticker, title: market.title, side: "NO", action: "BUY",
        price: noAsk + 1, count: Math.min(maxContracts, 3),
        reason: `NO undervalued: ask=${noAsk}¢, fair=${noFair.toFixed(0)}¢`,
        confidence: conf, edge: noFair - noAsk,
      });
    }
  }
  return signals;
}

function evaluateMMStrategy(market, params) {
  const half = Math.floor(params.spread / 2);
  return [
    { ticker: market.ticker, title: market.title, side: "YES", action: "BUY",
      price: Math.max(1, market.mid - half), count: params.size,
      reason: `MM yes bid: mid=${market.mid}¢`, confidence: 0.5, edge: half },
    { ticker: market.ticker, title: market.title, side: "NO", action: "BUY",
      price: Math.max(1, 100 - market.mid - half), count: params.size,
      reason: `MM no bid: mid=${market.mid}¢`, confidence: 0.5, edge: half },
  ];
}

// ── Sparkline ───────────────────────────────────────────────────────
function Sparkline({ data, width = 120, height = 32, color = "#22d3ee" }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

// ── Interactive Equity Chart ────────────────────────────────────────
function EquityChart({ data, height = 180 }) {
  const containerRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!data || data.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "11px" }}>
        Equity curve will appear after trades...
      </div>
    );
  }

  const marginLeft = 58, marginRight = 16, marginTop = 16, marginBottom = 24;
  const w = containerWidth - marginLeft - marginRight;
  const h = height - marginTop - marginBottom;
  const rawMin = Math.min(...data, 0);
  const rawMax = Math.max(...data, 0);
  const pad = Math.max(Math.abs(rawMax - rawMin) * 0.1, 10);
  const min = rawMin - pad, max = rawMax + pad;
  const range = max - min || 1;

  const toX = (i) => marginLeft + (i / (data.length - 1)) * w;
  const toY = (v) => marginTop + h - ((v - min) / range) * h;
  const zeroY = toY(0);
  const lastVal = data[data.length - 1];
  const isPositive = lastVal >= 0;
  const lineColor = isPositive ? "#22c55e" : "#ef4444";
  const fillColor = isPositive ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";
  const points = data.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const fillPoints = `${toX(0)},${zeroY} ${points} ${toX(data.length - 1)},${zeroY}`;

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const val = min + (range * i) / (tickCount - 1);
    return { val, y: toY(val) };
  });

  const handleMouse = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.round(((mx - marginLeft) / w) * (data.length - 1));
    if (idx >= 0 && idx < data.length) {
      setHover({ idx, x: toX(idx), y: toY(data[idx]), value: data[idx] });
    }
  };

  return (
    <div ref={containerRef} style={{ width: "100%", position: "relative" }}
      onMouseMove={handleMouse} onMouseLeave={() => setHover(null)}>
      <svg width={containerWidth} height={height} style={{ display: "block", cursor: "crosshair" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={marginLeft} y1={t.y} x2={containerWidth - marginRight} y2={t.y} stroke="#1a2236" strokeWidth="1" />
            <text x={marginLeft - 8} y={t.y + 4} textAnchor="end" fill="#475569" fontSize="10"
              fontFamily="'JetBrains Mono', monospace">
              {t.val >= 0 ? "+" : ""}{(t.val / 100).toFixed(2)}
            </text>
          </g>
        ))}
        {min < 0 && max > 0 && (
          <line x1={marginLeft} y1={zeroY} x2={containerWidth - marginRight} y2={zeroY}
            stroke="#334155" strokeWidth="1" strokeDasharray="6,4" />
        )}
        <polygon fill={fillColor} points={fillPoints} />
        <polyline fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" points={points} />
        {data.map((v, i) => {
          if (data.length > 20 && i % Math.ceil(data.length / 20) !== 0 && i !== data.length - 1) return null;
          return <circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill={v >= 0 ? "#22c55e" : "#ef4444"} stroke="#0a0e17" strokeWidth="1" />;
        })}
        {(() => {
          const lastX = toX(data.length - 1);
          const lastY = toY(lastVal);
          return (
            <g>
              <rect x={lastX + 6} y={lastY - 10} width={56} height={20} rx="3" fill={isPositive ? "#22c55e" : "#ef4444"} />
              <text x={lastX + 34} y={lastY + 4} textAnchor="middle" fill="#0a0e17" fontSize="10" fontWeight="700"
                fontFamily="'JetBrains Mono', monospace">
                {lastVal >= 0 ? "+" : ""}{(lastVal / 100).toFixed(2)}$
              </text>
            </g>
          );
        })()}
        {hover && (
          <g>
            <line x1={hover.x} y1={marginTop} x2={hover.x} y2={height - marginBottom} stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
            <line x1={marginLeft} y1={hover.y} x2={containerWidth - marginRight} y2={hover.y} stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={hover.x} cy={hover.y} r="5" fill={hover.value >= 0 ? "#22c55e" : "#ef4444"} stroke="#0a0e17" strokeWidth="2" />
            {(() => {
              const boxW = 100, boxH = 44;
              const flipX = hover.x + boxW + 20 > containerWidth;
              const bx = flipX ? hover.x - boxW - 12 : hover.x + 12;
              const by = Math.max(marginTop, Math.min(hover.y - boxH / 2, height - marginBottom - boxH));
              return (
                <g>
                  <rect x={bx} y={by} width={boxW} height={boxH} rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                  <text x={bx + 10} y={by + 16} fill="#94a3b8" fontSize="9" fontFamily="'JetBrains Mono', monospace">Cycle {hover.idx + 1}</text>
                  <text x={bx + 10} y={by + 34} fill={hover.value >= 0 ? "#22c55e" : "#ef4444"} fontSize="14" fontWeight="700"
                    fontFamily="'JetBrains Mono', monospace">
                    {hover.value >= 0 ? "+" : ""}{(hover.value / 100).toFixed(2)}$
                  </text>
                </g>
              );
            })()}
          </g>
        )}
        {data.map((_, i) => {
          const interval = Math.max(1, Math.ceil(data.length / 8));
          if (i % interval !== 0 && i !== data.length - 1) return null;
          return <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" fill="#334155" fontSize="9" fontFamily="'JetBrains Mono', monospace">{i + 1}</text>;
        })}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [mode, setMode] = useState("detecting"); // "detecting" | "live" | "sim"
  const [markets, setMarkets] = useState([]);
  const [priceHistory, setPriceHistory] = useState({});
  const [signals, setSignals] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState("value");
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [totalSignals, setTotalSignals] = useState(0);
  const [ordersPlaced, setOrdersPlaced] = useState(0);
  const [ordersRejected, setOrdersRejected] = useState(0);
  const [log, setLog] = useState([]);
  const logRef = useRef(null);

  // Live data
  const [liveBalance, setLiveBalance] = useState(null);
  const [livePositions, setLivePositions] = useState([]);
  const [liveFills, setLiveFills] = useState([]);
  const [lastFetchTime, setLastFetchTime] = useState(null);

  // P&L tracking
  const [portfolio, setPortfolio] = useState({
    balance: 10000, totalPnl: 0, positions: {}, closedTrades: [],
    equityCurve: [0], totalFees: 0,
  });
  const portfolioRef = useRef(portfolio);
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);

  const [valueParams, setValueParams] = useState({ threshold: 8, maxContracts: 5, minConfidence: 0.3 });
  const [mmParams, setMmParams] = useState({ spread: 6, size: 2 });
  const [riskParams, setRiskParams] = useState({ maxPositionPerMarket: 10, maxExposure: 5000, maxDailyLoss: 1000 });

  const addLog = useCallback((msg, level = "INFO") => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev.slice(-150), { time, level, msg }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ── Detect backend on mount ───────────────────────────────────────
  useEffect(() => {
    const url = getBackendUrl();
    if (!url) {
      setMode("sim");
      setMarkets(generateSimMarkets());
      return;
    }
    fetch(`${url}/api/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) {
          setMode("live");
          addLog("Connected to Kalshi demo API via backend", "SIGNAL");
        } else {
          setMode("sim");
          setMarkets(generateSimMarkets());
          addLog(`Backend found but Kalshi unreachable: ${data.error || "unknown"}`, "REJECT");
        }
      })
      .catch(() => {
        setMode("sim");
        setMarkets(generateSimMarkets());
        addLog("No backend detected — running in simulation mode");
      });
  }, [addLog]);

  // ── Fetch live data from backend ──────────────────────────────────
  const fetchLiveData = useCallback(async () => {
    const url = getBackendUrl();
    if (!url) return;
    try {
      const resp = await fetch(`${url}/api/dashboard?market_limit=20`);
      const data = await resp.json();

      if (data.errors && data.errors.length > 0) {
        data.errors.forEach((e) => addLog(`API error: ${e}`, "REJECT"));
      }

      // Update markets
      if (data.markets && data.markets.length > 0) {
        const parsed = parseMarkets(data.markets, data.orderbooks || {});
        setMarkets(parsed);
        setPriceHistory((hist) => {
          const newHist = { ...hist };
          parsed.forEach((m) => {
            const prev = newHist[m.ticker] || [];
            newHist[m.ticker] = [...prev.slice(-30), m.mid];
          });
          return newHist;
        });
      }

      // Update balance
      if (data.balance) {
        setLiveBalance(data.balance);
      }

      // Update positions
      if (data.positions) {
        setLivePositions(data.positions);
      }

      // Update fills
      if (data.fills) {
        setLiveFills(data.fills);
      }

      setLastFetchTime(new Date());
    } catch (e) {
      addLog(`Fetch error: ${e.message}`, "REJECT");
    }
  }, [addLog]);

  // ── Main loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      if (mode === "live") {
        fetchLiveData();
      } else {
        // Drift simulated markets
        setMarkets((prev) => {
          const updated = driftSimMarkets(prev);
          setPriceHistory((hist) => {
            const newHist = { ...hist };
            updated.forEach((m) => {
              const p = newHist[m.ticker] || [];
              newHist[m.ticker] = [...p.slice(-30), m.mid];
            });
            return newHist;
          });
          return updated;
        });
      }

      setCycleCount((c) => c + 1);

      // Run strategies against current markets
      setMarkets((currentMarkets) => {
        let newSignals = [];
        currentMarkets.forEach((m) => {
          if (activeStrategy === "value" || activeStrategy === "both")
            newSignals.push(...evaluateValueStrategy(m, valueParams));
          if (activeStrategy === "mm" || activeStrategy === "both")
            newSignals.push(...evaluateMMStrategy(m, mmParams));
        });

        let placed = 0, rejected = 0;
        const currentPortfolio = portfolioRef.current;
        const dailyLoss = currentPortfolio.totalPnl < 0 ? Math.abs(currentPortfolio.totalPnl) : 0;
        const checkedSignals = newSignals.map((sig) => {
          const cost = sig.price * sig.count;
          if (cost > riskParams.maxExposure) {
            rejected++;
            return { ...sig, status: "REJECTED", rejectReason: "Exposure limit" };
          }
          if (sig.confidence < valueParams.minConfidence && activeStrategy !== "mm") {
            rejected++;
            return { ...sig, status: "REJECTED", rejectReason: "Low confidence" };
          }
          // Check max position per market
          const posKey = `${sig.ticker}-${sig.side}`;
          const existingPos = currentPortfolio.positions[posKey];
          if (existingPos && existingPos.count >= riskParams.maxPositionPerMarket) {
            rejected++;
            return { ...sig, status: "REJECTED", rejectReason: "Position limit" };
          }
          // Check daily loss limit
          if (dailyLoss >= riskParams.maxDailyLoss) {
            rejected++;
            return { ...sig, status: "REJECTED", rejectReason: "Daily loss limit" };
          }
          placed++;
          return { ...sig, status: "APPROVED" };
        });

        // P&L simulation (applies in both modes — live orders would go through backend separately)
        setPortfolio((prev) => {
          const next = { ...prev, positions: { ...prev.positions } };
          const approved = checkedSignals.filter((s) => s.status === "APPROVED");
          approved.forEach((sig) => {
            const fee = Math.ceil(0.07 * sig.count * (sig.price / 100) * (1 - sig.price / 100) * 100);
            next.totalFees += fee;
            next.balance -= fee;
            const key = `${sig.ticker}-${sig.side}`;
            const existing = next.positions[key];
            if (existing) {
              const exitPrice = sig.side === "YES"
                ? currentMarkets.find((m) => m.ticker === sig.ticker)?.mid || sig.price
                : 100 - (currentMarkets.find((m) => m.ticker === sig.ticker)?.mid || sig.price);
              const pnl = (exitPrice - existing.avgPrice) * existing.count;
              next.totalPnl += pnl;
              next.balance += pnl;
              next.closedTrades = [...prev.closedTrades.slice(-50), {
                ticker: sig.ticker, side: sig.side, entryPrice: existing.avgPrice,
                exitPrice, count: existing.count, pnl,
                time: new Date().toLocaleTimeString("en-US", { hour12: false }),
              }];
              delete next.positions[key];
              addLog(`  ${pnl >= 0 ? "+" : ""}${(pnl / 100).toFixed(2)}$ ${sig.side} ${sig.ticker}`, pnl >= 0 ? "PROFIT" : "LOSS");
            } else {
              next.balance -= sig.price * sig.count;
              next.positions[key] = {
                side: sig.side, count: sig.count, avgPrice: sig.price, ticker: sig.ticker,
                entryTime: new Date().toLocaleTimeString("en-US", { hour12: false }),
              };
            }
          });
          let unrealized = 0;
          Object.values(next.positions).forEach((pos) => {
            const mkt = currentMarkets.find((m) => m.ticker === pos.ticker);
            if (mkt) {
              const cp = pos.side === "YES" ? mkt.mid : 100 - mkt.mid;
              unrealized += (cp - pos.avgPrice) * pos.count;
            }
          });
          next.equityCurve = [...prev.equityCurve.slice(-100), next.totalPnl + unrealized];
          return next;
        });

        if (checkedSignals.length > 0) {
          addLog(`Cycle ${mode === "live" ? "(LIVE)" : "(SIM)"} — ${checkedSignals.length} signals (${placed} approved, ${rejected} rejected)`);
          checkedSignals.filter((s) => s.status === "APPROVED").forEach((s) => {
            addLog(`  → ${s.action} ${s.side} ${s.ticker} @ ${s.price}¢ x${s.count} | edge: ${s.edge.toFixed(0)}¢`, "SIGNAL");
          });
        } else {
          addLog(`Cycle ${mode === "live" ? "(LIVE)" : "(SIM)"} — no signals`);
        }

        setSignals(checkedSignals);
        setTotalSignals((t) => t + checkedSignals.length);
        setOrdersPlaced((t) => t + placed);
        setOrdersRejected((t) => t + rejected);
        return currentMarkets;
      });
    }, mode === "live" ? 5000 : 3000); // slower polling for live to respect rate limits

    return () => clearInterval(interval);
  }, [isRunning, mode, activeStrategy, valueParams, mmParams, riskParams, addLog, fetchLiveData]);

  const resetStats = () => {
    setCycleCount(0); setTotalSignals(0); setOrdersPlaced(0); setOrdersRejected(0);
    setSignals([]); setLog([]); setPriceHistory({});
    setPortfolio({ balance: 10000, totalPnl: 0, positions: {}, closedTrades: [], equityCurve: [0], totalFees: 0 });
    addLog("Stats reset");
  };

  const positionCount = Object.keys(portfolio.positions).length;
  const lastEquity = portfolio.equityCurve[portfolio.equityCurve.length - 1] || 0;
  const winningTrades = portfolio.closedTrades.filter((t) => t.pnl > 0).length;
  const totalClosed = portfolio.closedTrades.length;
  const winRate = totalClosed > 0 ? ((winningTrades / totalClosed) * 100).toFixed(0) : "—";

  const displayBalance = mode === "live" && liveBalance
    ? `$${((liveBalance.balance || 0) / 100).toFixed(2)}`
    : `$${(portfolio.balance / 100).toFixed(2)}`;

  // ── Mode badge ────────────────────────────────────────────────────
  const modeBadge = {
    detecting: { label: "DETECTING...", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    live: { label: "LIVE — KALSHI DEMO", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
    sim: { label: "SIMULATION", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  }[mode];

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0e17", color: "#c8d6e5",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      fontSize: "13px", padding: "20px", boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", borderBottom: "1px solid #1a2236", paddingBottom: "16px",
        flexWrap: "wrap", gap: "10px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{
            width: "10px", height: "10px", borderRadius: "50%",
            background: isRunning ? "#22d3ee" : "#475569",
            boxShadow: isRunning ? "0 0 12px #22d3ee" : "none",
            animation: isRunning ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontSize: "18px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>KALSHI TRADING BOT</span>
          <span style={{
            fontSize: "10px", fontWeight: 600, letterSpacing: "0.5px",
            padding: "3px 8px", borderRadius: "3px",
            color: modeBadge.color, background: modeBadge.bg,
            border: `1px solid ${modeBadge.color}33`,
          }}>{modeBadge.label}</span>
          {mode === "live" && lastFetchTime && (
            <span style={{ color: "#334155", fontSize: "10px" }}>
              Last update: {lastFetchTime.toLocaleTimeString("en-US", { hour12: false })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {mode === "sim" && (
            <button onClick={() => {
              const url = getBackendUrl();
              if (url) {
                setMode("detecting");
                fetch(`${url}/api/status`).then(r => r.json()).then(d => {
                  if (d.connected) { setMode("live"); addLog("Reconnected to Kalshi demo", "SIGNAL"); }
                  else { setMode("sim"); addLog("Still unable to reach Kalshi", "REJECT"); }
                }).catch(() => { setMode("sim"); addLog("Backend not found"); });
              }
            }} style={{
              background: "transparent", color: "#64748b", border: "1px solid #1e293b",
              padding: "8px 12px", borderRadius: "4px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
            }}>RETRY LIVE</button>
          )}
          <button onClick={() => { setIsRunning(!isRunning); addLog(isRunning ? "Bot stopped" : "Bot started"); }}
            style={{
              background: isRunning ? "#dc2626" : "#059669", color: "#fff", border: "none",
              padding: "8px 20px", borderRadius: "4px", cursor: "pointer",
              fontFamily: "inherit", fontSize: "12px", fontWeight: 600, letterSpacing: "0.5px",
            }}>
            {isRunning ? "■ STOP" : "▶ START"}
          </button>
          <button onClick={resetStats} style={{
            background: "transparent", color: "#64748b", border: "1px solid #1e293b",
            padding: "8px 16px", borderRadius: "4px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px",
          }}>RESET</button>
        </div>
      </div>

      {/* P&L banner */}
      <div className="pnl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "TOTAL P&L", value: `${lastEquity >= 0 ? "+" : ""}${(lastEquity / 100).toFixed(2)}`, unit: "$", color: lastEquity >= 0 ? "#22c55e" : "#ef4444" },
          { label: "REALIZED", value: `${portfolio.totalPnl >= 0 ? "+" : ""}${(portfolio.totalPnl / 100).toFixed(2)}`, unit: "$", color: portfolio.totalPnl >= 0 ? "#22c55e" : "#ef4444" },
          { label: "BALANCE", value: displayBalance, unit: "", color: "#22d3ee" },
          { label: "FEES PAID", value: `$${(portfolio.totalFees / 100).toFixed(2)}`, unit: "", color: "#f59e0b" },
          { label: "WIN RATE", value: winRate, unit: winRate !== "—" ? "%" : "", color: "#94a3b8" },
          { label: "TRADES", value: totalClosed, color: "#94a3b8" },
        ].map(({ label, value, unit = "", color }) => (
          <div key={label} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: "6px", padding: "12px 14px" }}>
            <div style={{ color: "#475569", fontSize: "10px", letterSpacing: "1px", marginBottom: "4px" }}>{label}</div>
            <div style={{ color, fontSize: "20px", fontWeight: 700 }}>{value}<span style={{ fontSize: "12px", opacity: 0.7 }}>{unit}</span></div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <Panel title="EQUITY CURVE" style={{ marginBottom: "16px" }}>
        <EquityChart data={portfolio.equityCurve} />
      </Panel>

      {/* Main grid */}
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "16px" }}>
        {/* Left panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Panel title="STRATEGY">
            <div style={{ display: "flex", gap: "6px" }}>
              {["value", "mm", "both"].map((s) => (
                <button key={s} onClick={() => setActiveStrategy(s)} style={{
                  flex: 1, background: activeStrategy === s ? "#22d3ee" : "transparent",
                  color: activeStrategy === s ? "#0a0e17" : "#64748b",
                  border: `1px solid ${activeStrategy === s ? "#22d3ee" : "#1e293b"}`,
                  padding: "6px", borderRadius: "4px", cursor: "pointer",
                  fontFamily: "inherit", fontSize: "11px", fontWeight: activeStrategy === s ? 700 : 400,
                }}>{s === "value" ? "VALUE" : s === "mm" ? "MM" : "BOTH"}</button>
              ))}
            </div>
          </Panel>

          {(activeStrategy === "value" || activeStrategy === "both") && (
            <Panel title="VALUE DEVIATION">
              <Slider label="Edge Threshold" unit="¢" value={valueParams.threshold} min={1} max={20}
                onChange={(v) => setValueParams({ ...valueParams, threshold: v })} />
              <Slider label="Max Contracts" value={valueParams.maxContracts} min={1} max={20}
                onChange={(v) => setValueParams({ ...valueParams, maxContracts: v })} />
              <Slider label="Min Confidence" value={valueParams.minConfidence} min={0} max={1} step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => setValueParams({ ...valueParams, minConfidence: v })} />
            </Panel>
          )}

          {(activeStrategy === "mm" || activeStrategy === "both") && (
            <Panel title="MARKET MAKER">
              <Slider label="Spread" unit="¢" value={mmParams.spread} min={2} max={20}
                onChange={(v) => setMmParams({ ...mmParams, spread: v })} />
              <Slider label="Quote Size" value={mmParams.size} min={1} max={10}
                onChange={(v) => setMmParams({ ...mmParams, size: v })} />
            </Panel>
          )}

          <Panel title="RISK LIMITS">
            <Slider label="Max Position" value={riskParams.maxPositionPerMarket} min={1} max={50}
              onChange={(v) => setRiskParams({ ...riskParams, maxPositionPerMarket: v })} />
            <Slider label="Max Exposure" value={riskParams.maxExposure} min={500} max={20000} step={500}
              format={(v) => `$${(v / 100).toFixed(0)}`}
              onChange={(v) => setRiskParams({ ...riskParams, maxExposure: v })} />
            <Slider label="Daily Loss Limit" value={riskParams.maxDailyLoss} min={100} max={10000} step={100}
              format={(v) => `$${(v / 100).toFixed(0)}`}
              onChange={(v) => setRiskParams({ ...riskParams, maxDailyLoss: v })} />
          </Panel>

          {/* Live positions from Kalshi */}
          {mode === "live" && livePositions.length > 0 && (
            <Panel title="KALSHI POSITIONS">
              {livePositions.map((pos, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "6px 0", borderBottom: "1px solid #1a2236", fontSize: "11px",
                }}>
                  <div>
                    <span style={{ color: "#22d3ee", fontWeight: 600 }}>{pos.ticker || pos.market_ticker}</span>
                    <span style={{ color: "#475569", marginLeft: "6px" }}>
                      {pos.market_exposure ? `$${(pos.market_exposure / 100).toFixed(2)}` : ""}
                    </span>
                  </div>
                  <span style={{ color: "#94a3b8" }}>
                    {pos.position || 0} contracts
                  </span>
                </div>
              ))}
            </Panel>
          )}

          {/* Simulated open positions */}
          {Object.keys(portfolio.positions).length > 0 && (
            <Panel title="OPEN POSITIONS">
              {Object.entries(portfolio.positions).map(([key, pos]) => {
                const mkt = markets.find((m) => m.ticker === pos.ticker);
                const currentPrice = mkt ? (pos.side === "YES" ? mkt.mid : 100 - mkt.mid) : pos.avgPrice;
                const unrealized = (currentPrice - pos.avgPrice) * pos.count;
                return (
                  <div key={key} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "6px 0", borderBottom: "1px solid #1a2236", fontSize: "11px",
                  }}>
                    <div>
                      <span style={{ color: pos.side === "YES" ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{pos.side}</span>
                      <span style={{ color: "#94a3b8", marginLeft: "6px" }}>{pos.ticker}</span>
                      <span style={{ color: "#475569", marginLeft: "6px" }}>x{pos.count} @ {pos.avgPrice}¢</span>
                    </div>
                    <span style={{ color: unrealized >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                      {unrealized >= 0 ? "+" : ""}{unrealized.toFixed(0)}¢
                    </span>
                  </div>
                );
              })}
            </Panel>
          )}

          {/* Recent closed trades */}
          {portfolio.closedTrades.length > 0 && (
            <Panel title="RECENT TRADES">
              {portfolio.closedTrades.slice(-8).reverse().map((t, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "4px 0", borderBottom: "1px solid #111827", fontSize: "11px",
                }}>
                  <div>
                    <span style={{ color: "#475569", marginRight: "6px" }}>{t.time}</span>
                    <span style={{ color: t.side === "YES" ? "#22c55e" : "#ef4444" }}>{t.side}</span>
                    <span style={{ color: "#64748b", marginLeft: "4px" }}>{t.ticker.split("-")[0]}</span>
                  </div>
                  <span style={{ color: t.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {t.pnl >= 0 ? "+" : ""}{(t.pnl / 100).toFixed(2)}$
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </div>

        {/* Right panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Panel title={`MARKETS${mode === "live" ? " (LIVE)" : " (SIMULATED)"} — ${markets.length} active`}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", minWidth: "700px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b" }}>
                    {["TICKER", "TITLE", "YES BID", "YES ASK", "MID", "SPREAD", "TREND", "VOL"].map((h) => (
                      <th key={h} style={{
                        textAlign: "left", padding: "8px 10px", color: "#475569",
                        fontSize: "10px", letterSpacing: "0.5px", fontWeight: 500,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => {
                    const hasSignal = signals.some((s) => s.ticker === m.ticker && s.status === "APPROVED");
                    const hasPosition = Object.values(portfolio.positions).some((p) => p.ticker === m.ticker);
                    return (
                      <tr key={m.ticker} style={{
                        borderBottom: "1px solid #111827",
                        background: hasPosition ? "rgba(34,211,238,0.06)" : hasSignal ? "rgba(34,211,238,0.03)" : "transparent",
                      }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, fontSize: "11px" }}>
                          <span style={{ color: "#22d3ee" }}>{m.ticker}</span>
                          {hasPosition && <span style={{ color: "#f59e0b", marginLeft: "4px", fontSize: "9px" }}>●</span>}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#94a3b8", fontSize: "11px", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</td>
                        <td style={{ padding: "8px 10px", color: "#22c55e" }}>{m.yesBid}¢</td>
                        <td style={{ padding: "8px 10px", color: "#ef4444" }}>{m.yesAsk}¢</td>
                        <td style={{ padding: "8px 10px", color: "#f1f5f9", fontWeight: 600 }}>{m.mid}¢</td>
                        <td style={{ padding: "8px 10px", color: m.spread > 6 ? "#f59e0b" : "#475569" }}>{m.spread}¢</td>
                        <td style={{ padding: "8px 10px" }}><Sparkline data={priceHistory[m.ticker]} /></td>
                        <td style={{ padding: "8px 10px", color: "#475569", fontSize: "11px" }}>
                          {m.volume > 1000 ? `${(m.volume / 1000).toFixed(1)}K` : m.volume}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {signals.length > 0 && (
            <Panel title={`SIGNALS — CYCLE ${cycleCount}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {signals.map((s, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px",
                    borderRadius: "4px", fontSize: "11px",
                    background: s.status === "APPROVED" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                    border: `1px solid ${s.status === "APPROVED" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"}`,
                  }}>
                    <span style={{ color: s.status === "APPROVED" ? "#22c55e" : "#ef4444", fontWeight: 700, width: "16px" }}>
                      {s.status === "APPROVED" ? "✓" : "✗"}
                    </span>
                    <span style={{ color: "#22d3ee", fontWeight: 600, minWidth: "140px" }}>{s.ticker}</span>
                    <span style={{ color: s.side === "YES" ? "#22c55e" : "#ef4444", fontWeight: 600, minWidth: "32px" }}>{s.side}</span>
                    <span style={{ color: "#94a3b8", minWidth: "60px" }}>@ {s.price}¢ x{s.count}</span>
                    <span style={{ color: "#f59e0b", minWidth: "50px" }}>+{s.edge.toFixed(0)}¢</span>
                    <span style={{ color: "#475569", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.status === "REJECTED" ? s.rejectReason : s.reason}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="LOG" style={{ flex: 1, minHeight: "200px" }}>
            <div ref={logRef} style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1px" }}>
              {log.length === 0 && (
                <div style={{ color: "#334155", padding: "20px", textAlign: "center" }}>Press START to begin...</div>
              )}
              {log.map((entry, i) => (
                <div key={i} style={{
                  fontSize: "11px", padding: "2px 0",
                  color: entry.level === "SIGNAL" ? "#22c55e" : entry.level === "REJECT" ? "#ef4444"
                    : entry.level === "PROFIT" ? "#22c55e" : entry.level === "LOSS" ? "#ef4444" : "#64748b",
                }}>
                  <span style={{ color: "#334155" }}>{entry.time}</span> {entry.msg}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0e17; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        input[type="range"] { -webkit-appearance: none; appearance: none; height: 4px; background: #1e293b; border-radius: 2px; outline: none; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #22d3ee; cursor: pointer; border: 2px solid #0a0e17; }
        input[type="range"]:active { height: 6px; }
        @media (max-width: 768px) {
          .pnl-grid { grid-template-columns: repeat(3, 1fr) !important; gap: 8px !important; }
          .main-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
          .pnl-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function Panel({ title, children, style = {} }) {
  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: "6px", overflow: "hidden", ...style }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e293b", fontSize: "10px", fontWeight: 600, letterSpacing: "1px", color: "#475569" }}>{title}</div>
      <div style={{ padding: "14px" }}>{children}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = "", format, onChange }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ color: "#94a3b8", fontSize: "11px" }}>{label}</span>
        <span style={{ color: "#22d3ee", fontWeight: 600, fontSize: "12px" }}>{format ? format(value) : `${value}${unit}`}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} />
    </div>
  );
}
