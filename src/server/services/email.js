function readEnv(name) {
  const value = process.env[name];
  return value ? String(value).trim() : '';
}

export function isEmailSendingEnabled() {
  return process.env.EMAIL_SENDING_ENABLED === 'true' && process.env.DRY_RUN !== 'true';
}

export function isDryRun() {
  return process.env.DRY_RUN !== 'false';
}

export function getEmailConfig() {
  const host = readEnv('SMTP_HOST');
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  const from = readEnv('EMAIL_FROM') || readEnv('SMTP_FROM');
  const provider = readEnv('EMAIL_PROVIDER') || 'smtp';
  const configured = Boolean(host && user && pass && from);
  return {
    provider,
    configured,
    has_host: Boolean(host),
    has_user: Boolean(user),
    has_password: Boolean(pass),
    has_from: Boolean(from),
    sending_enabled: isEmailSendingEnabled(),
    dry_run: isDryRun(),
  };
}

export async function sendEmail(input = {}) {
  const to = String(input.to || '').trim();
  const subject = String(input.subject || 'SIPZY foldable cups').trim();
  const body = String(input.body || input.text || '').trim();
  if (!to) throw new Error('A valid recipient email address is required');
  if (!body) throw new Error('Email body is required');

  const config = getEmailConfig();
  const dryRun = isDryRun() || !isEmailSendingEnabled();

  if (dryRun || !config.configured) {
    return {
      sent: false,
      dry_run: true,
      reason: !config.configured ? 'email_not_configured' : 'sending_disabled',
      recipient: to,
      channel: 'email',
    };
  }

  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    return { sent: false, dry_run: true, reason: 'email_provider_unavailable', recipient: to, channel: 'email' };
  }

  const transporter = nodemailer.default.createTransport({
    host: readEnv('SMTP_HOST'),
    port: Number(readEnv('SMTP_PORT') || 587),
    secure: readEnv('SMTP_SECURE') === 'true',
    auth: {
      user: readEnv('SMTP_USER'),
      pass: readEnv('SMTP_PASS'),
    },
  });

  const info = await transporter.sendMail({
    from: readEnv('EMAIL_FROM') || readEnv('SMTP_FROM'),
    to,
    subject,
    text: body,
  });

  return {
    sent: true,
    dry_run: false,
    message_id: info?.messageId || null,
    recipient: to,
    channel: 'email',
  };
}

export default { getEmailConfig, isEmailSendingEnabled, isDryRun, sendEmail };
