import { useState, useEffect, useRef } from "react";

interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: number;
}

declare global {
  interface Window {
    __CONFIG__?: { API_BASE: string; ALLOW_REGISTRATION: boolean };
  }
}

const API_BASE = window.__CONFIG__?.API_BASE ?? "";
const ALLOW_REGISTRATION = window.__CONFIG__?.ALLOW_REGISTRATION ?? true;

const NotebookApp = () => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("username"));
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [notes, setNotes] = useState<Note[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
  const dirtyRef = useRef(dirtyIds);
  dirtyRef.current = dirtyIds;
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");

  const apiFetch = (path: string, options?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (options?.headers) {
      Object.assign(headers, options.headers as Record<string, string>);
    }
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (options?.method && options.method !== "GET" && options.method !== "DELETE") {
      headers["Content-Type"] = "application/json";
    }
    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };

  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
      localStorage.setItem("username", username || "");
    } else {
      localStorage.removeItem("token");
      localStorage.removeItem("username");
    }
  }, [token, username]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", handler);
    return () => removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    if (!token) return;
    apiFetch("/api/notes")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) =>
        setNotes((prev) => {
          const serverIds = new Set(data.map((n: Note) => n.id));
          const localOnly = prev.filter((n) => !serverIds.has(n.id));
          return [...data, ...localOnly];
        })
      )
      .catch(() => {});
  }, [token]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;

  useEffect(() => {
    if (selectedNote) {
      setEditingTitle(selectedNote.title);
      setEditingContent(selectedNote.content);
    } else {
      setEditingTitle("");
      setEditingContent("");
    }
  }, [selectedNoteId]);

  const handleAuth = async () => {
    setAuthError("");
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Authentication failed");
        return;
      }
      setToken(data.token);
      setUsername(authUsername);
    } catch {
      setAuthError("Network error");
    }
  };

  const handleLogout = () => {
    if (dirtyIds.size > 0 && !confirm("You have unsaved changes. Log out anyway?")) return;
    if (token) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    setUsername(null);
  };

  if (!token) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-50 px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
          <h1 className="text-2xl font-bold text-center mb-6">Notebook</h1>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Username"
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
            />
          </div>
          <div className="mb-4">
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
            />
          </div>
          {authError && <p className="text-red-500 text-sm mb-4">{authError}</p>}
          <button
            onClick={handleAuth}
            className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors mb-2"
          >
            {authMode === "login" ? "Login" : "Register"}
          </button>
          <p className="text-center text-sm text-gray-500">
            {authMode === "login" ? (
              ALLOW_REGISTRATION ? (
                <>
                  Don't have an account?{" "}
                  <button onClick={() => setAuthMode("register")} className="text-blue-500 hover:underline">
                    Register
                  </button>
                </>
              ) : null
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => setAuthMode("login")} className="text-blue-500 hover:underline">
                  Login
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const addNote = () => {
    const newNote: Note = {
      id: Date.now(),
      title: "New Note",
      content: "",
      createdAt: Date.now(),
    };
    setNotes((prev) => [...prev, newNote]);
    setDirtyIds((prev) => new Set(prev).add(newNote.id));
    setSelectedNoteId(newNote.id);
  };

  const updateNoteLocally = (id: number, title: string, content: string) => {
    const existing = notes.find((n) => n.id === id);
    if (!existing || (existing.title === title && existing.content === content)) return;
    setNotes(notes.map((n) => (n.id === id ? { ...n, title, content } : n)));
    setDirtyIds((prev) => new Set(prev).add(id));
  };

  const saveNote = async () => {
    if (!selectedNote) return;
    const updated = { ...selectedNote, title: editingTitle, content: editingContent };
    setNotes(notes.map((n) => (n.id === updated.id ? updated : n)));
    try {
      const res = await apiFetch(`/api/notes/${updated.id}`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Failed to save");
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(updated.id);
        return next;
      });
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const deleteNote = async (id: number) => {
    setNotes(notes.filter((n) => n.id !== id));
    if (selectedNoteId === id) setSelectedNoteId(null);
    try {
      const res = await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  return (
    <div className="flex h-dvh bg-gray-50">
      <div className={`w-full md:w-64 bg-white border-r border-gray-200 flex-col ${
        selectedNote ? 'hidden' : 'flex'
      } md:flex`}>
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={addNote}
            className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            + New Note
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              className={`p-4 cursor-pointer border-b border-gray-100 hover:bg-gray-100 transition-colors flex items-center gap-2 ${
                selectedNoteId === note.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-800 truncate flex items-center gap-1">
                  <span className="truncate">{note.title}</span>
                  {dirtyIds.has(note.id) && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />}
                </h3>
                <p className="text-sm text-gray-500 truncate">{note.content}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                title="Delete"
              >
                🗑
              </button>
            </div>
          ))}
          {notes.length === 0 && (
            <div className="p-4 text-center text-gray-400">No notes yet</div>
          )}
        </div>
        <div className="p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 truncate">{username}</span>
            <button onClick={handleLogout} className="text-sm text-red-500 hover:text-red-700 ml-2 shrink-0">
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className={`flex-1 flex-col ${
        selectedNote ? 'flex' : 'hidden'
      } md:flex`}>
        {selectedNote ? (
          <>
            <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="flex items-center flex-1 min-w-0">
                <button
                  onClick={() => setSelectedNoteId(null)}
                  className="md:hidden mr-2 text-gray-500 hover:text-gray-700 shrink-0 text-lg leading-none"
                >
                  ←
                </button>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => updateNoteLocally(selectedNote.id, editingTitle, editingContent)}
                  className="text-xl md:text-2xl font-bold text-gray-800 bg-transparent border-none outline-none flex-1 min-w-0"
                  placeholder="Note title"
                />
              </div>
              <div className="flex items-center gap-2 justify-end shrink-0 md:ml-auto">
                <button onClick={saveNote} className="text-blue-500 hover:text-blue-700 transition-colors">
                  Save
                </button>
                <button onClick={() => deleteNote(selectedNote.id)} className="text-red-500 hover:text-red-700 transition-colors">
                  Delete
                </button>
              </div>
            </div>
            <div className="flex-1 flex flex-col p-4 pb-[max(1rem,env(safe-area-inset-bottom))] h-full">
              <textarea
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                onBlur={() => updateNoteLocally(selectedNote.id, editingTitle, editingContent)}
                className="flex-1 w-full resize-none outline-none bg-transparent text-gray-700"
                placeholder="Start writing..."
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a note or create a new one
          </div>
        )}
      </div>
    </div>
  );
};

export default NotebookApp;
