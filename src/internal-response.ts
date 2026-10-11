/**
 * Responses reconstructed by first-party cache/idempotency middleware from a
 * previously finalized response. The original response already crossed the
 * route's schema-validation boundary, so replaying its stored bytes does not
 * create the opaque-success bypass guarded by `App`.
 */
const schemaValidatedResponses = new WeakSet<Response>();

/**
 * Mark a framework-generated replay as having crossed response validation.
 * This is an internal capability and is not exported from the package barrel.
 *
 * @param response - Reconstructed response containing previously validated bytes.
 * @returns The same response for allocation-free call-site composition.
 */
export function markSchemaValidatedResponse(response: Response): Response {
  schemaValidatedResponses.add(response);
  return response;
}

/**
 * Test whether a response is a trusted first-party replay of validated bytes.
 *
 * @param response - Hook response being considered for fail-closed handling.
 * @returns `true` only for responses marked by first-party replay middleware.
 */
export function isSchemaValidatedResponse(response: Response): boolean {
  return schemaValidatedResponses.has(response);
}

/**
 * Responses the dispatcher synthesized because the client disconnected
 * (`disconnectStatusCode`). They carry no handler outcome, so first-party
 * idempotency must release the reservation instead of storing them: storing
 * one would replay an empty 499 to the very retry the key exists for.
 */
const disconnectResponses = new WeakSet<Response>();

/**
 * Mark a dispatcher-built client-disconnect response. Internal capability, not
 * exported from the package barrel, so handlers cannot forge it.
 *
 * @param response - The synthesized `disconnectStatusCode` response.
 * @returns The same response for allocation-free call-site composition.
 */
export function markDisconnectResponse(response: Response): Response {
  disconnectResponses.add(response);
  return response;
}

/**
 * Test whether a response was synthesized for a client disconnect.
 *
 * @param response - Response seen by an `onSend` hook.
 * @returns `true` only for responses marked by the dispatcher.
 */
export function isDisconnectResponse(response: Response): boolean {
  return disconnectResponses.has(response);
}
