import { useState, useEffect, useCallback } from "react";
import { fetchAllAlphaData } from "./alpha/api.js";
import { scoreAlphaSignals, extractNarrativeSignals, extractSocialPosts } from "./alpha/scoring.js";
import { ALPHA_TIER_CONFIG, ALPHA_DIMENSION_LABELS, SENTIMENT_COLORS } from "./alpha/constants.js";

function fN(v) { return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v.toFixed(0)}`; }
function fP(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
function timeAgo(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function SentimentBadge({ label }) {
  const color = SENTIMENT_COLORS[label] || "#555577";
  return (
    <span style={{
      color,
      background: color + "15",
      border: `1px solid ${color}40`,
      padding: "1px 6px",
      borderRadius: "3px",
      fontSize: "9px",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}

function DimensionBar({ value, color }) {
  return (
    <div style={{ width: "48px", height: "6px", background: "#0a0a14", borderRadius: "3px", overflow: "hidden", display: "inline-block" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: color, borderRadius: "3px" }} />
    </div>
  );
}

function SocialPostCard({ post }) {
  const sentColor = post.sentiment > 60 ? "#33bb66" : post.sentiment < 40 ? "#ff4455" : "#ddaa00";
  const netIcon = post.network === "reddit" ? "\u{1F4AC}" : post.network === "youtube" ? "\u{1F3AC}" : "\u{1D54F}";
  return (
    <div style={{
      background: "#0b0b15",
      borderLeft: `3px solid ${sentColor}`,
      borderRadius: "0 4px 4px 0",
      padding: "10px 14px",
      marginBottom: "6px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px" }}>{netIcon}</span>
          <span style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px" }}>@{post.creator}</span>
          {post.interactions > 0 && (
            <span style={{ color: "#444466", fontSize: "9px" }}>{fN(post.interactions)} engagements</span>
          )}
        </div>
        <span style={{ color: "#2a2a44", fontSize: "9px" }}>{post.timestamp ? timeAgo(post.timestamp) : ""}</span>
      </div>
      <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0, wordBreak: "break-word" }}>
        {post.text.length > 280 ? post.text.substring(0, 280) + "..." : post.text}
      </p>
      {post.url && (
        <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: "#4444aa", fontSize: "9px", textDecoration: "none" }}>
          view post \u2197
        </a>
      )}
    </div>
  );
}

function NarrativeCard({ signal }) {
  return (
    <div style={{
      background: "#0b0b15",
      borderLeft: "3px solid #8855ff",
      borderRadius: "0 4px 4px 0",
      padding: "10px 14px",
      marginBottom: "6px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ color: "#aa88ff", fontWeight: 600, fontSize: "11px" }}>{signal.title}</span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ color: "#333355", fontSize: "9px", textTransform: "uppercase" }}>{signal.source}</span>
          {signal.engagement > 0 && (
            <span style={{ color: "#444466", fontSize: "9px" }}>{fN(signal.engagement)}</span>
          )}
        </div>
      </div>
      <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>
        {signal.snippet.length > 300 ? signal.snippet.substring(0, 300) + "..." : signal.snippet}
      </p>
      {signal.url && (
        <a href={signal.url} target="_blank" rel="noopener noreferrer" style={{ color: "#4444aa", fontSize: "9px", textDecoration: "none" }}>
          source \u2197
        </a>
      )}
    </div>
  );
}

function MemeCard({ coin }) {
  const isUp = num(coin.percent_change_24h || coin.price_change_24h) >= 0;
  const change = num(coin.percent_change_24h || coin.price_change_24h);
  const accentColor = isUp ? "#33bb66" : "#ff4455";
  return (
    <div style={{
      background: "#0b0b15",
      border: `1px solid ${accentColor}20`,
      borderRadius: "4px",
      padding: "10px 14px",
      minWidth: "200px",
      flex: "0 0 auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ color: "#b0b0cc", fontWeight: 600, fontSize: "12px" }}>
          {coin.symbol || coin.s || "???"}
        </span>
        <span style={{ color: accentColor, fontSize: "11px", fontWeight: 700 }}>
          {fP(change)}
        </span>
      </div>
      <div style={{ color: "#555577", fontSize: "10px" }}>
        {coin.name || coin.n || ""}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", color: "#444466", fontSize: "9px" }}>
        <span>{fN(num(coin.interactions || 0))} interactions</span>
        <span>sent: {num(coin.sentiment || 50).toFixed(0)}</span>
      </div>
    </div>
  );
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function ErrorList({ errors }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div style={{ margin: "8px 18px", padding: "8px 12px", background: "#ff000f08", border: "1px solid #ff003315", borderRadius: "4px" }}>
      {errors.map((e, i) => (
        <div key={i} style={{ color: "#ff6655", fontSize: "10px", marginBottom: "2px" }}>
          <span style={{ color: "#ff335540" }}>{e.source}:</span> {e.error}
        </div>
      ))}
    </div>
  );
}

export default function AlphaScanner() {
  const [loading, setLoading] = useState(false);
  const [ts, setTs] = useState(null);
  const [errors, setErrors] = useState([]);
  const [alphaScores, setAlphaScores] = useState([]);
  const [socialPosts, setSocialPosts] = useState([]);
  const [narrativeSignals, setNarrativeSignals] = useState([]);
  const [memeCoins, setMemeCoins] = useState([]);
  const [dsTwitterPosts, setDsTwitterPosts] = useState([]);
  const [taoTopic, setTaoTopic] = useState(null);
  const [taoNews, setTaoNews] = useState([]);
  const [sortBy, setSortBy] = useState("composite");
  const [sortDir, setSortDir] = useState("desc");
  const [panel, setPanel] = useState("all"); // all, social, narrative, scores

  const scan = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const data = await fetchAllAlphaData();
      setErrors(data.errors);

      // Score Bittensor ecosystem coins
      const btCoins = data.bittensorCoins?.data || data.bittensorCoins || [];
      if (Array.isArray(btCoins) && btCoins.length > 0) {
        const scored = scoreAlphaSignals(btCoins);
        setAlphaScores(scored);
      }

      // Meme coins
      const memes = data.memeCoins?.data || data.memeCoins || [];
      if (Array.isArray(memes)) setMemeCoins(memes.slice(0, 10));

      // TAO topic summary
      if (data.taoTopic) setTaoTopic(data.taoTopic?.data || data.taoTopic);

      // Social posts
      const posts = extractSocialPosts(data.taoPosts);
      setSocialPosts(posts);

      // News from LunarCrush
      const news = data.taoNews?.data || data.taoNews || [];
      if (Array.isArray(news)) setTaoNews(news.slice(0, 8));

      // Desearch Twitter posts (separate feed)
      const dsTweets = extractNarrativeSignals(data.desearchTwitter);
      setDsTwitterPosts(dsTweets.slice(0, 10));

      // Narrative signals from Desearch AI
      const dsNarrative = extractNarrativeSignals(data.desearchNarrative);
      setNarrativeSignals(dsNarrative.slice(0, 15));

      setTs(new Date());
    } catch (e) {
      setErrors([{ source: "general", error: e.message }]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, []);

  const sortedScores = [...alphaScores].sort((a, b) => {
    let aVal, bVal;
    if (sortBy === "composite") { aVal = a.composite; bVal = b.composite; }
    else if (ALPHA_DIMENSION_LABELS[sortBy]) { aVal = a.dimensions[sortBy]; bVal = b.dimensions[sortBy]; }
    else { aVal = a.composite; bVal = b.composite; }
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const signalCount = alphaScores.filter(s => s.tier === "signal").length;

  const S = {
    root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", color: "#b0b0cc", minHeight: "100vh", fontSize: "12px" },
    header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" },
    title: { color: "#ff8833", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
    btn: (dis) => ({ background: dis ? "#10101e" : "#1818cc", border: "none", color: dis ? "#2a2a44" : "#fff", padding: "6px 16px", borderRadius: "3px", cursor: dis ? "not-allowed" : "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.05em" }),
    filterBtn: (active) => ({ background: active ? "#1a1a3a" : "transparent", border: `1px solid ${active ? "#333366" : "#1a1a2e"}`, color: active ? "#8888cc" : "#333355", padding: "3px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit" }),
    section: { padding: "14px 18px", borderBottom: "1px solid #0d0d1e" },
    sectionTitle: { color: "#333355", fontSize: "10px", letterSpacing: "0.15em", fontWeight: 600, marginBottom: "10px" },
    th: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", cursor: "pointer", userSelect: "none" },
    thLeft: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" },
    cell: { padding: "8px 8px", textAlign: "right" },
    cellLeft: { padding: "8px 8px", textAlign: "left" },
  };

  const showAll = panel === "all";

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\u26A1"} ALPHA SIGNALS</span>
          {signalCount > 0 && (
            <span style={{ background: "#33bb6622", border: "1px solid #33bb66", color: "#33bb66", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", animation: "pulse 1.2s infinite" }}>
              {signalCount} SIGNAL{signalCount > 1 ? "S" : ""}
            </span>
          )}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <button onClick={() => setPanel("all")} style={S.filterBtn(panel === "all")}>ALL</button>
          <button onClick={() => setPanel("social")} style={S.filterBtn(panel === "social")}>SOCIAL</button>
          <button onClick={() => setPanel("narrative")} style={S.filterBtn(panel === "narrative")}>NARRATIVE</button>
          <button onClick={() => setPanel("scores")} style={S.filterBtn(panel === "scores")}>SCORES</button>
          <div style={{ width: "8px" }} />
          <button onClick={scan} disabled={loading} style={S.btn(loading)}>
            {loading ? "SCANNING..." : "\u27F3 SCAN ALPHA"}
          </button>
        </div>
      </div>

      {/* Errors */}
      <ErrorList errors={errors} />

      {/* Loading */}
      {loading && alphaScores.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u26A1"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>SCANNING SOCIAL SIGNALS...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>LunarCrush + Desearch</div>
        </div>
      )}

      {/* TAO Topic Overview */}
      {taoTopic && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u25C8"} BITTENSOR SOCIAL PULSE</div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {[
              { label: "SENTIMENT", value: num(taoTopic.sentiment || taoTopic.topic_sentiment).toFixed(0), color: num(taoTopic.sentiment || taoTopic.topic_sentiment) > 60 ? "#33bb66" : num(taoTopic.sentiment || taoTopic.topic_sentiment) < 40 ? "#ff4455" : "#ddaa00" },
              { label: "GALAXY SCORE", value: num(taoTopic.galaxy_score || taoTopic.topic_galaxy_score).toFixed(0), color: "#8855ff" },
              { label: "INTERACTIONS", value: fN(num(taoTopic.interactions || taoTopic.topic_interactions || 0)), color: "#4488ff" },
              { label: "MENTIONS", value: fN(num(taoTopic.posts_active || taoTopic.topic_posts_active || 0)), color: "#dd44ff" },
              { label: "CREATORS", value: fN(num(taoTopic.contributors_active || taoTopic.topic_contributors_active || 0)), color: "#33bbcc" },
              { label: "SOCIAL DOM", value: num(taoTopic.social_dominance || taoTopic.topic_social_dominance || 0).toFixed(3) + "%", color: "#ff8833" },
            ].map(m => (
              <div key={m.label} style={{ background: "#0a0a14", border: "1px solid #131326", borderRadius: "4px", padding: "10px 16px", minWidth: "120px" }}>
                <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "4px" }}>{m.label}</div>
                <div style={{ color: m.color, fontSize: "18px", fontWeight: 700 }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meme Sector Radar */}
      {memeCoins.length > 0 && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F525}"} MEME RADAR — TRENDING BY INTERACTIONS</div>
          <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
            {memeCoins.map((c, i) => <MemeCard key={c.id || c.symbol || i} coin={c} />)}
          </div>
        </div>
      )}

      {/* Desearch X/Twitter Feed */}
      {dsTwitterPosts.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1D54F}"} DESEARCH X FEED — LIVE BITTENSOR CHATTER</div>
          {dsTwitterPosts.map((s, i) => <NarrativeCard key={s.id || i} signal={s} />)}
        </div>
      )}

      {/* Narrative Intel (Desearch) */}
      {narrativeSignals.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F50D}"} NARRATIVE INTEL — DESEARCH AI + X</div>
          {narrativeSignals.map((s, i) => <NarrativeCard key={s.id || i} signal={s} />)}
        </div>
      )}

      {/* Social Posts (LunarCrush) */}
      {socialPosts.length > 0 && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1D54F}"} BITTENSOR SOCIAL FEED — TOP POSTS</div>
          {socialPosts.map((p, i) => <SocialPostCard key={p.id || i} post={p} />)}
        </div>
      )}

      {/* News Feed */}
      {taoNews.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F4F0}"} BITTENSOR NEWS</div>
          {taoNews.map((n, i) => (
            <div key={i} style={{ background: "#0b0b15", borderLeft: "3px solid #4488ff", borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px" }}>{n.title || n.post_title || "News"}</span>
                <span style={{ color: "#2a2a44", fontSize: "9px" }}>{n.time ? timeAgo(n.time) : ""}</span>
              </div>
              {(n.description || n.body || n.post_body) && (
                <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>
                  {(n.description || n.body || n.post_body || "").substring(0, 200)}
                </p>
              )}
              {(n.url || n.post_url) && (
                <a href={n.url || n.post_url} target="_blank" rel="noopener noreferrer" style={{ color: "#4444aa", fontSize: "9px", textDecoration: "none" }}>
                  read more \u2197
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Alpha Signal Score Table */}
      {sortedScores.length > 0 && (showAll || panel === "scores") && (
        <div style={{ ...S.section, padding: "14px 0" }}>
          <div style={{ ...S.sectionTitle, padding: "0 18px" }}>{"\u26A1"} ALPHA SIGNAL SCORE — SOCIAL + SENTIMENT + NARRATIVE + ON-CHAIN</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
              <thead>
                <tr style={{ background: "#0a0a14", borderBottom: "1px solid #131326" }}>
                  <th style={{ ...S.thLeft, width: "30px" }}>#</th>
                  <th style={S.thLeft}>TOKEN</th>
                  <th style={S.th} onClick={() => toggleSort("composite")}>
                    ALPHA {sortBy === "composite" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th}>TIER</th>
                  <th style={S.th}>SENT</th>
                  <th style={S.th} onClick={() => toggleSort("SOCIAL")}>
                    SOCIAL {sortBy === "SOCIAL" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th} onClick={() => toggleSort("SENTIMENT")}>
                    SENTMNT {sortBy === "SENTIMENT" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th} onClick={() => toggleSort("NARRATIVE")}>
                    NARRTV {sortBy === "NARRATIVE" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th} onClick={() => toggleSort("ONCHAIN")}>
                    ONCHAIN {sortBy === "ONCHAIN" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th}>PRICE</th>
                  <th style={S.th}>24H</th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((s, i) => {
                  const cfg = ALPHA_TIER_CONFIG[s.tier];
                  const rowBg = i % 2 === 0 ? "#0b0b15" : "#090912";
                  const changeColor = s.priceChange >= 0 ? "#33bb66" : "#ff4455";
                  return (
                    <tr key={s.symbol + i} className="trow" style={{ background: rowBg, borderBottom: "1px solid #0e0e18" }}>
                      <td style={{ ...S.cellLeft, color: "#1e1e33" }}>{i + 1}</td>
                      <td style={S.cellLeft}>
                        <span style={{ color: "#b0b0cc", fontWeight: 500 }}>{s.symbol?.toUpperCase()}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>{s.name}</span>
                      </td>
                      <td style={S.cell}>
                        <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700 }}>
                          {s.composite}
                        </span>
                      </td>
                      <td style={{ ...S.cell, color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em" }}>
                        {cfg.label}
                      </td>
                      <td style={S.cell}>
                        <SentimentBadge label={s.sentimentLabel} />
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.SOCIAL} color="#4488ff" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.SOCIAL.toFixed(0)}</span>
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.SENTIMENT} color="#33bb66" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.SENTIMENT.toFixed(0)}</span>
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.NARRATIVE} color="#dd44ff" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.NARRATIVE.toFixed(0)}</span>
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.ONCHAIN} color="#ff8833" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.ONCHAIN.toFixed(0)}</span>
                      </td>
                      <td style={{ ...S.cell, color: "#8888aa", fontSize: "11px" }}>
                        ${s.price > 0 ? s.price.toFixed(s.price < 1 ? 6 : 2) : "-"}
                      </td>
                      <td style={{ ...S.cell, color: changeColor, fontSize: "11px", fontWeight: 600 }}>
                        {fP(s.priceChange)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>Data: LunarCrush + Desearch {"\u00B7"} Alpha Score = Social + Sentiment + Narrative + On-Chain (percentile-ranked) {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Early Alpha Intelligence</span>
      </div>
    </div>
  );
}
