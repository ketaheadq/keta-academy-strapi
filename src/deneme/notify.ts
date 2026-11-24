import nodemailer, { type Transporter } from "nodemailer";
import { toInternational } from "./phone";

/**
 * Report link by SMS (Netgsm REST v2) and new-request e-mails to the teacher (SMTP).
 * Missing settings throw a readable error; callers store it on the request so it shows in the panel.
 */

function requireEnv(...names: string[]) {
	const missing = names.filter((name) => !process.env[name]);
	if (missing.length) throw new Error(`Ortam değişkeni eksik: ${missing.join(", ")}`);
	return names.map((name) => process.env[name] as string);
}

/** Sends one SMS. Returns Netgsm's job id. `phone` is national ("5551234567"). */
export async function sendSms(phone: string, message: string): Promise<string> {
	const [usercode, password, msgheader] = requireEnv("NETGSM_USERCODE", "NETGSM_PASSWORD", "NETGSM_MSGHEADER");
	const response = await fetch("https://api.netgsm.com.tr/sms/rest/v2/send", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Basic ${Buffer.from(`${usercode}:${password}`).toString("base64")}`,
		},
		body: JSON.stringify({
			msgheader,
			messages: [{ msg: message, no: toInternational(phone) }],
			encoding: "TR",
			// "0": informational message (report the person asked for), not a commercial one,
			// so it isn't filtered by İYS. Sales calls/messages need separate İYS consent.
			iysfilter: "0",
		}),
		signal: AbortSignal.timeout(30_000),
	});
	const text = await response.text();
	let data: { code?: string; jobid?: string; description?: string } = {};
	try {
		data = JSON.parse(text);
	} catch {
		// Non-JSON error page
	}
	if (!response.ok || data.code !== "00") {
		throw new Error(`Netgsm hatası (HTTP ${response.status}, kod ${data.code ?? "?"}): ${data.description ?? text.slice(0, 200)}`);
	}
	return data.jobid ?? "";
}

let transporter: Transporter | null = null;

export async function sendTeacherEmail(subject: string, text: string): Promise<void> {
	const [host, port, user, pass, to] = requireEnv("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "NOTIFY_EMAIL");
	transporter ??= nodemailer.createTransport({
		host,
		port: Number(port),
		secure: Number(port) === 465,
		auth: { user, pass },
	});
	await transporter.sendMail({ from: user, to, subject, text });
}
