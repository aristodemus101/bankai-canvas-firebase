# ◆ BankAI Research Canvas

**Firebase + Gemini Edition** — A research tool for collecting, categorizing, and exporting AI use cases in banking. Persistent database, Google auth, real-time sync across devices.

## What You Get

- **Drop anything** — URLs, files, pasted text onto the canvas
- **Gemini AI** — auto-extracts bank name, AI category, technology, use case, summary, impact
- **Firestore DB** — all entries persist and sync in real-time across devices
- **Google Auth** — sign in with Google, each user's data is private
- **Search & filter** — find entries by bank, category, status, or free text
- **CSV export** — one-click download of structured research data
- **Three views** — Canvas (cards), Table, Manual Add form

---

## 🚀 Complete Setup Guide

### Step 1: Create a Firebase Project (2 min)

1. Go to **https://console.firebase.google.com**
2. Click **"Create a project"** (or "Add project")
3. Name it something like `bankai-canvas`
4. Disable Google Analytics (not needed) → **Create Project**

### Step 2: Enable Authentication (1 min)

1. In Firebase Console, go to **Build → Authentication**
2. Click **"Get started"**
3. Click **Google** in the sign-in providers list
4. Toggle **Enable** → set a support email → **Save**

### Step 3: Create Firestore Database (1 min)

1. Go to **Build → Firestore Database**
2. Click **"Create database"**
3. Choose **Start in test mode** (we'll deploy proper rules later)
4. Pick a region close to you (e.g., `asia-south1` for Mumbai) → **Create**

### Step 4: Register a Web App & Get Config (1 min)

1. Go to **Project Settings** (gear icon, top left)
2. Scroll down → **"Add app"** → click the **Web** icon (`</>`)
3. Name it `bankai-canvas` → **Register app**
4. You'll see a `firebaseConfig` object — copy these values
5. Create a `.env.local` file in your project root:

```bash
cp .env.example .env.local
```

Fill in the values:
```
VITE_FB_API_KEY=AIzaSy...
VITE_FB_AUTH_DOMAIN=bankai-canvas.firebaseapp.com
VITE_FB_PROJECT_ID=bankai-canvas
VITE_FB_STORAGE_BUCKET=bankai-canvas.appspot.com
VITE_FB_MESSAGING_ID=123456789
VITE_FB_APP_ID=1:123456789:web:abc123
```

### Step 5: Get Gemini API Key & Set as Firebase Secret (2 min)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in → **"Create API Key"** → copy it
3. Install Firebase CLI if you haven't:
```bash
npm install -g firebase-tools
firebase login
```
4. Set the Gemini key as a secret:
```bash
firebase functions:secrets:set GEMINI_API_KEY
```
Paste your key when prompted.

### Step 6: Deploy Cloud Functions (3 min)

```bash
# From your project root
cd functions
npm install
cd ..

# Deploy just the function first
firebase deploy --only functions
```

After deploy, you'll see a URL like:
```
https://us-central1-bankai-canvas.cloudfunctions.net/summarize
```

Add this to your `.env.local`:
```
VITE_SUMMARIZE_URL=https://us-central1-bankai-canvas.cloudfunctions.net/summarize
```

### Step 7: Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### Step 8: Build & Deploy Hosting

```bash
npm install
npm run build
firebase deploy --only hosting
```

Your app is live at `https://bankai-canvas.web.app` 🎉

---

## 🖥️ Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. Make sure your `.env.local` has the Firebase config and the Cloud Function URL.

---

## 📊 Data Schema (Firestore)

Collection: `research_entries`

| Field | Type | Description |
|-------|------|-------------|
| uid | string | Firebase Auth user ID (auto-set) |
| title | string | Source title |
| sourceType | string | URL, PDF, Image, Excel/CSV, Text, etc. |
| url | string | Source URL if applicable |
| bank | string | Bank name from preset list |
| category | string | AI use case category (12 options) |
| aiTech | string | AI/ML technology type |
| useCase | string | One-line use case description |
| summary | string | 2-3 sentence AI summary |
| impact | string | Quantified impact / ROI |
| status | string | To Review / Reviewed / Key Finding / Archived |
| tags | array | Custom string tags |
| dateAdded | string | ISO date when added |
| notes | string | Free-form notes |
| createdAt | timestamp | Firestore server timestamp |

---

## 📁 Project Structure

```
├── src/
│   ├── App.jsx              # Main React app (auth, Firestore, UI)
│   ├── firebase.js          # Firebase initialization
│   └── main.jsx             # Entry point
├── functions/
│   ├── index.js             # Cloud Function (Gemini proxy)
│   └── package.json
├── index.html
├── package.json
├── vite.config.js
├── firebase.json            # Hosting + functions config
├── firestore.rules          # Security rules (user-scoped access)
├── firestore.indexes.json   # Composite index for queries
├── .env.example             # Environment template
└── README.md
```

---

## 💰 Firebase Free Tier Limits (Spark Plan)

| Service | Free Limit | Your Usage |
|---------|-----------|------------|
| Firestore reads | 50,000/day | ~50 per session |
| Firestore writes | 20,000/day | ~5-20 per session |
| Firestore storage | 1 GB | Tiny (text only) |
| Auth | Unlimited | ✓ |
| Hosting | 10 GB/month | ~1 MB site |
| Cloud Functions | 2M invocations/month | ~20-50/day |

You'll be well within free limits for personal research use.

---

## Gemini Free Tier Limits

| Model | Free Limit |
|-------|-----------|
| Gemini 2.0 Flash | 15 req/min, 1M tokens/day |

Also plenty for research workflows.

---

## Optional Enhancements

- **PDF text extraction**: Add `pdf-parse` to the Cloud Function to extract text from uploaded PDFs
- **Image OCR**: Use Google Cloud Vision API (also has a free tier) for image text extraction
- **Collaboration**: Remove the `uid` filter to make entries shared across a team
- **Vercel alternative**: The frontend works on Vercel too — just move `functions/index.js` to `api/summarize.js` and use Vercel serverless instead
