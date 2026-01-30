/**
 * Email Service - Outlook/Microsoft 365 SMTP
 * Sends transactional emails for user registration workflow
 */

import * as nodemailer from 'nodemailer';
import { emailTemplates } from './email-templates';

// Configuration from environment
const config = {
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'MyIO Platform',
  fromEmail: process.env.SMTP_FROM_EMAIL || '',
  enabled: process.env.EMAIL_ENABLED !== 'false',
};

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false,
      },
    });
  }
  return transporter;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class EmailService {
  /**
   * Send an email
   */
  async send(options: SendEmailOptions): Promise<EmailResult> {
    // If email is disabled, log and return success
    if (!config.enabled) {
      console.log(`[EMAIL-DISABLED] Would send to ${options.to}: ${options.subject}`);
      return { success: true, messageId: 'disabled' };
    }

    // Validate configuration
    if (!config.user || !config.pass) {
      console.warn('[EMAIL] SMTP credentials not configured, skipping email');
      return { success: false, error: 'SMTP not configured' };
    }

    try {
      const transport = getTransporter();

      const result = await transport.sendMail({
        from: `"${config.fromName}" <${config.fromEmail || config.user}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, ''),
      });

      console.log(`[EMAIL] Sent to ${options.to}: ${options.subject} (${result.messageId})`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[EMAIL] Failed to send to ${options.to}:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send email verification code
   */
  async sendVerificationCode(to: string, code: string, firstName: string): Promise<EmailResult> {
    const html = emailTemplates.verificationCode(code, firstName);
    return this.send({
      to,
      subject: `${code} - Codigo de Verificacao MyIO`,
      html,
    });
  }

  /**
   * Send password reset code
   */
  async sendPasswordResetCode(to: string, code: string, firstName: string): Promise<EmailResult> {
    const html = emailTemplates.passwordReset(code, firstName);
    return this.send({
      to,
      subject: `${code} - Redefinicao de Senha MyIO`,
      html,
    });
  }

  /**
   * Send account approved notification
   */
  async sendAccountApproved(to: string, firstName: string): Promise<EmailResult> {
    const html = emailTemplates.accountApproved(firstName);
    return this.send({
      to,
      subject: 'Sua conta MyIO foi aprovada!',
      html,
    });
  }

  /**
   * Send account rejected notification
   */
  async sendAccountRejected(to: string, firstName: string, reason: string): Promise<EmailResult> {
    const html = emailTemplates.accountRejected(firstName, reason);
    return this.send({
      to,
      subject: 'Atualizacao sobre seu cadastro MyIO',
      html,
    });
  }

  /**
   * Send account unlocked notification
   */
  async sendAccountUnlocked(to: string, firstName: string): Promise<EmailResult> {
    const html = emailTemplates.accountUnlocked(firstName);
    return this.send({
      to,
      subject: 'Sua conta MyIO foi desbloqueada',
      html,
    });
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!config.enabled) {
      console.log('[EMAIL] Email sending is disabled');
      return true;
    }

    if (!config.user || !config.pass) {
      console.warn('[EMAIL] SMTP credentials not configured');
      return false;
    }

    try {
      const transport = getTransporter();
      await transport.verify();
      console.log('[EMAIL] SMTP connection verified successfully');
      return true;
    } catch (error) {
      console.error('[EMAIL] SMTP connection failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const emailService = new EmailService();
