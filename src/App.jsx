// src/App.jsx — BankAI Research Canvas (Firebase + Gemini Edition)
import { useState, useRef, useEffect } from "react";
import { db, auth, googleProvider } from "./firebase";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, query, where,
  orderBy, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import {
  signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
} from "firebase/auth";

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
// Prefer explicit env URL, then hosting rewrite, then direct Cloud Function URL.
const projectId = import.meta.env.VITE_FB_PROJECT_ID;
const SUMMARIZE_URLS = [
  import.meta.env.VITE_SUMMARIZE_URL,
  "/api/summarize",
  projectId ? `https://us-central1-${projectId}.cloudfunctions.net/summarize` : null,
].filter(Boolean);

async function requestSummarize(url, token, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return res.json();
}

async function aiRequest(payload, user) {
  const token = user ? await user.getIdToken() : null;
  for (const url of SUMMARIZE_URLS) {
    try {
      return await requestSummarize(url, token, payload);
    } catch {
      // Try the next candidate endpoint.
    }
  }
  throw new Error("No summarize endpoint succeeded");
}

async function aiSummarize(payload, user) {
  try {
    return await aiRequest(payload, user);
  } catch {
    return {
      title: "", summary: "AI unavailable — edit manually.",
      bank_mentioned: "Other / Multiple", category: "Other",
      ai_technology: "Unknown", use_case: "", impact: "Not specified",
      tags: [], confidence: { overall: 30, category: 30, bank: 30 }, evidence: [],
    };
  }
}

async function aiSemanticSearch(textQuery, entries, user) {
  try {
    return await aiRequest({ action: "semantic_search", query: textQuery, entries }, user);
  } catch {
    return { ids: [], explanation: "Semantic ranking unavailable." };
  }
}

/* ═══════════════════════════════════════════
   CSV EXPORT
   ═══════════════════════════════════════════ */
function exportCSV(entries, fileName = `banking_ai_research_${new Date().toISOString().slice(0,10)}.csv`) {
  const h = ["ID","Title","Source Type","URL","Bank","Category","AI Technology",
    "Use Case","Summary","Impact / ROI","Status","Tags","Confidence","Evidence","Date Added","Notes"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = entries.map((e, i) => [
    i+1, e.title, e.sourceType, e.url, e.bank, e.category, e.aiTech,
    e.useCase, e.summary, e.impact, e.status, (e.tags||[]).join("; "),
    e.confidence?.overall ?? "", (e.evidence||[]).join(" | "), e.dateAdded, e.notes,
  ].map(esc).join(","));
  const blob = new Blob(["\uFEFF" + [h.map(esc).join(","), ...rows].join("\n")],
    { type: "text/csv;charset=utf-8;" });
  Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: fileName,
  }).click();
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: fileName,
  }).click();
}

/* ═══════════════════════════════════════════
   PALETTE & STYLES
   ═══════════════════════════════════════════ */
const C = {
  bg: "#F1F5F9", panel: "#FFFFFF", card: "#FFFFFF", cardHov: "#F8FAFC",
  border: "#E2E8F0", borderLit: "#2563EB", accent: "#2563EB",
  accentSoft: "rgba(37,99,235,0.08)", teal: "#0D9488", tealSoft: "rgba(13,148,136,0.08)",
  amber: "#D97706", amberSoft: "rgba(217,119,6,0.08)", rose: "#DC2626",
  roseSoft: "rgba(220,38,38,0.08)", violet: "#7C3AED", violetSoft: "rgba(124,58,237,0.08)",
  text: "#0F172A", muted: "#475569", dim: "#94A3B8",
};
const statusC = { "To Review": C.amber, Reviewed: C.teal, "Key Finding": C.violet, Archived: C.dim };
const srcIcon = { URL:"🔗", PDF:"📄", Image:"🖼", "Excel/CSV":"📊", Text:"✏️", File:"📁",
  Report:"📋", "News Article":"📰", "Research Paper":"🔬", Other:"📎" };

const pill = (bg, fg) => ({
  display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px",
  background:bg, color:fg, borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:"nowrap",
});
const inputS = {
  width:"100%", padding:"10px 14px", background:"#FFFFFF", border:`1px solid ${C.border}`,
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
   AUTH SCREEN
   ═══════════════════════════════════════════ */
function AuthScreen() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async (fn) => {
    setError(""); setInfo(""); setLoading(true);
    try { await fn(); } catch (e) { setError(e.message.replace("Firebase: ", "").replace(/ \(auth\/.*\)/, "")); }
    setLoading(false);
  };

  const submit = () => {
    if (mode === "signup") handle(() => createUserWithEmailAndPassword(auth, email, password));
    else handle(() => signInWithEmailAndPassword(auth, email, password));
  };

  const resetPw = () => handle(async () => {
    await sendPasswordResetEmail(auth, email);
    setInfo("Reset email sent — check your inbox.");
    setMode("login");
  });

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Manrope',sans-serif", padding:20 }}>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
      <div style={{ width:"100%", maxWidth:380, background:C.panel, borderRadius:16, border:`1px solid ${C.border}`, padding:36 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:40, marginBottom:10 }}>◆</div>
          <h1 style={{ margin:"0 0 6px", fontSize:22, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:C.teal, letterSpacing:"-0.5px" }}>BankAI Canvas</h1>
          <p style={{ margin:0, fontSize:12, color:C.dim }}>
            {mode === "signup" ? "Create an account" : mode === "reset" ? "Reset your password" : "Sign in to your account"}
          </p>
        </div>

        {error && <div style={{ background:C.roseSoft, color:C.rose, borderRadius:8, padding:"10px 14px", fontSize:12, marginBottom:16, border:`1px solid ${C.rose}44` }}>{error}</div>}
        {info  && <div style={{ background:C.tealSoft, color:C.teal,  borderRadius:8, padding:"10px 14px", fontSize:12, marginBottom:16, border:`1px solid ${C.teal}44` }}>{info}</div>}

        <div style={{ marginBottom:12 }}>
          <label style={labelS}>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"
            style={inputS} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
        </div>

        {mode !== "reset" && (
          <div style={{ marginBottom:20 }}>
            <label style={labelS}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Min 6 characters" : "••••••••"}
              style={inputS} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border}
              onKeyDown={e=>e.key==="Enter"&&submit()} />
          </div>
        )}

        {mode === "reset" ? (
          <button onClick={resetPw} disabled={loading||!email} style={{ ...btnP, width:"100%", opacity:(loading||!email)?0.5:1, marginBottom:12 }}>
            {loading ? "Sending…" : "Send Reset Email"}
          </button>
        ) : (
          <button onClick={submit} disabled={loading||!email||!password} style={{ ...btnP, width:"100%", opacity:(loading||!email||!password)?0.5:1, marginBottom:12 }}>
            {loading ? "…" : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
        )}

        <div style={{ textAlign:"center", marginBottom:16 }}>
          {mode !== "reset" && (
            <span style={{ fontSize:11, color:C.dim, cursor:"pointer" }} onClick={()=>{setMode(mode==="login"?"signup":"login");setError("");}}>
              {mode === "login" ? "No account? Sign up" : "Already have an account? Sign in"}
            </span>
          )}
          {mode === "login" && <span style={{ color:C.dim, fontSize:11 }}> · </span>}
          {mode !== "signup" && (
            <span style={{ fontSize:11, color:C.dim, cursor:"pointer" }} onClick={()=>{setMode(mode==="reset"?"login":"reset");setError("");}}>
              {mode === "reset" ? "Back to sign in" : "Forgot password?"}
            </span>
          )}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ flex:1, height:1, background:C.border }} />
          <span style={{ fontSize:11, color:C.dim }}>or</span>
          <div style={{ flex:1, height:1, background:C.border }} />
        </div>

        <button onClick={()=>signInWithPopup(auth, googleProvider)} style={{
          ...btnP, width:"100%", background:"transparent",
          border:`1px solid ${C.border}`, color:C.text, fontWeight:600,
        }}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}

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
  const [queue, setQueue] = useState([]);
  const [pendingCards, setPendingCards] = useState([]);
  const [successToasts, setSuccessToasts] = useState([]);
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticIds, setSemanticIds] = useState([]);
  const [semanticInfo, setSemanticInfo] = useState("");
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState("filtered");
  const [exportFormat, setExportFormat] = useState("csv");
  const [connectorUrl, setConnectorUrl] = useState("");
  const [dedupeModal, setDedupeModal] = useState(null);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [pasteInput, setPasteInput] = useState("");
  const fileRef = useRef(null);
  const lastPaste = useRef({ text: "", time: 0 });
  const retryStore = useRef({});

  /* ─── Queue helpers ─── */
  const enqueue = (label) => {
    const id = Math.random().toString(36).slice(2);
    setQueue(q => [...q, { id, label, status: "running" }]);
    return id;
  };
  const dequeue = (id) => setQueue(q => q.filter(x => x.id !== id));
  const setQueueStatus = (id, status, error = "") => {
    setQueue(q => q.map(item => (item.id === id ? { ...item, status, error } : item)));
  };

  const normalizeUrl = (url) => String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");

  const findExistingByUrl = (url) => {
    const norm = normalizeUrl(url);
    return entries.find(e => e.url && normalizeUrl(e.url) === norm);
  };

  const pushPendingCard = (id, title, sourceType) => {
    setPendingCards(cards => [{ id, title, sourceType, status: "analyzing", error: "" }, ...cards]);
  };

  const finishPendingCard = (id, status, error = "") => {
    setPendingCards(cards => cards.map(c => (c.id === id ? { ...c, status, error } : c)));
    if (status === "done") {
      setTimeout(() => {
        setPendingCards(cards => cards.filter(c => c.id !== id));
      }, 1400);
    }
  };

  const retryPendingCard = async (id) => {
    const meta = retryStore.current[id];
    if (!meta) return;
    finishPendingCard(id, "analyzing", "");
    setQueueStatus(id, "running", "");
    await meta.retry();
  };

  const pushSuccessToast = (text) => {
    const id = Math.random().toString(36).slice(2);
    setSuccessToasts(t => [...t, { id, text }]);
    setTimeout(() => {
      setSuccessToasts(t => t.filter(x => x.id !== id));
    }, 2600);
  };

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

  const semanticFiltered = semanticIds.length
    ? filtered
      .filter(e => semanticIds.includes(e.id))
      .sort((a, b) => semanticIds.indexOf(a.id) - semanticIds.indexOf(b.id))
    : filtered;

  /* ─── Ingest helpers ─── */
  const baseEntry = (ov) => ({
    title:"", sourceType:"Text", url:"", bank:"Other / Multiple",
    category:"Other", aiTech:"", useCase:"", summary:"", impact:"Not specified",
    status:"To Review", tags:[], dateAdded:new Date().toISOString().slice(0,10),
    notes:"", confidence:{ overall: 0, category: 0, bank: 0 }, evidence:[], extractedSnapshot:null,
    ...ov,
  });

  const buildAiEntry = (ai, overrides = {}) => baseEntry({
    title: ai.title || overrides.title || "Untitled",
    sourceType: overrides.sourceType || "Text",
    url: overrides.url || "",
    bank: ai.bank_mentioned || "Other / Multiple",
    category: ai.category || "Other",
    aiTech: ai.ai_technology || "Unknown",
    useCase: ai.use_case || "",
    summary: ai.summary || "AI unavailable — edit manually.",
    impact: ai.impact || "Not specified",
    tags: Array.isArray(ai.tags) ? ai.tags.slice(0, 10) : [],
    confidence: ai.confidence || { overall: 35, category: 35, bank: 35 },
    evidence: Array.isArray(ai.evidence) ? ai.evidence.slice(0, 3) : [],
    extractedSnapshot: ai.extracted || null,
    ...overrides,
  });

  const mergeEntryFromAi = async (existing, ai) => {
    const mergedTags = [...new Set([...(existing.tags || []), ...(ai.tags || [])])].slice(0, 12);
    await updateEntry(existing.id, {
      summary: ai.summary || existing.summary,
      bank: ai.bank_mentioned || existing.bank,
      category: ai.category || existing.category,
      aiTech: ai.ai_technology || existing.aiTech,
      useCase: ai.use_case || existing.useCase,
      impact: ai.impact || existing.impact,
      evidence: Array.isArray(ai.evidence) ? ai.evidence.slice(0, 3) : (existing.evidence || []),
      confidence: ai.confidence || existing.confidence,
      tags: mergedTags,
      extractedSnapshot: ai.extracted || existing.extractedSnapshot || null,
      notes: existing.notes
        ? `${existing.notes}\n\nMerged duplicate URL on ${new Date().toISOString().slice(0, 10)}`
        : `Merged duplicate URL on ${new Date().toISOString().slice(0, 10)}`,
    });
  };

  const runIngestJob = async ({ id, label, sourceType, payloadBuilder, onComplete }) => {
    setPendingCards(cards => {
      const exists = cards.some(c => c.id === id);
      if (exists) {
        return cards.map(c => (c.id === id ? { ...c, status: "analyzing", error: "" } : c));
      }
      return [{ id, title: label, sourceType, status: "analyzing", error: "" }, ...cards];
    });
    retryStore.current[id] = {
      retry: async () => {
        await runIngestJob({ id, label, sourceType, payloadBuilder, onComplete });
      },
    };
    try {
      const ai = await aiSummarize(payloadBuilder(), user);
      await onComplete(ai);
      finishPendingCard(id, "done");
      setQueueStatus(id, "done", "");
    } catch (err) {
      const msg = err?.message || "Processing failed";
      finishPendingCard(id, "error", msg);
      setQueueStatus(id, "error", msg);
      return;
    }
    dequeue(id);
    delete retryStore.current[id];
  };

  const ingestUrl = async (url) => {
    const label = url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50);
    const id = enqueue(label);
    const existing = findExistingByUrl(url);
    if (existing) {
      setDedupeModal({ id, url, existing, label });
      return;
    }

    await runIngestJob({
      id,
      label,
      sourceType: "URL",
      payloadBuilder: () => ({
        action: "analyze",
        url,
        content: `Analyze this banking AI source URL and extract evidence-rich details: ${url}`,
      }),
      onComplete: async (ai) => {
        const entry = buildAiEntry(ai, {
          title: ai.title || url.replace(/https?:\/\/(www\.)?/, "").slice(0, 70),
          sourceType: "URL",
          url,
        });
        await addEntry(entry);
        pushSuccessToast(`Added to canvas: ${entry.title}`);
      },
    });
  };

  const ingestText = async (text) => {
    const label = text.slice(0, 50).replace(/\n/g, " ") + "…";
    const id = enqueue(label);
    await runIngestJob({
      id,
      label,
      sourceType: "Text",
      payloadBuilder: () => ({ action: "analyze", content: text }),
      onComplete: async (ai) => {
        const entry = buildAiEntry(ai, {
          title: ai.title || text.slice(0, 65).replace(/\n/g, " ") + "…",
          sourceType: "Text",
        });
        await addEntry(entry);
        pushSuccessToast(`Added to canvas: ${entry.title}`);
      },
    });
  };

  const ingestFile = async (file) => {
    const id = enqueue(file.name.slice(0, 50));
    let sType = "File";
    if (file.type.includes("pdf")) sType = "PDF";
    else if (file.type.startsWith("image")) sType = "Image";
    else if (file.name.match(/\.(xlsx|xls|csv)$/i)) sType = "Excel/CSV";
    let text = `File: ${file.name} (${sType}, ${(file.size / 1024).toFixed(1)} KB)`;
    if (file.type.startsWith("text") || file.name.match(/\.(csv|txt|md|json)$/i)) {
      text += "\n" + (await file.text()).slice(0, 4000);
    }
    await runIngestJob({
      id,
      label: file.name.slice(0, 50),
      sourceType: sType,
      payloadBuilder: () => ({ action: "analyze", content: text }),
      onComplete: async (ai) => {
        const entry = buildAiEntry(ai, { title: file.name, sourceType: sType });
        await addEntry(entry);
        pushSuccessToast(`Added to canvas: ${entry.title}`);
      },
    });
  };

  const onDrop = (e) => {
    e.preventDefault(); setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const text = e.dataTransfer.getData("text/plain");
    if (files.length) files.forEach(f => ingestFile(f));
    else if (text?.match(/^https?:\/\//)) ingestUrl(text);
    else if (text) ingestText(text);
  };

  /* ─── Global paste (⌘V anywhere) ─── */
  useEffect(() => {
    if (!user) return;
    const handler = (e) => {
      if (view !== "canvas") return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find(i => i.type?.startsWith("image/"));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          e.preventDefault();
          setPasteFlash(true);
          setTimeout(() => setPasteFlash(false), 1800);
          ingestFile(file);
          return;
        }
      }

      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      const now = Date.now();
      if (text === lastPaste.current.text && now - lastPaste.current.time < 2000) return;
      lastPaste.current = { text, time: now };
      e.preventDefault();
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 1800);
      if (text.match(/^https?:\/\//)) ingestUrl(text);
      else ingestText(text);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [user, view]);

  const cycleStatus = async (entry) => {
    const next = STATUS_OPTIONS[(STATUS_OPTIONS.indexOf(entry.status)+1)%STATUS_OPTIONS.length];
    await updateEntry(entry.id, { status: next });
  };

  const clearSemantic = () => {
    setSemanticIds([]);
    setSemanticInfo("");
  };

  const runSemantic = async () => {
    if (!semanticQuery.trim()) return;
    setSemanticLoading(true);
    const ranked = await aiSemanticSearch(
      semanticQuery.trim(),
      filtered.map(e => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        useCase: e.useCase,
        bank: e.bank,
        category: e.category,
        tags: e.tags || [],
      })),
      user
    );
    setSemanticIds(Array.isArray(ranked.ids) ? ranked.ids : []);
    setSemanticInfo(ranked.explanation || "Semantic ranking applied.");
    setSemanticLoading(false);
  };

  const exportTarget = exportScope === "all" ? entries : semanticFiltered;

  const exportAsJson = () => {
    downloadFile(
      JSON.stringify(exportTarget, null, 2),
      `banking_ai_research_${new Date().toISOString().slice(0,10)}.json`,
      "application/json"
    );
  };

  const exportAsMarkdown = () => {
    const body = exportTarget.map((e, idx) => [
      `## ${idx + 1}. ${e.title || "Untitled"}`,
      `- Source: ${e.sourceType}`,
      `- Bank: ${e.bank}`,
      `- Category: ${e.category}`,
      `- AI Tech: ${e.aiTech || "Unknown"}`,
      `- Impact: ${e.impact || "Not specified"}`,
      `- Tags: ${(e.tags || []).join(", ")}`,
      "",
      `${e.summary || ""}`,
      "",
    ].join("\n")).join("\n");
    downloadFile(
      body,
      `banking_ai_research_${new Date().toISOString().slice(0,10)}.md`,
      "text/markdown;charset=utf-8"
    );
  };

  const sendToConnector = async () => {
    if (!connectorUrl.trim()) return;
    try {
      await fetch(connectorUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exportedAt: new Date().toISOString(),
          count: exportTarget.length,
          entries: exportTarget,
        }),
      });
      pushSuccessToast("Connector export sent");
    } catch {
      pushSuccessToast("Connector export failed");
    }
  };

  const doExport = async () => {
    if (exportFormat === "csv") {
      exportCSV(exportTarget);
    } else if (exportFormat === "json") {
      exportAsJson();
    } else if (exportFormat === "markdown") {
      exportAsMarkdown();
    } else if (exportFormat === "connector") {
      await sendToConnector();
    }
    if (exportFormat !== "connector") {
      pushSuccessToast(`Exported ${exportTarget.length} item${exportTarget.length!==1?"s":""}`);
    }
    setExportOpen(false);
  };

  const applyDedupeChoice = async (choice) => {
    const modal = dedupeModal;
    if (!modal) return;
    setDedupeModal(null);

    const { id, label, url, existing } = modal;
    if (choice === "cancel") {
      dequeue(id);
      return;
    }

    await runIngestJob({
      id,
      label,
      sourceType: "URL",
      payloadBuilder: () => ({
        action: "analyze",
        url,
        content: `Analyze this banking AI source URL and extract evidence-rich details: ${url}`,
      }),
      onComplete: async (ai) => {
        if (choice === "merge") {
          await mergeEntryFromAi(existing, ai);
          pushSuccessToast(`Merged into existing card: ${existing.title}`);
          return;
        }
        if (choice === "update") {
          await updateEntry(existing.id, {
            title: ai.title || existing.title,
            summary: ai.summary || existing.summary,
            bank: ai.bank_mentioned || existing.bank,
            category: ai.category || existing.category,
            aiTech: ai.ai_technology || existing.aiTech,
            useCase: ai.use_case || existing.useCase,
            impact: ai.impact || existing.impact,
            tags: Array.isArray(ai.tags) ? ai.tags.slice(0, 10) : existing.tags,
            confidence: ai.confidence || existing.confidence,
            evidence: Array.isArray(ai.evidence) ? ai.evidence.slice(0, 3) : existing.evidence,
            extractedSnapshot: ai.extracted || existing.extractedSnapshot || null,
          });
          pushSuccessToast(`Updated existing card: ${existing.title}`);
          return;
        }

        const entry = buildAiEntry(ai, {
          title: ai.title || url.replace(/https?:\/\/(www\.)?/, "").slice(0, 70),
          sourceType: "URL",
          url,
          notes: `Duplicate of ${existing.id}`,
        });
        await addEntry(entry);
        pushSuccessToast(`Added duplicate as new card: ${entry.title}`);
      },
    });
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
    return <AuthScreen />;
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
              style={{...inputS, flex:1}} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border}
              onKeyDown={e=>{
                if (e.key !== "Enter") return;
                const urls = Array.from(new Set((urlInput.match(/https?:\/\/[^\s,]+/g) || []).map(u => u.trim())));
                if (!urls.length) return;
                urls.forEach(ingestUrl);
                setUrlInput("");
              }} />
            <button onClick={()=>{
              const urls = Array.from(new Set((urlInput.match(/https?:\/\/[^\s,]+/g) || []).map(u => u.trim())));
              if (!urls.length && urlInput.trim().match(/^https?:\/\//)) urls.push(urlInput.trim());
              if (!urls.length) return;
              urls.forEach(ingestUrl);
              setUrlInput("");
            }}
              style={{...btnP, whiteSpace:"nowrap"}}>Add URL</button>
          </div>
          <div style={{ fontSize:11, color:C.dim, marginTop:-4, marginBottom:10 }}>
            Add one or many URLs at once (space/newline separated). You stay on this screen while items process.
          </div>
          <textarea value={pasteInput} onChange={e=>setPasteInput(e.target.value)} rows={3}
            placeholder="Or paste article text, research snippets, notes…"
            style={{...inputS, resize:"vertical"}} onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
          <button onClick={()=>{if(pasteInput.trim()){ingestText(pasteInput.trim());setPasteInput("");}}}
            disabled={!pasteInput.trim()} style={{...btnP, marginTop:10, opacity:!pasteInput.trim()?.4:1}}>
            Analyze & Add
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

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Paste flash toast */}
      {pasteFlash && (
        <div style={{
          position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
          zIndex:1001, background:C.teal, color:"#fff",
          padding:"9px 22px", borderRadius:24, fontSize:13, fontWeight:700,
          boxShadow:"0 4px 20px rgba(0,0,0,0.15)", animation:"fadein .2s ease",
          pointerEvents:"none",
        }}>
          ⌘V detected — analyzing…
        </div>
      )}

      {/* Success toasts */}
      {successToasts.length > 0 && (
        <div style={{ position:"fixed", top:64, right:20, zIndex:1002, display:"flex", flexDirection:"column", gap:8 }}>
          {successToasts.map(t => (
            <div key={t.id} style={{
              background:C.panel,
              border:`1px solid ${C.teal}66`,
              color:C.text,
              borderRadius:10,
              padding:"10px 14px",
              fontSize:12,
              minWidth:220,
              maxWidth:360,
              boxShadow:"0 8px 24px rgba(2,6,23,0.14)",
              animation:"fadein .2s ease",
            }}>
              <span style={{ color:C.teal, fontWeight:800, marginRight:6 }}>✓</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {dedupeModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.4)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"100%",maxWidth:540,background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,padding:18,boxShadow:"0 18px 48px rgba(2,6,23,0.2)"}}>
            <h3 style={{margin:"0 0 8px",fontSize:16,color:C.text}}>Duplicate URL Detected</h3>
            <p style={{margin:"0 0 12px",fontSize:12,color:C.muted,lineHeight:1.5}}>
              This URL already exists as <strong>{dedupeModal.existing.title}</strong>. Choose how to handle this source.
            </p>
            <div style={{display:"grid",gap:8,marginBottom:12}}>
              <button onClick={()=>applyDedupeChoice("merge")} style={{...btnP,justifySelf:"start"}}>Merge Insights Into Existing</button>
              <button onClick={()=>applyDedupeChoice("update")} style={{...btnP,justifySelf:"start",background:C.teal}}>Replace Existing AI Analysis</button>
              <button onClick={()=>applyDedupeChoice("new")} style={{...btnP,justifySelf:"start",background:C.violet}}>Add As New Card Anyway</button>
            </div>
            <button onClick={()=>applyDedupeChoice("cancel")} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Cancel</button>
          </div>
        </div>
      )}

      {exportOpen && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"100%",maxWidth:620,background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,padding:18,boxShadow:"0 20px 50px rgba(2,6,23,0.2)"}}>
            <h3 style={{margin:"0 0 12px",fontSize:16,color:C.text}}>Export Center</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={labelS}>Scope</label>
                <select value={exportScope} onChange={e=>setExportScope(e.target.value)} style={{...inputS,cursor:"pointer"}}>
                  <option value="filtered">Filtered / Current View</option>
                  <option value="all">All Entries</option>
                </select>
              </div>
              <div>
                <label style={labelS}>Format</label>
                <select value={exportFormat} onChange={e=>setExportFormat(e.target.value)} style={{...inputS,cursor:"pointer"}}>
                  <option value="csv">CSV (optional download)</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown Brief</option>
                  <option value="connector">Connector Webhook</option>
                </select>
              </div>
            </div>
            {exportFormat === "connector" && (
              <div style={{marginBottom:12}}>
                <label style={labelS}>Connector Endpoint URL</label>
                <input value={connectorUrl} onChange={e=>setConnectorUrl(e.target.value)} placeholder="https://hooks.slack.com/..." style={inputS} />
              </div>
            )}
            <div style={{fontSize:12,color:C.dim,marginBottom:14}}>
              {exportScope === "all" ? `Exporting all ${entries.length} entries.` : `Exporting current subset (${semanticFiltered.length} entries).`}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={doExport} style={btnP}>Run Export</button>
              <button onClick={()=>setExportOpen(false)} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Queue panel */}
      {queue.length > 0 && (
        <div style={{
          position:"fixed", bottom:24, right:24, zIndex:1000,
          background:C.panel, border:`1px solid ${C.border}`,
          borderRadius:14, padding:"14px 16px", minWidth:260, maxWidth:340,
          boxShadow:"0 8px 32px rgba(0,0,0,0.12)", animation:"fadein .2s ease",
        }}>
          <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:".6px"}}>
            Queue · {queue.filter(q => q.status === "running").length} running · {queue.filter(q => q.status === "error").length} failed
          </div>
          {queue.map(item => (
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderTop:`1px solid ${C.border}`}}>
              {item.status === "running" ? (
                <div style={{
                  width:14,height:14,borderRadius:"50%",flexShrink:0,
                  border:`2px solid ${C.accent}`,borderTopColor:"transparent",
                  animation:"spin .8s linear infinite",
                }}/>
              ) : (
                <div style={{ width:14, textAlign:"center", color:item.status === "error" ? C.rose : C.teal, fontWeight:800 }}>
                  {item.status === "error" ? "!" : "✓"}
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flex:1,minWidth:0}}>
                <span style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.label}</span>
                {item.status === "error" && (
                  <button onClick={()=>retryPendingCard(item.id)} style={{padding:"2px 8px",fontSize:10,borderRadius:6,border:`1px solid ${C.rose}`,background:C.roseSoft,color:C.rose,cursor:"pointer",fontWeight:700}}>
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))}
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
          <button onClick={()=>setExportOpen(true)} disabled={!entries.length} style={{
            padding:"7px 16px", borderRadius:7, border:`1px solid ${C.teal}`,
            background:C.tealSoft, color:C.teal,
            cursor:entries.length?"pointer":"not-allowed",
            fontWeight:700, fontSize:12, fontFamily:"inherit", opacity:entries.length?1:.4,
          }}>↓ Export</button>
          <button onClick={()=>signOut(auth)} style={{
            padding:"7px 14px", borderRadius:7, border:`1px solid ${C.border}`,
            background:"transparent", color:C.dim,
            cursor:"pointer", fontWeight:600, fontSize:11, fontFamily:"inherit",
          }}>Sign out</button>
        </div>
      </header>

      {/* ══════════ SEARCH & FILTERS ══════════ */}
      {view!=="add" && (
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
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

      {view!=="add" && (
        <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
          <input
            value={semanticQuery}
            onChange={e=>setSemanticQuery(e.target.value)}
            placeholder="Semantic search: e.g. agentic AI compliance with measurable ROI"
            style={{...inputS, flex:"1 1 360px"}}
            onKeyDown={e=>{ if (e.key === "Enter") runSemantic(); }}
          />
          <button onClick={runSemantic} disabled={semanticLoading || !semanticQuery.trim()} style={{...btnP, opacity:(semanticLoading || !semanticQuery.trim())?0.6:1}}>
            {semanticLoading ? "Ranking…" : "Semantic Rank"}
          </button>
          {semanticIds.length > 0 && (
            <button onClick={clearSemantic} style={{...btnP, background:"transparent", color:C.muted, border:`1px solid ${C.border}`}}>
              Clear Semantic
            </button>
          )}
          {semanticInfo && <div style={{ fontSize:11, color:C.dim }}>{semanticInfo}</div>}
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
              {semanticFiltered.map((e,i)=>(
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
              {!semanticFiltered.length && <tr><td colSpan={10} style={{padding:36,textAlign:"center",color:C.dim}}>No entries match</td></tr>}
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
            <div style={{fontSize:11,color:C.dim,marginTop:6,opacity:.7}}>
              or press <kbd style={{background:C.border,borderRadius:4,padding:"1px 6px",fontSize:11,fontFamily:"inherit"}}>⌘V</kbd> anywhere to paste instantly
            </div>
          </div>

          {/* Processing stack */}
          {pendingCards.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>
                Processing {pendingCards.length} item{pendingCards.length>1?"s":""}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:10 }}>
                {pendingCards.map(card => (
                  <div key={card.id} style={{
                    background:C.panel,
                    border:`1px solid ${card.status==="error" ? C.rose : C.border}`,
                    borderRadius:10,
                    padding:12,
                    boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", marginBottom:6 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:C.text, overflowWrap:"anywhere" }}>{card.title}</div>
                      <span style={pill(C.accentSoft, C.accent)}>{card.sourceType}</span>
                    </div>
                    <div style={{ fontSize:11, color:card.status==="error"?C.rose:(card.status==="done"?C.teal:C.dim), fontWeight:700 }}>
                      {card.status === "analyzing" ? "Analyzing..." : card.status === "done" ? "Added to canvas" : "Could not add this source"}
                    </div>
                    {card.status === "error" && (
                      <div style={{ marginTop:8, display:"flex", gap:6 }}>
                        <button onClick={()=>retryPendingCard(card.id)} style={{padding:"4px 10px",fontSize:10,borderRadius:6,border:`1px solid ${C.rose}`,background:C.roseSoft,color:C.rose,cursor:"pointer",fontWeight:700}}>
                          Retry
                        </button>
                        <button onClick={()=>{setPendingCards(x=>x.filter(p=>p.id!==card.id));dequeue(card.id);delete retryStore.current[card.id];}} style={{padding:"4px 10px",fontSize:10,borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer",fontWeight:700}}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cards */}
          {semanticFiltered.length > 0 ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))", gap:14 }}>
              {semanticFiltered.map(e => {
                const isOpen = expanded === e.id;
                return (
                  <div key={e.id} onClick={()=>setExpanded(isOpen?null:e.id)} style={{
                    background:C.card, borderRadius:12, padding:18,
                    border:`1px solid ${isOpen?C.borderLit:C.border}`,
                    cursor:"pointer", transition:"all .2s",
                    boxShadow:isOpen?`0 0 0 3px ${C.accentSoft}`:"0 1px 4px rgba(0,0,0,0.07)",
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                      <h4 style={{margin:0,fontSize:13,fontWeight:700,color:C.text,lineHeight:1.4,flex:"1 1 220px",overflowWrap:"anywhere"}}>{e.title}</h4>
                      <span style={pill(`${statusC[e.status]}18`,statusC[e.status])}>
                        <span style={{width:5,height:5,borderRadius:"50%",background:statusC[e.status]}}/> {e.status}
                      </span>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                      <span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType}</span>
                      <span style={pill(C.tealSoft,C.teal)}>{e.bank}</span>
                      <span style={pill(C.violetSoft,C.violet)}>{e.category}</span>
                      {typeof e.confidence?.overall === "number" && (
                        <span style={pill(C.amberSoft,C.amber)}>Confidence {e.confidence.overall}%</span>
                      )}
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
                          {e.url && (
                            <div style={{gridColumn:"1/-1"}}>
                              <span style={{color:C.dim}}>URL:</span>
                              <a
                                href={e.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={ev=>ev.stopPropagation()}
                                style={{
                                  color:C.accent,
                                  textDecoration:"none",
                                  fontSize:12,
                                  marginLeft:6,
                                  overflowWrap:"anywhere",
                                }}
                              >
                                {e.url}
                              </a>
                            </div>
                          )}
                          {e.notes && <div style={{gridColumn:"1/-1"}}><span style={{color:C.dim}}>Notes: </span><span style={{color:C.text}}>{e.notes}</span></div>}
                          {(e.evidence||[]).length > 0 && (
                            <div style={{gridColumn:"1/-1"}}>
                              <span style={{color:C.dim}}>Evidence:</span>
                              <ul style={{margin:"6px 0 0", paddingLeft:16, color:C.text}}>
                                {(e.evidence || []).map((ev, idx) => (
                                  <li key={idx} style={{marginBottom:3, fontSize:12}}>{ev}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        {(e.tags||[]).length>0 && (
                          <div style={{marginTop:10,display:"flex",gap:4,flexWrap:"wrap"}}>
                            {e.tags.map(t=><span key={t} style={{padding:"2px 8px",background:C.bg,color:C.dim,borderRadius:4,fontSize:10}}>#{t}</span>)}
                          </div>
                        )}
                        <div style={{marginTop:12,display:"flex",gap:6,flexWrap:"wrap"}}>
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
