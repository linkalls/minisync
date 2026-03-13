export class SyncError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 500) {
    super(message);
    this.name = "SyncError";
  }
}

export class AuthError extends SyncError {
  constructor(message = "Unauthorized") {
    super(message, "AUTH_ERROR", 401);
  }
}
