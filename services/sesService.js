// utils/sesService.js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import dotenv from "dotenv";

dotenv.config();

class SESService {
  constructor() {
    this.validateEnvironment();
    this.client = new SESClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  validateEnvironment() {
    const required = [
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SES_FROM_EMAIL",
    ];

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  async sendEmail(to, subject, textContent, htmlContent = null) {
    const params = {
      Source: process.env.AWS_SES_FROM_EMAIL,
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: textContent,
            Charset: "UTF-8",
          },
          ...(htmlContent && {
            Html: {
              Data: htmlContent,
              Charset: "UTF-8",
            },
          }),
        },
      },
    };

    try {
      const command = new SendEmailCommand(params);
      const response = await this.client.send(command);
      return response;
    } catch (error) {
      console.error("Error sending email:", error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendTestEmail(email) {
    return this.sendEmail(
      email,
      "Test Email",
      "This is a test email to verify that the email sending functionality works."
    );
  }
}

export const sesService = new SESService();