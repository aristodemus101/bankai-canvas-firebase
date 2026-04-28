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

    const { content } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Missing content" });
    }

    const key = geminiKey.value();
    if (!key) {
      return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    }

    const prompt = `You are a banking & fintech research analyst. Analyze the following source material about AI use cases in banking.

Return ONLY a valid JSON object — no markdown, no backticks, no extra text. Fields:

{
  "title": "short descriptive title (max 80 chars)",
  "summary": "2-3 sentence summary",
  "bank_mentioned": "primary bank, or 'Other / Multiple'",
  "category": "best fit from: Customer Service & Chatbots, Fraud Detection & Risk, Credit Scoring & Underwriting, Process Automation (RPA), Wealth Management & Advisory, Regulatory & Compliance, Personalization & Marketing, Cybersecurity, Document Processing, Trading & Market Analysis, KYC / AML, Other",
  "ai_technology": "specific AI/ML tech (NLP, Computer Vision, LLM, GenAI, ML, Deep Learning, RPA, etc.)",
  "use_case": "one-line description of the AI use case",
  "impact": "quantified impact if mentioned, or 'Not specified'"
}

Content:
${content.slice(0, 4000)}`;

    try {
      let data = null;
      let lastErrText = "";

      for (const model of MODEL_CANDIDATES) {
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        };

        // 2.5 models may spend many tokens on thinking unless explicitly disabled.
        if (model.startsWith("gemini-2.5")) {
          body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (response.ok) {
          data = await response.json();
          break;
        }

        lastErrText = await response.text();
        console.warn(`Gemini model ${model} failed:`, lastErrText);
      }

      if (!data) {
        console.error("Gemini error: no model succeeded.", lastErrText);
        return res.status(502).json({ error: "Gemini API error" });
      }

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return res.status(200).json(parsed);
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
      });
    }
  }
);
