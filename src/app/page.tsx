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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [input, setInput] = useState("");
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
    onFinish: (message) => {
      if (typeof window !== "undefined") {
        // Syncing handled by useEffect below
      }
    },
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      setFileInfo(data);
      // setMessages([]); // Removed to persist chat history when file changes
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
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white">
            Ex
          </div>
          <div>
            <h1 className="text-lg font-semibold">Excel AI Agent</h1>
            <p className="text-xs text-zinc-400">Chat with your spreadsheet data</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (confirm("Clear chat history?")) {
                setMessages([]);
                localStorage.removeItem("chat-messages");
              }
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Clear Chat
          </button>
          {fileInfo && (
            <button
              onClick={handleDownload}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-700"
            >
              Download Excel
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-72 flex-col border-r border-zinc-800 bg-zinc-900">
          <div className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase">Upload File</h2>
            <form onSubmit={handleFileUpload} className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-emerald-600 file:px-3 file:py-1 file:text-sm file:text-white"
              />
              <button
                type="submit"
                disabled={uploading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </form>
            {uploadError && (
              <p className="mt-2 text-sm text-red-400">{uploadError}</p>
            )}
          </div>

          {fileInfo && (
            <div className="border-t border-zinc-800 p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase">
                Active File
              </h2>
              <div className="space-y-2 text-sm">
                <div className="rounded-lg bg-zinc-800 p-3">
                  <p className="font-medium text-emerald-400">{fileInfo.fileName}</p>
                  <p className="mt-1 text-zinc-400">{fileInfo.rowCount} rows</p>
                  <p className="text-zinc-400">
                    Sheets: {fileInfo.sheetNames.join(", ")}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-800 p-3">
                  <p className="mb-1 text-zinc-400">Columns:</p>
                  <div className="flex flex-wrap gap-1">
                    {fileInfo.headers.map((h) => (
                      <span
                        key={h}
                        className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-auto border-t border-zinc-800 p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-400 uppercase">
              Commands
            </h2>
            <ul className="space-y-1 text-xs text-zinc-500">
              <li>&quot;Show all data&quot;</li>
              <li>&quot;Search Name for Ahmad&quot;</li>
              <li>&quot;Add a new record&quot;</li>
              <li>&quot;Update Ahmad&apos;s phone&quot;</li>
              <li>&quot;Delete record where Name is Ahmad&quot;</li>
              <li>&quot;Download the file&quot;</li>
            </ul>
          </div>
        </aside>

        {/* Chat Area */}
        <main className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-zinc-200">
                    {fileInfo
                      ? `"${fileInfo.fileName}" loaded!`
                      : "Upload an Excel file to get started"}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500">
                    {fileInfo
                      ? "Ask me anything about your data. I can read, search, add, update, and delete records."
                      : "Upload a .xlsx, .xls, or .csv file from the sidebar."}
                  </p>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`mb-4 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-200"
                    }`}
                >
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
              <div className="mb-4 flex justify-start">
                <div className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-400">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 p-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  fileInfo
                    ? "Ask about your Excel data..."
                    : "Upload a file first..."
                }
                disabled={!fileInfo}
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!fileInfo || isLoading || !input.trim()}
                className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
