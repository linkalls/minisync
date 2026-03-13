import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend } from "./types";

export interface HttpSyncBackendOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export class HttpSyncBackend implements SyncBackend {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpSyncBackendOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/pull`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.options.headers,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pull failed: ${response.status} ${text}`);
    }
    return (await response.json()) as PullResponse;
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.options.headers,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Push failed: ${response.status} ${text}`);
    }
    return (await response.json()) as PushResponse;
  }
}
