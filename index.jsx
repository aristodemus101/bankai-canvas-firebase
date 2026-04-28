import { useState, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════
   BANKING AI RESEARCH CANVAS — Gemini-Powered Edition
   Drop sources → Gemini categorizes → Search & Export
   ═══════════════════════════════════════════════════════ */

const CATEGORIES = [
  "Customer Service & Chatbots", "Fraud Detection & Risk", "Credit Scoring & Underwriting",
  "Process Automation (RPA)", "Wealth Management & Advisory", "Regulatory & Compliance",
  "Personalization & Marketing", "Cybersecurity", "Document Processing",
  "Trading & Market Analysis", "KYC / AML", "Other",
];

const BANKS = [
  "JPMorgan Chase", "Bank of America", "Wells Fargo", "Citibank", "Goldman Sachs",
  "Morgan Stanley", "HSBC", "Barclays", "Deutsche Bank", "UBS", "BNP Paribas",
  "Standard Chartered", "DBS Bank", "ICICI Bank", "HDFC Bank", "SBI",
  "Axis Bank", "Kotak Mahindra", "RBI (Central Bank)", "Other / Multiple",
];

const STATUS_OPTIONS = ["To Review", "Reviewed", "Key Finding", "Archived"];

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ─── Gemini summarizer (calls your /api/summarize route) ─── */
async function aiSummarize(text) {
  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) throw new Error("API error");
    return await res.json();
  } catch {
    return {
      summary: "AI summary unavailable — edit manually.",
      bank_mentioned: "Other / Multiple",
      category: "Other",
      ai_technology: "Unknown",
      use_case: "",
      impact: "Not specified",
    };
  }
}

/* ─── CSV export ─── */
function exportCSV(entries) {
  const headers = [
    "ID", "Title", "Source Type", "URL", "Bank", "Category", "AI Technology",
    "Use Case", "Summary", "Impact / ROI", "Status", "Tags", "Date Added", "Notes",
  ];
  const rows = entries.map((e, i) => [
    i + 1, e.title, e.sourceType, e.url, e.bank, e.category, e.aiTech,
    e.useCase, e.summary, e.impact, e.status, (e.tags || []).join("; "),
    e.dateAdded, e.notes,
  ]);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `banking_ai_research_${new Date().toISOString().slice(0, 10)}.csv`,
  }).click();
}

/* ─── Palette ─── */
const C = {
  bg: "#06090F", panel: "#0D1117", card: "#131A24", cardHov: "#17202E",
  border: "#1B2636", borderLit: "#2D6AE0", accent: "#2D6AE0", accentSoft: "rgba(45,106,224,0.12)",
  teal: "#0DCDA3", tealSoft: "rgba(13,205,163,0.12)", amber: "#E8A317",
  amberSoft: "rgba(232,163,23,0.12)", rose: "#E5484D", roseSoft: "rgba(229,72,77,0.12)",
  violet: "#8B5CF6", violetSoft: "rgba(139,92,246,0.12)",
  text: "#D6DEE8", muted: "#7B8CA6", dim: "#4A5568",
};

const statusCol = { "To Review": C.amber, Reviewed: C.teal, "Key Finding": C.violet, Archived: C.dim };
const srcIcons = { URL: "🔗", PDF: "📄", Image: "🖼", "Excel/CSV": "📊", Text: "✏️", File: "📁" };

/* ═══════════════════════ MAIN COMPONENT ═══════════════════════ */
export default function App() {
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("canvas");
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("All");
  const [fBank, setFBank] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [isDragOver, setIsDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [pasteInput, setPasteInput] = useState("");
  const fileRef = useRef(null);

  /* filtering */
  const filtered = entries.filter(e => {
    if (fCat !== "All" && e.category !== fCat) return false;
    if (fBank !== "All" && e.bank !== fBank) return false;
    if (fStatus !== "All" && e.status !== fStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return [e.title, e.summary, e.bank, e.category, e.useCase, e.aiTech, ...(e.tags || [])]
      .some(f => (f || "").toLowerCase().includes(q));
  });

  /* ─── ingest helpers ─── */
  const makeEntry = (overrides) => ({
    id: genId(), title: "", sourceType: "Text", url: "", bank: "Other / Multiple",
    category: "Other", aiTech: "", useCase: "", summary: "", impact: "Not specified",
    status: "To Review", tags: [], dateAdded: new Date().toISOString().slice(0, 10),
    notes: "", ...overrides,
  });

  const ingestUrl = async (url) => {
    setBusy(true); setBusyMsg("Fetching & analyzing URL…");
    const ai = await aiSummarize(`Analyze this URL about AI use cases in banking: ${url}`);
    setEntries(p => [makeEntry({
      title: ai.title || url.replace(/https?:\/\/(www\.)?/, "").slice(0, 70),
      sourceType: "URL", url, bank: ai.bank_mentioned, category: ai.category,
      aiTech: ai.ai_technology, useCase: ai.use_case, summary: ai.summary, impact: ai.impact,
    }), ...p]);
    setBusy(false); setBusyMsg("");
  };

  const ingestText = async (text) => {
    setBusy(true); setBusyMsg("Analyzing pasted content…");
    const ai = await aiSummarize(text);
    setEntries(p => [makeEntry({
      title: ai.title || text.slice(0, 65).replace(/\n/g, " ") + "…",
      sourceType: "Text", bank: ai.bank_mentioned, category: ai.category,
      aiTech: ai.ai_technology, useCase: ai.use_case, summary: ai.summary, impact: ai.impact,
    }), ...p]);
    setBusy(false); setBusyMsg("");
  };

  const ingestFile = async (file) => {
    setBusy(true); setBusyMsg(`Processing ${file.name}…`);
    let sType = "File";
    if (file.type.includes("pdf")) sType = "PDF";
    else if (file.type.startsWith("image")) sType = "Image";
    else if (file.name.match(/\.(xlsx|xls|csv)$/i)) sType = "Excel/CSV";

    let text = `File: ${file.name} (${sType}, ${(file.size / 1024).toFixed(1)} KB)`;
    if (file.type.startsWith("text") || file.name.match(/\.(csv|txt|md|json)$/i)) {
      text += "\n" + (await file.text()).slice(0, 4000);
    }
    const ai = await aiSummarize(text);
    setEntries(p => [makeEntry({
      title: file.name, sourceType: sType, bank: ai.bank_mentioned, category: ai.category,
      aiTech: ai.ai_technology, useCase: ai.use_case, summary: ai.summary, impact: ai.impact,
    }), ...p]);
    setBusy(false); setBusyMsg("");
  };

  /* drop handler */
  const onDrop = useCallback(async (e) => {
    e.preventDefault(); setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const text = e.dataTransfer.getData("text/plain");
    if (files.length) { for (const f of files) await ingestFile(f); }
    else if (text?.match(/^https?:\/\//)) await ingestUrl(text);
    else if (text) await ingestText(text);
  }, []);

  const deleteEntry = (id) => { setEntries(p => p.filter(x => x.id !== id)); setExpanded(null); };
  const cycleStatus = (id) => {
    setEntries(p => p.map(x => {
      if (x.id !== id) return x;
      return { ...x, status: STATUS_OPTIONS[(STATUS_OPTIONS.indexOf(x.status) + 1) % STATUS_OPTIONS.length] };
    }));
  };

  /* ─── shared styles ─── */
  const pill = (bg, fg) => ({
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px",
    background: bg, color: fg, borderRadius: 20, fontSize: 11, fontWeight: 600,
    whiteSpace: "nowrap",
  });
  const inputS = {
    width: "100%", padding: "10px 14px", background: C.bg, border: `1px solid ${C.border}`,
    borderRadius: 8, color: C.text, fontSize: 14, outline: "none", fontFamily: "inherit",
    boxSizing: "border-box", transition: "border-color 0.2s",
  };
  const labelS = { display: "block", fontSize: 11, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase" };
  const btnPrimary = {
    padding: "10px 22px", background: C.accent, color: "#fff", border: "none",
    borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit",
  };

  /* ═══════════ RENDER ═══════════ */
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Manrope', 'SF Pro Display', system-ui, sans-serif", padding: "0 20px 48px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />

      {/* ── Busy bar ── */}
      {busy && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 999, padding: "10px 0",
          background: `linear-gradient(90deg, ${C.accent}, ${C.teal})`, textAlign: "center",
          fontSize: 13, fontWeight: 700, color: "#fff",
          animation: "busyPulse 1.4s ease-in-out infinite",
        }}>
          <style>{`@keyframes busyPulse{0%,100%{opacity:1}50%{opacity:.65}}`}</style>
          🧠 {busyMsg}
        </div>
      )}

      {/* ══════════ HEADER ══════════ */}
      <header style={{ padding: "26px 0 18px", borderBottom: `1px solid ${C.border}`, marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: C.teal, letterSpacing: "-0.5px" }}>
            ◆ BankAI Canvas
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: C.dim }}>
            Drop sources → Gemini categorizes → Search &amp; export CSV
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { key: "canvas", icon: "◉", label: "Canvas" },
            { key: "table", icon: "☰", label: "Table" },
            { key: "add", icon: "+", label: "Add" },
          ].map(v => (
            <button key={v.key} onClick={() => { setEditing(null); setView(v.key); }} style={{
              padding: "7px 16px", borderRadius: 7,
              border: `1px solid ${view === v.key ? C.accent : C.border}`,
              background: view === v.key ? C.accentSoft : "transparent",
              color: view === v.key ? C.accent : C.muted,
              cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "inherit",
            }}>{v.icon} {v.label}</button>
          ))}
          <button onClick={() => exportCSV(entries)} disabled={!entries.length} style={{
            padding: "7px 16px", borderRadius: 7, border: `1px solid ${C.teal}`,
            background: C.tealSoft, color: C.teal, cursor: entries.length ? "pointer" : "not-allowed",
            fontWeight: 700, fontSize: 12, fontFamily: "inherit", opacity: entries.length ? 1 : .4,
          }}>↓ Export CSV</button>
        </div>
      </header>

      {/* ══════════ SEARCH & FILTERS ══════════ */}
      {view !== "add" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.dim, fontSize: 14 }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search titles, banks, tech, tags…"
              style={{ ...inputS, paddingLeft: 34 }}
              onFocus={e => e.target.style.borderColor = C.borderLit}
              onBlur={e => e.target.style.borderColor = C.border} />
          </div>
          {[
            { val: fCat, set: setFCat, opts: ["All", ...CATEGORIES], label: "Category" },
            { val: fBank, set: setFBank, opts: ["All", ...BANKS], label: "Bank" },
            { val: fStatus, set: setFStatus, opts: ["All", ...STATUS_OPTIONS], label: "Status" },
          ].map(f => (
            <select key={f.label} value={f.val} onChange={e => f.set(e.target.value)} style={{
              ...inputS, width: "auto", cursor: "pointer", color: f.val === "All" ? C.dim : C.text,
            }}>
              {f.opts.map(o => <option key={o} value={o}>{o === "All" ? `All ${f.label}` : o}</option>)}
            </select>
          ))}
        </div>
      )}

      {/* ══════════ STATS ROW ══════════ */}
      {view !== "add" && entries.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {[
            { n: entries.length, l: "Total Sources", c: C.accent },
            { n: entries.filter(e => e.status === "To Review").length, l: "To Review", c: C.amber },
            { n: entries.filter(e => e.status === "Key Finding").length, l: "Key Findings", c: C.violet },
            { n: [...new Set(entries.map(e => e.bank))].length, l: "Banks", c: C.teal },
          ].map(s => (
            <div key={s.l} style={{ flex: "1 1 120px", padding: "14px 18px", background: C.panel, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.c, fontFamily: "'JetBrains Mono', monospace" }}>{s.n}</div>
              <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════ ADD VIEW ══════════ */}
      {view === "add" && (() => {
        const FormInner = () => {
          const [form, setForm] = useState(editing || makeEntry({}));
          return (
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              {/* Quick add */}
              <div style={{ padding: 22, background: C.panel, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 24 }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.teal }}>⚡ Quick Add</h3>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="Paste a URL…" style={{ ...inputS, flex: 1 }}
                    onFocus={e => e.target.style.borderColor = C.borderLit} onBlur={e => e.target.style.borderColor = C.border} />
                  <button onClick={async () => { if (urlInput.trim()) { await ingestUrl(urlInput.trim()); setUrlInput(""); setView("canvas"); } }}
                    disabled={busy} style={{ ...btnPrimary, opacity: busy ? .5 : 1, whiteSpace: "nowrap" }}>
                    {busy ? "…" : "Add URL"}
                  </button>
                </div>
                <textarea value={pasteInput} onChange={e => setPasteInput(e.target.value)} rows={3}
                  placeholder="Or paste article text, research snippets, notes…"
                  style={{ ...inputS, resize: "vertical" }}
                  onFocus={e => e.target.style.borderColor = C.borderLit} onBlur={e => e.target.style.borderColor = C.border} />
                <button onClick={async () => { if (pasteInput.trim()) { await ingestText(pasteInput.trim()); setPasteInput(""); setView("canvas"); } }}
                  disabled={busy || !pasteInput.trim()} style={{ ...btnPrimary, marginTop: 10, opacity: (busy || !pasteInput.trim()) ? .4 : 1 }}>
                  {busy ? "Analyzing…" : "Analyze & Add"}
                </button>
              </div>
              {/* Manual form */}
              <div style={{ padding: 22, background: C.panel, borderRadius: 14, border: `1px solid ${C.border}` }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: C.text }}>Manual Entry</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {[
                    { key: "title", label: "Title", span: true },
                    { key: "sourceType", label: "Source Type", type: "select", opts: ["URL","PDF","Image","Excel/CSV","Text","Report","News Article","Research Paper","Other"] },
                    { key: "url", label: "URL" },
                    { key: "bank", label: "Bank", type: "select", opts: BANKS },
                    { key: "category", label: "Category", type: "select", opts: CATEGORIES },
                    { key: "aiTech", label: "AI Technology", placeholder: "NLP, CV, LLM…" },
                    { key: "status", label: "Status", type: "select", opts: STATUS_OPTIONS },
                    { key: "useCase", label: "Use Case", span: true, placeholder: "One-line AI use case" },
                    { key: "summary", label: "Summary", span: true, type: "textarea" },
                    { key: "impact", label: "Impact / ROI", placeholder: "e.g. 40% cost reduction" },
                    { key: "tags", label: "Tags (comma-sep)", isTag: true },
                    { key: "notes", label: "Notes", span: true, type: "textarea" },
                  ].map(f => (
                    <div key={f.key} style={f.span ? { gridColumn: "1/-1" } : {}}>
                      <label style={labelS}>{f.label}</label>
                      {f.type === "select" ? (
                        <select value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={{ ...inputS, cursor: "pointer" }}>
                          {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} rows={3}
                          style={{ ...inputS, resize: "vertical" }}
                          onFocus={e => e.target.style.borderColor = C.borderLit} onBlur={e => e.target.style.borderColor = C.border} />
                      ) : (
                        <input
                          value={f.isTag ? (form.tags || []).join(", ") : (form[f.key] ?? "")}
                          onChange={e => f.isTag
                            ? setForm({ ...form, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })
                            : setForm({ ...form, [f.key]: e.target.value })
                          }
                          placeholder={f.placeholder || ""} style={inputS}
                          onFocus={e => e.target.style.borderColor = C.borderLit} onBlur={e => e.target.style.borderColor = C.border} />
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    const e = { ...form, id: form.id || genId() };
                    if (editing) setEntries(p => p.map(x => x.id === e.id ? e : x));
                    else setEntries(p => [e, ...p]);
                    setEditing(null); setView("canvas");
                  }} style={btnPrimary}>{editing ? "Update" : "Add Entry"}</button>
                  <button onClick={() => { setEditing(null); setView("canvas"); }} style={{
                    ...btnPrimary, background: "transparent", color: C.muted, border: `1px solid ${C.border}`,
                  }}>Cancel</button>
                </div>
              </div>
            </div>
          );
        };
        return <FormInner />;
      })()}

      {/* ══════════ TABLE VIEW ══════════ */}
      {view === "table" && (
        <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "inherit" }}>
            <thead>
              <tr style={{ background: C.panel }}>
                {["#","Title","Type","Bank","Category","AI Tech","Use Case","Impact","Status","Date"].map(h => (
                  <th key={h} style={{ padding: "11px 12px", textAlign: "left", color: C.dim, fontWeight: 700, borderBottom: `1px solid ${C.border}`, fontSize: 10, textTransform: "uppercase", letterSpacing: ".5px", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.id} onClick={() => { setEditing(e); setView("add"); }}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", transition: "background .15s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background = C.card}
                  onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "9px 12px", color: C.dim }}>{i + 1}</td>
                  <td style={{ padding: "9px 12px", color: C.text, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</td>
                  <td style={{ padding: "9px 12px" }}><span style={pill(C.accentSoft, C.accent)}>{srcIcons[e.sourceType] || "📎"} {e.sourceType}</span></td>
                  <td style={{ padding: "9px 12px", color: C.text }}>{e.bank}</td>
                  <td style={{ padding: "9px 12px", color: C.muted }}>{e.category}</td>
                  <td style={{ padding: "9px 12px", color: C.text }}>{e.aiTech}</td>
                  <td style={{ padding: "9px 12px", color: C.muted, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.useCase}</td>
                  <td style={{ padding: "9px 12px", color: C.text }}>{e.impact}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={pill(`${statusCol[e.status]}18`, statusCol[e.status])}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusCol[e.status] }} /> {e.status}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", color: C.dim, whiteSpace: "nowrap" }}>{e.dateAdded}</td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={10} style={{ padding: 36, textAlign: "center", color: C.dim }}>No entries match filters</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════ CANVAS VIEW ══════════ */}
      {view === "canvas" && (
        <>
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              padding: "36px 20px", marginBottom: 22, borderRadius: 14,
              border: `2px dashed ${isDragOver ? C.teal : C.border}`,
              background: isDragOver ? C.tealSoft : C.panel,
              textAlign: "center", cursor: "pointer", transition: "all .25s",
            }}>
            <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt,.md,.doc,.docx"
              onChange={async e => { for (const f of Array.from(e.target.files)) await ingestFile(f); e.target.value = ""; }}
              style={{ display: "none" }} />
            <div style={{ fontSize: 36, marginBottom: 6 }}>{isDragOver ? "📥" : "◆"}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: isDragOver ? C.teal : C.text }}>
              {isDragOver ? "Release to analyze" : "Drop anything here"}
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
              URLs • PDFs • images • Excel • text — Gemini will categorize &amp; summarize
            </div>
          </div>

          {/* Cards */}
          {filtered.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 14 }}>
              {filtered.map(e => {
                const isOpen = expanded === e.id;
                return (
                  <div key={e.id} onClick={() => setExpanded(isOpen ? null : e.id)} style={{
                    background: C.card, borderRadius: 12, padding: 18,
                    border: `1px solid ${isOpen ? C.borderLit : C.border}`,
                    cursor: "pointer", transition: "all .2s",
                    boxShadow: isOpen ? `0 0 20px ${C.accentSoft}` : "none",
                  }}>
                    {/* top row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.4, flex: 1 }}>{e.title}</h4>
                      <span style={pill(`${statusCol[e.status]}18`, statusCol[e.status])}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusCol[e.status] }} /> {e.status}
                      </span>
                    </div>
                    {/* badges */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={pill(C.accentSoft, C.accent)}>{srcIcons[e.sourceType] || "📎"} {e.sourceType}</span>
                      <span style={pill(C.tealSoft, C.teal)}>{e.bank}</span>
                      <span style={pill(C.violetSoft, C.violet)}>{e.category}</span>
                    </div>
                    {/* summary */}
                    <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                      {e.summary.slice(0, isOpen ? 9999 : 110)}{!isOpen && e.summary.length > 110 ? "…" : ""}
                    </p>
                    {/* expanded details */}
                    {isOpen && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div><span style={{ color: C.dim }}>AI Tech: </span><span style={{ color: C.text }}>{e.aiTech || "—"}</span></div>
                          <div><span style={{ color: C.dim }}>Impact: </span><span style={{ color: C.text }}>{e.impact || "—"}</span></div>
                          <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>Use Case: </span><span style={{ color: C.text }}>{e.useCase || "—"}</span></div>
                          {e.url && <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>URL: </span><a href={e.url} target="_blank" rel="noreferrer" onClick={ev => ev.stopPropagation()} style={{ color: C.accent, textDecoration: "none", fontSize: 12 }}>{e.url.slice(0, 55)}…</a></div>}
                          {e.notes && <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>Notes: </span><span style={{ color: C.text }}>{e.notes}</span></div>}
                        </div>
                        {(e.tags || []).length > 0 && (
                          <div style={{ marginTop: 10, display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {e.tags.map(t => <span key={t} style={{ padding: "2px 8px", background: C.bg, color: C.dim, borderRadius: 4, fontSize: 10 }}>#{t}</span>)}
                          </div>
                        )}
                        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                          <button onClick={ev => { ev.stopPropagation(); setEditing(e); setView("add"); }} style={{
                            padding: "5px 12px", background: C.accentSoft, color: C.accent, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                          }}>Edit</button>
                          <button onClick={ev => { ev.stopPropagation(); cycleStatus(e.id); }} style={{
                            padding: "5px 12px", background: C.tealSoft, color: C.teal, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                          }}>Cycle Status</button>
                          <button onClick={ev => { ev.stopPropagation(); deleteEntry(e.id); }} style={{
                            padding: "5px 12px", background: C.roseSoft, color: C.rose, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                          }}>Delete</button>
                        </div>
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 10, color: C.dim }}>{e.dateAdded}</div>
                  </div>
                );
              })}
            </div>
          ) : !entries.length ? (
            <div style={{ textAlign: "center", padding: "56px 20px" }}>
              <div style={{ fontSize: 44, marginBottom: 10 }}>◆</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.muted }}>Canvas is empty</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Drop a link, PDF, or paste research to begin</div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 36, color: C.dim }}>No entries match your filters</div>
          )}
        </>
      )}
    </div>
  );
}