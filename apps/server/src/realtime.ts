import { createHash } from "node:crypto";

import type { DomainEvent } from "@counterpoint/domain";
import type {
  AppendEventsRequest,
  Clock,
  EventStore,
  IdGenerator,
} from "@counterpoint/ports";
import {
  ApplicationRealtimeMessageSchema,
  type ApplicationRealtimeMessage,
  type RealtimeRoleProjection,
} from "@counterpoint/protocol";

export const REALTIME_TICKET_TTL_MS = 30_000;

export interface RealtimeTicketRecord {
  readonly correlationId: string;
  readonly expiresAt: string;
  readonly lastSeenPosition: number;
  readonly meetingId: string;
  readonly participantId: string;
  readonly role: "facilitator" | "participant";
  readonly sessionId: string;
  readonly ticket: string;
  readonly userId: string;
}

type StoredRealtimeTicket = Omit<RealtimeTicketRecord, "ticket">;

export interface ProjectionPublication {
  readonly correlationId: string;
  readonly meetingId: string;
  readonly sourcePosition: number;
  readonly visibility:
    | { readonly kind: "shared" }
    | {
        readonly kind: "owner_private";
        readonly ownerParticipantId: string;
      };
}

interface RealtimeSubscriber {
  readonly close: (code: number, reason: string) => void;
  readonly id: string;
  readonly meetingId: string;
  readonly participantId: string;
  position: number;
  readonly revalidate: () => Promise<boolean>;
  readonly sessionId: string;
  readonly send: (message: ApplicationRealtimeMessage) => void;
  readonly snapshot: (
    correlationId: string,
  ) => Promise<RealtimeRoleProjection | undefined>;
}

function timestampMs(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Clock returned a non-ISO timestamp");
  }
  return milliseconds;
}

function visibleTo(
  publication: ProjectionPublication,
  participantId: string,
): boolean {
  return (
    publication.visibility.kind === "shared" ||
    publication.visibility.ownerParticipantId === participantId
  );
}

export class NodeMeetingRealtimeHub {
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #meetingQueues = new Map<string, Promise<void>>();
  readonly #subscribers = new Map<string, RealtimeSubscriber>();
  readonly #tickets = new Map<string, StoredRealtimeTicket>();

  constructor(clock: Clock, ids: IdGenerator) {
    this.#clock = clock;
    this.#ids = ids;
  }

  issueTicket(
    input: Omit<RealtimeTicketRecord, "expiresAt" | "ticket">,
  ): RealtimeTicketRecord {
    this.#pruneExpiredTickets();
    const ticket = this.#ids.next("realtime-ticket");
    const expiresAt = new Date(
      timestampMs(this.#clock.now()) + REALTIME_TICKET_TTL_MS,
    ).toISOString();
    const record = { ...input, expiresAt };
    this.#tickets.set(this.#ticketDigest(ticket), record);
    return { ...record, ticket };
  }

  consumeTicket(ticket: string): RealtimeTicketRecord | undefined {
    this.#pruneExpiredTickets();
    const digest = this.#ticketDigest(ticket);
    const record = this.#tickets.get(digest);
    if (record !== undefined) {
      this.#tickets.delete(digest);
    }
    return record === undefined ? undefined : { ...record, ticket };
  }

  async subscribe(input: {
    readonly close: RealtimeSubscriber["close"];
    readonly currentPosition: number;
    readonly revalidate: RealtimeSubscriber["revalidate"];
    readonly send: RealtimeSubscriber["send"];
    readonly snapshot: RealtimeSubscriber["snapshot"];
    readonly ticket: RealtimeTicketRecord;
  }): Promise<() => void> {
    const id = this.#ids.next("realtime-connection");
    const subscriber: RealtimeSubscriber = {
      close: input.close,
      id,
      meetingId: input.ticket.meetingId,
      participantId: input.ticket.participantId,
      position: input.ticket.lastSeenPosition,
      revalidate: input.revalidate,
      sessionId: input.ticket.sessionId,
      send: input.send,
      snapshot: input.snapshot,
    };
    await this.#enqueue(input.ticket.meetingId, async () => {
      this.#subscribers.set(id, subscriber);
      if (input.ticket.lastSeenPosition < input.currentPosition) {
        await this.#sendProjection(subscriber, input.ticket.correlationId);
      }
      this.#send(subscriber, {
        correlationId: input.ticket.correlationId,
        meetingId: input.ticket.meetingId,
        payload: {},
        position: subscriber.position,
        schemaVersion: "1",
        type: "connection.ready",
        visibility: {
          kind: "owner_private",
          ownerParticipantId: input.ticket.participantId,
        },
      });
    });
    return () => {
      this.#subscribers.delete(id);
    };
  }

  async publish(publications: readonly ProjectionPublication[]): Promise<void> {
    if (publications.length === 0) {
      return;
    }
    const byMeeting = Map.groupBy(
      publications,
      (publication) => publication.meetingId,
    );
    await Promise.all(
      [...byMeeting].map(([meetingScope, meetingPublications]) =>
        this.#enqueue(meetingScope, async () => {
          const subscribers = [...this.#subscribers.values()].filter(
            ({ meetingId }) => meetingId === meetingScope,
          );
          await Promise.all(
            subscribers.map(async (subscriber) => {
              try {
                const visible = meetingPublications.filter((publication) =>
                  visibleTo(publication, subscriber.participantId),
                );
                if (visible.length === 0) {
                  return;
                }
                if (!(await subscriber.revalidate())) {
                  this.#subscribers.delete(subscriber.id);
                  subscriber.close(4401, "Session or meeting access expired");
                  return;
                }
                await this.#sendProjection(
                  subscriber,
                  String(visible.at(-1)?.correlationId),
                );
              } catch {
                this.#subscribers.delete(subscriber.id);
                subscriber.close(1011, "Realtime revalidation failed");
              }
            }),
          );
        }),
      ),
    );
  }

  closeSession(sessionId: string): void {
    for (const subscriber of this.#subscribers.values()) {
      if (subscriber.sessionId === sessionId) {
        this.#subscribers.delete(subscriber.id);
        subscriber.close(4401, "Session ended");
      }
    }
    for (const [ticket, record] of this.#tickets) {
      if (record.sessionId === sessionId) {
        this.#tickets.delete(ticket);
      }
    }
  }

  close(): void {
    for (const subscriber of this.#subscribers.values()) {
      subscriber.close(1012, "Server shutting down");
    }
    this.#subscribers.clear();
    this.#tickets.clear();
  }

  #pruneExpiredTickets(): void {
    const now = timestampMs(this.#clock.now());
    for (const [ticket, record] of this.#tickets) {
      if (timestampMs(record.expiresAt) <= now) {
        this.#tickets.delete(ticket);
      }
    }
  }

  #enqueue(meetingId: string, task: () => Promise<void>): Promise<void> {
    const prior = this.#meetingQueues.get(meetingId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(task);
    this.#meetingQueues.set(meetingId, next);
    return next.finally(() => {
      if (this.#meetingQueues.get(meetingId) === next) {
        this.#meetingQueues.delete(meetingId);
      }
    });
  }

  #send(subscriber: RealtimeSubscriber, message: unknown): boolean {
    try {
      subscriber.send(ApplicationRealtimeMessageSchema.parse(message));
      return true;
    } catch {
      this.#subscribers.delete(subscriber.id);
      subscriber.close(1011, "Realtime publication failed");
      return false;
    }
  }

  async #sendProjection(
    subscriber: RealtimeSubscriber,
    correlationId: string,
  ): Promise<void> {
    try {
      const projection = await subscriber.snapshot(correlationId);
      if (projection === undefined) {
        this.#subscribers.delete(subscriber.id);
        subscriber.close(4403, "Meeting access unavailable");
        return;
      }
      if (projection.shared.position <= subscriber.position) {
        return;
      }
      const sent = this.#send(subscriber, {
        correlationId,
        meetingId: subscriber.meetingId,
        payload: projection,
        position: projection.shared.position,
        schemaVersion: "1",
        type: "role_projection.updated",
        visibility: {
          kind: "owner_private",
          ownerParticipantId: subscriber.participantId,
        },
      });
      if (sent) {
        subscriber.position = projection.shared.position;
      }
    } catch {
      this.#subscribers.delete(subscriber.id);
      subscriber.close(1011, "Realtime projection failed");
    }
  }

  #ticketDigest(ticket: string): string {
    return createHash("sha256").update(ticket, "utf8").digest("base64url");
  }
}

export class RealtimeNotifyingEventStore<
  TEvent extends DomainEvent,
> implements EventStore<TEvent> {
  readonly #delegate: EventStore<TEvent>;
  readonly #publish: (
    publications: readonly ProjectionPublication[],
  ) => Promise<void>;

  constructor(
    delegate: EventStore<TEvent>,
    publish: (publications: readonly ProjectionPublication[]) => Promise<void>,
  ) {
    this.#delegate = delegate;
    this.#publish = publish;
  }

  async append(request: AppendEventsRequest<TEvent>) {
    const result = await this.#delegate.append(request);
    if (result.kind === "appended") {
      const publications = result.records.map(({ event, position }) => ({
        correlationId: String(event.correlationId),
        meetingId: String(event.meetingId),
        sourcePosition: position,
        visibility:
          event.visibility === "shared"
            ? ({ kind: "shared" } as const)
            : ({
                kind: "owner_private",
                ownerParticipantId: String(event.ownerParticipantId),
              } as const),
      }));
      void this.#publish(publications).catch(() => undefined);
    }
    return result;
  }

  load(
    meetingId: string,
    options?: { readonly afterPosition?: number },
  ): ReturnType<EventStore<TEvent>["load"]> {
    return this.#delegate.load(meetingId, options);
  }

  position(meetingId: string): ReturnType<EventStore<TEvent>["position"]> {
    return this.#delegate.position(meetingId);
  }
}
