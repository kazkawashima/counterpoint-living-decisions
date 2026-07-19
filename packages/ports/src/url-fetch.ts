export interface UrlFetchRequest {
  readonly url: string;
}

export type UrlFetchFailureReason =
  | "credentials_not_allowed"
  | "dns_resolution_failed"
  | "http_error"
  | "invalid_redirect"
  | "invalid_url"
  | "network_error"
  | "port_not_allowed"
  | "response_too_large"
  | "timeout"
  | "too_many_redirects"
  | "unsafe_destination"
  | "unsupported_content_encoding"
  | "unsupported_content_type"
  | "unsupported_scheme";

export type UrlFetchResult =
  | {
      readonly kind: "fetched";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly filename: string;
    }
  | {
      readonly kind: "failed";
      readonly reason: UrlFetchFailureReason;
    };

export interface UrlFetcher {
  fetch(request: UrlFetchRequest): Promise<UrlFetchResult>;
}
