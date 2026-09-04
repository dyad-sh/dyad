import {
  CONNECTION_FLOW_INVOCATION_KIND,
  type ConnectionFlowInvocationRef,
} from "./state";

export type DeepLinkOAuthProvider = "neon" | "supabase";

const LOGIN_URLS: Record<DeepLinkOAuthProvider, string> = {
  neon: "https://oauth.dyad.sh/api/integrations/neon/login",
  supabase: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
};

const OAUTH_STATE_PATTERN = /^[A-Za-z0-9:._~-]{1,200}$/;

export function buildOAuthLoginUrl(
  provider: DeepLinkOAuthProvider,
  invocationRef: ConnectionFlowInvocationRef,
): string {
  if (
    invocationRef.kind !== CONNECTION_FLOW_INVOCATION_KIND ||
    invocationRef.entityKey !== provider
  ) {
    throw new Error(`OAuth invocation does not belong to ${provider}`);
  }

  const url = new URL(LOGIN_URLS[provider]);
  url.searchParams.set("state", invocationRef.operationId);
  return url.toString();
}

export function parseOAuthCallbackInvocationRef(
  provider: DeepLinkOAuthProvider,
  state: string | null,
): ConnectionFlowInvocationRef | null {
  if (!state || !OAUTH_STATE_PATTERN.test(state)) {
    return null;
  }

  return {
    kind: CONNECTION_FLOW_INVOCATION_KIND,
    entityKey: provider,
    operationId: state,
  };
}
