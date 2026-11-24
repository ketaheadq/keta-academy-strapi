/**
 * Turkish mobile numbers: accepts "0555 123 45 67", "+90 555…", "555-123-45-67".
 * Returns the national form "5551234567", or null when it isn't a Turkish mobile number.
 */
export function normalizeMobile(input: unknown): string | null {
	if (typeof input !== "string") return null;
	let digits = input.replace(/\D/g, "");
	if (digits.startsWith("00")) digits = digits.slice(2);
	if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
	if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
	return /^5\d{9}$/.test(digits) ? digits : null;
}

/** "5551234567" → "905551234567" (international, as Netgsm and wa.me expect). */
export const toInternational = (national: string) => `90${national}`;

/** "5551234567" → "0555 *** ** 67" for messages shown back to the user. */
export const maskMobile = (national: string) => `0${national.slice(0, 3)} *** ** ${national.slice(-2)}`;
