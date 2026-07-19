import type { Capability } from "@counterpoint/application";

type PublicCapability = Exclude<Capability, "judge:managed-ai">;

export function publicCapabilities(
  capabilities: ReadonlySet<Capability>,
): readonly PublicCapability[] {
  return [...capabilities].filter(
    (capability): capability is PublicCapability =>
      capability !== "judge:managed-ai",
  );
}
