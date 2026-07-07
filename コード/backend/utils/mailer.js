const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function isSmtpEnabled() {
    return (
        config.mail.mode === 'smtp' &&
        !!config.mail.host &&
        !!config.mail.user &&
        !!config.mail.pass
    );
}

function getTransporter() {
    if (!isSmtpEnabled()) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: config.mail.host,
            port: config.mail.port,
            secure: config.mail.secure,
            auth: {
                user: config.mail.user,
                pass: config.mail.pass
            }
        });
    }
    return transporter;
}

function formatRecipients(to) {
    if (Array.isArray(to)) {
        return to.filter(Boolean).join(',');
    }
    return String(to || '').trim();
}

async function sendMail({ to, subject, text, html }) {
    const recipients = formatRecipients(to);
    const finalSubject = String(subject || 'Shared Calendar notification').trim();
    const finalText = String(text || '').trim();

    if (!recipients) {
        return { skipped: true, reason: 'missing_recipient' };
    }

    const mailOptions = {
        from: config.mail.from,
        to: recipients,
        subject: finalSubject,
        text: finalText || finalSubject,
        html
    };

    const activeTransporter = getTransporter();
    if (!activeTransporter) {
        console.log('\n--- [MOCK MAIL SERVER] ---');
        console.log(`To: ${mailOptions.to}`);
        console.log(`Subject: ${mailOptions.subject}`);
        console.log(`Content: ${mailOptions.text}`);
        console.log('MAIL_MODE=smtp and SMTP_* settings are required for real email delivery.');
        console.log('--------------------------\n');
        return { mock: true, accepted: [recipients] };
    }

    const info = await activeTransporter.sendMail(mailOptions);
    return {
        messageId: info.messageId,
        accepted: info.accepted || [],
        rejected: info.rejected || []
    };
}

module.exports = {
    sendMail,
    isSmtpEnabled
};
