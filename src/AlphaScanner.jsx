import { useState, useEffect, useCallback } from "react";
import { fetchAllAlphaData } from "./alpha/api.js";
import { scoreAlphaSignals, extractSocialPosts } from "./alpha/scoring.js";
import { ALPHA_TIER_CONFIG, ALPHA_DIMENSION_LABELS, SENTIMENT_COLORS } from "./alpha/constants.js";

function fN(v) { return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v.toFixed(0)}`; }
function fP(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}
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
      color, background: color + "15", border: `1px solid ${color}40`,
      padding: "1px 6px", borderRadius: "3px", fontSize: "9px",
      fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
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

// ─── Desearch Tweet Card ───────────────────────────────────
function TweetCard({ tweet, sentiment }) {
  const sentColor = sentiment === "POSITIVE" ? "#33bb66" : sentiment === "NEGATIVE" ? "#ff4455" : "#ddaa00";
  const sentLabel = sentiment === "POSITIVE" ? "bullish" : sentiment === "NEGATIVE" ? "bearish" : "neutral";
  return (
    <div style={{
      background: "#0b0b15", borderLeft: `3px solid ${sentColor}`,
      borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", color: "#4488ff" }}>{"\u{1D54F}"}</span>
          <a href={tweet.url} target="_blank" rel="noopener noreferrer" style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px", textDecoration: "none" }}>
            @{tweet.username}
          </a>
          <span style={{ color: "#333355", fontSize: "10px" }}>{tweet.name}</span>
          {tweet.followers > 0 && (
            <span style={{ color: "#2a2a44", fontSize: "9px" }}>{fN(tweet.followers)} followers</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <SentimentBadge label={sentLabel} />
          {tweet.created_at && <span style={{ color: "#2a2a44", fontSize: "9px" }}>{timeAgo(tweet.created_at)}</span>}
        </div>
      </div>
      <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0, wordBreak: "break-word" }}>
        {tweet.text.length > 300 ? tweet.text.substring(0, 300) + "..." : tweet.text}
      </p>
    </div>
  );
}

// ─── Desearch Web Result Card ──────────────────────────────
function WebResultCard({ result }) {
  return (
    <div style={{
      background: "#0b0b15", borderLeft: "3px solid #4488ff",
      borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <a href={result.url} target="_blank" rel="noopener noreferrer"
          style={{ color: "#aa88ff", fontWeight: 600, fontSize: "11px", textDecoration: "none" }}>
          {result.title}
        </a>
        <span style={{ color: "#333355", fontSize: "9px" }}>WEB</span>
      </div>
      {result.snippet && (
        <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>
          {result.snippet.length > 250 ? result.snippet.substring(0, 250) + "..." : result.snippet}
        </p>
      )}
      <span style={{ color: "#2a2a44", fontSize: "9px" }}>{result.url}</span>
    </div>
  );
}

// ─── LunarCrush Post Card ──────────────────────────────────
function SocialPostCard({ post }) {
  const sentColor = post.sentiment > 60 ? "#33bb66" : post.sentiment < 40 ? "#ff4455" : "#ddaa00";
  const netIcon = post.network === "reddit" ? "\u{1F4AC}" : post.network === "youtube" ? "\u{1F3AC}" : "\u{1D54F}";
  return (
    <div style={{
      background: "#0b0b15", borderLeft: `3px solid ${sentColor}`,
      borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px" }}>{netIcon}</span>
          <span style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px" }}>@{post.creator}</span>
          {post.interactions > 0 && (
            <span style={{ color: "#444466", fontSize: "9px" }}>{fN(post.interactions)} engagements</span>
          )}
        </div>
        <span style={{ color: "#2a2a44", fontSize: "9px" }}>{post.timestamp || ""}</span>
      </div>
      <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0, wordBreak: "break-word" }}>
        {post.text.length > 280 ? post.text.substring(0, 280) + "..." : post.text}
      </p>
      {post.url && (
        <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: "#4444aa", fontSize: "9px", textDecoration: "none" }}>
          view post {"\u2197"}
        </a>
      )}
    </div>
  );
}

// ─── Meme Coin Card ────────────────────────────────────────
function MemeCard({ coin }) {
  const change = num(coin.percent_change_24h || coin.price_change_24h);
  const accentColor = change >= 0 ? "#33bb66" : "#ff4455";
  return (
    <div style={{
      background: "#0b0b15", border: `1px solid ${accentColor}20`,
      borderRadius: "4px", padding: "10px 14px", minWidth: "200px", flex: "0 0 auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ color: "#b0b0cc", fontWeight: 600, fontSize: "12px" }}>{coin.symbol || coin.s || "???"}</span>
        <span style={{ color: accentColor, fontSize: "11px", fontWeight: 700 }}>{fP(change)}</span>
      </div>
      <div style={{ color: "#555577", fontSize: "10px" }}>{coin.name || coin.n || ""}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", color: "#444466", fontSize: "9px" }}>
        <span>{fN(num(coin.interactions || 0))} interactions</span>
        <span>sent: {num(coin.sentiment || 50).toFixed(0)}</span>
      </div>
    </div>
  );
}

function ErrorList({ errors }) {
  if (!errors || errors.length === 0) return null;
  // Collapse "Paid plan required" errors into a single line
  const paidErrors = errors.filter(e => e.error === "Paid plan required");
  const otherErrors = errors.filter(e => e.error !== "Paid plan required");
  return (
    <div style={{ margin: "8px 18px", padding: "8px 12px", background: "#ff000f08", border: "1px solid #ff003315", borderRadius: "4px" }}>
      {paidErrors.length > 0 && (
        <div style={{ color: "#ff885580", fontSize: "10px", marginBottom: "2px" }}>
          LunarCrush: {paidErrors.length} endpoint{paidErrors.length > 1 ? "s" : ""} require paid plan ({paidErrors.map(e => e.source).join(", ")})
        </div>
      )}
      {otherErrors.map((e, i) => (
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
  // LunarCrush data
  const [alphaScores, setAlphaScores] = useState([]);
  const [socialPosts, setSocialPosts] = useState([]);
  const [memeCoins, setMemeCoins] = useState([]);
  const [taoTopic, setTaoTopic] = useState(null);
  const [taoNews, setTaoNews] = useState([]);
  // Desearch data (structured)
  const [dsTweets, setDsTweets] = useState([]);
  const [dsWebResults, setDsWebResults] = useState([]);
  const [dsSentiments, setDsSentiments] = useState({});
  const [dsSummary, setDsSummary] = useState("");
  const [dsXTweets, setDsXTweets] = useState([]);
  // UI
  const [sortBy, setSortBy] = useState("composite");
  const [sortDir, setSortDir] = useState("desc");
  const [panel, setPanel] = useState("all");

  const scan = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const data = await fetchAllAlphaData();
      setErrors(data.errors);

      // ─── Desearch AI results (structured) ───
      if (data.desearchAI) {
        setDsTweets(data.desearchAI.tweets || []);
        setDsWebResults(data.desearchAI.webResults || []);
        setDsSentiments(data.desearchAI.sentiments || {});
        setDsSummary(data.desearchAI.summary || "");
      }

      // ─── Desearch Twitter direct search ───
      const xResults = data.desearchTwitter;
      if (xResults) {
        // Could be array of tweets or { data: [...] }
        const tweets = Array.isArray(xResults) ? xResults : (xResults.data || xResults.results || []);
        setDsXTweets(Array.isArray(tweets) ? tweets.slice(0, 15) : []);
      }

      // ─── LunarCrush data ───
      const btCoins = data.bittensorCoins?.data || data.bittensorCoins || [];
      if (Array.isArray(btCoins) && btCoins.length > 0) {
        setAlphaScores(scoreAlphaSignals(btCoins));
      }

      const memes = data.memeCoins?.data || data.memeCoins || [];
      if (Array.isArray(memes)) setMemeCoins(memes.slice(0, 10));

      if (data.taoTopic) setTaoTopic(data.taoTopic?.data || data.taoTopic);

      setSocialPosts(extractSocialPosts(data.taoPosts));

      const news = data.taoNews?.data || data.taoNews || [];
      if (Array.isArray(news)) setTaoNews(news.slice(0, 8));

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
  const hasDsData = dsTweets.length > 0 || dsWebResults.length > 0 || dsXTweets.length > 0;
  const hasLcData = alphaScores.length > 0 || taoTopic || socialPosts.length > 0;

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
          {hasDsData && <span style={{ background: "#4488ff15", border: "1px solid #4488ff40", color: "#4488ff", padding: "2px 8px", borderRadius: "3px", fontSize: "10px" }}>DESEARCH LIVE</span>}
          {hasLcData && <span style={{ background: "#8855ff15", border: "1px solid #8855ff40", color: "#8855ff", padding: "2px 8px", borderRadius: "3px", fontSize: "10px" }}>LUNARCRUSH</span>}
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
      {loading && !hasDsData && !hasLcData && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u26A1"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>SCANNING SOCIAL SIGNALS...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>LunarCrush + Desearch</div>
        </div>
      )}

      {/* ═══ DESEARCH AI NARRATIVE SUMMARY ═══ */}
      {dsSummary && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F9E0}"} AI NARRATIVE SUMMARY</div>
          <div style={{ background: "#0a0a14", border: "1px solid #8855ff30", borderRadius: "4px", padding: "14px 16px" }}>
            <p style={{ color: "#9999bb", fontSize: "12px", lineHeight: "1.8", margin: 0 }}>{dsSummary}</p>
          </div>
        </div>
      )}

      {/* ═══ DESEARCH AI — TWEETS WITH SENTIMENT ═══ */}
      {dsTweets.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1D54F}"} DESEARCH AI — BITTENSOR X FEED ({dsTweets.length} tweets)</div>
          {dsTweets.map((t, i) => (
            <TweetCard key={t.id || i} tweet={t} sentiment={dsSentiments[t.id] || "MEDIUM"} />
          ))}
        </div>
      )}

      {/* ═══ DESEARCH AI — WEB RESULTS ═══ */}
      {dsWebResults.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F310}"} DESEARCH AI — WEB INTEL ({dsWebResults.length} results)</div>
          {dsWebResults.map((r, i) => <WebResultCard key={i} result={r} />)}
        </div>
      )}

      {/* ═══ DESEARCH DIRECT X SEARCH ═══ */}
      {dsXTweets.length > 0 && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1D54F}"} DESEARCH X SEARCH — $TAO LIVE FEED</div>
          {dsXTweets.map((t, i) => {
            const text = t.text || t.full_text || t.content || t.body || "";
            const user = t.user || {};
            return (
              <div key={t.id || i} style={{
                background: "#0b0b15", borderLeft: "3px solid #4488ff",
                borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "#4488ff", fontSize: "11px" }}>{"\u{1D54F}"}</span>
                    <span style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px" }}>
                      @{user.username || user.screen_name || t.username || "unknown"}
                    </span>
                    <span style={{ color: "#333355", fontSize: "10px" }}>{user.name || t.name || ""}</span>
                  </div>
                  <span style={{ color: "#2a2a44", fontSize: "9px" }}>{t.created_at ? timeAgo(t.created_at) : ""}</span>
                </div>
                <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0, wordBreak: "break-word" }}>
                  {text.length > 300 ? text.substring(0, 300) + "..." : text}
                </p>
                {(t.retweet_count > 0 || t.like_count > 0 || t.reply_count > 0) && (
                  <div style={{ marginTop: "4px", color: "#333355", fontSize: "9px", display: "flex", gap: "10px" }}>
                    {t.retweet_count > 0 && <span>{"\u{1F501}"} {fN(t.retweet_count)}</span>}
                    {t.like_count > 0 && <span>{"\u2764"} {fN(t.like_count)}</span>}
                    {t.reply_count > 0 && <span>{"\u{1F4AC}"} {fN(t.reply_count)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ LUNARCRUSH — TAO SOCIAL PULSE ═══ */}
      {taoTopic && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u25C8"} LUNARCRUSH — BITTENSOR SOCIAL PULSE</div>
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

      {/* ═══ MEME RADAR ═══ */}
      {memeCoins.length > 0 && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F525}"} MEME RADAR — TRENDING BY INTERACTIONS</div>
          <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
            {memeCoins.map((c, i) => <MemeCard key={c.id || c.symbol || i} coin={c} />)}
          </div>
        </div>
      )}

      {/* ═══ LUNARCRUSH SOCIAL POSTS ═══ */}
      {socialPosts.length > 0 && (showAll || panel === "social") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1D54F}"} LUNARCRUSH — BITTENSOR TOP POSTS</div>
          {socialPosts.map((p, i) => <SocialPostCard key={p.id || i} post={p} />)}
        </div>
      )}

      {/* ═══ LUNARCRUSH NEWS ═══ */}
      {taoNews.length > 0 && (showAll || panel === "narrative") && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F4F0}"} LUNARCRUSH — BITTENSOR NEWS</div>
          {taoNews.map((n, i) => (
            <div key={i} style={{ background: "#0b0b15", borderLeft: "3px solid #4488ff", borderRadius: "0 4px 4px 0", padding: "10px 14px", marginBottom: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ color: "#8888cc", fontWeight: 600, fontSize: "11px" }}>{n.title || n.post_title || "News"}</span>
                <span style={{ color: "#2a2a44", fontSize: "9px" }}>{n.time ? timeAgo(n.time) : ""}</span>
              </div>
              {(n.description || n.body || n.post_body) && (
                <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>
                  {String(n.description || n.body || n.post_body || "").substring(0, 200)}
                </p>
              )}
              {(n.url || n.post_url) && (
                <a href={n.url || n.post_url} target="_blank" rel="noopener noreferrer" style={{ color: "#4444aa", fontSize: "9px", textDecoration: "none" }}>
                  read more {"\u2197"}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══ ALPHA SCORE TABLE ═══ */}
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
                      <td style={S.cell}><SentimentBadge label={s.sentimentLabel} /></td>
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
        <span>Data: Desearch (SN22) + LunarCrush {"\u00B7"} Alpha = Social + Sentiment + Narrative + On-Chain {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Early Alpha Intelligence</span>
      </div>
    </div>
  );
}
