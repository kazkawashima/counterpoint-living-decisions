# Artifact ingestion reel notes

All captures use the explicitly synthetic `Synthetic artifact boundary check`
meeting and `synthetic-regional-readiness.md`. The document states inside the
captured text that it is staged demo material and is not a customer record.

| State | Viewport | Suggested reel use |
|---|---|---|
| Source validated and derived text ready | Desktop, 1280x720 | Show the separate Source and Derived controls, the owner-private label, and the animated processing surface. |
| Public URL passed the SSRF gate | Desktop, 1280x720 | Hold on the URL badge and safety copy while explaining DNS pinning, redirect re-checks, and closed type/size limits. |
| Uploaded document used in exact preview | Desktop, 1280x720 | Cut from the artifact vault into the exact outgoing payload to explain that ingestion does not grant sharing permission. |
| URL document used in exact preview | Desktop, 1280x720 | Show that a fetched source enters the same private derivative and exact-preview boundary as an uploaded file. |
| Other owner's empty vault | Mobile, 390x844, reduced motion | Demonstrate that another participant sees neither the filename nor a private-existence hint. |

The clips under `docs/media/clips/artifact-ingestion/` record both file and
public-URL selection, safe derivation, private activation, and the exact
preview. Source and derived downloads are exercised in the committed browser
test but are not treated as publication. The displayed URL is an IANA-reserved
synthetic `.example` locator; the browser test substitutes a synthetic body
while the Node security suite separately exercises the real pinned transport.

Suggested narration:

> Bring a PDF or note into your private boundary. Counterpoint validates the
> source, creates a separately hashed text derivative, and still requires an
> exact preview before one word can enter the room.

Capture date: 2026-07-19. Feature slices: A1 validated artifact ingestion and
A2 SSRF-safe URL ingestion.
