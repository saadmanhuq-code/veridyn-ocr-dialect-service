# WIRING_GAP_TICKETS — veridyn-ocr

> Frontend Factory Phase 1.5 (AM-12 §3). Every FIXTURE-ONLY route becomes one
> ticket here: route, why it is fixture-only, what real data source/endpoint
> would need to exist, and rough class (trivial wire-up vs. needs new backend
> work). Per the Factory's scope-lock principle, wiring a fixture to a real
> backend is backend/domain work — filed here, never built inside an FF run.

## Tickets

### `/` — authenticated interactive UI is not provided

The public route is **FIXTURE-ONLY (intentional reference surface)**. It renders
bundled cue phrases and labels them as reference data. It does not call
`/api/documents/extract`, `/api/dialect/analyze`, or `/api/phrase-eval`, because
all three routes require a bearer key and the public page has no user
authentication.

Making this page interactive requires a real user/session authentication design
with authorization, abuse controls, and cost limits. A server route that simply
adds the service key is not an acceptable wire-up: it would turn the protected
API into a public unauthenticated relay.

`/lab` remains a redirect to `/` and has no independent data path.

## Reference elements

The `/` route's only non-real-wired elements are **static reference-phrase
affordances** imported from `lib/dialect-samples.ts`:

- Cue chips — `app/page.tsx:111-115` ← `lib/dialect-samples.ts:12-45`.
- Regional sample cards (RegSpeech12-style) — `app/page.tsx:139-155` ← `lib/dialect-samples.ts:47-102`.
- Dialect dropdown options — `app/page.tsx:122-126` ← `lib/dialect-samples.ts:104-113`.

These are labelled as bundled reference phrases and metadata. They do not
present a transcript, score, verdict, or batch result as live API output.

## Live-wiring note for Phase 7 (AM-12 check 13, forward-looking)

If a future authenticated Phase 6 rebuild makes `/` interactive, check 13 must
prove real backend variation across inputs, session authorization, and the
absence of a public service-key relay. Until then, the route remains explicitly
reference-only.
