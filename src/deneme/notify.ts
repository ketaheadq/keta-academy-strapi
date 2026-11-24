import nodemailer, { type Transporter } from "nodemailer";

/**
 * New-request e-mails to the teacher (SMTP).
 * Missing settings throw a readable error; callers store it on the request so it shows in the panel.
 */

function requireEnv(...names: string[]) {
	const missing = names.filter((name) => !process.env[name]);
	if (missing.length) throw new Error(`Ortam değişkeni eksik: ${missing.join(", ")}`);
	return names.map((name) => process.env[name] as string);
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
