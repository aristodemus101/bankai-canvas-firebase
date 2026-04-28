// functions/index.js — Firebase Cloud Function for Gemini AI summarization
// Deploy with: firebase deploy --only functions

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp();

const geminiKey = defineSecret("GEMINI_API_KEY");
const ALLOWED_EMAIL = "divyaanshmehta513@gmail.com";
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
];
const BUDGETS = {
  semanticMaxEntries: 120,
  semanticMaxOutputTokens: 300,
  singleMaxOutputTokens: 900,
  multiMaxOutputTokens: 1400,
  sourceMaxChars: 7500,
  urlExtractMaxChars: 8000,
  requestTimeoutMs: 20000,
};

function cleanJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callGeminiJson({ key, prompt, maxOutputTokens = 1200 }) {
  let data = null;
  let lastErrText = "";

  for (const model of MODEL_CANDIDATES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGETS.requestTimeoutMs);
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topK: 20,
        maxOutputTokens,
      },
    };

    if (model.startsWith("gemini-2.5")) {
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      data = await response.json();
      break;
    }

    lastErrText = await response.text();
    console.warn(`Gemini model ${model} failed:`, lastErrText);
  }

  if (!data) {
    throw new Error(`Gemini API error: ${lastErrText}`);
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanJson(raw);
}

function normalizeWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BankAI-Canvas/1.0; +https://news-canvas.web.app)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch URL (${response.status})`);
  }

  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const title = normalizeWhitespace(titleMatch ? titleMatch[1] : "");
  const description = normalizeWhitespace(descMatch ? descMatch[1] : "");
  const text = stripHtml(html).slice(0, BUDGETS.urlExtractMaxChars);

  return { title, description, text, fetchedAt: new Date().toISOString() };
}

exports.summarize = onRequest(
  { cors: true, secrets: [geminiKey], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify Firebase ID token
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = await getAuth().verifyIdToken(token);
      if (decoded.email !== ALLOWED_EMAIL) {
        return res.status(403).json({ error: "Forbidden" });
      }
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { action = "analyze", content = "", url = "", entries = [], query = "" } = req.body || {};

    const key = geminiKey.value();
    if (!key) {
      return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    }

    try {
      if (action === "semantic_search") {
        if (!query || !Array.isArray(entries)) {
          return res.status(400).json({ error: "Missing query or entries" });
        }

        const compactEntries = entries.slice(0, BUDGETS.semanticMaxEntries).map((e, idx) => ({
          id: e.id || `row_${idx + 1}`,
          title: e.title || "",
          summary: e.summary || "",
          useCase: e.useCase || "",
          bank: e.bank || "",
          category: e.category || "",
          tags: e.tags || [],
        }));

        const prompt = `You are an enterprise research retrieval assistant.
Given a query and a list of entries, return the top 15 most relevant entry IDs.

Return ONLY valid JSON:
{
  "ids": ["entry_id_1", "entry_id_2"],
  "explanation": "one short sentence"
}

Query: ${String(query).slice(0, 500)}
Entries JSON:
${JSON.stringify(compactEntries).slice(0, 150000)}`;

        const ranked = await callGeminiJson({ key, prompt, maxOutputTokens: BUDGETS.semanticMaxOutputTokens });
        return res.status(200).json({
          ids: Array.isArray(ranked.ids) ? ranked.ids : [],
          explanation: ranked.explanation || "",
        });
      }

      let sourceText = content;
      let extracted = null;

      if (url && /^https?:\/\//i.test(url)) {
        try {
          extracted = await extractFromUrl(url);
          sourceText = `${content || ""}\n\nURL: ${url}\nTitle: ${extracted.title}\nDescription: ${extracted.description}\nContent:\n${extracted.text}`;
        } catch (fetchErr) {
          console.warn("URL extraction failed:", fetchErr.message);
        }
      }

      if (!sourceText || typeof sourceText !== "string") {
        return res.status(400).json({ error: "Missing content" });
      }

      const isMulti = action === "analyze_multi";
      const instruction = isMulti
        ? `You are a banking & fintech research analyst. Extract distinct AI initiatives/use cases from the source.

Return ONLY a valid JSON object — no markdown, no backticks, no extra text.

{
  "initiatives": [
    {
      "title": "short descriptive title (max 80 chars)",
      "summary": "2-3 sentence summary",
      "bank_mentioned": "primary bank, or 'Other / Multiple'",
      "category": "best fit from: Customer Service & Chatbots, Fraud Detection & Risk, Credit Scoring & Underwriting, Process Automation (RPA), Wealth Management & Advisory, Regulatory & Compliance, Personalization & Marketing, Cybersecurity, Document Processing, Trading & Market Analysis, KYC / AML, Other",
      "ai_technology": "specific AI/ML tech (NLP, Computer Vision, LLM, GenAI, ML, Deep Learning, RPA, etc.)",
      "use_case": "one-line description of the AI use case",
      "impact": "quantified impact if mentioned, or 'Not specified'",
      "tags": ["3-7 concise tags"],
      "confidence": {
        "overall": "0-100 integer",
        "category": "0-100 integer",
        "bank": "0-100 integer"
      },
      "evidence": ["up to 3 short supporting quotes or facts from the source"]
    }
  ]
}

Rules:
- Each initiative should represent one distinct use case or program.
- Include initiatives from different banks separately when present.
- Return up to 12 initiatives, ordered by relevance and specificity.
- If only one initiative exists, return one item in initiatives.
`
        : `You are a banking & fintech research analyst. Analyze the following source material about AI use cases in banking.

Return ONLY a valid JSON object — no markdown, no backticks, no extra text. Fields:

{
  "title": "short descriptive title (max 80 chars)",
  "summary": "2-3 sentence summary",
  "bank_mentioned": "primary bank, or 'Other / Multiple'",
  "category": "best fit from: Customer Service & Chatbots, Fraud Detection & Risk, Credit Scoring & Underwriting, Process Automation (RPA), Wealth Management & Advisory, Regulatory & Compliance, Personalization & Marketing, Cybersecurity, Document Processing, Trading & Market Analysis, KYC / AML, Other",
  "ai_technology": "specific AI/ML tech (NLP, Computer Vision, LLM, GenAI, ML, Deep Learning, RPA, etc.)",
  "use_case": "one-line description of the AI use case",
  "impact": "quantified impact if mentioned, or 'Not specified'",
  "tags": ["3-7 concise tags"],
  "confidence": {
    "overall": "0-100 integer",
    "category": "0-100 integer",
    "bank": "0-100 integer"
  },
  "evidence": ["up to 3 short supporting quotes or facts from the source"]
}

`;
      const prompt = `${instruction}\nContent:\n${sourceText.slice(0, BUDGETS.sourceMaxChars)}`;

      const parsed = await callGeminiJson({
        key,
        prompt,
        maxOutputTokens: isMulti ? BUDGETS.multiMaxOutputTokens : BUDGETS.singleMaxOutputTokens,
      });
      return res.status(200).json({
        ...parsed,
        extracted: extracted || null,
      });
    } catch (err) {
      console.error("Summarize error:", err);
      return res.status(200).json({
        title: "Untitled Source",
        summary: "AI summary unavailable — edit manually.",
        bank_mentioned: "Other / Multiple",
        category: "Other",
        ai_technology: "Unknown",
        use_case: "",
        impact: "Not specified",
        tags: [],
        confidence: { overall: 35, category: 35, bank: 35 },
        evidence: [],
        extracted: null,
      });
    }
  }
);
