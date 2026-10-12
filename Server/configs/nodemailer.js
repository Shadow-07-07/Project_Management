import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, body }) => {
  const missingConfig = ['SMTP_USER', 'SMTP_PASS', 'SENDER_EMAIL']
    .filter((key) => !process.env[key]);
  if (missingConfig.length > 0) {
    throw new Error(`Email configuration is missing: ${missingConfig.join(', ')}`);
  }

  const response = await transporter.sendMail({
    from: process.env.SENDER_EMAIL, // sender address
    to, // list of recipients
    subject, // subject line 
    html: body, // HTML body
  });
  return response
}

export default sendEmail