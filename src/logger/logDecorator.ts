 
 
 
 
 
import { log } from "./logManager";

/**
* A decorator function that logs the method call with its arguments and return value.
* Used by writing @logDecorator above a method.
*/
function logDecorator(
	target: object,
	key: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value as (
		this: unknown,
		...args: unknown[]
	) => unknown;

	descriptor.value = function (...args: unknown[]) {
		log.logMessage(`Method ${key} called with arguments: ${JSON.stringify(args)}`);
		const result = originalMethod.apply(this, args);
		log.logMessage(`Method ${key} returned: ${JSON.stringify(result)}`);
		return result;
	};

	return descriptor;
}

export default logDecorator;