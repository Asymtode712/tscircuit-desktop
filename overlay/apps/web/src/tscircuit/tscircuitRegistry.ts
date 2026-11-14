/**
 * tscircuit desktop: what the app asks of tscircuit's registry API. A session
 * for the user, by the browser sign-in that `tsci login` uses, and a public
 * autorouter bug report, as `tsci report autorouter` files one.
 */
import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "~/hooks/useLocalStorage";

const REGISTRY_API_URL = "https://registry-api.tscircuit.com";
const BUG_REPORT_VIEW_URL =
  "https://api.tscircuit.com/autorouting/bug_reports/view?autorouting_bug_report_id=";
const SESSION_TOKEN_STORAGE_KEY = "tscircuit-desktop:tscircuit-session-token";
const SIGN_IN_POLL_MS = 1_500;

export const readSessionToken = (): string | null =>
  getLocalStorageItem(SESSION_TOKEN_STORAGE_KEY, Schema.String);
export const saveSessionToken = (token: string) =>
  setLocalStorageItem(SESSION_TOKEN_STORAGE_KEY, token, Schema.String);
export const forgetSessionToken = () => removeLocalStorageItem(SESSION_TOKEN_STORAGE_KEY);

interface RegistryOptions {
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, name: string): unknown =>
  isRecord(value) ? value[name] : undefined;

interface Reply {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

async function post(
  path: string,
  json: unknown,
  token: string | null,
  options: RegistryOptions,
): Promise<Reply> {
  const response = await (options.fetch ?? fetch)(`${REGISTRY_API_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(json),
    signal: options.signal,
  });
  const body: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

/** A refusal in the registry's own words, when it sent any. */
const refused = (reply: Reply) => {
  const message = field(field(reply.body, "error"), "message");
  return {
    kind: "failed" as const,
    message:
      typeof message === "string" ? message : `The tscircuit registry answered ${reply.status}.`,
  };
};

const failure = (error: unknown, signal: AbortSignal) => {
  // A cancelled request is the caller's own doing, and not a failure to report.
  if (signal.aborted) throw error;
  return {
    kind: "failed" as const,
    message: error instanceof Error ? error.message : "The request failed.",
  };
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export type SignInResult =
  | { readonly kind: "signed_in"; readonly token: string }
  /** The sign-in page was left open too long. */
  | { readonly kind: "expired" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Signs the user in to tscircuit: opens the registry's sign-in page in their
 * browser and waits until they have finished there. Rejects when `signal` aborts.
 */
export async function signInToTscircuit(
  options: RegistryOptions & {
    readonly openUrl: (url: string) => Promise<void>;
    /** Waits between checks of the sign-in page. Tests pass one that does not sleep. */
    readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<SignInResult> {
  try {
    const created = await post("sessions/login_page/create", {}, null, options);
    if (!created.ok) return refused(created);
    const page = field(created.body, "login_page");
    const pageId = field(page, "login_page_id");
    const pageToken = field(page, "login_page_auth_token");
    const url = field(page, "url");
    if (typeof pageId !== "string" || typeof pageToken !== "string" || typeof url !== "string") {
      return { kind: "failed", message: "The tscircuit registry did not offer a sign-in page." };
    }
    await options.openUrl(url);
    const forPage = { login_page_id: pageId };
    for (;;) {
      const checked = await post("sessions/login_page/get", forPage, pageToken, options);
      if (!checked.ok) return refused(checked);
      const state = field(checked.body, "login_page");
      if (field(state, "was_login_successful") === true) break;
      if (field(state, "is_expired") === true) return { kind: "expired" };
      await (options.wait ?? wait)(SIGN_IN_POLL_MS, options.signal);
    }
    const exchanged = await post(
      "sessions/login_page/exchange_for_cli_session",
      forPage,
      pageToken,
      options,
    );
    if (!exchanged.ok) return refused(exchanged);
    const token = field(field(exchanged.body, "session"), "token");
    return typeof token === "string"
      ? { kind: "signed_in", token }
      : { kind: "failed", message: "The tscircuit registry did not return a session." };
  } catch (error) {
    return failure(error, options.signal);
  }
}

export type BugReportResult =
  | { readonly kind: "created"; readonly url: string }
  /** No session, or one the registry no longer accepts. */
  | { readonly kind: "sign_in_required" }
  | { readonly kind: "too_large" }
  | { readonly kind: "failed"; readonly message: string };

/** Files a public autorouter bug report. Rejects when `signal` aborts. */
export async function createAutorouterBugReport(
  input: RegistryOptions & {
    readonly title: string;
    readonly simpleRouteJson: Record<string, unknown>;
    readonly token: string;
  },
): Promise<BugReportResult> {
  try {
    const reply = await post(
      "autorouting/bug_reports/create",
      { title: input.title, simple_route_json: input.simpleRouteJson },
      input.token,
      input,
    );
    if (reply.status === 401) return { kind: "sign_in_required" };
    if (reply.status === 413) return { kind: "too_large" };
    if (!reply.ok) return refused(reply);
    const id = field(field(reply.body, "autorouting_bug_report"), "autorouting_bug_report_id");
    return typeof id === "string"
      ? { kind: "created", url: `${BUG_REPORT_VIEW_URL}${encodeURIComponent(id)}` }
      : { kind: "failed", message: "The tscircuit registry did not return a report." };
  } catch (error) {
    return failure(error, input.signal);
  }
}
