import nodemailer from 'nodemailer';
import crypto from 'crypto';
import QRCode from 'qrcode';


const CLINIC_NAME = process.env.CLINIC_NAME || 'Clinic';
const CLINIC_TZ = process.env.CLINIC_TZ || 'Asia/Colombo';
const ORG_DOMAIN = process.env.ORG_DOMAIN || 'squareone.com'; // used for ICS UID



const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === '465', // secure only for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});


type ReceiptParams = {
  to: string;
  clinicName?: string;
  paymentId: number | string;
  patientName: string;
  patientCode: string;
  amount: number;
  currency: string;
  method: string;
  last4?: string | null;
  transactionRef?: string | null;
  createdAt?: Date | string | number;
  appointmentId?: number | string | null;
};

export async function sendPaymentReceiptEmail({
  to,
  clinicName = process.env.CLINIC_NAME || 'Clinic',
  paymentId,
  patientName,
  patientCode,
  amount,
  currency,
  method,
  last4,
  transactionRef,
  createdAt = new Date(),
  appointmentId,
}: ReceiptParams) {
  const amountFmt = new Intl.NumberFormat('en-LK', { style: 'currency', currency }).format(amount);
  const dt = new Date(createdAt);
  const when = dt.toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });

  const subject = `${clinicName} – Payment Receipt #${paymentId}`;
  const text = [
    `${clinicName} – Payment Receipt #${paymentId}`,
    ``,
    `Hi ${patientName},`,
    ``,
    `Thank you for your payment.`,
    `Amount: ${amountFmt}`,
    `Method: ${method.toUpperCase()}${last4 ? ` (****${last4})` : ''}`,
    transactionRef ? `Transaction Ref: ${transactionRef}` : '',
    appointmentId ? `Appointment: ${appointmentId}` : '',
    `Patient: ${patientName} (${patientCode})`,
    `Date: ${when} (Asia/Colombo)`,
    ``,
    `If you have any questions, reply to this email.`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.5;">
      <h2 style="margin:0 0 8px">${clinicName} – Payment Receipt #${paymentId}</h2>
      <p>Hi ${patientName},</p>
      <p>Thank you for your payment.</p>
      <table style="border-collapse:collapse; width:100%; max-width:520px">
        <tbody>
          <tr><td style="padding:6px 0; color:#555">Amount</td><td style="padding:6px 0; font-weight:600">${amountFmt}</td></tr>
          <tr><td style="padding:6px 0; color:#555">Method</td><td style="padding:6px 0">${method.toUpperCase()}${last4 ? ` (****${last4})` : ''}</td></tr>
          ${transactionRef ? `<tr><td style="padding:6px 0; color:#555">Transaction Ref</td><td style="padding:6px 0">${transactionRef}</td></tr>` : ''}
          ${appointmentId ? `<tr><td style="padding:6px 0; color:#555">Appointment</td><td style="padding:6px 0">${appointmentId}</td></tr>` : ''}
          <tr><td style="padding:6px 0; color:#555">Patient</td><td style="padding:6px 0">${patientName} (${patientCode})</td></tr>
          <tr><td style="padding:6px 0; color:#555">Date</td><td style="padding:6px 0">${when} (Asia/Colombo)</td></tr>
        </tbody>
      </table>
      <p style="margin-top:16px">If you have any questions, just reply to this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}


function fmtWhen(d: Date) {
  return d.toLocaleString('en-GB', {
    timeZone: CLINIC_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toICSDate(dt: Date) {
  // convert to UTC and format YYYYMMDDTHHMMSSZ
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  const ss = String(dt.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function buildICS({
  id,
  start,
  end,
  summary,
  description,
  location,
}: {
  id: string | number;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
}) {
  const uid = `${id}-${crypto.randomBytes(6).toString('hex')}@${ORG_DOMAIN}`;
  const now = new Date();

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SquareOne//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location.replace(/\n/g, ' ')}` : '',
    description ? `DESCRIPTION:${description.replace(/\n/g, '\\n')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return ics;
}


export async function sendAppointmentConfirmationEmail(args: {
  to: string;
  patientName: string;
  patientCode?: string;
  start: Date;
  durationMin: number;
  type: string;
  notes?: string | null;
  appointmentId: number | string;
  /** Now used as the full payment URL */
  invoiceId?: number | string;
  location?: string | null;
}) {
  const {
    to,
    patientName,
    patientCode,
    start,
    durationMin,
    type,
    notes,
    appointmentId,
    invoiceId,
    location,
  } = args;

  const end = new Date(start.getTime() + durationMin * 60_000);
  const whenStr = fmtWhen(start);
  const subject = `${CLINIC_NAME} – Appointment confirmed (${whenStr})`;

  // Treat invoiceId as a payment link. Normalize to https:// if protocol missing.
  const rawPayUrl = invoiceId != null ? String(invoiceId).trim() : '';
  const payUrl = rawPayUrl
    ? (/^https?:\/\//i.test(rawPayUrl) ? rawPayUrl : `https://${rawPayUrl}`)
    : '';

  // Build QR image (PNG buffer) if we have a pay URL
  let qrPng: Buffer | undefined;
  if (payUrl) {
    qrPng = await QRCode.toBuffer(payUrl, { width: 256, margin: 1 });
  }

  const htmlPayBlock = payUrl
    ? `
      <div style="margin:16px 0 8px;">
        <a href="${payUrl}"
           target="_blank" rel="noopener noreferrer"
           style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;
                  padding:10px 16px;border-radius:8px;font-weight:600;">
          Pay now
        </a>
        <div style="font-size:12px;color:#666;margin-top:8px;">
          Or scan this QR code to pay:
        </div>
        <img src="cid:pay-qr"
             alt="Scan to pay"
             width="160" height="160"
             style="display:block;margin-top:6px;border:0;outline:none;" />
      </div>
    `
    : '';

  const html = `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.6;">
    <h2 style="margin:0 0 8px;">${CLINIC_NAME} – Appointment Confirmation</h2>
    <p>Hi ${patientName}${patientCode ? ` (${patientCode})` : ''},</p>
    <p>Your appointment has been scheduled.</p>
    <table style="border-collapse: collapse;">
      <tr><td style="padding:4px 12px 4px 0; color:#666;">When</td><td style="padding:4px 0;">${whenStr} (${CLINIC_TZ})</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Type</td><td style="padding:4px 0; text-transform:capitalize;">${type}</td></tr>
      ${location ? `<tr><td style="padding:4px 12px 4px 0; color:#666;">Location</td><td style="padding:4px 0;">${location}</td></tr>` : ''}
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Reference</td><td style="padding:4px 0;">#APT-${String(appointmentId).padStart(6, '0')}</td></tr>
    </table>

    ${notes ? `<p style="margin-top:12px"><strong>Notes:</strong> ${notes}</p>` : ''}

    ${htmlPayBlock}

    <p style="margin-top:16px;">We've attached a calendar invite. We look forward to seeing you!</p>
  </div>`.trim();

  const text = [
    `${CLINIC_NAME} – Appointment Confirmation`,
    ``,
    `Hi ${patientName}${patientCode ? ` (${patientCode})` : ''},`,
    `Your appointment has been scheduled.`,
    `When: ${whenStr} (${CLINIC_TZ})`,
    `Type: ${type}`,
    location ? `Location: ${location}` : '',
    `Reference: #APT-${String(appointmentId).padStart(6, '0')}`,
    notes ? `Notes: ${notes}` : '',
    payUrl ? `Pay now: ${payUrl}` : '',
    payUrl ? `Or scan the attached QR code to pay.` : '',
    ``,
    `A calendar invite is attached.`,
  ].filter(Boolean).join('\n');

  const ics = buildICS({
    id: appointmentId,
    start,
    end,
    summary: `${CLINIC_NAME}: ${type} with ${patientName}`,
    description: notes || undefined,
    location: location || undefined,
  });

  const attachments: any[] = [
    {
      filename: 'appointment.ics',
      content: ics,
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    },
  ];

  if (qrPng) {
    attachments.push({
      filename: 'pay-qr.png',
      content: qrPng,
      contentType: 'image/png',
      cid: 'pay-qr', // referenced in HTML <img src="cid:pay-qr">
    });
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments,
  });
}
