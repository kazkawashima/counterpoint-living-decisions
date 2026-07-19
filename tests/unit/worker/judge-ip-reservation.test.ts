import { describe, expect, it } from "vitest";

import { resolveJudgeIpReservationInput } from "../../../apps/worker/src/judge-ip-reservation.js";

const FIRST_SECRET = "a".repeat(32);
const SECOND_SECRET = "b".repeat(32);
const HASH_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;

function request(ipAddress?: string): Request {
  return new Request(
    "https://counterpoint.test/managed-call",
    ipAddress === undefined
      ? {}
      : { headers: { "CF-Connecting-IP": ipAddress } },
  );
}

describe("judge IP reservation input", () => {
  it.each(["203.0.113.42", "2001:db8::1"])(
    "binds the verified canonical address %s to a keyed pseudonym",
    async (ipAddress) => {
      const input = await resolveJudgeIpReservationInput(
        request(ipAddress),
        FIRST_SECRET,
      );

      expect(input?.ipAddress).toBe(ipAddress);
      await expect(input?.hashIp(ipAddress)).resolves.toMatch(HASH_PATTERN);
      await expect(input?.hashIp("198.51.100.10")).rejects.toThrow(
        "IP address does not match the verified request",
      );
    },
  );

  it.each([
    undefined,
    "",
    "203.0.113.42, 198.51.100.10",
    "203.0.113.42:443",
    "example.test",
    "2001:0db8::1",
    "fe80::1%eth0",
  ])("fails closed for a missing or unsafe header: %s", async (ipAddress) => {
    await expect(
      resolveJudgeIpReservationInput(request(ipAddress), FIRST_SECRET),
    ).resolves.toBeUndefined();
  });

  it.each([undefined, "", " ", "short-secret", "é".repeat(15)])(
    "fails closed for a missing or sub-32-byte HMAC secret",
    async (secret) => {
      await expect(
        resolveJudgeIpReservationInput(request("203.0.113.42"), secret),
      ).resolves.toBeUndefined();
    },
  );

  it("is deterministic per key and separates independently keyed deployments", async () => {
    const firstInput = await resolveJudgeIpReservationInput(
      request("203.0.113.42"),
      FIRST_SECRET,
    );
    const repeatedInput = await resolveJudgeIpReservationInput(
      request("203.0.113.42"),
      FIRST_SECRET,
    );
    const secondInput = await resolveJudgeIpReservationInput(
      request("203.0.113.42"),
      SECOND_SECRET,
    );

    const first = await firstInput?.hashIp("203.0.113.42");
    await expect(repeatedInput?.hashIp("203.0.113.42")).resolves.toBe(first);
    await expect(secondInput?.hashIp("203.0.113.42")).resolves.not.toBe(first);
  });

  it("does not reflect the raw header or secret when validation fails", async () => {
    const rawHeader = "sensitive-hostname.example";
    const secret = "sensitive-secret-material-value-000";

    const result = await resolveJudgeIpReservationInput(
      request(rawHeader),
      secret,
    );

    expect(result).toBeUndefined();
  });
});
