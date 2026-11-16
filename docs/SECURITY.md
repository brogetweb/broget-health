# Security policy and implementation

Security fixes target the current company `main` branch. Deploy the matching backend and client versions and keep dependencies current. This document describes implemented controls and operating requirements; it is not a penetration-test or compliance certification.

## Reporting a vulnerability

Do not post credentials, private health records, session tokens or exploit details in a public issue. Use GitHub's **Report a vulnerability** option when available. If private reporting is unavailable, open an issue requesting a private security contact without including sensitive details; maintainers can arrange a private reporting channel. Never upload service-account JSON or environment files.

## Authentication and authorization

- Firebase Authentication manages passwords, account sessions, verification and password-reset emails. MongoDB does not store passwords or Firebase session tokens.
- The app's minimum password length is **6 characters**, consistent with Firebase's default policy. Registration validation and weak-password messages use one shared constant. Any future Firebase console policy change must be reflected in client validation.
- The backend verifies Firebase ID-token signature, project/audience, expiry and revocation. Every private query uses the verified UID, not a client-supplied account identifier.
- Production and staging require Firebase App Check in addition to authentication. Configure authorized web domains, Android signing certificates and the applicable attestation providers. There is no hosted emulator bypass.
- AI/photo upload and food-search endpoints require verified email. Account deletion requires recent authentication and explicit confirmation. Per-IP and per-account quotas limit API usage.

## MongoDB data isolation and consistency

Profiles, preferences, meals, chat, summaries, remembered notes, reminder histories, scan estimates and media metadata are stored in MongoDB behind the API. Flutter has no direct database connection, Firestore dependency or arbitrary-query endpoint.

Owner validators and indexes supplement application authorization. Private writes acquire an account serialization fence in a MongoDB transaction. Meal changes update old/new daily totals atomically, and chat request/attempt IDs prevent duplicate or stale completion. Canonical nutrition snapshots are resolved server-side; user-entered label values retain explicit provenance.

Use a transaction-capable replica set or sharded deployment, TLS, a dedicated least-privileged database account and an appropriate network access list. Expired caches and quotas are rejected logically as well as being scheduled for TTL cleanup; TTL deletion is not immediate.

## Cloudinary media

Optional meal photos use authenticated Cloudinary delivery. Images are size-limited, decoded, resized and re-encoded without original metadata. Randomized asset IDs are reserved before upload, and MongoDB records their owner and lifecycle. The API checks ownership before issuing a signed download link that expires after 60 seconds. Treat those temporary URLs as bearer credentials and do not log them.

Meal attachment, replacement and removal update metadata transactionally and queue external cleanup. Failed/abandoned uploads and account deletion use durable retry jobs. MongoDB, Cloudinary and Firebase do not share a transaction; cleanup can be delayed while a service is unavailable or a free Render instance is asleep. A minimal account tombstone prevents stale requests from recreating deleted records. Device/browser caches require separate consideration in the retention policy.

## AI and sensitive data

AI receives relevant photos and bounded nutrition context only when the user invokes those features. Server-owned history, confirmed notes and deterministic summaries form context. Responses are schema-validated, and write tools propose changes for explicit user confirmation. Nutritional estimates are not clinical measurements.

Prompt-injection and disclosure filters are defense in depth, not a guarantee against every unsafe response. No model-generated command or database query is executed. Do not log raw AI requests/responses, uploaded images or health/chat records.

Optional analytics and crash collection are initially disabled and require user preference. Custom analytics must not include nutrition or conversation content. Review SDK collection settings and processor agreements for the actual deployment.

## Credentials, deployment and maintenance

- Store MongoDB, Cloudinary, AI and Firebase Admin credentials only in ignored local files, Render variables or Render Secret Files. Public Firebase client identifiers are distinct from server credentials.
- Never commit environment files, private keys, signing keys, debug logs or generated private configuration. Run `node scripts/check-secrets.mjs` against the Git index before pushing.
- Rotate exposed credentials and revoke obsolete keys. Preserve the Android signing identity securely for updates.
- Use Node.js 22, dependency audits and the checks in the [README](../README.md). Integration tests use disposable local MongoDB instances and test doubles rather than production user data.
- Follow the [Render deployment guide](RENDER.md), verify health/attestation and perform browser/device acceptance before distributing a release.

The deployed privacy policy and terms still require the service operator's actual legal identity, contact information, processing/retention details and applicable rights. Source code alone cannot establish those legal or operational facts.
