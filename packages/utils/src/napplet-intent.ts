import { intentInvoke } from '@napplet/sdk';
import { createIntentRequest, type IntentRequest, type IntentResult } from '@hyprgate/types';

/** Send a validated shared request through the public URI/options SDK surface. */
export function invokeNappletIntent(request: IntentRequest): Promise<IntentResult> {
  const normalized = createIntentRequest(request);
  if (!normalized) return Promise.reject(new Error('Invalid intent request'));
  return intentInvoke(normalized.convention, {
    ...('payload' in normalized ? { payload: normalized.payload } : {}),
    ...(normalized.handler !== undefined ? { handler: normalized.handler } : {}),
    ...(normalized.handlerHint !== undefined ? { handlerHint: normalized.handlerHint } : {}),
    ...(normalized.behavior !== undefined ? { behavior: normalized.behavior } : {}),
  });
}
