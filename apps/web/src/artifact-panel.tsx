import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { AssignedMeeting, PrivateArtifact } from "@counterpoint/protocol";

import {
  ApiError,
  downloadPrivateArtifact,
  getRoleProjection,
  uploadPrivateArtifact,
  type StoredSession,
} from "./api.js";

interface ArtifactPanelProps {
  readonly meetingId: string;
  readonly onPositionChange: (position: AssignedMeeting["position"]) => void;
  readonly onUseArtifact: (source: {
    readonly filename: string;
    readonly sourceArtifactId: string;
    readonly text: string;
  }) => void;
  readonly session: StoredSession;
}

type UploadState =
  "failed" | "idle" | "processed" | "processing" | "validating";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function safeMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case "ARTIFACT_TOO_LARGE":
        return "This file exceeds an owner or meeting artifact limit.";
      case "ARTIFACT_TYPE_UNSUPPORTED":
        return "Use PDF, Markdown, plain text, or JSON with a matching file type.";
      default:
        return cause.message;
    }
  }
  return "The artifact could not be processed. Its private contents were not exposed.";
}

function formatBytes(value: number): string {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactPanel({
  meetingId,
  onPositionChange,
  onUseArtifact,
  session,
}: ArtifactPanelProps) {
  const inputId = useId();
  const [artifacts, setArtifacts] = useState<readonly PrivateArtifact[]>([]);
  const [error, setError] = useState<string>();
  const [file, setFile] = useState<File>();
  const [state, setState] = useState<UploadState>("idle");
  const commandKey = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void getRoleProjection(session, { meetingId }, controller.signal)
      .then((projection) => {
        setArtifacts(projection.privateWorkspace.artifacts);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(safeMessage(cause));
        }
      });
    return () => controller.abort();
  }, [meetingId, session]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    commandKey.current = crypto.randomUUID();
    setError(undefined);
    setState(selected === undefined ? "idle" : "validating");
    setFile(selected);
    if (selected !== undefined && selected.size > MAX_FILE_BYTES) {
      setError("Files must be 20 MB or smaller.");
      setState("failed");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === undefined || file.size > MAX_FILE_BYTES) {
      return;
    }
    setState("processing");
    setError(undefined);
    try {
      const response = await uploadPrivateArtifact(session, {
        file,
        idempotencyKey: commandKey.current,
        meetingId,
      });
      onPositionChange(response.position);
      setArtifacts((current) => [
        ...current.filter(
          ({ sourceArtifactId }) =>
            sourceArtifactId !== response.artifact.sourceArtifactId,
        ),
        response.artifact,
      ]);
      setState(
        response.artifact.processingState === "processed"
          ? "processed"
          : "failed",
      );
      if (response.artifact.processingState === "failed") {
        setError(
          "The source is stored privately, but safe text extraction failed.",
        );
      }
    } catch (cause) {
      setState("failed");
      setError(safeMessage(cause));
    }
  }

  async function download(
    artifact: PrivateArtifact,
    representation: "derived" | "source",
  ) {
    setError(undefined);
    try {
      const downloaded = await downloadPrivateArtifact(session, {
        artifactId: artifact.sourceArtifactId,
        meetingId,
        representation,
      });
      const url = URL.createObjectURL(downloaded.blob);
      const anchor = document.createElement("a");
      anchor.download = downloaded.filename;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(safeMessage(cause));
    }
  }

  async function useArtifact(artifact: PrivateArtifact) {
    setError(undefined);
    try {
      const downloaded = await downloadPrivateArtifact(session, {
        artifactId: artifact.sourceArtifactId,
        meetingId,
        representation: "derived",
      });
      onUseArtifact({
        filename: artifact.filename,
        sourceArtifactId: artifact.sourceArtifactId,
        text: await downloaded.blob.text(),
      });
    } catch (cause) {
      setError(safeMessage(cause));
    }
  }

  return (
    <section aria-labelledby="artifact-vault-title" className="artifact-vault">
      <header>
        <div>
          <span className="source-type">A1 · owner-private artifact vault</span>
          <h2 id="artifact-vault-title">
            Bring evidence in. Nothing goes out.
          </h2>
        </div>
        <span className="artifact-limit">
          20 MB · 10 items · 100 MB/meeting
        </span>
      </header>
      <form
        className={`artifact-drop ${state}`}
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor={inputId}>
          <span className="artifact-drop-glyph" aria-hidden="true">
            ⇣
          </span>
          <strong>
            {file === undefined ? "Choose a private source" : file.name}
          </strong>
          <small>
            {file === undefined
              ? "PDF · Markdown · TXT · JSON"
              : `${formatBytes(file.size)} · ${file.type || "unknown type"}`}
          </small>
        </label>
        <input
          accept=".pdf,.md,.markdown,.txt,.json"
          id={inputId}
          onChange={chooseFile}
          type="file"
        />
        <button
          disabled={
            file === undefined ||
            file.size > MAX_FILE_BYTES ||
            state === "processing"
          }
          type="submit"
        >
          {state === "processing"
            ? "Validating + deriving…"
            : "Store and process privately"}
        </button>
        <p className="artifact-safety">
          Source and derived text receive separate hashes and storage records.
          Content is treated as untrusted data.
        </p>
      </form>
      {error === undefined ? null : (
        <p className="artifact-error" role="alert">
          {error}
        </p>
      )}
      {artifacts.length === 0 ? (
        <p className="artifact-empty">
          No uploaded artifacts in your boundary.
        </p>
      ) : (
        <ol className="artifact-list">
          {artifacts.map((artifact) => (
            <li
              className={`artifact-item ${artifact.processingState}`}
              key={artifact.sourceArtifactId}
            >
              <span className="artifact-file-mark" aria-hidden="true">
                {artifact.contentType === "application/pdf" ? "PDF" : "TXT"}
              </span>
              <div>
                <strong>{artifact.filename}</strong>
                <small>
                  {formatBytes(artifact.sizeBytes)} ·{" "}
                  {artifact.processingState === "processed"
                    ? "Derived text ready"
                    : "Processing failed safely"}
                </small>
              </div>
              <div className="artifact-actions">
                <button
                  onClick={() => void download(artifact, "source")}
                  type="button"
                >
                  Source
                </button>
                {artifact.processingState === "processed" ? (
                  <>
                    <button
                      onClick={() => void download(artifact, "derived")}
                      type="button"
                    >
                      Derived
                    </button>
                    <button
                      className="use-artifact"
                      onClick={() => void useArtifact(artifact)}
                      type="button"
                    >
                      Use privately
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
