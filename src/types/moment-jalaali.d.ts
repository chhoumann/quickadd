declare module "moment-jalaali" {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const momentJalaali: typeof import("moment") & {
		loadPersian(args?: {
			usePersianDigits?: boolean;
			dialect?: string;
		}): void;
	};
	export default momentJalaali;
}
