import React, { useState, useEffect } from "react";
import { 
  Upload, 
  Search, 
  FileText, 
  Database, 
  ShieldAlert, 
  CheckCircle2, 
  ArrowRight, 
  Globe, 
  Link as LinkIcon,
  Trash2,
  Files
} from "lucide-react";

export default function App() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [totalChunks, setTotalChunks] = useState(0);

  const [urlInput, setUrlInput] = useState("");
  const [indexingUrl, setIndexingUrl] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [error, setError] = useState("");

  const BACKEND_URL = "http://localhost:8000";

  const fetchStats = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/stats`);
      const data = await res.json();
      setTotalChunks(data.total_chunks || 0);
    } catch {
      // Backend not running
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm("Are you sure you want to delete all stored documents and chunks?")) {
      return;
    }

    setClearing(true);
    setError("");
    setUploadMessage("");
    setSearchResult(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/clear`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to clear database");

      setUploadMessage(data.status || "Database cleared successfully!");
      fetchStats();
    } catch (err) {
      setError(err.message || "Failed to clear database.");
    } finally {
      setClearing(false);
    }
  };

  const handleMultipleUpload = async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadMessage("");
    setError("");

    const formData = new FormData();
    selectedFiles.forEach((file) => {
      formData.append("files", file);
    });

    try {
      const res = await fetch(`${BACKEND_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        let msg = "Upload failed.";
        if (typeof data.detail === "string") {
          msg = data.detail;
        } else if (Array.isArray(data.detail)) {
          msg = data.detail.map(d => d.msg || JSON.stringify(d)).join(", ");
        } else if (typeof data.detail === "object") {
          msg = JSON.stringify(data.detail);
        }
        throw new Error(msg);
      }

      const successCount = data.successful_files.length;
      setUploadMessage(`Indexed ${successCount} PDF(s) successfully (${data.total_chunks_added} chunks added).`);
      setSelectedFiles([]);
      fetchStats();
    } catch (err) {
      setError(err.message || "Failed to process PDF.");
    } finally {
      setUploading(false);
    }
  };

  const handleUrlIngest = async (e) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setIndexingUrl(true);
    setUploadMessage("");
    setError("");

    try {
      const res = await fetch(`${BACKEND_URL}/api/scrape-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        let msg = "Website scraping failed.";
        if (typeof data.detail === "string") msg = data.detail;
        throw new Error(msg);
      }

      setUploadMessage(`Indexed Website: ${data.source} (${data.total_chunks} chunks added).`);
      setUrlInput("");
      fetchStats();
    } catch (err) {
      setError(err.message || "Failed to index website.");
    } finally {
      setIndexingUrl(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setSearchResult(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: 4 }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        let msg = "Search failed.";
        if (typeof data.detail === "string") {
          msg = data.detail;
        } else if (Array.isArray(data.detail)) {
          msg = data.detail.map(d => d.msg || JSON.stringify(d)).join(", ");
        } else if (typeof data.detail === "object") {
          msg = JSON.stringify(data.detail);
        }
        throw new Error(msg);
      }

      setSearchResult(data);
    } catch (err) {
      setError(err.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center space-x-2">
          <Database className="w-6 h-6 text-indigo-600" />
          <h1 className="text-xl font-bold tracking-tight text-slate-800">Enterprise Multi-Source Search</h1>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-slate-100 text-slate-600 text-sm px-3 py-1.5 rounded-full border border-slate-200">
            <span>Active Indexed Chunks:</span>
            <span className="font-semibold text-slate-900">{totalChunks}</span>
          </div>

          <button
            onClick={handleClearDatabase}
            disabled={clearing || totalChunks === 0}
            className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-sm px-3 py-1.5 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            <span>{clearing ? "Clearing..." : "Clear Data"}</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column: Upload */}
        <section className="md:col-span-4 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 flex items-center space-x-2 mb-2">
                <Upload className="w-5 h-5 text-indigo-600" />
                <span>Knowledge Ingestion</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Upload PDF documents or provide a website URL. Text is extracted, semantically chunked, and indexed into ChromaDB.
              </p>
            </div>

            {/* PDF Upload */}
            <form onSubmit={handleMultipleUpload} className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center space-x-1">
                <Files className="w-3.5 h-3.5 text-indigo-600" />
                <span>1. Upload PDF Document</span>
              </label>
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border border-slate-200 rounded-lg"
              />

              {selectedFiles.length > 0 && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1 max-h-28 overflow-y-auto">
                  <span className="font-semibold text-slate-600">Selected ({selectedFiles.length}):</span>
                  <ul className="list-disc list-inside text-slate-500 truncate">
                    {selectedFiles.map((f, idx) => (
                      <li key={idx} className="truncate">{f.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="submit"
                disabled={selectedFiles.length === 0 || uploading}
                className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium rounded-lg shadow-sm transition text-xs flex items-center justify-center space-x-2"
              >
                {uploading 
                  ? `Processing ${selectedFiles.length} file(s)...` 
                  : `Process PDF`}
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-2 text-slate-400 text-xs uppercase font-bold">OR</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* URL Ingestion */}
            <form onSubmit={handleUrlIngest} className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center space-x-1">
                <Globe className="w-3.5 h-3.5 text-indigo-600" />
                <span>2. Ingest Website URL</span>
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="url"
                  placeholder="https://en.wikipedia.org/wiki/..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={!urlInput.trim() || indexingUrl}
                className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white font-medium rounded-lg shadow-sm transition text-xs flex items-center justify-center space-x-2"
              >
                {indexingUrl ? "Scraping & Indexing Web..." : "Index Website"}
              </button>
            </form>

            {uploadMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start space-x-2 text-emerald-800 text-xs">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{uploadMessage}</span>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Search */}
        <section className="md:col-span-8 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <form onSubmit={handleSearch} className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Ask any precise question from indexed PDFs or Websites..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium rounded-lg text-sm transition flex items-center space-x-1.5"
              >
                <span>{loading ? "Searching..." : "Search"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {error && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start space-x-2 text-rose-800 text-sm">
                <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {searchResult && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm bg-gradient-to-b from-indigo-50/20 to-white">
                <div className="flex items-center space-x-2 text-indigo-700 font-semibold mb-2 text-sm">
                  <span>Grounded Answer:</span>
                </div>
                <div className="text-slate-800 text-sm leading-relaxed whitespace-pre-line">
                  {searchResult.answer}
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-4">
                  Qualified Matches ({searchResult.sources.length} sources)
                </h3>
                {searchResult.sources.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No sources met the similarity confidence threshold.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {searchResult.sources.map((src) => (
                      <div key={src.document_id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
                        <div className="flex justify-between items-center text-slate-500 font-medium">
                          <span className="flex items-center space-x-1 text-indigo-600 font-semibold truncate max-w-md">
                            {src.source_type === "web" ? (
                              <Globe className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-indigo-600" />
                            )}
                            <span className="truncate">{src.source_name}</span>
                          </span>
                          <span className="bg-white px-2.5 py-1 rounded-md border border-slate-200 font-bold text-slate-700">
                            Relevance: {src.relevance_score}%
                          </span>
                        </div>
                        <p className="text-slate-700 italic border-l-2 border-indigo-400 pl-3 leading-relaxed">
                          "{src.content}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}