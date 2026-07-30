export function getAuthErrorMessage(error: unknown): string {
  if (!error) {
    return "Something went wrong. Please try again.";
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object") {
    const maybe = error as {
      message?: unknown;
      error?: unknown;
      statusText?: unknown;
    };

    if (typeof maybe.message === "string" && maybe.message.trim()) {
      return maybe.message;
    }

    if (typeof maybe.error === "string" && maybe.error.trim()) {
      return maybe.error;
    }

    if (maybe.error && typeof maybe.error === "object") {
      const nested = maybe.error as { message?: unknown };
      if (typeof nested.message === "string" && nested.message.trim()) {
        return nested.message;
      }
    }
  }

  return "Something went wrong. Please try again.";
}
