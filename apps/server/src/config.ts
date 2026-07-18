import { isScryptPasswordHash } from "@counterpoint/adapters-node";

export interface DemoUserConfiguration {
  readonly passwordHash: string;
  readonly role: "facilitator" | "participant";
  readonly userId: string;
}

export interface ServerConfiguration {
  readonly databasePath: string;
  readonly demoUsers: readonly DemoUserConfiguration[];
  readonly host: "0.0.0.0";
  readonly openAiConfigured: boolean;
  readonly port: number;
}

const DEFAULT_DEMO_USERS: readonly DemoUserConfiguration[] = [
  {
    passwordHash:
      "scrypt$v1$16384$8$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc",
    role: "facilitator",
    userId: "product",
  },
  {
    passwordHash:
      "scrypt$v1$16384$8$1$mNoCK6EpZlTEErwXPN04ew$k2CJzod-vSBkJOeHfl0DYZRC8JdTUiushgpMmtR99rU",
    role: "participant",
    userId: "safety",
  },
  {
    passwordHash:
      "scrypt$v1$16384$8$1$FbFwb6-avA-vMsmHdMOoIw$i55Hu7ezBsAqgdW97XHwRaSIFRZnJpu7TyP0KDfwe4U",
    role: "participant",
    userId: "legal",
  },
  {
    passwordHash:
      "scrypt$v1$16384$8$1$2EL8CN_i5Ip2bygrRaYeAA$BngA7tzCOXkGWY_mg5KAygQje2Zy3LIPIDU5xLX0qks",
    role: "participant",
    userId: "engineering",
  },
  {
    passwordHash:
      "scrypt$v1$16384$8$1$os7QZZ9UEaQ03JICKECA8A$VoLeF85ItTvIzOlOFb5upvEjV2e231uLYh6as3v20ig",
    role: "participant",
    userId: "sales",
  },
];

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

function parseDemoUsers(
  value: string | undefined,
): readonly DemoUserConfiguration[] {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_DEMO_USERS;
  }

  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("DEMO_USERS_JSON must be valid JSON");
  }
  if (!Array.isArray(input) || input.length < 3 || input.length > 8) {
    throw new Error("DEMO_USERS_JSON must contain 3–8 users");
  }

  const users = input.map((candidate: unknown): DemoUserConfiguration => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("userId" in candidate) ||
      typeof candidate.userId !== "string" ||
      candidate.userId.length === 0 ||
      !("passwordHash" in candidate) ||
      typeof candidate.passwordHash !== "string" ||
      !isScryptPasswordHash(candidate.passwordHash) ||
      !("role" in candidate) ||
      (candidate.role !== "facilitator" && candidate.role !== "participant")
    ) {
      throw new Error(
        "Each demo user requires userId, encoded scrypt passwordHash, and role",
      );
    }
    return {
      passwordHash: candidate.passwordHash,
      role: candidate.role,
      userId: candidate.userId,
    };
  });
  if (new Set(users.map(({ userId }) => userId)).size !== users.length) {
    throw new Error("DEMO_USERS_JSON user IDs must be unique");
  }
  if (users.filter(({ role }) => role === "facilitator").length !== 1) {
    throw new Error("DEMO_USERS_JSON requires exactly one facilitator");
  }
  return users;
}

export function readServerConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ServerConfiguration {
  return {
    databasePath: environment.DATABASE_PATH ?? "./data/counterpoint.sqlite",
    demoUsers: parseDemoUsers(environment.DEMO_USERS_JSON),
    host: "0.0.0.0",
    openAiConfigured: (environment.OPENAI_API_KEY ?? "").length > 0,
    port: parsePort(environment.PORT),
  };
}
