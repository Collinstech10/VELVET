import { useEffect, useRef, useState } from 'react';

type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

type VaultConfig = { credentialId: string; salt: string };
type EncryptedVault = { version: 1; iv: string; ciphertext: string };
type Theme = 'velvet' | 'midnight' | 'paper';
type NoteFont = 'sans' | 'serif' | 'mono';
type Preferences = { theme: Theme; font: NoteFont; fontSize: number; animations: boolean; autoLock: number };

const CONFIG_KEY = 'velvet-passkey-v1';
const VAULT_KEY = 'velvet-encrypted-notes-v1';
const LEGACY_KEY = 'velvet-notes-v1';
const PREFERENCES_KEY = 'velvet-preferences-v1';
const PRF_SALT_BYTES = 32;
const DEFAULT_PREFERENCES: Preferences = { theme: 'velvet', font: 'sans', fontSize: 16, animations: true, autoLock: 5 };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
function randomBytes(length: number): Uint8Array { return crypto.getRandomValues(new Uint8Array(length)); }

function readConfig(): VaultConfig | null {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (!value) return null;
    const config: unknown = JSON.parse(value);
    if (typeof config === 'object' && config !== null && 'credentialId' in config && 'salt' in config
      && typeof config.credentialId === 'string' && typeof config.salt === 'string') return config as VaultConfig;
  } catch { /* Treat corrupt settings as an unconfigured vault. */ }
  return null;
}
function readPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    if (typeof saved === 'object' && saved !== null) {
      const value = saved as Partial<Preferences>;
      return {
        theme: value.theme === 'midnight' || value.theme === 'paper' ? value.theme : 'velvet',
        font: value.font === 'serif' || value.font === 'mono' ? value.font : 'sans',
        fontSize: typeof value.fontSize === 'number' ? Math.min(24, Math.max(14, value.fontSize)) : 16,
        animations: value.animations !== false,
        autoLock: [0, 1, 5, 15].includes(value.autoLock ?? 5) ? value.autoLock ?? 5 : 5,
      };
    }
  } catch { /* Use defaults if preferences are unreadable. */ }
  return DEFAULT_PREFERENCES;
}
function readLegacyNotes(): Note[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
    return Array.isArray(value) ? value as Note[] : [];
  } catch { return []; }
}
function getPrfBytes(credential: Credential): Uint8Array | null {
  const result = (credential as Credential & { getClientExtensionResults(): { prf?: { results?: { first?: ArrayBuffer } } } }).getClientExtensionResults();
  const first = result.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}
async function deriveVaultKey(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Velvet notes encryption v1') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function encryptNotes(notes: Note[], key: CryptoKey): Promise<EncryptedVault> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(notes)));
  return { version: 1, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) };
}
async function decryptNotes(value: string, key: CryptoKey): Promise<Note[]> {
  const envelope: unknown = JSON.parse(value);
  if (typeof envelope !== 'object' || envelope === null || !('version' in envelope) || envelope.version !== 1
    || !('iv' in envelope) || !('ciphertext' in envelope) || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('The encrypted notes file is invalid.');
  }
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) }, key, base64UrlToBytes(envelope.ciphertext));
  const notes: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(notes)) throw new Error('The notes data is invalid.');
  return notes as Note[];
}

function App() {
  const [config, setConfig] = useState<VaultConfig | null>(readConfig);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.noteFont = preferences.font;
    document.documentElement.style.setProperty('--note-size', `${preferences.fontSize}px`);
    document.documentElement.dataset.motion = preferences.animations ? 'on' : 'off';
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (!unlocked || preferences.autoLock === 0) return undefined;
    let timer = window.setTimeout(lockVault, preferences.autoLock * 60_000);
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockVault, preferences.autoLock * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [unlocked, preferences.autoLock]);

  useEffect(() => {
    if (!unlocked || !vaultKey) return;
    saveQueue.current = saveQueue.current.then(async () => {
      const encrypted = await encryptNotes(notes, vaultKey);
      localStorage.setItem(VAULT_KEY, JSON.stringify(encrypted));
    }).catch(() => setError('Could not save your encrypted notes. Check available device storage.'));
  }, [notes, unlocked, vaultKey]);

  function updatePreferences(changes: Partial<Preferences>) {
    setPreferences((current) => ({ ...current, ...changes }));
  }
  function lockVault() {
    setUnlocked(false); setVaultKey(null); setNotes([]); setSelectedId(null); setQuery(''); setError(''); setSettingsOpen(false);
  }
  async function setupPasskey() {
    if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) {
      setError('Passkeys need a supported browser on HTTPS (or localhost).'); return;
    }
    setBusy(true); setError('');
    try {
      const credential = await navigator.credentials.create({ publicKey: {
        challenge: randomBytes(32), rp: { name: 'Velvet' }, user: { id: randomBytes(16), name: 'velvet-local-user', displayName: 'Velvet user' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }, timeout: 60000, attestation: 'none',
      } });
      if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey setup was cancelled.');
      const newConfig = { credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)), salt: bytesToBase64Url(randomBytes(PRF_SALT_BYTES)) };
      const key = await deriveVaultKey(await requestPrf(newConfig), base64UrlToBytes(newConfig.salt));
      const migratedNotes = readLegacyNotes();
      localStorage.setItem(VAULT_KEY, JSON.stringify(await encryptNotes(migratedNotes, key)));
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig)); localStorage.removeItem(LEGACY_KEY);
      setConfig(newConfig); setNotes(migratedNotes); setVaultKey(key); setUnlocked(true);
    } catch (cause) { setError(errorMessage(cause, 'Could not set up fingerprint or Face ID.')); }
    finally { setBusy(false); }
  }
  async function requestPrf(vaultConfig: VaultConfig): Promise<Uint8Array> {
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: randomBytes(32), rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(vaultConfig.credentialId) }], userVerification: 'required', timeout: 60000,
      extensions: { prf: { eval: { first: base64UrlToBytes(vaultConfig.salt) } } },
    } as PublicKeyCredentialRequestOptions });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey verification was cancelled.');
    const output = getPrfBytes(credential);
    if (!output) throw new Error('This authenticator or browser does not support WebAuthn PRF, which is required to encrypt notes.');
    return output;
  }
  async function unlockVault() {
    if (!config) return;
    setBusy(true); setError('');
    try {
      const key = await deriveVaultKey(await requestPrf(config), base64UrlToBytes(config.salt));
      const encrypted = localStorage.getItem(VAULT_KEY);
      if (!encrypted) throw new Error('Encrypted notes are missing from this browser.');
      setNotes(await decryptNotes(encrypted, key)); setVaultKey(key); setUnlocked(true);
    } catch (cause) { setError(errorMessage(cause, 'Could not unlock your notes.')); }
    finally { setBusy(false); }
  }
  function updateSelected(changes: Partial<Pick<Note, 'title' | 'body'>>) {
    if (!selected) return;
    setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, ...changes, updatedAt: Date.now() } : note));
  }
  function createNote() {
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', updatedAt: Date.now() };
    setNotes((current) => [note, ...current]); setSelectedId(note.id);
  }
  function deleteSelected() {
    if (!selected) return;
    setNotes((current) => current.filter((note) => note.id !== selected.id)); setSelectedId(null);
  }
  const filteredNotes = notes.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);

  if (!unlocked) {
    const supported = window.isSecureContext && Boolean(navigator.credentials) && Boolean(window.PublicKeyCredential);
    return <main className="auth-screen"><section className="auth-card">
      <a className="brand auth-brand" href="/" aria-label="Velvet home"><span className="brand-mark">v</span> velvet</a>
      <div className="auth-icon" aria-hidden="true">⌑</div><p className="eyebrow">YOUR PRIVATE NOTEBOOK</p>
      <h1>{config ? 'Your thoughts, protected.' : 'A private place, just for you.'}</h1>
      <p className="auth-copy">{config ? 'Unlock this vault with the fingerprint, Face ID, or device screen lock you set up.' : 'Set up a device passkey to protect and encrypt your notes. Your biometric data stays with your device.'}</p>
      {supported ? <button className="primary-button auth-button" onClick={config ? unlockVault : setupPasskey} disabled={busy}><span aria-hidden="true">{busy ? '◌' : '⌑'}</span>{busy ? 'Waiting for your device…' : config ? 'Unlock with passkey' : 'Set up fingerprint or Face ID'}</button> : <p className="auth-warning">Passkeys require HTTPS (or localhost) and a supported browser/device.</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="privacy-copy">Notes are encrypted on this device. Velvet never receives your passkey or notes.</p>
      {config && <p className="privacy-copy recovery-copy">Keep this browser profile and device passkey available. There is no password reset or recovery key.</p>}
      <button className="auth-settings" onClick={() => setSettingsOpen(true)}>Appearance settings</button>
      {settingsOpen && <Settings preferences={preferences} onChange={updatePreferences} onClose={() => setSettingsOpen(false)} locked />}
    </section></main>;
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Velvet home"><span className="brand-mark">v</span> velvet</a>
      <p className="eyebrow">YOUR SPACE</p>
      <div className="notes-heading"><span>Notes</span><span className="count">{notes.length}</span></div>
      <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search notes" placeholder="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button className="new-note" onClick={createNote}><span>＋</span> New note</button>
      <nav className="note-list" aria-label="Your notes">
        {filteredNotes.map((note) => <button key={note.id} className={`note-item ${note.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(note.id)}>
          <span className="note-item-title">{note.title.trim() || 'Untitled note'}</span><span className="note-item-preview">{note.body.trim().slice(0, 52) || 'No additional text'}</span>
        </button>)}
        {filteredNotes.length === 0 && <p className="empty-list">{query ? 'No matching notes.' : 'Your notes will appear here.'}</p>}
      </nav>
      <p className="storage-note"><span className="status-dot" /> Encrypted on this device</p>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><span className="topbar-label">PRIVATE NOTEBOOK</span><span className="topbar-subtitle">A little space for what matters</span></div><div className="topbar-actions"><button className="settings-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><span aria-hidden="true">⚙</span><span>Settings</span></button><button className="lock-button" onClick={lockVault}><span aria-hidden="true">⌑</span> Lock vault</button></div></header>
      {selected ? <article className="editor" key={selected.id}>
        <div className="editor-actions"><span className="saved-label"><span className="status-dot" /> Edited {new Date(selected.updatedAt).toLocaleString()}</span><button className="delete-button" onClick={deleteSelected} aria-label="Delete note">Delete note</button></div>
        <input className="title-input" aria-label="Note title" placeholder="Untitled note" value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} autoFocus />
        <textarea className="body-input" aria-label="Note content" placeholder="Start writing..." value={selected.body} onChange={(event) => updateSelected({ body: event.target.value })} />
      </article> : <div className="welcome">
        <div className="welcome-icon">✳</div><p className="eyebrow">A MOMENT FOR YOURSELF</p><h1>Make room<br />for your thoughts.</h1>
        <p className="welcome-copy">A quiet place to collect ideas, reminders, and everything in between.</p><button className="primary-button" onClick={createNote}>Create your first note <span>→</span></button>
        <p className="privacy-copy">Notes are encrypted and saved in this browser.</p>
      </div>}
    </section>
    {settingsOpen && <Settings preferences={preferences} onChange={updatePreferences} onClose={() => setSettingsOpen(false)} onLock={lockVault} />}
  </main>;
}

function Settings({ preferences, onChange, onClose, onLock, locked = false }: {
  preferences: Preferences; onChange: (changes: Partial<Preferences>) => void; onClose: () => void; onLock?: () => void; locked?: boolean;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div><p className="eyebrow">MAKE IT YOURS</p><h2 id="settings-title">Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings">×</button></header>
      <div className="settings-content">
        <section className="setting-section"><h3>Appearance</h3><p className="setting-description">Choose a look that feels like you.</p>
          <div className="theme-options" role="group" aria-label="Color theme">
            {([['velvet', 'Velvet', 'theme-swatch-velvet'], ['midnight', 'Midnight', 'theme-swatch-midnight'], ['paper', 'Paper', 'theme-swatch-paper']] as const).map(([theme, label, swatch]) =>
              <button key={theme} className={`theme-option ${preferences.theme === theme ? 'selected' : ''}`} onClick={() => onChange({ theme })} aria-pressed={preferences.theme === theme}><span className={`theme-swatch ${swatch}`} /><span>{label}</span></button>)}
          </div>
        </section>
        <section className="setting-section"><h3>Writing</h3>
          <label className="setting-row"><span><strong>Note font</strong><small>Pick a style for your writing</small></span><select value={preferences.font} onChange={(event) => onChange({ font: event.target.value as NoteFont })}><option value="sans">Modern sans</option><option value="serif">Classic serif</option><option value="mono">Monospace</option></select></label>
          <label className="setting-row"><span><strong>Text size</strong><small>Adjust editor text size</small></span><select value={preferences.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })}><option value="14">Small</option><option value="16">Comfortable</option><option value="18">Large</option><option value="21">Extra large</option><option value="24">Largest</option></select></label>
        </section>
        <section className="setting-section"><h3>Behavior</h3>
          <label className="setting-row"><span><strong>Animations</strong><small>Subtle motion in the interface</small></span><input className="toggle" type="checkbox" checked={preferences.animations} onChange={(event) => onChange({ animations: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>Auto-lock</strong><small>Lock after you stop using Velvet</small></span><select value={preferences.autoLock} onChange={(event) => onChange({ autoLock: Number(event.target.value) })}><option value="1">1 minute</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="0">Never</option></select></label>
        </section>
        <section className="setting-section security-section"><h3>Security</h3><div className="security-status"><span className="status-dot" /><span><strong>Device passkey active</strong><small>Fingerprint, Face ID, or screen lock</small></span></div>
          <p className="security-note">Your passkey protects the encryption key. A separate password cannot be changed here; adding one needs a safe vault-key migration. Keep access to your device passkey—there is no recovery key.</p>
          {!locked && onLock && <button className="secondary-button lock-now" onClick={onLock}>Lock vault now</button>}
        </section>
      </div>
      <footer className="settings-footer"><span>Preferences are saved on this device.</span><button className="primary-button settings-done" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out. Try again.';
  if (cause instanceof Error) return cause.message;
  return fallback;
}
export default App;
