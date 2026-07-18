export interface ArtifactScope {
  readonly artifactId: string;
  readonly meetingId: string;
  readonly ownerParticipantId?: string;
  readonly visibility: "private" | "shared";
}

export interface ArtifactMetadata extends ArtifactScope {
  readonly contentType: string;
  readonly hash: string;
  readonly size: number;
  readonly storageReference: string;
}

export interface ArtifactWrite {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly hash: string;
  readonly scope: ArtifactScope;
}

export interface ArtifactStore {
  delete(scope: ArtifactScope): Promise<void>;
  get(scope: ArtifactScope): Promise<Uint8Array | undefined>;
  put(write: ArtifactWrite): Promise<ArtifactMetadata>;
}

export interface ExtractedArtifactText {
  readonly content: string;
  readonly contentType: string;
  readonly pages?: number;
}

export interface ArtifactTextExtractor {
  extract(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly filename: string;
  }): Promise<ExtractedArtifactText>;
}
