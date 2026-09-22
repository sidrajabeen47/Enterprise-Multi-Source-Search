import os
import shutil
import uuid
import re
import gc
from typing import List, Optional
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
import chromadb
from sentence_transformers import SentenceTransformer, util

# ----------------------------------------------------
# CONFIG & INITIALIZATION
# ----------------------------------------------------
app = FastAPI(title="Enterprise Multi-Source Search")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "./uploads"
CHROMA_DIR = "./chroma_db"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CHROMA_DIR, exist_ok=True)

# Free local model for embeddings (384 dimensions)
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

# Persistent ChromaDB Client
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

def get_collection():
    """Returns the collection, creating it on demand only when data is stored."""
    return chroma_client.get_or_create_collection(
        name="enterprise_knowledge",
        metadata={"hnsw:space": "cosine"}
    )

# ----------------------------------------------------
# 1. TEXT EXTRACTORS (CLEAN & JUNK-FREE)
# ----------------------------------------------------
def extract_text_from_pdf(file_path: str) -> str:
    reader = PdfReader(file_path)
    full_text = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text.append(text)
    return "\n".join(full_text)

def extract_text_from_url(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    resp = requests.get(url, headers=headers, timeout=20)
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Website unreachable (Status: {resp.status_code})")

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove non-content elements and references
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "aside", "table", "sup", "ol", "ul"]):
        tag.extract()

    # Wikipedia citations & reference lists filter
    for ref_box in soup.find_all(class_=["reflist", "reference", "mw-references-wrap", "navbox", "sidebar"]):
        ref_box.extract()

    # Retain meaningful paragraphs (> 80 characters)
    paragraphs = [p.get_text().strip() for p in soup.find_all("p") if len(p.get_text().strip()) > 80]
    
    clean_text = "\n\n".join(paragraphs)
    if not clean_text.strip():
        clean_text = soup.get_text(separator=" ", strip=True)
        
    return clean_text

# ----------------------------------------------------
# 2. SEMANTIC CHUNKING
# ----------------------------------------------------
def semantic_chunk_text(
    text: str, 
    similarity_threshold: float = 0.60, 
    max_chunk_size: int = 700
) -> List[str]:
    raw_sentences = re.split(r'(?<=[.?!])\s+|\n+', text)
    sentences = [s.strip() for s in raw_sentences if len(s.strip()) > 20]

    if not sentences:
        return []
    if len(sentences) == 1:
        return [sentences[0]] if len(sentences[0]) > 60 else []

    sentence_embeddings = embed_model.encode(sentences, convert_to_tensor=True)

    chunks = []
    current_chunk = [sentences[0]]

    for i in range(len(sentences) - 1):
        sim = util.cos_sim(sentence_embeddings[i], sentence_embeddings[i+1]).item()
        current_chunk_length = sum(len(s) for s in current_chunk)

        if sim < similarity_threshold or current_chunk_length > max_chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = [sentences[i+1]]
        else:
            current_chunk.append(sentences[i+1])

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    # Lenient length filter for resume bullet points
    final_chunks = [c for c in chunks if len(c.strip()) > 60]
    return final_chunks

# ----------------------------------------------------
# 3. GROUNDED ANSWER GENERATION
# ----------------------------------------------------
def generate_grounded_answer(query: str, context_blocks: List[str]) -> str:
    if not context_blocks:
        return "No relevant information found in the indexed documents or website for this query."

    context = "\n\n".join(context_blocks)
    
    # Try local Ollama if running
    try:
        res = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "phi3:mini",
                "prompt": f"Context:\n{context}\n\nQuestion: {query}\n\nAnswer strictly in clear English using only the context provided above:",
                "stream": False,
                "options": {"temperature": 0.1}
            },
            timeout=20
        )
        if res.status_code == 200:
            return res.json().get("response", "").strip()
    except Exception:
        pass

    # Direct top paragraph extraction fallback
    return context_blocks[0]

# ----------------------------------------------------
# SCHEMAS
# ----------------------------------------------------
class URLRequest(BaseModel):
    url: str

class QueryRequest(BaseModel):
    query: str
    top_k: int = 4

class SourceDoc(BaseModel):
    document_id: str
    source_type: str
    source_name: str
    content: str
    relevance_score: float

class QueryResponse(BaseModel):
    answer: str
    sources: List[SourceDoc]

# ----------------------------------------------------
# API ENDPOINTS
# ----------------------------------------------------
@app.post("/api/upload")
async def upload_pdf_documents(
    files: Optional[List[UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None)
):
    """Handles both single file ('file') and multiple files ('files') payloads."""
    uploaded_files: List[UploadFile] = []
    if files:
        uploaded_files.extend(files)
    if file:
        uploaded_files.append(file)

    if not uploaded_files:
        raise HTTPException(status_code=400, detail="No files uploaded. Please choose a PDF file.")

    all_chunks = []
    all_embeddings = []
    all_ids = []
    all_metas = []
    successful_files = []
    failed_files = []

    for f in uploaded_files:
        if not f.filename.lower().endswith(".pdf"):
            failed_files.append({"filename": f.filename, "reason": "Not a PDF document."})
            continue

        file_id = str(uuid.uuid4())[:8]
        save_path = os.path.join(UPLOAD_DIR, f"{file_id}_{f.filename}")

        try:
            with open(save_path, "wb") as buffer:
                shutil.copyfileobj(f.file, buffer)

            raw_text = extract_text_from_pdf(save_path)
            if not raw_text.strip():
                failed_files.append({"filename": f.filename, "reason": "No readable digital text found (might be scanned images)."})
                continue

            chunks = semantic_chunk_text(raw_text)
            if not chunks:
                raw_sentences = [s.strip() for s in re.split(r'\n+', raw_text) if len(s.strip()) > 30]
                chunks = raw_sentences[:50]

            if not chunks:
                failed_files.append({"filename": f.filename, "reason": "Text content is too short to generate chunks."})
                continue

            chunk_embeddings = embed_model.encode(chunks).tolist()

            for i, chunk in enumerate(chunks):
                doc_id = f"pdf_{file_id}_{i}"
                all_ids.append(doc_id)
                all_chunks.append(chunk)
                all_embeddings.append(chunk_embeddings[i])
                all_metas.append({"source_type": "pdf", "source_name": f.filename})

            successful_files.append({"filename": f.filename, "chunks_added": len(chunks)})
        except Exception as e:
            failed_files.append({"filename": f.filename, "reason": str(e)})

    if all_ids:
        coll = get_collection()
        coll.add(
            ids=all_ids,
            embeddings=all_embeddings,
            documents=all_chunks,
            metadatas=all_metas
        )

    if not successful_files and failed_files:
        raise HTTPException(status_code=400, detail=failed_files[0]["reason"])

    return {
        "status": "success",
        "total_files": len(uploaded_files),
        "successful_files": successful_files,
        "failed_files": failed_files,
        "total_chunks_added": len(all_ids)
    }

@app.post("/api/scrape-url")
async def scrape_url(req: URLRequest):
    """Indexes a single website URL into ChromaDB."""
    try:
        raw_text = extract_text_from_url(req.url)
        if len(raw_text.strip()) < 100:
            raise HTTPException(status_code=400, detail="Unable to extract substantial content from this URL.")

        chunks = semantic_chunk_text(raw_text)
        if not chunks:
            raise HTTPException(status_code=400, detail="No qualifying paragraphs met chunk size threshold.")

        embeddings = embed_model.encode(chunks).tolist()
        url_id = str(uuid.uuid4())[:8]
        doc_ids = [f"web_{url_id}_{i}" for i in range(len(chunks))]
        metadatas = [{"source_type": "web", "source_name": req.url} for _ in chunks]

        coll = get_collection()
        coll.add(
            ids=doc_ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas
        )

        return {"status": "success", "source": req.url, "total_chunks": len(chunks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/search", response_model=QueryResponse)
async def search_knowledge(req: QueryRequest):
    """Performs semantic search and answers the query based on context."""
    existing_collections = [c.name for c in chroma_client.list_collections()]
    if "enterprise_knowledge" not in existing_collections:
        raise HTTPException(status_code=400, detail="Database is empty. Please upload PDFs or index a URL first.")

    coll = get_collection()
    total_docs = coll.count()
    if total_docs == 0:
        raise HTTPException(status_code=400, detail="Database is empty. Please upload PDFs or index a URL first.")

    query_vector = embed_model.encode([req.query]).tolist()
    results = coll.query(
        query_embeddings=query_vector,
        n_results=min(req.top_k, total_docs),
        include=["documents", "metadatas", "distances"]
    )

    retrieved_docs = results["documents"][0]
    retrieved_meta = results["metadatas"][0]
    distances = results["distances"][0]

    sources = []
    qualified_contexts = []

    # Relevance threshold 20.0% so short chunks/bullet points are captured
    for i in range(len(retrieved_docs)):
        dist = float(distances[i])
        relevance = round(max(0.0, 1.0 - dist) * 100, 1)

        if relevance >= 20.0:
            sources.append(SourceDoc(
                document_id=results["ids"][0][i],
                source_type=retrieved_meta[i].get("source_type", "unknown"),
                source_name=retrieved_meta[i].get("source_name", "Unknown"),
                content=retrieved_docs[i],
                relevance_score=relevance
            ))
            qualified_contexts.append(retrieved_docs[i])

    # Fallback: Agar sabhi score 20% se niche ho, tab bhi best available chunk return hoga
    if not sources and retrieved_docs:
        dist = float(distances[0])
        relevance = round(max(0.0, 1.0 - dist) * 100, 1)
        sources.append(SourceDoc(
            document_id=results["ids"][0][0],
            source_type=retrieved_meta[0].get("source_type", "unknown"),
            source_name=retrieved_meta[0].get("source_name", "Unknown"),
            content=retrieved_docs[0],
            relevance_score=relevance
        ))
        qualified_contexts.append(retrieved_docs[0])

    answer = generate_grounded_answer(req.query, qualified_contexts)
    return QueryResponse(answer=answer, sources=sources)

@app.get("/api/stats")
async def get_stats():
    """Returns the total number of chunks currently stored in ChromaDB."""
    existing_collections = [c.name for c in chroma_client.list_collections()]
    if "enterprise_knowledge" not in existing_collections:
        return {"total_chunks": 0}
    return {"total_chunks": get_collection().count()}

@app.delete("/api/clear")
async def clear_database():
    """Physically deletes all collection files, HNSW bin subfolders, and uploaded files."""
    global chroma_client
    
    try:
        chroma_client.delete_collection("enterprise_knowledge")
    except Exception:
        pass

    chroma_client = None
    gc.collect()

    if os.path.exists(CHROMA_DIR):
        for item in os.listdir(CHROMA_DIR):
            item_path = os.path.join(CHROMA_DIR, item)
            try:
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
                elif os.path.isfile(item_path):
                    os.remove(item_path)
            except Exception:
                pass

    if os.path.exists(UPLOAD_DIR):
        for item in os.listdir(UPLOAD_DIR):
            item_path = os.path.join(UPLOAD_DIR, item)
            try:
                if os.path.isfile(item_path):
                    os.remove(item_path)
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
            except Exception:
                pass

    chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

    return {"status": "Database and physical files cleared completely."}