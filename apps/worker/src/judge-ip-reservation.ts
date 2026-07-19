import {
  createKeyedIpHash,
  type KeyedIpHash,
} from "@counterpoint/adapters-cloudflare";

const MINIMUM_HMAC_SECRET_BYTES = 32;

export interface JudgeIpReservationInput {
  readonly hashIp: KeyedIpHash;
  readonly ipAddress: string;
}

export async function resolveJudgeIpReservationInput(
  request: Request,
  secret: string | undefined,
): Promise<JudgeIpReservationInput | undefined> {
  if (
    secret === undefined ||
    new TextEncoder().encode(secret).length < MINIMUM_HMAC_SECRET_BYTES
  ) {
    return undefined;
  }
  const ipAddress = request.headers.get("CF-Connecting-IP");
  if (ipAddress === null) {
    return undefined;
  }

  try {
    const keyedHash = createKeyedIpHash(secret);
    const ipHash = await keyedHash(ipAddress);
    return {
      hashIp(candidate) {
        if (candidate !== ipAddress) {
          return Promise.reject(
            new TypeError("IP address does not match the verified request"),
          );
        }
        return Promise.resolve(ipHash);
      },
      ipAddress,
    };
  } catch {
    return undefined;
  }
}
