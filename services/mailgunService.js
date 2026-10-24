// services/mailgunService.js
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);

function createClient() {
  const required = ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL"];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing Mailgun configuration: ${missing.join(", ")}`);
  }

  return mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY
  });
}

export const mailgunService = {
  async sendEmail(to, subject, text, html) {
    const data = {
      from: process.env.MAILGUN_FROM_EMAIL,
      to,
      subject,
      text,
      html
    };

    try {
      const mg = createClient();
      const response = await mg.messages.create(process.env.MAILGUN_DOMAIN, data);
      return response;
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  },
  async sendTestEmail(email) {
    return this.sendEmail(
      email,
      'Test Email',
      'This is a test email from your application',
      '<h1>Test Email</h1><p>This is a test email from your application</p>'
    );
  }
};
