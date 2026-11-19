# Velvet
Private, local-first notes. React + Vite + TypeScript, IndexedDB, Web Crypto, WebAuthn (PRF), installable PWA.

    npm install
    npm run dev        # http://localhost:5173 (localhost counts as secure for WebAuthn)
    npm run build && npm run preview

Deploy `dist/` over HTTPS (Vercel, Netlify, etc.). Fingerprint/Face ID is bound to the origin it was enabled on.
Vault notes are AES-GCM encrypted with a key derived from your PIN; regular notes are stored unencrypted.
