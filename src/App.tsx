import { useEffect, useState } from 'react';

type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

const STORAGE_KEY = 'velvet-notes-v1';

function readNotes(): Note[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved as Note[] : [];
  } catch {
    return [];
  }
}

function App() {
  const [notes, setNotes] = useState<Note[]>(readNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  function updateSelected(changes: Partial<Pick<Note, 'title' | 'body'>>) {
    if (!selected) return;
    setNotes((current) => current.map((note) => note.id === selected.id
      ? { ...note, ...changes, updatedAt: Date.now() }
      : note));
  }

  function createNote() {
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', updatedAt: Date.now() };
    setNotes((current) => [note, ...current]);
    setSelectedId(note.id);
  }

  function deleteSelected() {
    if (!selected) return;
    setNotes((current) => current.filter((note) => note.id !== selected.id));
    setSelectedId(null);
  }

  const filteredNotes = notes
    .filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Velvet home"><span className="brand-mark">v</span> velvet</a>
        <p className="eyebrow">YOUR SPACE</p>
        <div className="notes-heading"><span>Notes</span><span className="count">{notes.length}</span></div>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search notes" placeholder="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button className="new-note" onClick={createNote}><span>＋</span> New note</button>
        <nav className="note-list" aria-label="Your notes">
          {filteredNotes.map((note) => (
            <button key={note.id} className={`note-item ${note.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(note.id)}>
              <span className="note-item-title">{note.title.trim() || 'Untitled note'}</span>
              <span className="note-item-preview">{note.body.trim().slice(0, 52) || 'No additional text'}</span>
            </button>
          ))}
          {filteredNotes.length === 0 && <p className="empty-list">{query ? 'No matching notes.' : 'Your notes will appear here.'}</p>}
        </nav>
        <p className="storage-note"><span className="status-dot" /> Saved on this device</p>
      </aside>

      <section className="workspace">
        <header className="topbar"><span className="topbar-label">PRIVATE NOTEBOOK</span><span className="local-badge"><span className="status-dot" /> Local storage</span></header>
        {selected ? (
          <article className="editor">
            <div className="editor-actions">
              <span className="saved-label">Edited {new Date(selected.updatedAt).toLocaleString()}</span>
              <button className="delete-button" onClick={deleteSelected} aria-label="Delete note">Delete note</button>
            </div>
            <input className="title-input" aria-label="Note title" placeholder="Untitled note" value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} autoFocus />
            <textarea className="body-input" aria-label="Note content" placeholder="Start writing..." value={selected.body} onChange={(event) => updateSelected({ body: event.target.value })} />
          </article>
        ) : (
          <div className="welcome">
            <div className="welcome-icon">✳</div>
            <p className="eyebrow">A MOMENT FOR YOURSELF</p>
            <h1>Make room<br />for your thoughts.</h1>
            <p className="welcome-copy">A quiet place to collect ideas, reminders, and everything in between.</p>
            <button className="primary-button" onClick={createNote}>Create your first note <span>→</span></button>
            <p className="privacy-copy">Your notes are saved in this browser on this device.</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
