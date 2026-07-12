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
