# Velvet

Private, local-first notes for the browser. Notes are encrypted with AES-GCM using a key derived from the WebAuthn PRF extension of a device passkey. Fingerprint, Face ID, or the device screen lock is handled by the browser/operating system; Velvet cannot access biometric data.

## Run locally

```sh
npm install
npm run dev
npm run build && npm run preview
```

Passkeys require HTTPS in production (localhost is treated as secure for development), a compatible browser/device, and WebAuthn PRF support. The passkey is bound to the web origin used during setup. Keep the same domain and browser profile, and retain access to the device passkey. There is no recovery key: if the passkey or its PRF capability is lost, the encrypted notes cannot be recovered. Back up notes before changing domains or browsers.

The passkey protects and encrypts the notes stored by the app. It does not protect an already-unlocked session from someone using the unlocked device; use **Lock vault** when stepping away. Biometric data is never stored in Velvet.
