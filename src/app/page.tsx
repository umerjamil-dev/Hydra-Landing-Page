"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";

interface FileInfo {
  fileName: string;
  sheetNames: string[];
  headers: string[];
  rowCount: number;
}

export default function Home() {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [input, setInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { fileName: fileInfo?.fileName },
      }),
    [fileInfo?.fileName]
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });

  // Load initial messages from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("chat-messages");
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved messages", e);
      }
    }
  }, [setMessages]);

  // Sync state to localStorage whenever messages change
  useEffect(() => {
    if (typeof window !== "undefined" && messages.length > 0) {
      localStorage.setItem("chat-messages", JSON.stringify(messages));
    }
  }, [messages]);

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (isChatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isChatOpen]);

  async function handleFileUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFileInfo({
        fileName: data.fileName,
        headers: data.headers,
        rowCount: data.rowCount,
        sheetNames: data.sheetNames
      });
      setPreviewData(data.preview || []);
      setIsChatOpen(true); // Open chat automatically on first upload
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleDownload() {
    if (!fileInfo) return;
    window.open(`/api/download?file=${encodeURIComponent(fileInfo.fileName)}`, "_blank");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || !fileInfo || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Background Gradients */}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.05)_0%,transparent_50%)]" />
      
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800/50 backdrop-blur-md bg-zinc-950/50 px-8 py-4 sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20 font-bold text-white text-xl">
            H
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Hydra Excel AI</h1>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Active Management Ready</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {fileInfo && (
            <div className="hidden md:flex flex-col items-end px-4 py-1 border-r border-zinc-800 mr-2">
              <span className="text-xs text-zinc-400 font-medium">{fileInfo.fileName}</span>
              <span className="text-[10px] text-emerald-500/80">{fileInfo.rowCount} records loaded</span>
            </div>
          )}
          <button
            onClick={() => {
              if (confirm("Clear chat history?")) {
                setMessages([]);
                localStorage.removeItem("chat-messages");
              }
            }}
            className="hidden sm:block rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Clear Chat
          </button>
          {fileInfo && (
            <>
              <button
                onClick={() => setFileInfo(null)}
                className="hidden sm:block rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                Upload New
              </button>
              <button
                onClick={handleDownload}
                className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 backdrop-blur px-5 py-2.5 text-xs font-bold text-zinc-200 transition hover:bg-zinc-700/50 hover:border-zinc-600 shadow-xl"
              >
                Download Excel
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Main Content Area - Excel Preview */}
        <main className="flex-1 overflow-auto p-8 custom-scrollbar">
          {!fileInfo ? (
            <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center">
              <div className="mb-8 p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/50 backdrop-blur-xl shadow-2xl">
                <div className="mb-6 mx-auto h-20 w-20 flex items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600/20 to-teal-600/20 text-emerald-500 border border-emerald-500/20">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Upload Your Data</h2>
                <p className="text-zinc-400 text-lg mb-8 px-4">Ready to unlock insights? Upload your .xlsx, .xls, or .csv file to start managing it with AI.</p>
                
                <form onSubmit={handleFileUpload} className="space-y-4">
                  <div className="relative group">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      id="file-upload"
                      onChange={() => {
                        const file = fileInputRef.current?.files?.[0];
                        if (file) {
                          // Trigger auto upload or just show name
                        }
                      }}
                    />
                    <label 
                      htmlFor="file-upload"
                      className="block w-full cursor-pointer rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-800/30 p-8 transition hover:border-emerald-500/50 hover:bg-zinc-800/50 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                    >
                      <span className="text-zinc-300 font-medium">Click to browse or drag and drop</span>
                      <p className="text-xs text-zinc-500 mt-2">Maximum file size: 10MB</p>
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 px-8 py-4 text-sm font-bold text-white transition hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {uploading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : "Start Analyzing"}
                  </button>
                </form>
                {uploadError && (
                  <p className="mt-4 text-sm text-red-500 bg-red-500/10 py-2 rounded-xl">{uploadError}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-[1600px] mx-auto">
              <div className="mb-8 flex items-end justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-zinc-100 flex items-center gap-3">
                    <span className="bg-emerald-500/10 text-emerald-400 p-2 rounded-xl border border-emerald-500/20">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </span>
                    Data Explorer
                  </h2>
                  <p className="text-zinc-500 mt-1 ml-11 font-medium">Viewing sheet insights for <span className="text-emerald-500/80">{fileInfo.fileName}</span></p>
                </div>
                
                <div className="flex gap-2">
                  <button className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition" title="Toggle Search">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </button>
                   <button className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition" title="Filter View">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                  </button>
                </div>
              </div>

              {/* Data Grid - Excel Styled */}
              <div className="rounded-xl border border-zinc-300 bg-white overflow-hidden shadow-xl mb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="overflow-x-auto overflow-y-auto max-h-[70vh] custom-scrollbar">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[#1D6F42] border-b border-[#165432]">
                        <th className="p-3 w-12 text-center text-[10px] font-bold text-white/70 uppercase">#</th>
                        {fileInfo.headers.map((h) => (
                          <th key={h} className="p-3 text-[11px] font-bold text-white uppercase tracking-wider min-w-[150px] border-r border-[#165432]/50">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {previewData.length > 0 ? (
                        previewData.map((row, i) => (
                          <tr key={i} className="border-b border-zinc-200 hover:bg-zinc-50 transition-colors group">
                            <td className="p-3 text-center text-[10px] text-zinc-400 font-mono bg-zinc-50/50 border-r border-zinc-200">{i + 1}</td>
                            {fileInfo.headers.map((h, j) => (
                              <td key={j} className="p-3 text-sm text-zinc-900 border-r border-zinc-100 font-medium">
                                {row[h] !== null && row[h] !== undefined ? String(row[h]) : ""}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        [...Array(20)].map((_, i) => (
                          <tr key={i} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors group">
                            <td className="p-3 text-center text-xs text-zinc-300 font-mono italic">{i + 1}</td>
                            {fileInfo.headers.map((h, j) => (
                              <td key={j} className="p-3 text-sm text-zinc-900">
                                <div className="h-4 w-2/3 bg-zinc-100 rounded animate-pulse" />
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between text-[11px] text-zinc-500 px-6">
                  <span>Showing all {previewData.length} records from the active file.</span>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#1D6F42]" />
                    Excel Rendering Engine Active
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Floating Chat Interface */}
        <div className={`fixed bottom-8 right-8 z-50 transition-all duration-500 ease-out ${isChatOpen ? 'w-[450px] sm:w-[500px]' : 'w-16'}`}>
          {!isChatOpen ? (
            <button 
              onClick={() => setIsChatOpen(true)}
              className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl shadow-emerald-500/40 flex items-center justify-center text-white hover:scale-110 transition active:scale-95 group relative"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 transition-transform group-hover:rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 rounded-full border-4 border-zinc-950 text-[10px] font-bold flex items-center justify-center animate-bounce">1</span>
            </button>
          ) : (
            <div className="flex h-[75vh] flex-col rounded-3xl bg-zinc-950/90 border border-zinc-800/50 backdrop-blur-2xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] overflow-hidden scale-in-center">
              {/* Chat Header */}
              <header className="flex items-center justify-between p-5 border-b border-zinc-800/50 bg-zinc-900/30">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100">Hydra AI Assistant</h3>
                    <p className="text-[10px] text-emerald-500 uppercase font-bold tracking-widest">Online</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsChatOpen(false)}
                  className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l18 18" />
                  </svg>
                </button>
              </header>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
                 {messages.length === 0 && (
                   <div className="text-center py-10 opacity-50 space-y-3">
                     <p className="text-xs text-zinc-400 font-mono">--- SYSTEM INITIALIZED ---</p>
                     <p className="text-sm">Assalamu Alaikum! Main aapka Excel AI Assistant hun. Poochiye jo poochna hai.</p>
                   </div>
                 )}

                 {messages.map((m) => (
                   <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                     <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                       m.role === "user" 
                       ? "bg-emerald-600 text-white rounded-tr-none shadow-lg shadow-emerald-500/10" 
                       : "bg-zinc-900 text-zinc-300 rounded-tl-none border border-zinc-800"
                     }`}>
                        <div className="whitespace-pre-wrap">
                          {m.parts
                            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                            .map((p, i) => (
                              <span key={i}>{p.text}</span>
                            ))}
                        </div>
                     </div>
                   </div>
                 ))}

                 {isLoading && (
                   <div className="flex justify-start">
                     <div className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-2xl rounded-tl-none">
                       <span className="flex gap-1.5">
                         <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
                         <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                         <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                       </span>
                     </div>
                   </div>
                 )}
                 <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-5 border-t border-zinc-800/50 bg-zinc-900/30">
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={fileInfo ? "Ask me anything..." : "Upload a file first..."}
                    disabled={!fileInfo || isLoading}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-emerald-500 transition disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!fileInfo || isLoading || !input.trim()}
                    className="h-12 w-12 flex items-center justify-center bg-emerald-600 rounded-2xl text-white hover:bg-emerald-500 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #10b981;
        }
        
        .scale-in-center {
          animation: scale-in-center 0.4s cubic-bezier(0.250, 0.460, 0.450, 0.940) both;
        }
        @keyframes scale-in-center {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
