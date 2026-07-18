export interface JsonCodec<T> {
  decode(serialized: string): T;
  encode(value: T): string;
}

export function createJsonCodec<T>(parse: (input: unknown) => T): JsonCodec<T> {
  return {
    decode(serialized) {
      return parse(JSON.parse(serialized) as unknown);
    },
    encode(value) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError("Value cannot be represented as JSON");
      }
      return serialized;
    },
  };
}
