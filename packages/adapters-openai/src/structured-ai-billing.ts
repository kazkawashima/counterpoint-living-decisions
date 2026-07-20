export interface StructuredAiTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface StructuredAiBilling {
  readonly attemptCount: number;
  readonly attempts: readonly {
    readonly inputTokens: number;
    readonly model: string;
    readonly outputTokens: number;
  }[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class StructuredAiBillingAccumulator {
  readonly #attempts: {
    inputTokens: number;
    model: string;
    outputTokens: number;
  }[] = [];
  #inputTokens = 0;
  #outputTokens = 0;
  #valid = true;

  record(
    responseModel: string,
    usage: StructuredAiTokenUsage | undefined,
  ): void {
    if (!this.#valid) {
      return;
    }

    if (!isTrustworthyResponseModel(responseModel) || !isTrustworthyUsage(usage)) {
      this.invalidate();
      return;
    }

    const inputTokens = this.#inputTokens + usage.inputTokens;
    const outputTokens = this.#outputTokens + usage.outputTokens;
    if (
      !Number.isSafeInteger(inputTokens) ||
      !Number.isSafeInteger(outputTokens)
    ) {
      this.invalidate();
      return;
    }

    this.#attempts.push({
      inputTokens: usage.inputTokens,
      model: responseModel,
      outputTokens: usage.outputTokens,
    });
    this.#inputTokens = inputTokens;
    this.#outputTokens = outputTokens;
  }

  invalidate(): void {
    this.#valid = false;
  }

  complete(attemptCount: number): StructuredAiBilling | undefined {
    if (
      !this.#valid ||
      !Number.isSafeInteger(attemptCount) ||
      attemptCount < 1 ||
      this.#attempts.length !== attemptCount
    ) {
      return undefined;
    }

    return {
      attemptCount,
      attempts: this.#attempts.map((attempt) => ({ ...attempt })),
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
    };
  }
}

function isTrustworthyResponseModel(responseModel: string): boolean {
  return responseModel.trim().length > 0;
}

function isTrustworthyUsage(
  usage: StructuredAiTokenUsage | undefined,
): usage is StructuredAiTokenUsage {
  return (
    usage !== undefined &&
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    Number.isSafeInteger(usage.totalTokens) &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}
