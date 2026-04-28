// src/App.jsx — BankAI Research Canvas (Firebase + Gemini Edition)
import { useState, useRef, useCallback, useEffect } from "react";
import { db, auth, googleProvider } from "./firebase";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, query, where,
  orderBy, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */
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
const COLLECTION = "research_entries";

/* ═══════════════════════════════════════════
   GEMINI AI — calls your Cloud Function
   ═══════════════════════════════════════════ */
// After deploying, replace this URL with your actual function URL
const SUMMARIZE_URL = import.meta.env.VITE_SUMMARIZE_URL || "/api/summarize";

async function aiSummarize(text) {
  try {
    const res = await fetch(SUMMARIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) throw new Error("API " + res.status);
    return await res.json();
  } catch {
    return {
      title: "", summary: "AI unavailable — edit manually.",
      bank_mentioned: "Other / Multiple", category: "Other",
      ai_technology: "Unknown", use_case: "", impact: "Not specified",
    };
  }
}

/* ═══════════════════════════════════════════
   CSV EXPORT
   ═══════════════════════════════════════════ */
function exportCSV(entries) {
  const h = ["ID","Title","Source Type","URL","Bank","Category","AI Technology",
    "Use Case","Summary","Impact / ROI","Status","Tags","Date Added","Notes"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = entries.map((e, i) => [
    i+1, e.title, e.sourceType, e.url, e.bank, e.category, e.aiTech,
    e.useCase, e.summary, e.impact, e.status, (e.tags||[]).join("; "),
    e.dateAdded, e.notes,
  ].map(esc).join(","));
  const blob = new Blob(["\uFEFF" + [h.map(esc).join(","), ...rows].join("\n")],
    { type: "text/csv;charset=utf-8;" });
  Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `banking_ai_research_${new Date().toISOString().slice(0,10)}.csv`,
  }).click();
}

/* ═══════════════════════════════════════════
   PALETTE & STYLES
   ═══════════════════════════════════════════ */
const C = {
  bg: "#05080E", panel: "#0C1219", card: "#111921", cardHov: "#162030",
  border: "#1A2538", borderLit: "#2563EB", accent: "#2563EB",
  accentSoft: "rgba(37,99,235,0.10)", teal: "#06D6A0", tealSoft: "rgba(6,214,160,0.10)",
  amber: "#F0A820", amberSoft: "rgba(240,168,32,0.10)", rose: "#EF4444",
  roseSoft: "rgba(239,68,68,0.10)", violet: "#7C3AED", violetSoft: "rgba(124,58,237,0.10)",
  text: "#D1DAE6", muted: "#6B7F99", dim: "#3E5068",
};
const statusC = { "To Review": C.amber, Reviewed: C.teal, "Key Finding": C.violet, Archived: C.dim };
const srcIcon = { URL:"🔗", PDF:"📄", Image:"🖼", "Excel/CSV":"📊", Text:"✏️", File:"📁",
  Report:"📋", "News Article":"📰", "Research Paper":"🔬", Other:"📎" };

const pill = (bg, fg) => ({
  display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px",
  background:bg, color:fg, borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:"nowrap",
});
const inputS = {
  width:"100%", padding:"10px 14px", background:C.bg, border:`1px solid ${C.border}`,
  borderRadius:8, color:C.text, fontSize:14, outline:"none", fontFamily:"inherit",
  boxSizing:"border-box", transition:"border-color .2s",
};
const labelS = {
  display:"block", fontSize:11, color:C.muted, marginBottom:5,
  fontWeight:700, letterSpacing:".6px", textTransform:"uppercase",
};
const btnP = {
  padding:"10px 22px", background:C.accent, color:"#fff", border:"none",
  borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13, fontFamily:"inherit",
};

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
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

  /* ─── Auth listener ─── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

  /* ─── Firestore real-time listener ─── */
  useEffect(() => {
    if (!user) { setEntries([]); return; }
    const q = query(
      collection(db, COLLECTION),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  /* ─── Firestore CRUD ─── */
  const addEntry = async (data) => {
    if (!user) return;
    await addDoc(collection(db, COLLECTION), {
      ...data, uid: user.uid, createdAt: serverTimestamp(),
    });
  };
  const updateEntry = async (id, data) => {
    await updateDoc(doc(db, COLLECTION, id), data);
  };
  const removeEntry = async (id) => {
    await deleteDoc(doc(db, COLLECTION, id));
    setExpanded(null);
  };

  /* ─── Filtering ─── */
  const filtered = entries.filter(e => {
    if (fCat !== "All" && e.category !== fCat) return false;
    if (fBank !== "All" && e.bank !== fBank) return false;
    if (fStatus !== "All" && e.status !== fStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return [e.title, e.summary, e.bank, e.category, e.useCase, e.aiTech, ...(e.tags||[])]
      .some(f => (f||"").toLowerCase().includes(q));
  });

  /* ─── Ingest helpers ─── */
  const baseEntry = (ov) => ({
    title:"", sourceType:"Text", url:"", bank:"Other / Multiple",
    category:"Other", aiTech:"", useCase:"", summary:"", impact:"Not specified",
    status:"To Review", tags:[], dateAdded:new Date().toISOString().slice(0,10),
    notes:"", ...ov,
  });

  const ingestUrl = async (url) => {
    setBusy(true); setBusyMsg("Fetching & analyzing URL…");
    const ai = await aiSummarize(`Analyze this URL about AI use cases in banking: ${url}`);
    await addEntry(baseEntry({
      title: ai.title || url.replace(/https?:\/\/(www\.)?/,"").slice(0,70),
      sourceType:"URL", url, bank:ai.bank_mentioned, category:ai.category,
      aiTech:ai.ai_technology, useCase:ai.use_case, summary:ai.summary, impact:ai.impact,
    }));
    setBusy(false); setBusyMsg("");
  };

  const ingestText = async (text) => {
    setBusy(true); setBusyMsg("Analyzing pasted content…");
    const ai = await aiSummarize(text);
    await addEntry(baseEntry({
      title: ai.title || text.slice(0,65).replace(/\n/g," ")+"…",
      sourceType:"Text", bank:ai.bank_mentioned, category:ai.category,
      aiTech:ai.ai_technology, useCase:ai.use_case, summary:ai.summary, impact:ai.impact,
    }));
    setBusy(false); setBusyMsg("");
  };

  const ingestFile = async (file) => {
    setBusy(true); setBusyMsg(`Processing ${file.name}…`);
    let sType = "File";
    if (file.type.includes("pdf")) sType = "PDF";
    else if (file.type.startsWith("image")) sType = "Image";
    else if (file.name.match(/\.(xlsx|xls|csv)$/i)) sType = "Excel/CSV";
    let text = `File: ${file.name} (${sType}, ${(file.size/1024).toFixed(1)} KB)`;
    if (file.type.startsWith("text") || file.name.match(/\.(csv|txt|md|json)$/i)) {
      text += "\n" + (await file.text()).slice(0, 4000);
    }
    const ai = await aiSummarize(text);
    await addEntry(baseEntry({
      title: file.name, sourceType:sType, bank:ai.bank_mentioned, category:ai.category,
      aiTech:ai.ai_technology, useCase:ai.use_case, summary:ai.summary, impact:ai.impact,
    }));
    setBusy(false); setBusyMsg("");
  };

  const onDrop = useCallback(async (e) => {
    e.preventDefault(); setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const text = e.dataTransfer.getData("text/plain");
    if (files.length) for (const f of files) await ingestFile(f);
    else if (text?.match(/^https?:\/\//)) await ingestUrl(text);
    else if (text) await ingestText(text);
  }, [user]);

  const cycleStatus = async (entry) => {
    const next = STATUS_OPTIONS[(STATUS_OPTIONS.indexOf(entry.status)+1)%STATUS_OPTIONS.length];
    await updateEntry(entry.id, { status: next });
  };

  /* ═══════════════════════════════════════════
     AUTH SCREEN
     ═══════════════════════════════════════════ */
  if (authLoading) {
    return (
      <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
        <div style={{ color:C.muted, fontFamily:"'Manrope',sans-serif", fontSize:16 }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{
        minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"'Manrope',sans-serif",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
        <div style={{ textAlign:"center", padding:40 }}>
          <div style={{ fontSize:56, marginBottom:16 }}>◆</div>
          <h1 style={{
            fontSize:28, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
            color:C.teal, margin:"0 0 8px", letterSpacing:"-0.5px",
          }}>BankAI Canvas</h1>
          <p style={{ color:C.muted, fontSize:14, margin:"0 0 28px", maxWidth:380, lineHeight:1.6 }}>
            Collect, categorize, and export AI use cases in banking.
            Sign in to sync your research across devices.
          </p>
          <button onClick={() => signInWithPopup(auth, googleProvider)} style={{
            ...btnP, padding:"14px 36px", fontSize:15, borderRadius:10,
            background:`linear-gradient(135deg, ${C.accent}, ${C.teal})`,
            boxShadow:`0 4px 24px ${C.accentSoft}`,
          }}>
            Sign in with Google
          </button>
          <p style={{ color:C.dim, fontSize:11, marginTop:16 }}>Your data is private — only you can see your entries</p>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     MAIN APP (authenticated)
     ═══════════════════════════════════════════ */

  /* ─── Add / Edit form ─── */
  const FormView = () => {
    const [form, setForm] = useState(editing || baseEntry({}));
    const saveForm = async () => {
      if (editing?.id) {
        const { id, uid, createdAt, ...rest } = form;
        await updateEntry(editing.id, rest);
      } else {
        await addEntry(form);
      }
      setEditing(null); setView("canvas");
    };
    return (
      <div style={{ maxWidth:700, margin:"0 auto" }}>
        {/* Quick add */}
        <div style={{ padding:22, background:C.panel, borderRadius:14, border:`1px solid ${C.border}`, marginBottom:24 }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700, color:C.teal }}>⚡ Quick Add</h3>
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="Paste a URL…"
              style={{...inputS, flex:1}} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
            <button onClick={async()=>{if(urlInput.trim()){await ingestUrl(urlInput.trim());setUrlInput("");setView("canvas");}}}
              disabled={busy} style={{...btnP, opacity:busy?.5:1, whiteSpace:"nowrap"}}>{busy?"…":"Add URL"}</button>
          </div>
          <textarea value={pasteInput} onChange={e=>setPasteInput(e.target.value)} rows={3}
            placeholder="Or paste article text, research snippets, notes…"
            style={{...inputS, resize:"vertical"}} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
          <button onClick={async()=>{if(pasteInput.trim()){await ingestText(pasteInput.trim());setPasteInput("");setView("canvas");}}}
            disabled={busy||!pasteInput.trim()} style={{...btnP, marginTop:10, opacity:(busy||!pasteInput.trim())?.4:1}}>
            {busy?"Analyzing…":"Analyze & Add"}
          </button>
        </div>
        {/* Manual form */}
        <div style={{ padding:22, background:C.panel, borderRadius:14, border:`1px solid ${C.border}` }}>
          <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700, color:C.text }}>Manual Entry</h3>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            {[
              {k:"title",l:"Title",span:true},
              {k:"sourceType",l:"Source Type",sel:["URL","PDF","Image","Excel/CSV","Text","Report","News Article","Research Paper","Other"]},
              {k:"url",l:"URL"},
              {k:"bank",l:"Bank",sel:BANKS},
              {k:"category",l:"Category",sel:CATEGORIES},
              {k:"aiTech",l:"AI Technology",ph:"NLP, CV, LLM…"},
              {k:"status",l:"Status",sel:STATUS_OPTIONS},
              {k:"useCase",l:"Use Case",span:true,ph:"One-line AI use case description"},
              {k:"summary",l:"Summary",span:true,ta:true},
              {k:"impact",l:"Impact / ROI",ph:"e.g. 40% cost reduction"},
              {k:"tags",l:"Tags (comma-sep)",isTag:true},
              {k:"notes",l:"Notes",span:true,ta:true},
            ].map(f=>(
              <div key={f.k} style={f.span?{gridColumn:"1/-1"}:{}}>
                <label style={labelS}>{f.l}</label>
                {f.sel ? (
                  <select value={form[f.k]} onChange={e=>setForm({...form,[f.k]:e.target.value})} style={{...inputS,cursor:"pointer"}}>
                    {f.sel.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.ta ? (
                  <textarea value={form[f.k]} onChange={e=>setForm({...form,[f.k]:e.target.value})} rows={3}
                    style={{...inputS,resize:"vertical"}} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
                ) : (
                  <input value={f.isTag?(form.tags||[]).join(", "):(form[f.k]??"")}
                    onChange={e=>f.isTag?setForm({...form,tags:e.target.value.split(",").map(t=>t.trim()).filter(Boolean)}):setForm({...form,[f.k]:e.target.value})}
                    placeholder={f.ph||""} style={inputS} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop:18, display:"flex", gap:8 }}>
            <button onClick={saveForm} style={btnP}>{editing?.id?"Update":"Add Entry"}</button>
            <button onClick={()=>{setEditing(null);setView("canvas");}} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Manrope','SF Pro Display',system-ui,sans-serif", padding:"0 20px 48px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />

      {/* Busy bar */}
      {busy && (
        <div style={{
          position:"fixed",top:0,left:0,right:0,zIndex:999,padding:"10px 0",
          background:`linear-gradient(90deg,${C.accent},${C.teal})`,textAlign:"center",
          fontSize:13,fontWeight:700,color:"#fff",animation:"bp 1.4s ease-in-out infinite",
        }}>
          <style>{`@keyframes bp{0%,100%{opacity:1}50%{opacity:.65}}`}</style>
          🧠 {busyMsg}
        </div>
      )}

      {/* ══════════ HEADER ══════════ */}
      <header style={{ padding:"24px 0 16px", borderBottom:`1px solid ${C.border}`, marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:C.teal, letterSpacing:"-0.5px" }}>
            ◆ BankAI Canvas
          </h1>
          <p style={{ margin:"3px 0 0", fontSize:12, color:C.dim }}>
            {user.displayName || user.email} · {entries.length} source{entries.length!==1?"s":""}
          </p>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {[
            {key:"canvas",icon:"◉",label:"Canvas"},
            {key:"table",icon:"☰",label:"Table"},
            {key:"add",icon:"+",label:"Add"},
          ].map(v=>(
            <button key={v.key} onClick={()=>{setEditing(null);setView(v.key);}} style={{
              padding:"7px 16px", borderRadius:7,
              border:`1px solid ${view===v.key?C.accent:C.border}`,
              background:view===v.key?C.accentSoft:"transparent",
              color:view===v.key?C.accent:C.muted,
              cursor:"pointer", fontWeight:700, fontSize:12, fontFamily:"inherit",
            }}>{v.icon} {v.label}</button>
          ))}
          <button onClick={()=>exportCSV(entries)} disabled={!entries.length} style={{
            padding:"7px 16px", borderRadius:7, border:`1px solid ${C.teal}`,
            background:C.tealSoft, color:C.teal,
            cursor:entries.length?"pointer":"not-allowed",
            fontWeight:700, fontSize:12, fontFamily:"inherit", opacity:entries.length?1:.4,
          }}>↓ CSV</button>
          <button onClick={()=>signOut(auth)} style={{
            padding:"7px 14px", borderRadius:7, border:`1px solid ${C.border}`,
            background:"transparent", color:C.dim,
            cursor:"pointer", fontWeight:600, fontSize:11, fontFamily:"inherit",
          }}>Sign out</button>
        </div>
      </header>

      {/* ══════════ SEARCH & FILTERS ══════════ */}
      {view!=="add" && (
        <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 260px", position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:C.dim, fontSize:14 }}>⌕</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search titles, banks, tech, tags…"
              style={{...inputS, paddingLeft:34}}
              onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
          </div>
          {[
            {val:fCat,set:setFCat,opts:["All",...CATEGORIES],label:"Category"},
            {val:fBank,set:setFBank,opts:["All",...BANKS],label:"Bank"},
            {val:fStatus,set:setFStatus,opts:["All",...STATUS_OPTIONS],label:"Status"},
          ].map(f=>(
            <select key={f.label} value={f.val} onChange={e=>f.set(e.target.value)}
              style={{...inputS,width:"auto",cursor:"pointer",color:f.val==="All"?C.dim:C.text}}>
              {f.opts.map(o=><option key={o} value={o}>{o==="All"?`All ${f.label}`:o}</option>)}
            </select>
          ))}
        </div>
      )}

      {/* ══════════ STATS ══════════ */}
      {view!=="add" && entries.length>0 && (
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:20 }}>
          {[
            {n:entries.length,l:"Total Sources",c:C.accent},
            {n:entries.filter(e=>e.status==="To Review").length,l:"To Review",c:C.amber},
            {n:entries.filter(e=>e.status==="Key Finding").length,l:"Key Findings",c:C.violet},
            {n:[...new Set(entries.map(e=>e.bank))].length,l:"Banks",c:C.teal},
          ].map(s=>(
            <div key={s.l} style={{ flex:"1 1 120px", padding:"14px 18px", background:C.panel, borderRadius:10, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:22, fontWeight:800, color:s.c, fontFamily:"'JetBrains Mono',monospace" }}>{s.n}</div>
              <div style={{ fontSize:10, color:C.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", marginTop:2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════ VIEWS ══════════ */}
      {view==="add" && <FormView />}

      {/* TABLE */}
      {view==="table" && (
        <div style={{ overflowX:"auto", borderRadius:10, border:`1px solid ${C.border}` }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"inherit" }}>
            <thead>
              <tr style={{ background:C.panel }}>
                {["#","Title","Type","Bank","Category","AI Tech","Use Case","Impact","Status","Date"].map(h=>(
                  <th key={h} style={{ padding:"11px 12px", textAlign:"left", color:C.dim, fontWeight:700, borderBottom:`1px solid ${C.border}`, fontSize:10, textTransform:"uppercase", letterSpacing:".5px", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e,i)=>(
                <tr key={e.id} onClick={()=>{setEditing(e);setView("add");}}
                  style={{ borderBottom:`1px solid ${C.border}`, cursor:"pointer", transition:"background .15s" }}
                  onMouseEnter={ev=>ev.currentTarget.style.background=C.card}
                  onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                  <td style={{padding:"9px 12px",color:C.dim}}>{i+1}</td>
                  <td style={{padding:"9px 12px",color:C.text,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.title}</td>
                  <td style={{padding:"9px 12px"}}><span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType}</span></td>
                  <td style={{padding:"9px 12px",color:C.text}}>{e.bank}</td>
                  <td style={{padding:"9px 12px",color:C.muted}}>{e.category}</td>
                  <td style={{padding:"9px 12px",color:C.text}}>{e.aiTech}</td>
                  <td style={{padding:"9px 12px",color:C.muted,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.useCase}</td>
                  <td style={{padding:"9px 12px",color:C.text}}>{e.impact}</td>
                  <td style={{padding:"9px 12px"}}><span style={pill(`${statusC[e.status]}18`,statusC[e.status])}><span style={{width:5,height:5,borderRadius:"50%",background:statusC[e.status]}}/> {e.status}</span></td>
                  <td style={{padding:"9px 12px",color:C.dim,whiteSpace:"nowrap"}}>{e.dateAdded}</td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={10} style={{padding:36,textAlign:"center",color:C.dim}}>No entries match</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* CANVAS */}
      {view==="canvas" && (
        <>
          {/* Drop zone */}
          <div onDragOver={e=>{e.preventDefault();setIsDragOver(true);}} onDragLeave={()=>setIsDragOver(false)}
            onDrop={onDrop} onClick={()=>fileRef.current?.click()}
            style={{
              padding:"36px 20px", marginBottom:22, borderRadius:14,
              border:`2px dashed ${isDragOver?C.teal:C.border}`,
              background:isDragOver?C.tealSoft:C.panel,
              textAlign:"center", cursor:"pointer", transition:"all .25s",
            }}>
            <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt,.md,.doc,.docx"
              onChange={async e=>{for(const f of Array.from(e.target.files))await ingestFile(f);e.target.value="";}}
              style={{display:"none"}} />
            <div style={{fontSize:36,marginBottom:6}}>{isDragOver?"📥":"◆"}</div>
            <div style={{fontSize:15,fontWeight:700,color:isDragOver?C.teal:C.text}}>
              {isDragOver?"Release to analyze":"Drop anything here"}
            </div>
            <div style={{fontSize:12,color:C.dim,marginTop:4}}>
              URLs · PDFs · images · Excel · text — Gemini categorizes &amp; summarizes
            </div>
          </div>

          {/* Cards */}
          {filtered.length > 0 ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))", gap:14 }}>
              {filtered.map(e => {
                const isOpen = expanded === e.id;
                return (
                  <div key={e.id} onClick={()=>setExpanded(isOpen?null:e.id)} style={{
                    background:C.card, borderRadius:12, padding:18,
                    border:`1px solid ${isOpen?C.borderLit:C.border}`,
                    cursor:"pointer", transition:"all .2s",
                    boxShadow:isOpen?`0 0 20px ${C.accentSoft}`:"none",
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                      <h4 style={{margin:0,fontSize:13,fontWeight:700,color:C.text,lineHeight:1.4,flex:1}}>{e.title}</h4>
                      <span style={pill(`${statusC[e.status]}18`,statusC[e.status])}>
                        <span style={{width:5,height:5,borderRadius:"50%",background:statusC[e.status]}}/> {e.status}
                      </span>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                      <span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType}</span>
                      <span style={pill(C.tealSoft,C.teal)}>{e.bank}</span>
                      <span style={pill(C.violetSoft,C.violet)}>{e.category}</span>
                    </div>
                    <p style={{margin:0,fontSize:12,color:C.muted,lineHeight:1.55}}>
                      {e.summary?.slice(0,isOpen?9999:110)}{!isOpen&&(e.summary||"").length>110?"…":""}
                    </p>
                    {isOpen && (
                      <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12}}>
                          <div><span style={{color:C.dim}}>AI Tech: </span><span style={{color:C.text}}>{e.aiTech||"—"}</span></div>
                          <div><span style={{color:C.dim}}>Impact: </span><span style={{color:C.text}}>{e.impact||"—"}</span></div>
                          <div style={{gridColumn:"1/-1"}}><span style={{color:C.dim}}>Use Case: </span><span style={{color:C.text}}>{e.useCase||"—"}</span></div>
                          {e.url && <div style={{gridColumn:"1/-1"}}><span style={{color:C.dim}}>URL: </span><a href={e.url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{color:C.accent,textDecoration:"none",fontSize:12}}>{e.url.slice(0,55)}…</a></div>}
                          {e.notes && <div style={{gridColumn:"1/-1"}}><span style={{color:C.dim}}>Notes: </span><span style={{color:C.text}}>{e.notes}</span></div>}
                        </div>
                        {(e.tags||[]).length>0 && (
                          <div style={{marginTop:10,display:"flex",gap:4,flexWrap:"wrap"}}>
                            {e.tags.map(t=><span key={t} style={{padding:"2px 8px",background:C.bg,color:C.dim,borderRadius:4,fontSize:10}}>#{t}</span>)}
                          </div>
                        )}
                        <div style={{marginTop:12,display:"flex",gap:6}}>
                          <button onClick={ev=>{ev.stopPropagation();setEditing(e);setView("add");}} style={{padding:"5px 12px",background:C.accentSoft,color:C.accent,border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Edit</button>
                          <button onClick={ev=>{ev.stopPropagation();cycleStatus(e);}} style={{padding:"5px 12px",background:C.tealSoft,color:C.teal,border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Cycle Status</button>
                          <button onClick={ev=>{ev.stopPropagation();removeEntry(e.id);}} style={{padding:"5px 12px",background:C.roseSoft,color:C.rose,border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Delete</button>
                        </div>
                      </div>
                    )}
                    <div style={{marginTop:8,fontSize:10,color:C.dim}}>{e.dateAdded}</div>
                  </div>
                );
              })}
            </div>
          ) : !entries.length ? (
            <div style={{textAlign:"center",padding:"56px 20px"}}>
              <div style={{fontSize:44,marginBottom:10}}>◆</div>
              <div style={{fontSize:15,fontWeight:700,color:C.muted}}>Canvas is empty</div>
              <div style={{fontSize:12,color:C.dim,marginTop:4}}>Drop a link, PDF, or paste research to begin</div>
            </div>
          ) : (
            <div style={{textAlign:"center",padding:36,color:C.dim}}>No entries match your filters</div>
          )}
        </>
      )}
    </div>
  );
}
