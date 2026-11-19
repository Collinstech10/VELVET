# Velvet

Private, local-first notes for the browser. Notes are encrypted with AES-GCM using a key derived from the WebAuthn PRF extension of a device passkey. Fingerprint, Face ID, or the device screen lock is handled by the browser/operating system; Velvet cannot access biometric data.

## Run locally

```sh
npm install
npm run dev
npm run build && npm run preview
```

Passkeys require HTTPS in production (localhost is treated as secure for development), a compatible browser/device, and WebAuthn PRF support. The passkey is bound to the web origin used during setup. Keep the same domain and browser profile, and retain access to the device passkey. There is no recovery key: if the passkey or its PRF capability is lost, the encrypted notes cannot be recovered. Back up notes before changing domains or browsers.

The settings panel includes Velvet, Midnight, and Paper themes; note font and text-size controls; animation preferences; and automatic vault locking. Preferences are stored locally in this browser. Auto-lock can be disabled, but locking the vault when stepping away is recommended.

A separate password is not currently supported. The passkey protects the encryption key, and changing the authentication model requires a safe migration of the encrypted vault. The passkey protects the notes stored by the app; it does not protect an already-unlocked session from someone using the unlocked device. Use **Lock vault** when stepping away.
