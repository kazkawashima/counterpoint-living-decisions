import type {
  AppendEventsFailure,
  AppendEventsRequest,
  AppendEventsResult,
  EventStore,
} from "./event-store.js";
import type { ProjectionScope, ProjectionStore } from "./repositories.js";

export type AtomicAppendRequest<TEvent> = Omit<
  AppendEventsRequest<TEvent>,
  "events" | "expectedPosition" | "idempotencyKey"
> & {
  readonly events: readonly [TEvent, ...TEvent[]];
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
};

export interface ProjectionWrite<TProjection> {
  readonly scope: ProjectionScope;
  readonly value: TProjection;
}

export interface EventProjectionCommitRequest<TEvent, TProjection> {
  readonly append: AtomicAppendRequest<TEvent>;
  readonly projections: readonly ProjectionWrite<TProjection>[];
}

export interface EventProjectionStore<TEvent, TProjection>
  extends EventStore<TEvent>, ProjectionStore<TProjection> {
  commit(
    request: EventProjectionCommitRequest<TEvent, TProjection>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>>;
}

export function isEventProjectionStore<TEvent, TProjection>(
  events: EventStore<TEvent>,
  projections: ProjectionStore<TProjection>,
): events is EventProjectionStore<TEvent, TProjection> {
  const candidate: unknown = events;
  return (
    candidate === projections &&
    typeof candidate === "object" &&
    candidate !== null &&
    "commit" in candidate &&
    typeof candidate.commit === "function"
  );
}
