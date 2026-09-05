# Security Audit Round 10 — 2026-09-05

## Scope

Sandbox permissions, browser message boundaries, authentication storage review, payment URL opening, and media fallback links.

## Confirmed findings

### 1. Untrusted nsites received excessive browser capabilities

The nsite sandbox `Permissions-Policy` granted camera, microphone, geolocation, display capture, sensors, battery/device state, MIDI, gamepad, screen wake lock, window management, and related capabilities to untrusted cross-origin content. Even where browser permission prompts still apply, this unnecessarily expanded the capability and privacy surface of every nsite preview.

### 2. Audio fallback bypassed URL sanitization

When encrypted audio failed to decrypt, the chat audio component rendered the original event URL directly as an anchor. This bypassed the shared HTTPS/local-network URL policy and could expose a viewer to unsafe navigation from untrusted event data.

## Reviewed and found safe

Third-party Tweet and Reddit resize listeners already verify both the fixed provider origin and the exact iframe `contentWindow`, so no changes were required there. Encrypted nsec login storage was also reviewed; it fails closed when encryption is unavailable and does not persist nsec secrets in plaintext.

## Fixes

- Reduced the sandbox `allow` policy to presentation/playback capabilities only: autoplay, clipboard-write, encrypted-media, fullscreen, and picture-in-picture.
- Removed camera, microphone, geolocation, display capture, sensor, battery, MIDI, gamepad, wake-lock, window-management, and other device/privacy capabilities from the default nsite grant.
- Sanitized encrypted-audio fallback links and render plain text instead of an unsafe anchor when the URL is invalid.

## Verification

- TypeScript: passed.
- ESLint: passed.
- Full Vitest suite: passed.
- Production build: passed.
- Repository security scan: passed with 0 critical and 0 high findings.

## Residual risk

The sandbox still permits scripts, same-origin storage within the isolated nsite origin, forms, modals, popups, downloads, and selected media/presentation features because these are required by existing nsite functionality. Capability grants should remain opt-in and purpose-specific if future nsite features need access to sensitive device APIs.
