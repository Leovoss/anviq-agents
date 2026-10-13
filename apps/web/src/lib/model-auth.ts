import { waitForModelOAuthCompletion } from "@anviq/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@anviq/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@anviq/core";

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
