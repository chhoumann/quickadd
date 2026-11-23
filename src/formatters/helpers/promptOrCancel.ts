import { promptCancelled } from "../../errors/UserCancelError";
import { isCancellationError } from "../../utils/errorUtils";

/**
 * Awaits a prompt. A dismissal, including a legacy cancellation sentinel a user
 * script throws, rethrows as the one typed cancellation; any other
 * failure rethrows unchanged.
 */
export async function promptOrCancel<T>(prompt: () => Promise<T>): Promise<T> {
	try {
		return await prompt();
	} catch (error) {
		if (isCancellationError(error)) throw promptCancelled();
		throw error;
	}
}
