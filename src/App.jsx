// src/App.jsx — BankAI Research Canvas (Firebase + Gemini Edition)
import { useState, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db, auth, googleProvider } from "./firebase";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, query, where,
  orderBy, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import {
  signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
} from "firebase/auth";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
const BANK_PREFIXES = {
  "Citibank": "C",
  "Citi": "C",
  "JPMorgan Chase": "JPMC",
  "JPMC": "JPMC",
  "Bank of America": "BOA",
  "Wells Fargo": "WF",
  "Goldman Sachs": "GS",
  "Morgan Stanley": "MS",
  HSBC: "HSBC",
  Barclays: "BARC",
  "Deutsche Bank": "DB",
  UBS: "UBS",
  "BNP Paribas": "BNP",
  "Standard Chartered": "SCB",
  "DBS Bank": "DBS",
  "ICICI Bank": "ICICI",
  "HDFC Bank": "HDFC",
  SBI: "SBI",
  "Axis Bank": "AXIS",
  "Kotak Mahindra": "KOTAK",
  "RBI (Central Bank)": "RBI",
  "Other / Multiple": "OTH",
};
const STATUS_OPTIONS = ["To Review", "Reviewed", "Key Finding", "Archived"];
const DIVISIONS = ["Front Office", "Operations", "Corporate Functions", "Engineering", "Enablers", "Not specified"];
const AREAS = [
  "Client Experience", "Banker Enablement", "Product", "Operations", "Risk and Audit",
  "Engineering", "Finance and Business Management", "HR", "Compliance", "Data and Analytics", "Other", "Not specified",
];
const SCALE_OPTIONS = ["Small", "Pilot", "Department", "Enterprise", "Cross-enterprise", "Not specified"];
const TECH_SOPHISTICATION_OPTIONS = ["Basic", "Intermediate", "Advanced", "Frontier", "Not specified"];
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
      division: "Not specified", area: "Not specified", scale: "Not specified", tech_sophistication: "Not specified",
      tags: [], confidence: { overall: 30, category: 30, bank: 30, structure: 30 }, evidence: [],
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

async function aiDedupeClusters(entries, user) {
  try {
    return await aiRequest({ action: "dedupe_clusters", entries }, user);
  } catch {
    return { clusters: [] };
  }
}

/* ═══════════════════════════════════════════
   CSV EXPORT
   ═══════════════════════════════════════════ */
function exportCSV(entries, fileName = `banking_ai_research_${new Date().toISOString().slice(0,10)}.csv`) {
  const h = ["ID","Title","Source Type","URL","Bank","Category","AI Technology",
    "Use Case","Summary","Impact / ROI","Division","Area","Scale","Tech Sophistication","Status","Tags","Confidence","Structure Confidence","Evidence","Source References","Date Added","Notes"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = entries.map((e, i) => [
    i+1, e.title, e.sourceType, e.url, e.bank, e.category, e.aiTech,
    e.useCase, e.summary, e.impact, e.division, e.area, e.scale, e.techSophistication, e.status, (e.tags||[]).join("; "),
    e.confidence?.overall ?? "", e.confidence?.structure ?? "", (e.evidence||[]).join(" | "), (e.sourceRefs||[]).map(r => r.url || r.title).join(" | "), e.dateAdded, e.notes,
  ].map(esc).join(","));
  const blob = new Blob(["\uFEFF" + [h.map(esc).join(","), ...rows].join("\n")],
    { type: "text/csv;charset=utf-8;" });
  Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: fileName,
  }).click();
}

function exportTSV(entries, fileName = `banking_ai_research_${new Date().toISOString().slice(0,10)}.tsv`) {
  const h = ["ID","Title","Source Type","URL","Bank","Category","AI Technology",
    "Use Case","Summary","Impact / ROI","Division","Area","Scale","Tech Sophistication","Status","Tags","Confidence","Structure Confidence","Evidence","Source References","Date Added","Notes"];
  const esc = v => String(v ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
  const rows = entries.map((e, i) => [
    i+1, e.title, e.sourceType, e.url, e.bank, e.category, e.aiTech,
    e.useCase, e.summary, e.impact, e.division, e.area, e.scale, e.techSophistication, e.status, (e.tags||[]).join("; "),
    e.confidence?.overall ?? "", e.confidence?.structure ?? "", (e.evidence||[]).join(" | "), (e.sourceRefs||[]).map(r => r.url || r.title).join(" | "), e.dateAdded, e.notes,
  ].map(esc).join("\t"));
  const blob = new Blob([[h.join("\t"), ...rows].join("\n")],
    { type: "text/tab-separated-values;charset=utf-8;" });
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
  bg: "#ECF2FA", panel: "#FFFFFF", card: "#FFFFFF", cardHov: "#F8FBFF",
  border: "#D7E3F1", borderLit: "#2563EB", accent: "#1D4ED8",
  accentSoft: "rgba(29,78,216,0.10)", teal: "#0F766E", tealSoft: "rgba(15,118,110,0.10)",
  amber: "#B45309", amberSoft: "rgba(180,83,9,0.10)", rose: "#DC2626",
  roseSoft: "rgba(220,38,38,0.10)", violet: "#6D28D9", violetSoft: "rgba(109,40,217,0.10)",
  text: "#0B1B34", muted: "#3D526E", dim: "#7A8CA5",
};
const statusC = { "To Review": C.amber, Reviewed: C.teal, "Key Finding": C.violet, Archived: C.dim };
const srcIcon = { URL:"🔗", PDF:"📄", Image:"🖼", "Excel/CSV":"📊", Text:"✏️", File:"📁",
  Report:"📋", "News Article":"📰", "Research Paper":"🔬", Other:"📎" };

const pill = (bg, fg) => ({
  display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px",
  background:bg, color:fg, borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:"nowrap",
});
const inputS = {
  width:"100%", padding:"10px 14px", background:"#FBFDFF", border:`1px solid ${C.border}`,
  borderRadius:10, color:C.text, fontSize:14, outline:"none", fontFamily:"inherit",
  boxSizing:"border-box", transition:"border-color .2s, box-shadow .2s, background .2s",
};
const selectS = {
  ...inputS,
  cursor:"pointer",
  appearance:"none",
  WebkitAppearance:"none",
  MozAppearance:"none",
  paddingRight:36,
  backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:"no-repeat",
  backgroundPosition:"right 12px center",
  backgroundSize:"12px",
};
const labelS = {
  display:"block", fontSize:11, color:C.muted, marginBottom:5,
  fontWeight:700, letterSpacing:".6px", textTransform:"uppercase",
};
const btnP = {
  padding:"10px 22px", background:"linear-gradient(135deg, #1D4ED8 0%, #2563EB 55%, #0EA5E9 100%)", color:"#fff", border:"none",
  borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13, fontFamily:"inherit",
  boxShadow:"0 6px 16px rgba(29,78,216,0.28)",
};

const getBankPrefix = (bank) => BANK_PREFIXES[bank] || String(bank || "GEN")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .trim()
  .split(/\s+/)
  .map(part => part[0])
  .join("")
  .slice(0, 8) || "GEN";

const getProductHeadline = (entry) => {
  const bankPrefix = getBankPrefix(entry?.bank);
  const product = String(entry?.productName || entry?.title || "Untitled").trim();
  const normalized = product.toLowerCase();
  const bankLabel = String(entry?.bank || "").trim().toLowerCase();
  const prefixLabel = String(bankPrefix || "").trim().toLowerCase();

  if (!product) return `${bankPrefix} Untitled`;
  if (normalized.startsWith(prefixLabel + " ") || normalized.startsWith(bankLabel + " ")) return product;
  return `${bankPrefix} ${product}`;
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
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [hasBootedEntries, setHasBootedEntries] = useState(false);
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("canvas");
  const [viewLoading, setViewLoading] = useState(false);
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
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [dedupeLoading, setDedupeLoading] = useState(false);
  const [autoConsolidate, setAutoConsolidate] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState("filtered");
  const [exportFormat, setExportFormat] = useState("csv");
  const [connectorUrl, setConnectorUrl] = useState("");
  const [dedupeModal, setDedupeModal] = useState(null);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [cardActionLoading, setCardActionLoading] = useState({});
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [pasteInput, setPasteInput] = useState("");
  const fileRef = useRef(null);
  const lastPaste = useRef({ text: "", time: 0 });
  const retryStore = useRef({});
  const lastAutoDedupeCount = useRef(0);
  const cardCodeBackfillDone = useRef(false);

  const showFeedback = (type, title, message) => {
    setFeedbackModal({ type, title, message });
  };

  const runAction = async ({ key, run, successTitle, successMessage, errorTitle = "Action failed" }) => {
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const result = await run();
      if (successTitle || successMessage) {
        showFeedback("success", successTitle || "Success", successMessage || "Action completed.");
      }
      return result;
    } catch (err) {
      showFeedback("error", errorTitle, err?.message || "Something went wrong.");
      return null;
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const runCardAction = async ({ id, key, run, successTitle, successMessage, errorTitle = "Card action failed" }) => {
    const loadingKey = `${id}:${key}`;
    setCardActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
      const result = await run();
      if (successTitle || successMessage) {
        showFeedback("success", successTitle || "Success", successMessage || "Card updated.");
      }
      return result;
    } catch (err) {
      showFeedback("error", errorTitle, err?.message || "Unable to update this card.");
      return null;
    } finally {
      setCardActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

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
    setEntriesLoading(true);
    const q = query(
      collection(db, COLLECTION),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setEntriesLoading(false);
      setHasBootedEntries(true);
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    setViewLoading(true);
    const timer = setTimeout(() => setViewLoading(false), 220);
    return () => clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    if (!user || !hasBootedEntries || cardCodeBackfillDone.current) return;
    const missing = entries.filter(e => !e.cardCode);
    if (!missing.length) {
      cardCodeBackfillDone.current = true;
      return;
    }
    cardCodeBackfillDone.current = true;
    const reservedCodes = new Set(entries.map(e => e.cardCode).filter(Boolean));
    (async () => {
      for (const entry of missing) {
        const cardCode = allocateCardCode(entry.bank, entries, reservedCodes);
        await updateEntry(entry.id, { cardCode, productName: entry.productName || entry.title || "Untitled" });
      }
    })();
  }, [user, hasBootedEntries, entries]);

  /* ─── Firestore CRUD ─── */
  const addEntry = async (data) => {
    if (!user) return;
    const finalRecord = normalizeCardRecord(data);
    await addDoc(collection(db, COLLECTION), {
      ...finalRecord,
      uid: user.uid,
      createdAt: serverTimestamp(),
    });
  };
  const updateEntry = async (id, data) => {
    await updateDoc(doc(db, COLLECTION, id), data);
  };
  const removeEntry = async (id) => {
    await runAction({
      key: "trash-card",
      run: async () => {
        await updateDoc(doc(db, COLLECTION, id), {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
        });
      },
      successTitle: "Moved to trash",
      successMessage: "Card moved to trash. You can restore it anytime.",
      errorTitle: "Delete failed",
    });
    setExpanded(null);
  };

  const restoreEntry = async (id) => {
    await runAction({
      key: "restore-card",
      run: async () => {
        await updateDoc(doc(db, COLLECTION, id), { isDeleted: false, deletedAt: null });
      },
      successTitle: "Card restored",
      successMessage: "The card is back in your active view.",
      errorTitle: "Restore failed",
    });
  };

  const removeEntryPermanent = async (id) => {
    await runAction({
      key: "delete-permanent",
      run: async () => {
        await deleteDoc(doc(db, COLLECTION, id));
      },
      successTitle: "Permanently deleted",
      successMessage: "The card was permanently removed.",
      errorTitle: "Permanent delete failed",
    });
  };

  /* ─── Filtering ─── */
  const isMeaningfulEntry = (e) => {
    const text = [e?.title, e?.summary, e?.useCase, e?.url].join(" ").trim();
    return text.length > 0;
  };

  const activeEntries = entries.filter(e => !e.isDeleted && isMeaningfulEntry(e));
  const trashEntries = entries.filter(e => e.isDeleted);

  const filtered = activeEntries.filter(e => {
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

  const filterCategories = ["All", ...new Set(activeEntries.map(e => e.category).filter(Boolean))];
  const filterBanks = ["All", ...new Set(activeEntries.map(e => e.bank).filter(Boolean))];
  const filterStatuses = ["All", ...new Set(activeEntries.map(e => e.status).filter(Boolean))];

  useEffect(() => {
    if (!autoConsolidate || dedupeLoading) return;
    if (activeEntries.length < 25) return;
    if (lastAutoDedupeCount.current === 0) {
      lastAutoDedupeCount.current = activeEntries.length;
      return;
    }
    if (activeEntries.length - lastAutoDedupeCount.current >= 25) {
      lastAutoDedupeCount.current = activeEntries.length;
      consolidateDuplicateCards("auto-25");
    }
  }, [activeEntries.length, autoConsolidate, dedupeLoading]);

  /* ─── Ingest helpers ─── */
  const baseEntry = (ov) => ({
    title:"", productName:"", cardCode:"", sourceType:"Text", url:"", bank:"Other / Multiple",
    category:"Other", aiTech:"", useCase:"", summary:"", impact:"Not specified",
    division:"Not specified", area:"Not specified", scale:"Not specified", techSophistication:"Not specified",
    status:"To Review", tags:[], dateAdded:new Date().toISOString().slice(0,10),
    notes:"", confidence:{ overall: 0, category: 0, bank: 0 }, evidence:[], extractedSnapshot:null,
    sourceRefs:[], sourceCount:0,
    isDeleted:false, deletedAt:null,
    ...ov,
  });

  const extractInitiatives = (ai, fallbackTitle) => {
    const list = Array.isArray(ai?.initiatives) && ai.initiatives.length ? ai.initiatives : [ai];
    return list.map((item, idx) => ({
      ...item,
      title: item?.title || `${fallbackTitle} · Initiative ${idx + 1}`,
      extracted: ai?.extracted || item?.extracted || null,
    }));
  };

  const extractPdfText = async (file) => {
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const pageLimit = Math.min(pdf.numPages, 24);
      const chunks = [];
      for (let i = 1; i <= pageLimit; i += 1) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const txt = content.items
          .map(item => (typeof item.str === "string" ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (txt) chunks.push(txt);
      }
      return chunks.join("\n").slice(0, 24000);
    } catch {
      return "";
    }
  };

  const buildAiEntry = (ai, overrides = {}) => baseEntry({
    title: ai.title || overrides.title || "Untitled",
    productName: ai.product_name || ai.product || ai.title || overrides.productName || overrides.title || "Untitled",
    sourceType: overrides.sourceType || "Text",
    url: overrides.url || "",
    bank: ai.bank_mentioned || "Other / Multiple",
    category: ai.category || "Other",
    aiTech: ai.ai_technology || "Unknown",
    useCase: ai.use_case || "",
    summary: ai.summary || "AI unavailable — edit manually.",
    impact: ai.impact || "Not specified",
    division: ai.division || "Not specified",
    area: ai.area || "Not specified",
    scale: ai.scale || "Not specified",
    techSophistication: ai.tech_sophistication || "Not specified",
    tags: Array.isArray(ai.tags) ? ai.tags.slice(0, 10) : [],
    confidence: ai.confidence || { overall: 35, category: 35, bank: 35, structure: 35 },
    evidence: Array.isArray(ai.evidence) ? ai.evidence.slice(0, 3) : [],
    extractedSnapshot: ai.extracted || null,
    sourceRefs: Array.isArray(overrides.sourceRefs) ? overrides.sourceRefs : [],
    sourceCount: Array.isArray(overrides.sourceRefs) ? overrides.sourceRefs.length : 0,
    ...overrides,
  });

  const allocateCardCode = (bank, sourceEntries = entries, reservedCodes = new Set()) => {
    const prefix = getBankPrefix(bank);
    const existingNumbers = sourceEntries
      .map(entry => entry?.cardCode)
      .filter(code => typeof code === "string" && code.startsWith(`${prefix}-`))
      .map(code => Number(code.slice(prefix.length + 1)))
      .filter(num => Number.isFinite(num));
    let nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
    let candidate = `${prefix}-${nextNumber}`;
    while (reservedCodes.has(candidate) || sourceEntries.some(entry => entry?.cardCode === candidate)) {
      nextNumber += 1;
      candidate = `${prefix}-${nextNumber}`;
    }
    reservedCodes.add(candidate);
    return candidate;
  };

  const normalizeCardRecord = (entry, { sourceEntries = entries, reservedCodes = new Set() } = {}) => ({
    ...entry,
    productName: entry.productName || entry.product_name || entry.title || "Untitled",
    cardCode: entry.cardCode || allocateCardCode(entry.bank, sourceEntries, reservedCodes),
  });

  const makeSourceRef = ({ sourceType, url, title, id }) => ({
    sourceType: sourceType || "Text",
    url: url || "",
    title: title || "Untitled",
    refId: id || "",
    addedAt: new Date().toISOString(),
  });

  const mergeSourceRefs = (items) => {
    const all = items.flatMap(x => Array.isArray(x?.sourceRefs) ? x.sourceRefs : []);
    const dedup = [];
    const seen = new Set();
    for (const ref of all) {
      const key = `${ref.url || ""}|${ref.title || ""}|${ref.sourceType || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(ref);
    }
    return dedup;
  };

  const consolidateDuplicateCards = async (reason = "manual") => {
    if (!activeEntries.length) return;
    setDedupeLoading(true);
    try {
      const response = await aiDedupeClusters(
        activeEntries.map(e => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          useCase: e.useCase,
          bank: e.bank,
          category: e.category,
          url: e.url,
          sourceType: e.sourceType,
        })),
        user
      );

      const clusters = (response.clusters || []).filter(c => Array.isArray(c.ids) && c.ids.length > 1 && (c.confidence ?? 0) >= 60);
      let mergedCount = 0;

      for (const cluster of clusters) {
        const clusterEntries = cluster.ids
          .map(id => activeEntries.find(e => e.id === id))
          .filter(Boolean);
        if (clusterEntries.length < 2) continue;

        const primary = clusterEntries[0];
        const secondaries = clusterEntries.slice(1);
        const mergedTags = [...new Set(clusterEntries.flatMap(e => e.tags || []))].slice(0, 15);
        const mergedEvidence = [...new Set(clusterEntries.flatMap(e => e.evidence || []))].slice(0, 6);
        const refs = mergeSourceRefs(clusterEntries.map(e => ({
          sourceRefs: (e.sourceRefs && e.sourceRefs.length)
            ? e.sourceRefs
            : [makeSourceRef({ sourceType: e.sourceType, url: e.url, title: e.title, id: e.id })],
        })));

        await updateEntry(primary.id, {
          tags: mergedTags,
          evidence: mergedEvidence,
          sourceRefs: refs,
          sourceCount: refs.length,
          mergedFromIds: clusterEntries.slice(1).map(item => item.id),
          mergedFromCodes: clusterEntries.slice(1).map(item => item.cardCode || item.id),
          mergedFromTitles: clusterEntries.slice(1).map(item => item.productName || item.title || "Untitled"),
          notes: primary.notes
            ? `${primary.notes}\n\nConsolidated duplicate cluster (${reason}) on ${new Date().toISOString().slice(0, 10)}`
            : `Consolidated duplicate cluster (${reason}) on ${new Date().toISOString().slice(0, 10)}`,
        });

        for (const s of secondaries) {
          await updateEntry(s.id, {
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            mergedIntoId: primary.id,
            mergedIntoCode: primary.cardCode || primary.id,
            mergedIntoTitle: primary.productName || primary.title || "Untitled",
            mergedReason: cluster.topic || reason,
            notes: s.notes
              ? `${s.notes}\n\nMerged into ${primary.id} (${cluster.topic || "same topic"})`
              : `Merged into ${primary.id} (${cluster.topic || "same topic"})`,
          });
          mergedCount += 1;
        }
      }

      if (mergedCount > 0) {
        pushSuccessToast(`Consolidated ${mergedCount} duplicate card${mergedCount!==1?"s":""}`);
      } else {
        pushSuccessToast("No strong duplicate clusters detected");
      }
      return mergedCount;
    } finally {
      setDedupeLoading(false);
    }
  };

  const mergeEntryFromAi = async (existing, ai) => {
    const mergedTags = [...new Set([...(existing.tags || []), ...(ai.tags || [])])].slice(0, 12);
    await updateEntry(existing.id, {
      summary: ai.summary || existing.summary,
      productName: ai.product_name || ai.product || existing.productName || existing.title,
      bank: ai.bank_mentioned || existing.bank,
      category: ai.category || existing.category,
      aiTech: ai.ai_technology || existing.aiTech,
      useCase: ai.use_case || existing.useCase,
      impact: ai.impact || existing.impact,
      division: ai.division || existing.division || "Not specified",
      area: ai.area || existing.area || "Not specified",
      scale: ai.scale || existing.scale || "Not specified",
      techSophistication: ai.tech_sophistication || existing.techSophistication || "Not specified",
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
        action: "analyze_multi",
        url,
        content: `Extract ALL distinct AI initiatives and use cases from this source, splitting by bank/program when possible: ${url}`,
      }),
      onComplete: async (ai) => {
        const initiatives = extractInitiatives(ai, url.replace(/https?:\/\/(www\.)?/, "").slice(0, 70));
        const reservedCodes = new Set();
        for (const initiative of initiatives) {
          const entry = normalizeCardRecord(buildAiEntry(initiative, {
            title: initiative.title,
            productName: initiative.product_name || initiative.product || initiative.title,
            sourceType: "URL",
            url,
            sourceRefs: [makeSourceRef({ sourceType: "URL", url, title: initiative.title })],
          }), { sourceEntries: entries, reservedCodes });
          await addEntry(entry);
        }
        pushSuccessToast(`Added ${initiatives.length} card${initiatives.length!==1?"s":""} from URL`);
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
      payloadBuilder: () => ({ action: "analyze_multi", content: text }),
      onComplete: async (ai) => {
        const initiatives = extractInitiatives(ai, text.slice(0, 65).replace(/\n/g, " ") + "…");
        const reservedCodes = new Set();
        for (const initiative of initiatives) {
          const entry = normalizeCardRecord(buildAiEntry(initiative, {
            title: initiative.title,
            productName: initiative.product_name || initiative.product || initiative.title,
            sourceType: "Text",
            sourceRefs: [makeSourceRef({ sourceType: "Text", title: initiative.title })],
          }), { sourceEntries: entries, reservedCodes });
          await addEntry(entry);
        }
        pushSuccessToast(`Added ${initiatives.length} card${initiatives.length!==1?"s":""} from text`);
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
    if (sType === "PDF") {
      const pdfText = await extractPdfText(file);
      if (pdfText) text += "\n" + pdfText;
    } else if (file.type.startsWith("text") || file.name.match(/\.(csv|txt|md|json)$/i)) {
      text += "\n" + (await file.text()).slice(0, 4000);
    }
    await runIngestJob({
      id,
      label: file.name.slice(0, 50),
      sourceType: sType,
      payloadBuilder: () => ({ action: "analyze_multi", content: text }),
      onComplete: async (ai) => {
        const initiatives = extractInitiatives(ai, file.name);
        const reservedCodes = new Set();
        for (const initiative of initiatives) {
          const entry = normalizeCardRecord(buildAiEntry(initiative, {
            title: initiative.title,
            productName: initiative.product_name || initiative.product || initiative.title,
            sourceType: sType,
            sourceRefs: [makeSourceRef({ sourceType: sType, title: initiative.title })],
          }), { sourceEntries: entries, reservedCodes });
          await addEntry(entry);
        }
        pushSuccessToast(`Added ${initiatives.length} card${initiatives.length!==1?"s":""} from ${sType}`);
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
    await runCardAction({
      id: entry.id,
      key: "cycle-status",
      run: async () => {
        await updateEntry(entry.id, { status: next });
      },
      successTitle: "Status updated",
      successMessage: `${entry.title || "Card"} moved to ${next}.`,
      errorTitle: "Status update failed",
    });
  };

  const clearSemantic = () => {
    setSemanticIds([]);
    setSemanticInfo("");
  };

  const runSemantic = async () => {
    if (!semanticQuery.trim()) return;
    await runAction({
      key: "semantic",
      run: async () => {
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
      },
      successTitle: "Semantic ranking complete",
      successMessage: "The current list was ranked by intent similarity.",
      errorTitle: "Semantic ranking failed",
    }).finally(() => setSemanticLoading(false));
  };

  const exportTarget = exportScope === "all" ? activeEntries : semanticFiltered;

  const inferStructureForEntry = async (entry) => {
    const material = [
      `Title: ${entry.title || ""}`,
      `Summary: ${entry.summary || ""}`,
      `Use case: ${entry.useCase || ""}`,
      `Impact: ${entry.impact || ""}`,
      `Bank: ${entry.bank || ""}`,
      entry.url ? `URL: ${entry.url}` : "",
    ].filter(Boolean).join("\n");

    const structured = await aiRequest({ action: "infer_structure", content: material }, user);
    await updateEntry(entry.id, {
      division: structured.division || entry.division || "Not specified",
      area: structured.area || entry.area || "Not specified",
      scale: structured.scale || entry.scale || "Not specified",
      techSophistication: structured.tech_sophistication || entry.techSophistication || "Not specified",
      impact: entry.impact && entry.impact !== "Not specified"
        ? entry.impact
        : (structured.impact || "Not specified"),
      confidence: {
        ...(entry.confidence || {}),
        structure: structured.confidence?.structure ?? entry.confidence?.structure ?? 35,
        overall: structured.confidence?.overall ?? entry.confidence?.overall ?? 35,
      },
    });
  };

  const backfillExistingStructure = async () => {
    const targets = activeEntries.filter(e =>
      !e.division || !e.area || !e.scale || !e.techSophistication ||
      e.division === "Not specified" || e.area === "Not specified" ||
      e.scale === "Not specified" || e.techSophistication === "Not specified"
    );
    if (!targets.length) {
      pushSuccessToast("All active cards already have structure fields.");
      return;
    }
    await runAction({
      key: "backfill",
      run: async () => {
        setBackfillLoading(true);
        for (const entry of targets) {
          try {
            await inferStructureForEntry(entry);
          } catch {
            // Continue to next entry if one fails.
          }
        }
      },
      successTitle: "Structure backfill complete",
      successMessage: `Backfilled structure for ${targets.length} card${targets.length !== 1 ? "s" : ""}.`,
      errorTitle: "Backfill failed",
    }).finally(() => setBackfillLoading(false));
  };

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
      `- Division: ${e.division || "Not specified"}`,
      `- Area: ${e.area || "Not specified"}`,
      `- Scale: ${e.scale || "Not specified"}`,
      `- Tech Sophistication: ${e.techSophistication || "Not specified"}`,
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
    await runAction({
      key: "export",
      run: async () => {
        if (exportFormat === "csv") {
          exportCSV(exportTarget);
        } else if (exportFormat === "tsv") {
          exportTSV(exportTarget);
        } else if (exportFormat === "json") {
          exportAsJson();
        } else if (exportFormat === "markdown") {
          exportAsMarkdown();
        } else if (exportFormat === "connector") {
          await sendToConnector();
        }
      },
      successTitle: "Export complete",
      successMessage: `Exported ${exportTarget.length} item${exportTarget.length!==1?"s":""} as ${exportFormat.toUpperCase()}.`,
      errorTitle: "Export failed",
    });
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

    await runAction({
      key: "dedupe-choice",
      run: async () => {
        await runIngestJob({
          id,
          label,
          sourceType: "URL",
          payloadBuilder: () => ({
            action: "analyze_multi",
            url,
            content: `Analyze this banking AI source URL and extract evidence-rich details: ${url}`,
          }),
          onComplete: async (ai) => {
            const initiatives = extractInitiatives(ai, url.replace(/https?:\/\/(www\.)?/, "").slice(0, 70));
            const primary = initiatives[0] || ai;
            if (choice === "merge") {
              await mergeEntryFromAi(existing, primary);
              const reservedCodes = new Set();
              for (const initiative of initiatives.slice(1)) {
                const extra = normalizeCardRecord(buildAiEntry(initiative, {
                  title: initiative.title,
                  productName: initiative.product_name || initiative.product || initiative.title,
                  sourceType: "URL",
                  url,
                  notes: `Split from duplicate source ${existing.id}`,
                  sourceRefs: [makeSourceRef({ sourceType: "URL", url, title: initiative.title })],
                }), { sourceEntries: entries, reservedCodes });
                await addEntry(extra);
              }
              pushSuccessToast(`Merged into existing card: ${existing.title}`);
              return;
            }
            if (choice === "update") {
              await updateEntry(existing.id, {
                title: primary.title || existing.title,
                productName: primary.product_name || primary.product || existing.productName || existing.title,
                summary: primary.summary || existing.summary,
                bank: primary.bank_mentioned || existing.bank,
                category: primary.category || existing.category,
                aiTech: primary.ai_technology || existing.aiTech,
                useCase: primary.use_case || existing.useCase,
                impact: primary.impact || existing.impact,
                division: primary.division || existing.division || "Not specified",
                area: primary.area || existing.area || "Not specified",
                scale: primary.scale || existing.scale || "Not specified",
                techSophistication: primary.tech_sophistication || existing.techSophistication || "Not specified",
                tags: Array.isArray(primary.tags) ? primary.tags.slice(0, 10) : existing.tags,
                confidence: primary.confidence || existing.confidence,
                evidence: Array.isArray(primary.evidence) ? primary.evidence.slice(0, 3) : existing.evidence,
                extractedSnapshot: primary.extracted || existing.extractedSnapshot || null,
              });
              const reservedCodes = new Set();
              for (const initiative of initiatives.slice(1)) {
                const extra = normalizeCardRecord(buildAiEntry(initiative, {
                  title: initiative.title,
                  productName: initiative.product_name || initiative.product || initiative.title,
                  sourceType: "URL",
                  url,
                  notes: `Split from updated duplicate source ${existing.id}`,
                  sourceRefs: [makeSourceRef({ sourceType: "URL", url, title: initiative.title })],
                }), { sourceEntries: entries, reservedCodes });
                await addEntry(extra);
              }
              pushSuccessToast(`Updated existing card: ${existing.title}`);
              return;
            }

            const reservedCodes = new Set();
            for (const initiative of initiatives) {
              const entry = normalizeCardRecord(buildAiEntry(initiative, {
                title: initiative.title,
                productName: initiative.product_name || initiative.product || initiative.title,
                sourceType: "URL",
                url,
                notes: `Duplicate of ${existing.id}`,
                sourceRefs: [makeSourceRef({ sourceType: "URL", url, title: initiative.title })],
              }), { sourceEntries: entries, reservedCodes });
              await addEntry(entry);
            }
            pushSuccessToast(`Added ${initiatives.length} duplicate card${initiatives.length!==1?"s":""}`);
          },
        });
      },
      successTitle: "Duplicate handling complete",
      successMessage: "The selected duplicate resolution path was applied.",
      errorTitle: "Duplicate action failed",
    });
  };

  /* ═══════════════════════════════════════════
     AUTH SCREEN
     ═══════════════════════════════════════════ */
  if (authLoading) {
    return (
      <div style={{
        minHeight:"100vh",
        background:`radial-gradient(900px 500px at 20% 20%, rgba(37,99,235,0.16), transparent 55%), radial-gradient(700px 420px at 80% 30%, rgba(15,118,110,0.16), transparent 58%), ${C.bg}`,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        padding:24,
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
        <div style={{ width:"100%", maxWidth:520, background:"rgba(255,255,255,0.88)", border:`1px solid ${C.border}`, borderRadius:20, padding:28, boxShadow:"0 24px 60px rgba(2,6,23,0.12)", backdropFilter:"blur(14px)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18 }}>
            <div style={{ width:54, height:54, borderRadius:16, background:"linear-gradient(135deg, rgba(29,78,216,0.14), rgba(15,118,110,0.16))", display:"grid", placeItems:"center", fontSize:28 }}>◆</div>
            <div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:C.teal, fontSize:20 }}>BankAI Canvas</div>
              <div style={{ color:C.dim, fontSize:12, marginTop:3 }}>Preparing your workspace</div>
            </div>
          </div>
          <div style={{ display:"grid", gap:10 }}>
            <div style={{ height:12, borderRadius:999, background:"linear-gradient(90deg, rgba(203,213,225,0.55), rgba(148,163,184,0.18), rgba(203,213,225,0.55))", backgroundSize:"200% 100%", animation:"shimmer 1.25s infinite" }} />
            <div style={{ height:12, borderRadius:999, width:"82%", background:"linear-gradient(90deg, rgba(203,213,225,0.55), rgba(148,163,184,0.18), rgba(203,213,225,0.55))", backgroundSize:"200% 100%", animation:"shimmer 1.25s infinite" }} />
            <div style={{ height:12, borderRadius:999, width:"68%", background:"linear-gradient(90deg, rgba(203,213,225,0.55), rgba(148,163,184,0.18), rgba(203,213,225,0.55))", backgroundSize:"200% 100%", animation:"shimmer 1.25s infinite" }} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:18, color:C.muted, fontSize:13 }}>
            <span style={{ width:14, height:14, borderRadius:"50%", border:`2px solid ${C.accent}`, borderTopColor:"transparent", animation:"spin .8s linear infinite" }} />
            Loading secure session and workspace data…
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (!hasBootedEntries) {
    return (
      <div style={{
        minHeight:"100vh",
        background:`radial-gradient(900px 500px at 20% 20%, rgba(37,99,235,0.16), transparent 55%), radial-gradient(700px 420px at 80% 30%, rgba(15,118,110,0.16), transparent 58%), ${C.bg}`,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        padding:24,
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
        <div style={{ width:"100%", maxWidth:620, background:"rgba(255,255,255,0.9)", border:`1px solid ${C.border}`, borderRadius:20, padding:28, boxShadow:"0 24px 60px rgba(2,6,23,0.12)", backdropFilter:"blur(14px)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:16, marginBottom:20 }}>
            <div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:C.teal, fontSize:22 }}>BankAI Canvas</div>
              <div style={{ color:C.dim, fontSize:12, marginTop:4 }}>Loading your active sources…</div>
            </div>
            <div style={{ width:54, height:54, borderRadius:18, background:"linear-gradient(135deg, rgba(29,78,216,0.14), rgba(15,118,110,0.16))", display:"grid", placeItems:"center", color:C.accent }}>
              <span style={{ width:18, height:18, borderRadius:"50%", border:`3px solid ${C.accent}`, borderTopColor:"transparent", animation:"spin .8s linear infinite" }} />
            </div>
          </div>
          <div style={{ display:"grid", gap:12 }}>
            <div style={{ height:14, borderRadius:999, background:"linear-gradient(90deg, rgba(203,213,225,0.6), rgba(148,163,184,0.22), rgba(203,213,225,0.6))", backgroundSize:"200% 100%", animation:"shimmer 1.2s infinite" }} />
            <div style={{ height:14, borderRadius:999, width:"92%", background:"linear-gradient(90deg, rgba(203,213,225,0.6), rgba(148,163,184,0.22), rgba(203,213,225,0.6))", backgroundSize:"200% 100%", animation:"shimmer 1.2s infinite" }} />
            <div style={{ height:14, borderRadius:999, width:"76%", background:"linear-gradient(90deg, rgba(203,213,225,0.6), rgba(148,163,184,0.22), rgba(203,213,225,0.6))", backgroundSize:"200% 100%", animation:"shimmer 1.2s infinite" }} />
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:8 }}>
              <span style={pill(C.accentSoft, C.accent)}>Syncing Firestore</span>
              <span style={pill(C.tealSoft, C.teal)}>Preparing filters</span>
              <span style={pill(C.violetSoft, C.violet)}>Warming the canvas</span>
            </div>
          </div>
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
      const result = await runAction({
        key: "save-form",
        run: async () => {
          if (editing?.id) {
            const { id, uid, createdAt, ...rest } = form;
            await updateEntry(editing.id, normalizeCardRecord(rest));
          } else {
            await addEntry(normalizeCardRecord(form));
          }
        },
        successTitle: editing?.id ? "Card updated" : "Card added",
        successMessage: editing?.id ? "Changes were saved successfully." : "New card added to canvas.",
        errorTitle: "Save failed",
      });
      if (result === null) return;
      setEditing(null); setView("canvas");
    };
    return (
      <div style={{ maxWidth:700, margin:"0 auto" }}>
        {/* Quick add */}
        <div style={{ padding:22, background:"rgba(255,255,255,0.92)", borderRadius:14, border:`1px solid ${C.border}`, marginBottom:24, boxShadow:"0 10px 26px rgba(15,23,42,0.08)" }}>
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
        <div style={{ padding:22, background:"rgba(255,255,255,0.92)", borderRadius:14, border:`1px solid ${C.border}`, boxShadow:"0 10px 26px rgba(15,23,42,0.08)" }}>
          <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700, color:C.text }}>Manual Entry</h3>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            {[
              {k:"title",l:"Title",span:true},
              {k:"sourceType",l:"Source Type",sel:["URL","PDF","Image","Excel/CSV","Text","Report","News Article","Research Paper","Other"]},
              {k:"url",l:"URL"},
              {k:"bank",l:"Bank",sel:BANKS},
              {k:"category",l:"Category",sel:CATEGORIES},
              {k:"division",l:"Division",sel:DIVISIONS},
              {k:"area",l:"Area",sel:AREAS},
              {k:"scale",l:"Scale",sel:SCALE_OPTIONS},
              {k:"techSophistication",l:"Tech Sophistication",sel:TECH_SOPHISTICATION_OPTIONS},
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
                  <select value={form[f.k]} onChange={e=>setForm({...form,[f.k]:e.target.value})} style={selectS}>
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
            <button onClick={saveForm} disabled={!!actionLoading["save-form"]} style={{...btnP, opacity:actionLoading["save-form"]?0.6:1}}>{actionLoading["save-form"] ? "Saving..." : (editing?.id?"Update":"Add Entry")}</button>
            <button onClick={()=>{setEditing(null);setView("canvas");}} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      minHeight:"100vh",
      background:`radial-gradient(1200px 600px at 80% -120px, rgba(37,99,235,0.16), transparent 55%), radial-gradient(900px 500px at 10% -100px, rgba(15,118,110,0.14), transparent 58%), ${C.bg}`,
      color:C.text,
      fontFamily:"'Manrope','SF Pro Display',system-ui,sans-serif",
      padding:"0 20px 48px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes drift{0%{transform:translateY(0px)}50%{transform:translateY(-4px)}100%{transform:translateY(0px)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        html { scroll-behavior: smooth; }
        * { scrollbar-width: thin; scrollbar-color: #CBD5E1 transparent; }
        *::-webkit-scrollbar { width: 10px; height: 10px; }
        *::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
        *::-webkit-scrollbar-track { background: transparent; }
        .surface-scroll { scrollbar-gutter: stable both-edges; }
        .glass-panel { background: rgba(255,255,255,0.86); backdrop-filter: blur(10px); }
      `}</style>

      <div style={{maxWidth:1280, margin:"0 auto"}}>

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
              <button disabled={!!actionLoading["dedupe-choice"]} onClick={()=>applyDedupeChoice("merge")} style={{...btnP,justifySelf:"start",opacity:actionLoading["dedupe-choice"]?0.6:1}}>{actionLoading["dedupe-choice"] ? "Working..." : "Merge Insights Into Existing"}</button>
              <button disabled={!!actionLoading["dedupe-choice"]} onClick={()=>applyDedupeChoice("update")} style={{...btnP,justifySelf:"start",background:C.teal,opacity:actionLoading["dedupe-choice"]?0.6:1}}>{actionLoading["dedupe-choice"] ? "Working..." : "Replace Existing AI Analysis"}</button>
              <button disabled={!!actionLoading["dedupe-choice"]} onClick={()=>applyDedupeChoice("new")} style={{...btnP,justifySelf:"start",background:C.violet,opacity:actionLoading["dedupe-choice"]?0.6:1}}>{actionLoading["dedupe-choice"] ? "Working..." : "Add As New Card Anyway"}</button>
            </div>
            <button disabled={!!actionLoading["dedupe-choice"]} onClick={()=>applyDedupeChoice("cancel")} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`,opacity:actionLoading["dedupe-choice"]?0.6:1}}>Cancel</button>
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
                <select value={exportScope} onChange={e=>setExportScope(e.target.value)} style={selectS}>
                  <option value="filtered">Filtered / Current View</option>
                  <option value="all">All Entries</option>
                </select>
              </div>
              <div>
                <label style={labelS}>Format</label>
                <select value={exportFormat} onChange={e=>setExportFormat(e.target.value)} style={selectS}>
                  <option value="csv">CSV (optional download)</option>
                  <option value="tsv">TSV</option>
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
              {exportScope === "all" ? `Exporting all ${activeEntries.length} active entries.` : `Exporting current subset (${semanticFiltered.length} entries).`}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={doExport} disabled={!!actionLoading["export"]} style={{...btnP,opacity:actionLoading["export"]?0.6:1}}>{actionLoading["export"] ? "Exporting..." : "Run Export"}</button>
              <button onClick={()=>setExportOpen(false)} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {feedbackModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"100%",maxWidth:460,background:C.panel,border:`1px solid ${feedbackModal.type === "error" ? C.rose : C.teal}66`,borderRadius:14,padding:18,boxShadow:"0 20px 50px rgba(2,6,23,0.24)"}}>
            <h3 style={{margin:"0 0 8px",fontSize:16,color:C.text}}>{feedbackModal.type === "error" ? "Action Failed" : "Action Complete"}</h3>
            <div style={{fontSize:13,fontWeight:700,color:feedbackModal.type === "error" ? C.rose : C.teal,marginBottom:8}}>{feedbackModal.title}</div>
            <p style={{margin:"0 0 14px",fontSize:12,color:C.muted,lineHeight:1.5}}>{feedbackModal.message}</p>
            <div style={{display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setFeedbackModal(null)} style={{...btnP,padding:"8px 14px",background:feedbackModal.type === "error" ? C.rose : C.teal}}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPermanentDelete && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.50)",zIndex:1160,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"100%",maxWidth:520,background:C.panel,border:`1px solid ${C.rose}55`,borderRadius:16,padding:20,boxShadow:"0 24px 60px rgba(2,6,23,0.24)"}}>
            <h3 style={{margin:"0 0 8px",fontSize:16,color:C.text}}>Delete permanently?</h3>
            <p style={{margin:"0 0 12px",fontSize:12,color:C.muted,lineHeight:1.6}}>
              This is the final removal step. The card will be removed from trash and cannot be restored.
            </p>
            <div style={{padding:12,border:`1px solid ${C.border}`,borderRadius:12,background:"rgba(255,255,255,0.8)",marginBottom:14}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                <span style={pill(C.roseSoft,C.rose)}>{pendingPermanentDelete.cardCode || "No ID"}</span>
                <span style={pill(C.accentSoft,C.accent)}>{srcIcon[pendingPermanentDelete.sourceType]||"📎"} {pendingPermanentDelete.sourceType || "Source"}</span>
              </div>
              <div style={{fontWeight:800,color:C.text}}>{pendingPermanentDelete.productName || pendingPermanentDelete.title || "Untitled"}</div>
              {pendingPermanentDelete.mergedIntoTitle && (
                <div style={{fontSize:12,color:C.muted,marginTop:6}}>Merged into {pendingPermanentDelete.mergedIntoCode || pendingPermanentDelete.mergedIntoId || "a primary card"}</div>
              )}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button onClick={()=>setPendingPermanentDelete(null)} style={{...btnP,background:"transparent",color:C.muted,border:`1px solid ${C.border}`}}>Cancel</button>
              <button onClick={async ()=>{ const target = pendingPermanentDelete; setPendingPermanentDelete(null); if (target) await removeEntryPermanent(target.id); }} style={{...btnP,background:C.rose,boxShadow:`0 6px 16px ${C.rose}33`}}>Delete permanently</button>
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
      <header className="glass-panel" style={{ padding:"18px 16px", border:`1px solid ${C.border}`, borderRadius:14, margin:"16px 0 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, boxShadow:"0 8px 24px rgba(15,23,42,0.07)" }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:C.teal, letterSpacing:"-0.5px" }}>
            ◆ BankAI Canvas
          </h1>
          <p style={{ margin:"3px 0 0", fontSize:12, color:C.dim }}>
            {user.displayName || user.email} · {activeEntries.length} active source{activeEntries.length!==1?"s":""}
          </p>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {[
            {key:"canvas",icon:"◉",label:"Canvas"},
            {key:"table",icon:"☰",label:"Table"},
            {key:"add",icon:"+",label:"Add"},
            {key:"trash",icon:"🗑",label:`Trash (${trashEntries.length})`},
          ].map(v=>(
            <button key={v.key} onClick={()=>{setEditing(null);setView(v.key);}} style={{
              padding:"7px 16px", borderRadius:7,
              border:`1px solid ${view===v.key?C.accent:C.border}`,
              background:view===v.key?C.accentSoft:"transparent",
              color:view===v.key?C.accent:C.muted,
              cursor:"pointer", fontWeight:700, fontSize:12, fontFamily:"inherit",
            }}>{v.icon} {v.label}</button>
          ))}
          <button onClick={()=>setExportOpen(true)} disabled={!activeEntries.length} style={{
            padding:"7px 16px", borderRadius:7, border:`1px solid ${C.teal}`,
            background:C.tealSoft, color:C.teal,
            cursor:activeEntries.length?"pointer":"not-allowed",
            fontWeight:700, fontSize:12, fontFamily:"inherit", opacity:activeEntries.length?1:.4,
          }}>↓ Export</button>
          <button onClick={backfillExistingStructure} disabled={backfillLoading || !activeEntries.length} style={{
            padding:"7px 14px", borderRadius:7, border:`1px solid ${C.violet}`,
            background:C.violetSoft, color:C.violet,
            cursor:(backfillLoading || !activeEntries.length)?"not-allowed":"pointer",
            fontWeight:700, fontSize:12, fontFamily:"inherit", opacity:(backfillLoading || !activeEntries.length)?0.5:1,
          }}>{backfillLoading || actionLoading["backfill"] ? "Backfilling..." : "Backfill Structure"}</button>
          <button onClick={()=>runAction({
            key: "dedupe-manual",
            run: async () => { await consolidateDuplicateCards("manual"); },
            successTitle: "Duplicate consolidation complete",
            successMessage: "Duplicate clustering pass has finished.",
            errorTitle: "Duplicate consolidation failed",
          })} disabled={dedupeLoading || activeEntries.length < 2 || !!actionLoading["dedupe-manual"]} style={{
            padding:"7px 14px", borderRadius:7, border:`1px solid ${C.accent}`,
            background:C.accentSoft, color:C.accent,
            cursor:(dedupeLoading || activeEntries.length < 2 || actionLoading["dedupe-manual"])?"not-allowed":"pointer",
            fontWeight:700, fontSize:12, fontFamily:"inherit", opacity:(dedupeLoading || activeEntries.length < 2 || actionLoading["dedupe-manual"])?0.5:1,
          }}>{dedupeLoading || actionLoading["dedupe-manual"] ? "Consolidating..." : "Consolidate Duplicates"}</button>
          <label style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:C.muted,padding:"0 6px"}}>
            <input type="checkbox" checked={autoConsolidate} onChange={e=>setAutoConsolidate(e.target.checked)} />
            Auto consolidate every 25 cards
          </label>
          <button onClick={()=>signOut(auth)} style={{
            padding:"7px 14px", borderRadius:7, border:`1px solid ${C.border}`,
            background:"transparent", color:C.dim,
            cursor:"pointer", fontWeight:600, fontSize:11, fontFamily:"inherit",
          }}>Sign out</button>
        </div>
      </header>

      {/* ══════════ SEARCH & FILTERS ══════════ */}
      {view!=="add" && view!=="trash" && (
        <div className="glass-panel" style={{ position:"sticky", top:8, zIndex:30, border:`1px solid ${C.border}`, borderRadius:12, padding:10, marginBottom:10, boxShadow:"0 6px 16px rgba(15,23,42,0.05)" }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 260px", position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:C.dim, fontSize:14 }}>⌕</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search titles, banks, tech, tags…"
              style={{...inputS, paddingLeft:34}}
              onFocus={e=>e.target.style.borderColor=C.borderLit} onBlur={e=>e.target.style.borderColor=C.border} />
          </div>
          {[
            {val:fCat,set:setFCat,opts:filterCategories,label:"Category"},
            {val:fBank,set:setFBank,opts:filterBanks,label:"Bank"},
            {val:fStatus,set:setFStatus,opts:filterStatuses,label:"Status"},
          ].map(f=>(
            <select key={f.label} value={f.val} onChange={e=>f.set(e.target.value)}
              style={{...selectS,width:"auto",color:f.val==="All"?C.dim:C.text}}>
              {f.opts.map(o=><option key={o} value={o}>{o==="All"?`All ${f.label}`:o}</option>)}
            </select>
          ))}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap", alignItems:"center" }}>
          <input
            value={semanticQuery}
            onChange={e=>setSemanticQuery(e.target.value)}
            placeholder="Semantic search: e.g. agentic AI compliance with measurable ROI"
            style={{...inputS, flex:"1 1 360px"}}
            onKeyDown={e=>{ if (e.key === "Enter") runSemantic(); }}
          />
          <button onClick={runSemantic} disabled={semanticLoading || !semanticQuery.trim()} style={{...btnP, opacity:(semanticLoading || !semanticQuery.trim())?0.6:1}}>
            {semanticLoading || actionLoading["semantic"] ? "Ranking..." : "Semantic Rank"}
          </button>
          {semanticIds.length > 0 && (
            <button onClick={clearSemantic} style={{...btnP, background:"transparent", color:C.muted, border:`1px solid ${C.border}`}}>
              Clear Semantic
            </button>
          )}
          {semanticInfo && <div style={{ fontSize:11, color:C.dim }}>{semanticInfo}</div>}
          </div>
        </div>
      )}

      {/* ══════════ STATS ══════════ */}
      {view!=="add" && view!=="trash" && activeEntries.length>0 && (
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:20 }}>
          {[
            {n:activeEntries.length,l:"Total Sources",c:C.accent},
            {n:activeEntries.filter(e=>e.status==="To Review").length,l:"To Review",c:C.amber},
            {n:activeEntries.filter(e=>e.status==="Key Finding").length,l:"Key Findings",c:C.violet},
            {n:[...new Set(activeEntries.map(e=>e.bank))].length,l:"Banks",c:C.teal},
          ].map(s=>(
            <div key={s.l} style={{ flex:"1 1 120px", padding:"14px 18px", background:C.panel, borderRadius:12, border:`1px solid ${C.border}`, boxShadow:"0 4px 14px rgba(15,23,42,0.05)" }}>
              <div style={{ fontSize:22, fontWeight:800, color:s.c, fontFamily:"'JetBrains Mono',monospace" }}>{s.n}</div>
              <div style={{ fontSize:10, color:C.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", marginTop:2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {view!=="add" && view!=="trash" && (
        <div style={{marginBottom:18,padding:"12px 14px",border:`1px solid ${C.border}`,borderRadius:12,background:"rgba(255,255,255,0.86)"}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",marginBottom:8}}>Confidence Guide</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12,color:C.text}}>
            <span style={pill("rgba(21,128,61,0.12)","#166534")}>High 80-100: strong explicit evidence</span>
            <span style={pill("rgba(217,119,6,0.12)","#92400E")}>Medium 50-79: partial or inferred evidence</span>
            <span style={pill("rgba(220,38,38,0.12)","#991B1B")}>Low 0-49: weak signals, review manually</span>
          </div>
        </div>
      )}

      {/* ══════════ VIEWS ══════════ */}
      {(entriesLoading || viewLoading) && (
        <div style={{
          marginBottom:14,
          padding:"12px 14px",
          border:`1px solid ${C.border}`,
          borderRadius:12,
          background:"rgba(255,255,255,0.92)",
          display:"inline-flex",
          alignItems:"center",
          gap:8,
          color:C.muted,
          fontSize:12,
          fontWeight:700,
        }}>
          <span style={{
            width:14,height:14,borderRadius:"50%",border:`2px solid ${C.accent}`,borderTopColor:"transparent",
            animation:"spin .8s linear infinite",
          }} />
          {entriesLoading ? "Syncing entries..." : "Loading view..."}
        </div>
      )}

      {view==="add" && <FormView />}

      {view==="trash" && (
        <div style={{display:"grid",gap:10}}>
          {trashEntries.length ? trashEntries.map((e, i) => (
            <div key={e.id} style={{padding:14,border:`1px solid ${C.border}`,borderRadius:14,background:"rgba(255,255,255,0.94)",display:"grid",gap:12,boxShadow:"0 6px 18px rgba(15,23,42,0.05)"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                    <span style={pill(C.roseSoft,C.rose)}>{e.cardCode || `Deleted-${i + 1}`}</span>
                    <span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType || "Source"}</span>
                    {e.mergedIntoCode && <span style={pill(C.tealSoft,C.teal)}>Merged into {e.mergedIntoCode}</span>}
                  </div>
                  <div style={{fontSize:14,fontWeight:800,color:C.text,lineHeight:1.35,overflowWrap:"anywhere"}}>{getProductHeadline(e)}</div>
                  {e.title && e.title !== e.productName && (
                    <div style={{fontSize:12,color:C.dim,marginTop:4,overflowWrap:"anywhere"}}>{e.title}</div>
                  )}
                  <div style={{fontSize:11,color:C.dim,marginTop:8}}>Deleted: {e.deletedAt || "unknown"}</div>
                  {e.mergedIntoTitle && (
                    <div style={{fontSize:11,color:C.muted,marginTop:6}}>
                      Consolidated into <strong>{e.mergedIntoCode || e.mergedIntoId || "a primary card"}</strong>
                      {e.mergedIntoTitle ? ` · ${e.mergedIntoTitle}` : ""}
                      {e.mergedReason ? ` · ${e.mergedReason}` : ""}
                    </div>
                  )}
                  {(e.sourceRefs||[]).length > 0 && (
                    <div style={{fontSize:11,color:C.muted,marginTop:6,overflowWrap:"anywhere"}}>
                      Sources: {(e.sourceRefs || []).slice(0, 4).map(ref => ref.title || ref.url || "Source").join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button disabled={!!actionLoading["restore-card"]} onClick={()=>restoreEntry(e.id)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.teal}`,background:C.tealSoft,color:C.teal,cursor:actionLoading["restore-card"]?"not-allowed":"pointer",fontWeight:700,fontSize:11,opacity:actionLoading["restore-card"]?0.6:1}}>{actionLoading["restore-card"] ? "Restoring..." : "Restore"}</button>
                <button disabled={!!actionLoading["delete-permanent"]} onClick={()=>setPendingPermanentDelete(e)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.rose}`,background:C.roseSoft,color:C.rose,cursor:actionLoading["delete-permanent"]?"not-allowed":"pointer",fontWeight:700,fontSize:11,opacity:actionLoading["delete-permanent"]?0.6:1}}>{actionLoading["delete-permanent"] ? "Deleting..." : "Delete Permanently"}</button>
              </div>
            </div>
          )) : (
            <div style={{textAlign:"center",padding:40,color:C.dim,border:`1px dashed ${C.border}`,borderRadius:12,background:"rgba(255,255,255,0.8)"}}>Trash is empty</div>
          )}
        </div>
      )}

      {/* TABLE */}
      {view==="table" && (
        <div style={{border:`1px solid ${C.border}`,borderRadius:12,background:"rgba(255,255,255,0.9)",padding:10}}>
          <div style={{fontSize:11,color:C.dim,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Spreadsheet View · Scroll both directions</div>
          <div className="surface-scroll" style={{ overflow:"auto", borderRadius:10, border:`1px solid ${C.border}`, maxHeight:"72vh", maxWidth:"100%" }}>
          <table style={{ minWidth:1760, width:"max-content", borderCollapse:"separate", borderSpacing:0, fontSize:12, fontFamily:"inherit" }}>
            <thead>
              <tr style={{ background:C.panel }}>
                {["#","Title","Type","Bank","Division","Area","Scale","Category","AI Tech","Use Case","Impact","Status","Date"].map(h=>(
                  <th key={h} style={{
                    position:"sticky", top:0, zIndex:h === "#" || h === "Title" ? 5 : 4,
                    left:h === "#" ? 0 : (h === "Title" ? 56 : undefined),
                    background:C.panel,
                    padding:"11px 12px", textAlign:"left", color:C.dim, fontWeight:700,
                    borderBottom:`1px solid ${C.border}`, borderRight:`1px solid ${C.border}`,
                    fontSize:10, textTransform:"uppercase", letterSpacing:".5px", whiteSpace:"nowrap"
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {semanticFiltered.map((e,i) => {
                const displayProduct = e.productName || e.title || "Untitled";
                const subtitleTitle = e.title && e.title !== displayProduct ? e.title : "";
                return (
                  <tr key={e.id} onClick={()=>{setEditing(e);setView("add");}}
                    style={{ borderBottom:`1px solid ${C.border}`, cursor:"pointer", transition:"background .15s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background=C.card}
                    onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                    <td style={{position:"sticky",left:0,zIndex:3,padding:"9px 12px",color:C.dim,background:C.panel,borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap",width:56,minWidth:56}}>{i+1}</td>
                    <td style={{position:"sticky",left:56,zIndex:3,padding:"9px 12px",color:C.text,maxWidth:280,minWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",background:C.panel,borderRight:`1px solid ${C.border}`}}>{displayProduct}</td>
                    <td style={{padding:"9px 12px",borderRight:`1px solid ${C.border}`}}><span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType}</span></td>
                    <td style={{padding:"9px 12px",color:C.text,borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap",minWidth:170}}>{e.bank}</td>
                    <td style={{padding:"9px 12px",color:C.text,whiteSpace:"nowrap",borderRight:`1px solid ${C.border}`,minWidth:140}}>{e.division||"Not specified"}</td>
                    <td style={{padding:"9px 12px",color:C.muted,whiteSpace:"nowrap",borderRight:`1px solid ${C.border}`,minWidth:150}}>{e.area||"Not specified"}</td>
                    <td style={{padding:"9px 12px",color:C.text,whiteSpace:"nowrap",borderRight:`1px solid ${C.border}`,minWidth:130}}>{e.scale||"Not specified"}</td>
                    <td style={{padding:"9px 12px",color:C.muted,borderRight:`1px solid ${C.border}`,minWidth:180}}>{e.category}</td>
                    <td style={{padding:"9px 12px",color:C.text,borderRight:`1px solid ${C.border}`,minWidth:180}}>{e.aiTech}</td>
                    <td style={{padding:"9px 12px",color:C.muted,maxWidth:260,minWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",borderRight:`1px solid ${C.border}`}}>{e.useCase}</td>
                    <td title={e.impact || ""} style={{padding:"9px 12px",color:C.text,borderRight:`1px solid ${C.border}`,minWidth:170,maxWidth:170,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.impact}</td>
                    <td style={{padding:"9px 12px",borderRight:`1px solid ${C.border}`,minWidth:140}}><span style={pill(`${statusC[e.status]}18`,statusC[e.status])}><span style={{width:5,height:5,borderRadius:"50%",background:statusC[e.status]}}/> {e.status}</span></td>
                    <td style={{padding:"9px 12px",color:C.dim,whiteSpace:"nowrap",minWidth:120}}>{e.dateAdded}</td>
                  </tr>
                );
              })}
              {!semanticFiltered.length && <tr><td colSpan={13} style={{padding:36,textAlign:"center",color:C.dim}}>No entries match</td></tr>}
            </tbody>
          </table>
          </div>
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
              background:isDragOver?C.tealSoft:"rgba(255,255,255,0.9)",
              textAlign:"center", cursor:"pointer", transition:"all .25s",
              boxShadow:"0 10px 28px rgba(15,23,42,0.06)",
            }}>
            <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt,.md,.doc,.docx"
              onChange={async e=>{for(const f of Array.from(e.target.files))await ingestFile(f);e.target.value="";}}
              style={{display:"none"}} />
            <div style={{fontSize:36,marginBottom:6,animation:"drift 3s ease-in-out infinite"}}>{isDragOver?"📥":"◆"}</div>
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
                const displayProduct = getProductHeadline(e);
                const rawProduct = e.productName || e.title || "Untitled";
                const subtitleTitle = e.title && e.title !== rawProduct ? e.title : "";
                return (
                  <div key={e.id} onClick={()=>setExpanded(isOpen?null:e.id)} style={{
                    background:C.card, borderRadius:12, padding:18,
                    border:`1px solid ${isOpen?C.borderLit:C.border}`,
                    cursor:"pointer", transition:"all .2s",
                    boxShadow:isOpen?`0 0 0 3px ${C.accentSoft}, 0 10px 28px rgba(15,23,42,0.12)`:"0 6px 18px rgba(15,23,42,0.08)",
                  }}>
                    <div style={{height:4,borderRadius:999,background:`linear-gradient(90deg, ${C.accent}, ${C.teal}, ${C.violet})`,marginBottom:14,opacity:0.9}} />
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                          <span style={pill(C.accentSoft,C.accent)}>{srcIcon[e.sourceType]||"📎"} {e.sourceType}</span>
                          <span style={pill(`${statusC[e.status]}18`,statusC[e.status])}>
                            <span style={{width:5,height:5,borderRadius:"50%",background:statusC[e.status]}}/> {e.status}
                          </span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
                          <div style={{fontSize:21,fontWeight:900,color:C.text,lineHeight:1.08,letterSpacing:"-0.6px",overflowWrap:"anywhere"}}>{displayProduct}</div>
                          <span style={{...pill(C.tealSoft,C.teal),padding:"4px 9px",fontSize:10,letterSpacing:".4px"}}>{e.cardCode || `${getBankPrefix(e.bank)}-?`}</span>
                        </div>
                        {subtitleTitle && (
                          <div style={{fontSize:12,color:C.dim,marginTop:4,overflowWrap:"anywhere"}}>{subtitleTitle}</div>
                        )}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                      <span style={pill(C.tealSoft,C.teal)}>{e.bank}</span>
                      <span style={pill(C.violetSoft,C.violet)}>{e.category}</span>
                      <span style={pill("rgba(14,116,144,0.10)","#0E7490")}>{e.division || "Not specified"}</span>
                      <span style={pill("rgba(100,116,139,0.10)","#334155")}>{e.area || "Not specified"}</span>
                      <span style={pill("rgba(22,163,74,0.10)","#15803D")}>{e.scale || "Not specified"}</span>
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
                          <div><span style={{color:C.dim}}>Division: </span><span style={{color:C.text}}>{e.division||"Not specified"}</span></div>
                          <div><span style={{color:C.dim}}>Area: </span><span style={{color:C.text}}>{e.area||"Not specified"}</span></div>
                          <div><span style={{color:C.dim}}>Scale: </span><span style={{color:C.text}}>{e.scale||"Not specified"}</span></div>
                          <div><span style={{color:C.dim}}>Tech Sophistication: </span><span style={{color:C.text}}>{e.techSophistication||"Not specified"}</span></div>
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
                          {(e.sourceRefs||[]).length > 0 && (
                            <div style={{gridColumn:"1/-1"}}>
                              <span style={{color:C.dim}}>Sources ({e.sourceRefs.length}):</span>
                              <ul style={{margin:"6px 0 0",paddingLeft:16,color:C.text}}>
                                {e.sourceRefs.slice(0, 8).map((ref, idx) => (
                                  <li key={`${ref.url || ref.title}-${idx}`} style={{marginBottom:2,fontSize:12,overflowWrap:"anywhere"}}>
                                    {ref.url ? (
                                      <a href={ref.url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{color:C.accent,textDecoration:"none"}}>{ref.url}</a>
                                    ) : (ref.title || `Source ${idx + 1}`)}
                                  </li>
                                ))}
                              </ul>
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
                          <button disabled={!!cardActionLoading[`${e.id}:cycle-status`]} onClick={ev=>{ev.stopPropagation();cycleStatus(e);}} style={{padding:"5px 12px",background:C.tealSoft,color:C.teal,border:"none",borderRadius:6,cursor:cardActionLoading[`${e.id}:cycle-status`] ? "not-allowed" : "pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",opacity:cardActionLoading[`${e.id}:cycle-status`] ? 0.6 : 1}}>{cardActionLoading[`${e.id}:cycle-status`] ? "Updating..." : "Cycle Status"}</button>
                          <button disabled={!!actionLoading["trash-card"]} onClick={ev=>{ev.stopPropagation();removeEntry(e.id);}} style={{padding:"5px 12px",background:C.roseSoft,color:C.rose,border:"none",borderRadius:6,cursor:actionLoading["trash-card"]?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",opacity:actionLoading["trash-card"]?0.6:1}}>{actionLoading["trash-card"] ? "Deleting..." : "Delete"}</button>
                        </div>
                      </div>
                    )}
                    <div style={{marginTop:8,fontSize:10,color:C.dim}}>{e.dateAdded}</div>
                  </div>
                );
              })}
            </div>
          ) : !activeEntries.length ? (
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
    </div>
  );
}
