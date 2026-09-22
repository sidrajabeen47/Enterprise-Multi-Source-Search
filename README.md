# ⚡ Enterprise Multi-Source Search (RAG Engine)

A fast, privacy-focused semantic search engine that ingests **PDFs** and **live websites** simultaneously without using any paid cloud APIs.

---

## 💡 Why It Stands Out
- **Zero API Costs:** Runs completely free and local using open-source models.
- **Privacy-First:** Your documents and search queries never leave your local machine.
- **Multi-Source:** Searches across PDFs (including presentations and resumes) and live scraped websites in one unified query.
- **Smart Chunking:** Splits text by semantic meaning rather than arbitrary word counts.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | FastAPI (Python) | High-speed asynchronous REST API |
| **Embeddings** | SentenceTransformers (`all-MiniLM-L6-v2`) | Local 384-d vector embeddings |
| **Vector DB** | ChromaDB | On-disk vector indexing & fast cosine search |
| **Text Extractors** | PyPDF & BeautifulSoup4 | Extracts text from PDFs and cleans web HTML |
| **Frontend** | React (Vite) + Tailwind CSS | Responsive, modern dashboard |

---

## 🔄 How It Works

```text
[ PDFs / URLs ] ──> Clean Text ──> Semantic Chunks ──> Local Vector Store (ChromaDB)
                                                                │
[ User Query ]  ────────────> Vector Match (Cosine) ────────────┘
                                     │
                                     ▼
                    Grounded Answer + Source Cards


Ingest: Extracts text from PDFs or URLs while stripping out web junk, ads, and references.

Chunk: Breaks text into logically coherent segments using sentence similarity.

Index: Converts chunks into vectors and stores them on disk in ChromaDB.

Search: Compares user queries against stored vectors and returns exact source chunks with similarity scores.

1. Backend
Bash
cd backend
python -m venv venv
venv\Scripts\activate      # Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

2. Frontend
Bash
cd frontend
npm install
npm run dev
Open http://localhost:5173 in your browser.
