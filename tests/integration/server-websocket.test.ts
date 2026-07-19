import { mkdtemp, rm } from "node:fs/promises";
import type { ServerType, WebSocketServerLike } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalServerRuntime,
  createServerApp,
  readServerConfiguration,
  type LocalServerRuntime,
} from "../../apps/server/src/index.js";
import {
  ApplicationRealtimeMessageSchema,
  ApproveDisclosureResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RealtimeTicketResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  type ApplicationRealtimeMessage,
  type LoginResponse,
  type PreviewDisclosureResponse,
} from "@counterpoint/protocol";
import type { ZodType } from "zod";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";

const MEETING_ID = "meeting-global-ai-rollout";
const activeFixtures: ServerFixture[] = [];

class RealtimeMessageTimeoutError extends Error {}

class RealtimeInbox {
  readonly #messages: ApplicationRealtimeMessage[] = [];
  readonly #waiters: {
    reject: (error: unknown) => void;
    resolve: (message: ApplicationRealtimeMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  #parseError: Error | undefined;

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      try {
        const message = ApplicationRealtimeMessageSchema.parse(
          JSON.parse(rawDataText(data)),
        );
        const waiter = this.#waiters.shift();
        if (waiter === undefined) {
          this.#messages.push(message);
          return;
        }
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } catch (error) {
        const parseError =
          error instanceof Error
            ? error
            : new Error("Realtime message parsing failed", { cause: error });
        this.#parseError = parseError;
        for (const waiter of this.#waiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.reject(parseError);
        }
      }
    });
  }

  next(timeoutMs = 2_000): Promise<ApplicationRealtimeMessage> {
    if (this.#parseError !== undefined) {
      return Promise.reject(this.#parseError);
    }
    const message = this.#messages.shift();
    if (message !== undefined) {
      return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        reject,
        resolve,
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) {
            this.#waiters.splice(index, 1);
          }
          reject(new RealtimeMessageTimeoutError("Realtime message timed out"));
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString("utf8");
  }
  return data.toString("utf8");
}

interface SocketConnection {
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly inbox: RealtimeInbox;
  readonly opened: Promise<void>;
  readonly socket: WebSocket;
  readonly upgraded: Promise<number | undefined>;
}

interface ServerFixture {
  readonly httpOrigin: string;
  readonly runtime: LocalServerRuntime;
  readonly server: ServerType;
  readonly sockets: Set<WebSocket>;
  readonly temporaryDirectory: string;
  readonly websocketOrigin: string;
  readonly websocketServer: WebSocketServer;
  close(): Promise<void>;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 500);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "Test complete");
    } else {
      socket.terminate();
    }
  });
}

async function startFixture(): Promise<ServerFixture> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "counterpoint-server-websocket-"),
  );
  const runtime = await createLocalServerRuntime(
    readServerConfiguration({
      DATABASE_PATH: join(temporaryDirectory, "counterpoint.sqlite"),
      OPENAI_API_KEY: "",
      PORT: "8787",
      STORAGE_PATH: join(temporaryDirectory, "artifacts"),
    }),
  );
  const websocketServer = new WebSocketServer({
    noServer: true,
  });
  let server: ServerType | undefined;
  try {
    const app = createServerApp(runtime);
    const listening = new Promise<number>((resolve, reject) => {
      server = serve(
        {
          fetch: app.fetch,
          hostname: "0.0.0.0",
          port: 0,
          websocket: {
            server: websocketServer as unknown as WebSocketServerLike,
          },
        },
        ({ port }) => resolve(port),
      );
      server.once("error", reject);
    });
    const port = await listening;
    if (server === undefined) {
      throw new Error("Node server did not start");
    }
    const sockets = new Set<WebSocket>();
    let closed = false;
    const fixture: ServerFixture = {
      httpOrigin: `http://127.0.0.1:${String(port)}`,
      runtime,
      server,
      sockets,
      temporaryDirectory,
      websocketOrigin: `ws://127.0.0.1:${String(port)}`,
      websocketServer,
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        await Promise.all([...sockets].map((socket) => closeSocket(socket)));
        const websocketClosed = new Promise<void>((resolve) => {
          websocketServer.once("close", resolve);
        });
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error === undefined) {
              resolve();
            } else {
              reject(error);
            }
          });
        });
        await websocketClosed;
        runtime.close();
        await rm(temporaryDirectory, { force: true, recursive: true });
      },
    };
    activeFixtures.push(fixture);
    return fixture;
  } catch (error) {
    server?.close();
    websocketServer.close();
    runtime.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function jsonRequest<T>(
  fixture: ServerFixture,
  path: string,
  input: unknown,
  schema: ZodType<T>,
  expectedStatus: number,
  bearerToken?: string,
): Promise<T> {
  const response = await fetch(`${fixture.httpOrigin}${path}`, {
    body: JSON.stringify(input),
    headers: {
      ...(bearerToken === undefined
        ? {}
        : { authorization: `Bearer ${bearerToken}` }),
      "content-type": "application/json",
    },
    method: "POST",
  });
  expect(response.status).toBe(expectedStatus);
  return schema.parse(await response.json());
}

function login(
  fixture: ServerFixture,
  userId: "legal" | "product" | "safety",
): Promise<LoginResponse> {
  return jsonRequest(
    fixture,
    "/api/v1/login",
    {
      password: `counterpoint-${userId}`,
      userId,
    },
    LoginResponseSchema,
    200,
  );
}

function issueTicket(
  fixture: ServerFixture,
  bearerToken: string,
  lastSeenPosition: number,
) {
  return jsonRequest(
    fixture,
    `/api/v1/meetings/${MEETING_ID}/realtime/tickets`,
    {
      lastSeenPosition,
      meetingId: MEETING_ID,
    },
    RealtimeTicketResponseSchema,
    201,
    bearerToken,
  );
}

function connect(fixture: ServerFixture, ticket: string): SocketConnection {
  const socket = new WebSocket(
    `${fixture.websocketOrigin}/api/v1/realtime?ticket=${encodeURIComponent(ticket)}`,
  );
  const inbox = new RealtimeInbox(socket);
  fixture.sockets.add(socket);
  socket.on("error", () => undefined);
  socket.once("close", () => fixture.sockets.delete(socket));
  return {
    closed: new Promise((resolve) => {
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      );
    }),
    inbox,
    opened: new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    socket,
    upgraded: new Promise((resolve, reject) => {
      socket.once("upgrade", (response) => resolve(response.statusCode));
      socket.once("error", reject);
    }),
  };
}

async function expectNoMessage(
  inbox: RealtimeInbox,
  timeoutMs = 150,
): Promise<void> {
  try {
    const message = await inbox.next(timeoutMs);
    throw new Error(`Unexpected realtime message: ${message.type}`);
  } catch (error) {
    if (error instanceof RealtimeMessageTimeoutError) {
      return;
    }
    throw error;
  }
}

async function registerPrivateSource(
  fixture: ServerFixture,
  session: LoginResponse,
  key: string,
  text: string,
) {
  return jsonRequest(
    fixture,
    "/api/v1/disclosures/sources/text",
    {
      expectedPosition: 0,
      idempotencyKey: `${key}-register`,
      meetingId: MEETING_ID,
      text,
      title: "Synthetic realtime source",
    },
    RegisterPrivateTextSourceFixtureResponseSchema,
    201,
    session.bearerToken,
  );
}

async function prepareDisclosure(
  fixture: ServerFixture,
  session: LoginResponse,
  key: string,
  text: string,
  exactSnippet: string,
): Promise<PreviewDisclosureResponse> {
  const registered = await registerPrivateSource(fixture, session, key, text);
  const start = text.indexOf(exactSnippet);
  expect(start).toBeGreaterThanOrEqual(0);
  const sourceRange = {
    end: start + exactSnippet.length,
    start,
  };
  const proposed = await jsonRequest(
    fixture,
    "/api/v1/disclosures/proposals",
    {
      assistance: "manual",
      exactSnippet,
      expectedPosition: registered.position,
      idempotencyKey: `${key}-propose`,
      meetingId: MEETING_ID,
      sourceArtifactId: registered.source.sourceArtifactId,
      sourceRange,
    },
    ProposeDisclosureResponseSchema,
    201,
    session.bearerToken,
  );
  return jsonRequest(
    fixture,
    "/api/v1/disclosures/preview",
    {
      candidateId: proposed.candidate.candidateId,
      exactSnippet,
      expectedPosition: proposed.position,
      idempotencyKey: `${key}-preview`,
      meetingId: MEETING_ID,
      sourceRange,
    },
    PreviewDisclosureResponseSchema,
    200,
    session.bearerToken,
  );
}

function approveDisclosure(
  fixture: ServerFixture,
  session: LoginResponse,
  key: string,
  preview: PreviewDisclosureResponse,
) {
  return jsonRequest(
    fixture,
    "/api/v1/disclosures/approve",
    {
      candidateId: preview.candidateId,
      expectedPosition: preview.position,
      idempotencyKey: `${key}-approve`,
      meetingId: MEETING_ID,
      previewHash: preview.previewHash,
    },
    ApproveDisclosureResponseSchema,
    200,
    session.bearerToken,
  );
}

afterEach(async () => {
  for (const fixture of activeFixtures.splice(0)) {
    await fixture.close();
  }
});

describe("Node server WebSocket integration", () => {
  it("performs a real 101 handshake and resumes an owner projection from position zero", async () => {
    const fixture = await startFixture();
    const safety = await login(fixture, "safety");
    const privateText =
      "Synthetic owner note: stage the rollout behind a reversible gate.";
    const registered = await registerPrivateSource(
      fixture,
      safety,
      "resume-owner-source",
      privateText,
    );
    const ticket = await issueTicket(fixture, safety.bearerToken, 0);
    const connection = connect(fixture, ticket.ticket);

    await expect(connection.upgraded).resolves.toBe(101);
    await connection.opened;
    const resumedMessages = await Promise.all([
      connection.inbox.next(),
      connection.inbox.next(),
    ]);
    expect(
      resumedMessages.find(({ type }) => type === "connection.ready"),
    ).toMatchObject({
      meetingId: MEETING_ID,
      position: 1,
      type: "connection.ready",
    });
    const resumed = resumedMessages.find(
      ({ type }) => type === "role_projection.updated",
    );
    if (resumed?.type !== "role_projection.updated") {
      throw new Error("Resume projection was not published");
    }
    expect(resumed).toMatchObject({
      meetingId: MEETING_ID,
      position: 1,
      type: "role_projection.updated",
    });
    expect(resumed.payload.privateWorkspace.sources).toEqual([
      expect.objectContaining({
        sourceArtifactId: registered.source.sourceArtifactId,
      }),
    ]);
  });

  it("withholds Product-private updates from Legal but publishes the later shared approval", async () => {
    const fixture = await startFixture();
    const product = await login(fixture, "product");
    const legal = await login(fixture, "legal");
    const ticket = await issueTicket(fixture, legal.bearerToken, 0);
    const connection = connect(fixture, ticket.ticket);
    await connection.opened;
    await expect(connection.inbox.next()).resolves.toMatchObject({
      position: 0,
      type: "connection.ready",
    });

    const fullText =
      "Synthetic Product-only context. Shareable approval requires a staged review gate. Product-only ending.";
    const exactSnippet = "Shareable approval requires a staged review gate.";
    const registered = await registerPrivateSource(
      fixture,
      product,
      "product-private-to-shared",
      fullText,
    );
    await expectNoMessage(connection.inbox);

    const start = fullText.indexOf(exactSnippet);
    const sourceRange = { end: start + exactSnippet.length, start };
    const proposed = await jsonRequest(
      fixture,
      "/api/v1/disclosures/proposals",
      {
        assistance: "manual",
        exactSnippet,
        expectedPosition: registered.position,
        idempotencyKey: "product-private-to-shared-propose",
        meetingId: MEETING_ID,
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange,
      },
      ProposeDisclosureResponseSchema,
      201,
      product.bearerToken,
    );
    const preview = await jsonRequest(
      fixture,
      "/api/v1/disclosures/preview",
      {
        candidateId: proposed.candidate.candidateId,
        exactSnippet,
        expectedPosition: proposed.position,
        idempotencyKey: "product-private-to-shared-preview",
        meetingId: MEETING_ID,
        sourceRange,
      },
      PreviewDisclosureResponseSchema,
      200,
      product.bearerToken,
    );
    await expectNoMessage(connection.inbox);

    await approveDisclosure(
      fixture,
      product,
      "product-private-to-shared",
      preview,
    );
    const sharedUpdate = await connection.inbox.next();
    expect(sharedUpdate).toMatchObject({
      meetingId: MEETING_ID,
      position: 1,
      type: "role_projection.updated",
    });
    expect(
      sharedUpdate.type === "role_projection.updated"
        ? sharedUpdate.payload.shared.evidence
        : [],
    ).toEqual([
      expect.objectContaining({
        exactSnippet,
      }),
    ]);
    expect(JSON.stringify(sharedUpdate)).not.toContain(
      "Synthetic Product-only context",
    );
    expect(JSON.stringify(sharedUpdate)).not.toContain("Product-only ending");
  });

  it("consumes a realtime ticket once and closes an invalid reuse with 4401", async () => {
    const fixture = await startFixture();
    const legal = await login(fixture, "legal");
    const ticket = await issueTicket(fixture, legal.bearerToken, 0);
    const first = connect(fixture, ticket.ticket);
    await first.opened;
    await expect(first.inbox.next()).resolves.toMatchObject({
      type: "connection.ready",
    });

    const reused = connect(fixture, ticket.ticket);
    await expect(reused.upgraded).resolves.toBe(101);
    await reused.opened;
    await expect(reused.closed).resolves.toEqual({
      code: 4401,
      reason: "Invalid or expired realtime ticket",
    });
  });

  it("logout closes the active socket and blocks later publication and ticket use", async () => {
    const fixture = await startFixture();
    const product = await login(fixture, "product");
    const legal = await login(fixture, "legal");
    const exactSnippet =
      "Synthetic shared approval follows a logged-out subscriber.";
    const preview = await prepareDisclosure(
      fixture,
      legal,
      "logout-publication-control",
      `Legal-only lead. ${exactSnippet} Legal-only tail.`,
      exactSnippet,
    );
    const activeTicket = await issueTicket(fixture, product.bearerToken, 0);
    const unusedTicket = await issueTicket(fixture, product.bearerToken, 0);
    const active = connect(fixture, activeTicket.ticket);
    await active.opened;
    await expect(active.inbox.next()).resolves.toMatchObject({
      position: 0,
      type: "connection.ready",
    });

    await jsonRequest(
      fixture,
      "/api/v1/logout",
      {},
      LogoutResponseSchema,
      200,
      product.bearerToken,
    );
    await expect(active.closed).resolves.toEqual({
      code: 4401,
      reason: "Session ended",
    });

    await approveDisclosure(
      fixture,
      legal,
      "logout-publication-control",
      preview,
    );
    await expectNoMessage(active.inbox);

    const revoked = connect(fixture, unusedTicket.ticket);
    await revoked.opened;
    await expect(revoked.closed).resolves.toEqual({
      code: 4401,
      reason: "Invalid or expired realtime ticket",
    });
  });
});
