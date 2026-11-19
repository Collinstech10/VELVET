import { useEffect, useRef, useState } from 'react';

type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

type VaultConfig = { credentialId: string; salt: string };
type EncryptedVault = { version: 1; iv: string; ciphertext: string };

const CONFIG_KEY = 'velvet-passkey-v1';
const VAULT_KEY = 'velvet-encrypted-notes-v1';
const LEGACY_KEY = 'velvet-notes-v1';
const PRF_SALT_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function readConfig(): VaultConfig | null {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (!value) return null;
    const config: unknown = JSON.parse(value);
    if (typeof config === 'object' && config !== null && 'credentialId' in config && 'salt' in config
      && typeof config.credentialId === 'string' && typeof config.salt === 'string') {
      return config as VaultConfig;
    }
  } catch { /* Treat corrupt settings as an unconfigured vault. */ }
  return null;
}

function readLegacyNotes(): Note[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
    return Array.isArray(value) ? value as Note[] : [];
  } catch {
    return [];
  }
}

function getPrfBytes(credential: Credential): Uint8Array | null {
  const result = (credential as Credential & {
    getClientExtensionResults(): { prf?: { results?: { first?: ArrayBuffer } } };
  }).getClientExtensionResults();
  const first = result.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

async function deriveVaultKey(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Velvet notes encryption v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptNotes(notes: Note[], key: CryptoKey): Promise<EncryptedVault> {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(notes));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { version: 1, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) };
}

async function decryptNotes(value: string, key: CryptoKey): Promise<Note[]> {
  const envelope: unknown = JSON.parse(value);
  if (typeof envelope !== 'object' || envelope === null || !('version' in envelope)
    || envelope.version !== 1 || !('iv' in envelope) || !('ciphertext' in envelope)
    || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('The encrypted notes file is invalid.');
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) },
    key,
    base64UrlToBytes(envelope.ciphertext),
  );
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    if (!unlocked || !vaultKey) return;
    // Serialize writes so a slower encryption operation cannot overwrite newer edits.
    saveQueue.current = saveQueue.current.then(async () => {
      const encrypted = await encryptNotes(notes, vaultKey);
      localStorage.setItem(VAULT_KEY, JSON.stringify(encrypted));
    }).catch(() => setError('Could not save your encrypted notes. Check available device storage.'));
  }, [notes, unlocked, vaultKey]);

  function lockVault() {
    setUnlocked(false);
    setVaultKey(null);
    setNotes([]);
    setSelectedId(null);
    setQuery('');
    setError('');
  }

  async function setupPasskey() {
    if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) {
      setError('Passkeys need a supported browser on HTTPS (or localhost).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const challenge = randomBytes(32);
      const userId = randomBytes(16);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Velvet' },
          user: { id: userId, name: 'velvet-local-user', displayName: 'Velvet user' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'required',
            userVerification: 'required',
          },
          timeout: 60000,
          attestation: 'none',
        },
      });
      if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey setup was cancelled.');

      const newConfig = { credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)), salt: bytesToBase64Url(randomBytes(PRF_SALT_BYTES)) };
      const prfOutput = await requestPrf(newConfig);
      const key = await deriveVaultKey(prfOutput, base64UrlToBytes(newConfig.salt));
      const migratedNotes = readLegacyNotes();
      const encrypted = await encryptNotes(migratedNotes, key);

      localStorage.setItem(VAULT_KEY, JSON.stringify(encrypted));
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
      localStorage.removeItem(LEGACY_KEY);
      setConfig(newConfig);
      setNotes(migratedNotes);
      setVaultKey(key);
      setUnlocked(true);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not set up fingerprint or Face ID.'));
    } finally {
      setBusy(false);
    }
  }

  async function requestPrf(vaultConfig: VaultConfig): Promise<Uint8Array> {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(vaultConfig.credentialId) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: base64UrlToBytes(vaultConfig.salt) } } },
      } as PublicKeyCredentialRequestOptions,
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey verification was cancelled.');
    const output = getPrfBytes(credential);
    if (!output) throw new Error('This authenticator or browser does not support the WebAuthn PRF feature needed to encrypt notes. Try an up-to-date browser and a device passkey.');
    return output;
  }

  async function unlockVault() {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      const prfOutput = await requestPrf(config);
      const key = await deriveVaultKey(prfOutput, base64UrlToBytes(config.salt));
      const encrypted = localStorage.getItem(VAULT_KEY);
      if (!encrypted) throw new Error('Encrypted notes are missing from this browser.');
      const decryptedNotes = await decryptNotes(encrypted, key);
      setNotes(decryptedNotes);
      setVaultKey(key);
      setUnlocked(true);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not unlock your notes.'));
    } finally {
      setBusy(false);
    }
  }

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

  if (!unlocked) {
    const supported = window.isSecureContext && Boolean(navigator.credentials) && Boolean(window.PublicKeyCredential);
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <a className="brand auth-brand" href="/" aria-label="Velvet home"><span className="brand-mark">v</span> velvet</a>
          <div className="auth-icon" aria-hidden="true">⌑</div>
          <p className="eyebrow">YOUR PRIVATE NOTEBOOK</p>
          <h1>{config ? 'Your thoughts, protected.' : 'A private place, just for you.'}</h1>
          <p className="auth-copy">{config
            ? 'Unlock this vault with the fingerprint, Face ID, or device screen lock you set up.'
            : 'Set up a device passkey to protect and encrypt your notes. Your biometric data stays with your device.'}</p>
          {supported ? (
            <button className="primary-button auth-button" onClick={config ? unlockVault : setupPasskey} disabled={busy}>
              <span aria-hidden="true">{busy ? '◌' : '⌑'}</span>
              {busy ? 'Waiting for your device…' : config ? 'Unlock with passkey' : 'Set up fingerprint or Face ID'}
            </button>
          ) : <p className="auth-warning">Passkeys require HTTPS (or localhost) and a supported browser/device.</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <p className="privacy-copy">Notes are encrypted on this device. Velvet never receives your passkey or notes.</p>
          {config && <p className="privacy-copy recovery-copy">Keep this browser profile and device passkey available. There is no password reset or recovery key.</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Velvet home"><span className="brand-mark">v</span> velvet</a>
        <p className="eyebrow">YOUR SPACE</p>
        <div className="notes-heading"><span>Notes</span><span className="count">{notes.length}</span></div>
        <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search notes" placeholder="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
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
        <p className="storage-note"><span className="status-dot" /> Encrypted on this device</p>
      </aside>
      <section className="workspace">
        <header className="topbar"><span className="topbar-label">PRIVATE NOTEBOOK</span><button className="lock-button" onClick={lockVault}>⌑ Lock vault</button></header>
        {selected ? (
          <article className="editor">
            <div className="editor-actions"><span className="saved-label">Edited {new Date(selected.updatedAt).toLocaleString()}</span><button className="delete-button" onClick={deleteSelected} aria-label="Delete note">Delete note</button></div>
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
            <p className="privacy-copy">Notes are encrypted and saved in this browser.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out. Try again.';
  if (cause instanceof Error) return cause.message;
  return fallback;
}

export default App;
