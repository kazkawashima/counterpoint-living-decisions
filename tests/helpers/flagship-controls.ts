export const FLAGSHIP_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="radio"]',
].join(", ");

export type FlagshipControlKind =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "summary"
  | "role-button"
  | "radio";

export type FlagshipControlState =
  | "workspace-shell"
  | "realtime-key-active"
  | "realtime-connecting"
  | "realtime-connected"
  | "realtime-fallback"
  | "projection-paused"
  | "judge-usage-ready"
  | "judge-usage-unavailable"
  | "judge-byok"
  | "manual-private-ready"
  | "manual-shared-ready"
  | "reset-confirmation"
  | "display-active"
  | "context"
  | "permission-preview"
  | "approved-context"
  | "commitment-idle"
  | "candidate-surface"
  | "candidate-readonly"
  | "candidate"
  | "premise-confirmed"
  | "premise-rejected"
  | "manual-alternative"
  | "decision-draft"
  | "decision-ready"
  | "decision-committed"
  | "decision-export"
  | "decision-export-ready"
  | "monitoring"
  | "at-risk"
  | "invalidation-surface"
  | "review-required"
  | "resolution"
  | "shared-display";

export type FlagshipScenarioOwner =
  | "flagship-control-inventory: traverses seeded Flagship states"
  | "decision-commit: facilitator commits a grounded Decision that participants can revisit"
  | "decision-commit: edited exact excerpt is the only private span disclosed"
  | "realtime-channels: Cancel cleans a held connection attempt and stops reconnecting"
  | "realtime-channels: Shared to Private selector keeps owner-private text out of the room transcript"
  | "realtime-channels: Cloudflare 1102 pauses projection polling until one manual retry recovers"
  | "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels"
  | "realtime-channels: server-owned access switches the browser to a credential-free managed call"
  | "realtime-channels: private/shared text and push-to-talk use one immutable, floor-gated command path"
  | "guided-flagship: facilitator can reset the guided flagship while participants cannot"
  | "shared-display: facilitator opens and revokes a privacy-safe shared display";

export interface FlagshipControlInventoryEntry {
  readonly id: string;
  readonly kind: FlagshipControlKind;
  readonly name: string | RegExp;
  readonly enabled: boolean;
  readonly state: FlagshipControlState;
  readonly owner: FlagshipScenarioOwner;
  readonly postcondition: string;
}

export interface FlagshipControlExclusion {
  readonly id: string;
  readonly selector: string;
  readonly reason: string;
}

export const flagshipControlExclusions = [
  {
    id: "artifact-administration",
    selector: ".artifact-vault",
    reason:
      "Artifact ingestion and administration have their own E2E surface and are outside the Flagship decision-flow inventory.",
  },
  {
    id: "descant-brand-navigation",
    selector: "a.brand",
    reason:
      "Generic Descant brand navigation is application chrome rather than a Flagship workspace action.",
  },
] as const satisfies readonly FlagshipControlExclusion[];

// Filled state-by-state from the runtime census. Keeping the typed empty
// inventory for the first RED makes the meta-test report every missing entry.
export const flagshipControls = [
  {
    id: "display-create",
    kind: "button",
    name: "Create shared display",
    enabled: true,
    state: "workspace-shell",
    owner:
      "shared-display: facilitator opens and revokes a privacy-safe shared display",
    postcondition: "A scoped read-only display link is issued.",
  },
  {
    id: "flagship-reset-request",
    kind: "button",
    name: "Reset staged demo",
    enabled: true,
    state: "workspace-shell",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition: "The destructive reset confirmation is shown.",
  },
  {
    id: "flagship-back-to-meetings",
    kind: "button",
    name: "← Meetings",
    enabled: true,
    state: "workspace-shell",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition: "The seeded Flagship meeting card is visible again.",
  },
  {
    id: "flagship-reset-confirm",
    kind: "button",
    name: "Confirm meeting reset",
    enabled: true,
    state: "reset-confirmation",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition:
      "Only the staged meeting is cleared and synthetic Context is restored.",
  },
  {
    id: "flagship-reset-cancel",
    kind: "button",
    name: "Cancel",
    enabled: true,
    state: "reset-confirmation",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition:
      "The reset confirmation closes without changing meeting state.",
  },
  {
    id: "display-open",
    kind: "link",
    name: /^Open display/u,
    enabled: true,
    state: "display-active",
    owner:
      "shared-display: facilitator opens and revokes a privacy-safe shared display",
    postcondition:
      "Actual link activation opens the scoped read-only display in a new page.",
  },
  {
    id: "display-end-access",
    kind: "button",
    name: "End access",
    enabled: true,
    state: "display-active",
    owner:
      "shared-display: facilitator opens and revokes a privacy-safe shared display",
    postcondition:
      "The display credential is revoked and shared content becomes unavailable.",
  },
  {
    id: "shared-display-source-disclosure",
    kind: "summary",
    name: /^Source ref [^\s]+…$/u,
    enabled: true,
    state: "shared-display",
    owner:
      "shared-display: facilitator opens and revokes a privacy-safe shared display",
    postcondition:
      "The read-only display reveals only its owned source identifier on demand.",
  },
  {
    id: "byok-key-input",
    kind: "input",
    name: "Facilitator BYOK · tab only",
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition: "The standard key can be entered without rendering it back.",
  },
  {
    id: "byok-set-key",
    kind: "button",
    name: "Set key",
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition: "The facilitator lease becomes active.",
  },
  {
    id: "private-realtime-connect",
    kind: "button",
    name: "Connect",
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition: "The private channel reports Connected.",
  },
  {
    id: "shared-realtime-connect",
    kind: "button",
    name: "Connect",
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition: "The shared channel reports Connected.",
  },
  {
    id: "speech-select-private",
    kind: "button",
    name: /Private · owner only/u,
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition:
      "Private is aria-pressed and only the private transcript is visible.",
  },
  {
    id: "speech-select-shared",
    kind: "button",
    name: /Shared · room/u,
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition:
      "Shared is aria-pressed and the shared transcript is visible.",
  },
  {
    id: "push-to-talk-private-disconnected",
    kind: "button",
    name: /Hold to speak privately/u,
    enabled: false,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition:
      "Voice remains disabled while its Realtime channel is disconnected.",
  },
  {
    id: "manual-text-input",
    kind: "textarea",
    name: "Equivalent text command",
    enabled: true,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition:
      "The entered text is sent through the selected immutable channel.",
  },
  {
    id: "manual-text-send-empty",
    kind: "button",
    name: /Send privately/u,
    enabled: false,
    state: "workspace-shell",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition: "An empty text command cannot be sent.",
  },
  {
    id: "byok-remove-key",
    kind: "button",
    name: "Remove key",
    enabled: true,
    state: "realtime-key-active",
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels",
    postcondition:
      "The tab-scoped key lease is removed and the key form returns.",
  },
  {
    id: "realtime-cancel",
    kind: "button",
    name: "Cancel",
    enabled: true,
    state: "realtime-connecting",
    owner:
      "realtime-channels: Cancel cleans a held connection attempt and stops reconnecting",
    postcondition:
      "The pending or reconnecting attempt returns to Off and late resources are closed.",
  },
  ...(["private", "shared"] as const).map((channel) => ({
    id: `${channel}-realtime-disconnect`,
    kind: "button" as const,
    name: "Disconnect",
    enabled: true,
    state: "realtime-connected" as const,
    owner:
      "realtime-channels: facilitator secures BYOK and connects isolated private/shared WebRTC channels" as const,
    postcondition: `The ${channel} Realtime channel returns to Off without changing durable text.`,
  })),
  {
    id: "realtime-try-again",
    kind: "button",
    name: "Try again",
    enabled: true,
    state: "realtime-fallback",
    owner:
      "realtime-channels: server-owned access switches the browser to a credential-free managed call",
    postcondition:
      "One deliberate retry reconnects after the staged failure while text remains available.",
  },
  {
    id: "projection-retry",
    kind: "button",
    name: "Retry meeting state",
    enabled: true,
    state: "projection-paused",
    owner:
      "realtime-channels: Cloudflare 1102 pauses projection polling until one manual retry recovers",
    postcondition:
      "One manual projection request resumes polling after the non-retryable pause.",
  },
  {
    id: "judge-usage-refresh",
    kind: "button",
    name: "Refresh",
    enabled: true,
    state: "judge-usage-ready",
    owner:
      "realtime-channels: server-owned access switches the browser to a credential-free managed call",
    postcondition: "The content-free judge cost summary is requested again.",
  },
  {
    id: "judge-usage-retry",
    kind: "button",
    name: "Retry usage check",
    enabled: true,
    state: "judge-usage-unavailable",
    owner:
      "realtime-channels: server-owned access switches the browser to a credential-free managed call",
    postcondition:
      "The unavailable usage meter performs one deliberate recovery request.",
  },
  {
    id: "judge-byok-input",
    kind: "input",
    name: "Optional judge BYOK · tab only",
    enabled: true,
    state: "judge-byok",
    owner:
      "realtime-channels: server-owned access switches the browser to a credential-free managed call",
    postcondition:
      "A judge can enter a standard provider key without rendering it back.",
  },
  {
    id: "judge-byok-use-key",
    kind: "button",
    name: "Use my key",
    enabled: true,
    state: "judge-byok",
    owner:
      "realtime-channels: server-owned access switches the browser to a credential-free managed call",
    postcondition:
      "The judge switches from managed access to an owner-controlled tab-only key.",
  },
  {
    id: "manual-private-send",
    kind: "button",
    name: /Send privately/u,
    enabled: true,
    state: "manual-private-ready",
    owner:
      "realtime-channels: Shared to Private selector keeps owner-private text out of the room transcript",
    postcondition:
      "The private command appears only in the owner-private transcript.",
  },
  {
    id: "push-to-talk-private-ready",
    kind: "button",
    name: /Hold to speak privately/u,
    enabled: true,
    state: "manual-private-ready",
    owner:
      "realtime-channels: private/shared text and push-to-talk use one immutable, floor-gated command path",
    postcondition:
      "Holding the control captures one synthetic owner-private utterance.",
  },
  {
    id: "manual-shared-send",
    kind: "button",
    name: /Send to room/u,
    enabled: true,
    state: "manual-shared-ready",
    owner:
      "realtime-channels: private/shared text and push-to-talk use one immutable, floor-gated command path",
    postcondition: "The shared command appears in the room transcript.",
  },
  {
    id: "push-to-talk-shared-ready",
    kind: "button",
    name: /Hold to speak to room/u,
    enabled: true,
    state: "manual-shared-ready",
    owner:
      "realtime-channels: private/shared text and push-to-talk use one immutable, floor-gated command path",
    postcondition:
      "Holding the control acquires the floor and records one synthetic room utterance.",
  },
  {
    id: "staged-private-note",
    kind: "textarea",
    name: "Staged private note",
    enabled: false,
    state: "workspace-shell",
    owner: "flagship-control-inventory: traverses seeded Flagship states",
    postcondition: "The synthetic source note is read-only.",
  },
  {
    id: "exact-excerpt-input",
    kind: "textarea",
    name: "Exact excerpt to preview",
    enabled: true,
    state: "context",
    owner:
      "decision-commit: edited exact excerpt is the only private span disclosed",
    postcondition: "The outgoing preview contains exactly the edited excerpt.",
  },
  {
    id: "prepare-grounded-preview",
    kind: "button",
    name: "Prepare grounded sharing preview",
    enabled: true,
    state: "context",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition: "The exact outgoing payload preview becomes visible.",
  },
  {
    id: "exact-excerpt-locked-preview",
    kind: "textarea",
    name: "Exact excerpt to preview",
    enabled: false,
    state: "permission-preview",
    owner: "flagship-control-inventory: traverses seeded Flagship states",
    postcondition: "The reviewed exact excerpt is immutable during approval.",
  },
  {
    id: "approve-exact-excerpt",
    kind: "button",
    name: /Approve exact excerpt/u,
    enabled: true,
    state: "permission-preview",
    owner:
      "guided-flagship: facilitator can reset the guided flagship while participants cannot",
    postcondition:
      "Only the exact previewed excerpt appears in shared evidence.",
  },
  {
    id: "keep-excerpt-private",
    kind: "button",
    name: "Keep private",
    enabled: true,
    state: "permission-preview",
    owner:
      "decision-commit: edited exact excerpt is the only private span disclosed",
    postcondition: "The preview closes and no evidence is published.",
  },
  {
    id: "exact-excerpt-locked-shared",
    kind: "textarea",
    name: "Exact excerpt to preview",
    enabled: false,
    state: "approved-context",
    owner: "flagship-control-inventory: traverses seeded Flagship states",
    postcondition: "The approved excerpt remains immutable after sharing.",
  },
  {
    id: "shared-source-reference",
    kind: "summary",
    name: /^Source ref [^\s]+…$/u,
    enabled: true,
    state: "approved-context",
    owner:
      "shared-display: facilitator opens and revokes a privacy-safe shared display",
    postcondition: "The exact source identifier is disclosed only on demand.",
  },
  {
    id: "shared-evidence-reference",
    kind: "summary",
    name: "Evidence reference",
    enabled: true,
    state: "approved-context",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The approved Evidence identifier is disclosed on demand.",
  },
  {
    id: "generate-decision-candidate",
    kind: "button",
    name: "Generate Decision candidate",
    enabled: true,
    state: "commitment-idle",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "A grounded editable candidate workbench is rendered.",
  },
  {
    id: "candidate-technical-provenance",
    kind: "summary",
    name: "Technical provenance",
    enabled: true,
    state: "candidate-surface",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "Model and source details are disclosed separately from human-facing prose.",
  },
  {
    id: "candidate-title",
    kind: "input",
    name: "Decision title",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The edited title persists into the Decision draft.",
  },
  {
    id: "candidate-outcome",
    kind: "textarea",
    name: "Outcome",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The edited outcome persists into the Decision draft.",
  },
  {
    id: "candidate-premise",
    kind: "textarea",
    name: /^Candidate premise/u,
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The edited premise is explicitly confirmed before publication.",
  },
  {
    id: "candidate-evidence-reference",
    kind: "summary",
    name: "Evidence reference",
    enabled: true,
    state: "candidate-surface",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The candidate premise provenance can be expanded without exposing it by default.",
  },
  {
    id: "candidate-retained-dissent",
    kind: "textarea",
    name: "Retained dissent",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The user's dissent edit persists into the committed Decision.",
  },
  {
    id: "candidate-bounded-action",
    kind: "textarea",
    name: "Bounded Action",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The user's bounded Action edit persists into the committed Decision.",
  },
  {
    id: "candidate-monitor-condition",
    kind: "textarea",
    name: "Monitor condition",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The user's monitor-condition edit persists into monitoring.",
  },
  {
    id: "candidate-confirm-premise",
    kind: "button",
    name: /^Confirm(?: edited)? premise$/u,
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The canonical premise, dissent, and Action are recorded.",
  },
  {
    id: "candidate-reject-premise",
    kind: "button",
    name: "Reject premise",
    enabled: true,
    state: "candidate",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "No linked premise, Action, or Decision is published.",
  },
  {
    id: "readonly-candidate-title",
    kind: "input",
    name: "Decision title",
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The canonical Decision title is read-only after premise disposition.",
  },
  {
    id: "readonly-candidate-outcome",
    kind: "textarea",
    name: "Outcome",
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The canonical Decision outcome is read-only after premise disposition.",
  },
  {
    id: "readonly-candidate-premise",
    kind: "textarea",
    name: /^Candidate premise/u,
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The disposed premise is read-only.",
  },
  {
    id: "readonly-candidate-dissent",
    kind: "textarea",
    name: "Retained dissent",
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "Retained dissent is read-only after premise disposition.",
  },
  {
    id: "readonly-candidate-action",
    kind: "textarea",
    name: "Bounded Action",
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The bounded Action is read-only after premise disposition.",
  },
  {
    id: "readonly-candidate-monitor",
    kind: "textarea",
    name: "Monitor condition",
    enabled: false,
    state: "candidate-readonly",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The monitor condition is read-only after premise disposition.",
  },
  {
    id: "save-decision-draft",
    kind: "button",
    name: "Save Decision draft",
    enabled: true,
    state: "premise-confirmed",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "Immutable Decision revision 1 is created in DRAFT.",
  },
  {
    id: "validate-and-mark-ready",
    kind: "button",
    name: "Validate and mark ready",
    enabled: true,
    state: "decision-draft",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The Decision enters DECISION_READY without committing itself.",
  },
  {
    id: "commit-decision",
    kind: "button",
    name: "Commit Decision",
    enabled: true,
    state: "decision-ready",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "A new immutable COMMITTED revision is appended by the facilitator.",
  },
  {
    id: "prepare-decision-json-export",
    kind: "button",
    name: "Prepare Decision JSON export",
    enabled: true,
    state: "decision-export",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "A Decision JSON download link is prepared from current history and audit data.",
  },
  {
    id: "download-decision-json",
    kind: "link",
    name: /^Download JSON · \d+ revisions? · \d+ audit entries?$/u,
    enabled: true,
    state: "decision-export-ready",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "A JSON download event yields the named, parseable Decision export.",
  },
  {
    id: "start-decision-monitor",
    kind: "button",
    name: "Start Decision monitor",
    enabled: true,
    state: "decision-committed",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "A monitor registration is created and Monitoring becomes active.",
  },
  {
    id: "inject-staged-regulatory-event",
    kind: "button",
    name: "Inject staged regulatory event",
    enabled: true,
    state: "monitoring",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "A synthetic external event is recorded and the Decision becomes AT_RISK.",
  },
  {
    id: "invalidation-technical-references",
    kind: "summary",
    name: "Technical references",
    enabled: true,
    state: "invalidation-surface",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "Affected premise and Action identifiers are disclosed on demand.",
  },
  ...(["premise", "evidence", "action"] as const).map((reference) => ({
    id: `review-${reference}-technical-reference`,
    kind: "summary" as const,
    name: "Technical reference",
    enabled: true,
    state: "invalidation-surface" as const,
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit" as const,
    postcondition: `The ${reference} identifier is disclosed only on demand.`,
  })),
  {
    id: "facilitator-review-reason",
    kind: "textarea",
    name: "Facilitator review reason",
    enabled: true,
    state: "at-risk",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The human review reason is recorded with the disposition.",
  },
  {
    id: "confirm-invalidation-impact",
    kind: "button",
    name: "Confirm impact and open review",
    enabled: true,
    state: "at-risk",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The Decision enters REVIEW_REQUIRED with human confirmation.",
  },
  {
    id: "reject-invalidation-suggestion",
    kind: "button",
    name: /^Reject (?:AI suggestion|invalidation suggestion)$/u,
    enabled: true,
    state: "at-risk",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The suggestion is rejected and monitoring resumes.",
  },
  {
    id: "resolution-prepare-decision-json-export",
    kind: "button",
    name: "Prepare Decision JSON export",
    enabled: true,
    state: "resolution",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The terminal resolution prepares the current Decision JSON export.",
  },
  {
    id: "resolution-download-decision-json",
    kind: "link",
    name: /^Download JSON · \d+ revisions? · \d+ audit entries?$/u,
    enabled: true,
    state: "resolution",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The terminal resolution exposes a named, parseable JSON download.",
  },
  {
    id: "resolution-revise",
    kind: "radio",
    name: /^Commit revised Decision/u,
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The revise branch is selected and exposes revision fields.",
  },
  {
    id: "resolution-supersede",
    kind: "radio",
    name: /^Replace this Decision/u,
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The supersede branch is selected and exposes replacement fields.",
  },
  {
    id: "resolution-close",
    kind: "radio",
    name: /^Close without replacement/u,
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The close branch is selected and exposes the terminal reason field.",
  },
  {
    id: "resolution-revised-title",
    kind: "input",
    name: "Revised Decision title",
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The revised title is included in the next immutable revision.",
  },
  {
    id: "resolution-revised-outcome",
    kind: "textarea",
    name: "Revised outcome",
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The revised outcome is included in the next immutable revision.",
  },
  {
    id: "resolution-revised-monitor",
    kind: "textarea",
    name: "Revised monitor condition",
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition:
      "The revised monitor condition is included in the next immutable revision.",
  },
  {
    id: "resolution-change-reason",
    kind: "textarea",
    name: "Revision change reason",
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The human revision reason is appended to audit history.",
  },
  {
    id: "resolution-commit-revision",
    kind: "button",
    name: /^Commit revision \d+$/u,
    enabled: true,
    state: "review-required",
    owner:
      "decision-commit: facilitator commits a grounded Decision that participants can revisit",
    postcondition: "The next immutable COMMITTED revision is appended.",
  },
] as const satisfies readonly FlagshipControlInventoryEntry[];

export function controlNameMatches(
  expected: string | RegExp,
  actual: string,
): boolean {
  if (typeof expected === "string") {
    return expected === actual;
  }
  expected.lastIndex = 0;
  return expected.test(actual);
}
