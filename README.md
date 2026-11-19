# Velvet

Private, local-first notes with passkey and PIN protection.

## Unlock options

- Face ID or fingerprint through a supported platform WebAuthn passkey
- A local 4–8 digit PIN fallback
- AES-GCM encrypted notes
- PBKDF2-derived PIN wrapping
- Automatic vault locking

## Writing experience

- Responsive desktop and mobile layout
- Velvet, Midnight, and Paper themes
- Sans, serif, and monospace writing styles
- Adjustable text size
- Searchable note list
- Reduced-motion support
- Touch-friendly controls and mobile settings sheet

## Run locally

```sh
npm install
npm run dev
npm run build
```

Passkeys require HTTPS (localhost is secure for development). Keep access to your browser passkey and PIN. If browser data or every unlock method is lost, encrypted notes cannot be recovered.
