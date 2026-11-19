# Velvet

Private, local-first notes with passkey and PIN protection.

- **Face ID / fingerprint:** uses a platform WebAuthn passkey on supported HTTPS browsers.
- **PIN:** available to phones or browsers without supported biometrics. PINs are used to derive a key with PBKDF2 and are never stored as plain text.
- **Encryption:** notes are encrypted with AES-GCM using a random vault master key.
- **Settings:** themes, fonts, text size, animation, auto-lock, and security controls.

Run locally:

```sh
npm install
npm run dev
npm run build
```

Passkeys require HTTPS (localhost is secure for development). PIN fallback works as a separate key recovery method, but both security methods rely on data stored in this browser. If the browser/profile or all unlock methods are lost, encrypted notes cannot be recovered.
