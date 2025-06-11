// services/mailgunService.js
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY
});

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