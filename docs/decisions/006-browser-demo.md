# Decision 006: browser-only HOME testing ground

The owner wants to explore the real HOME interface from a free public GitHub Pages URL without installing a server. Each visitor's data should persist locally, including a functional test Vault.

Build the existing web apps with a separate demo-only Vite entry transformation and browser service worker. The worker answers scoped API requests from IndexedDB, including XHR file uploads. Keep production services, ownership checks, routing and encryption source unchanged. Persist only Vault ciphertext/envelopes and public metadata; preserve the existing unlock/recovery flow. Simulate server monitoring and identity explicitly. Unsupported network/server actions fail visibly.

This deliberately creates a single-user local sandbox; it does not create an authentication boundary, share data across computers, perform server jobs or establish production Vault readiness. The browser can evict data. See BROWSER_DEMO.md for behavior, limitations and deployment.

Acceptance: open all seven apps from Pages-compatible paths, retain edited data on refresh, preserve file bytes under concurrent uploads, use real Vault encryption with wrong-password rejection and no persisted plaintext, initialize an independent fresh browser, and reset disposable demo data. Automated API and browser lifecycle checks cover these boundaries.
