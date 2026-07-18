# External facts to re-check

These are time-dependent or platform-dependent facts, not product-owner
decisions. The implementation plan must verify them from official sources at
the named gate.

| ID | Fact to verify | Gate | Owner output |
|---|---|---|---|
| ER-01 | Current Build Week rules, deadline, category rule, public/private repository requirements, demo availability period | Before submission work and again immediately before final submit | Dated checklist with source links |
| ER-02 | Required use and evidence wording for Codex and GPT-5.6 | Before README/reel lock | Exact official wording and compliance mapping |
| ER-03 | Current official GPT-5.6 model ID and structured-output support | Before OpenAI adapter implementation | Versioned model configuration |
| ER-04 | Realtime model ID, WebRTC flow, client-secret lifetime, session and rate limits | Before Realtime adapter implementation | Connection contract and tested expiry behavior |
| ER-05 | Cloudflare Worker, Durable Object, D1, R2, and `workers.dev` account limits | Before hosted load/limit design | Capacity table and configured caps |
| ER-06 | Durable Object secret/transient-memory behavior needed for key leases | Before judge/BYOK production path | Threat-model note and eviction test |
| ER-07 | Devpost `Testing Instructions` visibility in preview, logged-out view, and gallery | Before entering credentials | Screenshots with no real credential present |
| ER-08 | Official private-repository sharing recipients and procedure | Before inviting judge accounts | Confirmed addresses/procedure |
| ER-09 | GitHub Actions permissions and Cloudflare deployment credentials | Before CI deploy workflow | Least-privilege deployment setup |
| ER-10 | Counterpoint trademark and relevant domain availability | Before public name lock | Search record and recommendation for UD-04 |

Do not convert an unverified topic statement into a current fact. Record the
date, exact source, and observed value when each item is closed.
