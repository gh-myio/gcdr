/**
 * Email Templates - HTML templates for transactional emails
 */

const baseStyle = `
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .card { background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .header { text-align: center; margin-bottom: 30px; }
  .logo { font-size: 28px; font-weight: bold; color: #2563eb; }
  .code-box { background-color: #f0f9ff; border: 2px dashed #2563eb; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
  .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e40af; font-family: monospace; }
  .message { color: #374151; font-size: 16px; line-height: 1.6; }
  .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
  .button { display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
  .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; color: #92400e; }
  .success { background-color: #d1fae5; border-left: 4px solid #10b981; padding: 12px; margin: 20px 0; color: #065f46; }
`;

function wrapTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyle}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo">MyIO</div>
      </div>
      ${content}
      <div class="footer">
        <p>Este email foi enviado automaticamente. Por favor, nao responda.</p>
        <p>&copy; ${new Date().getFullYear()} MyIO Platform. Todos os direitos reservados.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export const emailTemplates = {
  /**
   * Email verification code template
   */
  verificationCode: (code: string, firstName: string): string => {
    return wrapTemplate(`
      <div class="message">
        <p>Ola <strong>${firstName}</strong>,</p>
        <p>Obrigado por se cadastrar na plataforma MyIO!</p>
        <p>Use o codigo abaixo para verificar seu email:</p>
      </div>

      <div class="code-box">
        <div class="code">${code}</div>
      </div>

      <div class="message">
        <p>Este codigo expira em <strong>15 minutos</strong>.</p>
        <div class="warning">
          Se voce nao solicitou este cadastro, ignore este email.
        </div>
      </div>
    `);
  },

  /**
   * Password reset code template
   */
  passwordReset: (code: string, firstName: string): string => {
    return wrapTemplate(`
      <div class="message">
        <p>Ola <strong>${firstName}</strong>,</p>
        <p>Recebemos uma solicitacao para redefinir sua senha.</p>
        <p>Use o codigo abaixo para criar uma nova senha:</p>
      </div>

      <div class="code-box">
        <div class="code">${code}</div>
      </div>

      <div class="message">
        <p>Este codigo expira em <strong>15 minutos</strong>.</p>
        <div class="warning">
          Se voce nao solicitou a redefinicao de senha, sua conta pode estar em risco.
          Recomendamos que voce altere sua senha imediatamente.
        </div>
      </div>
    `);
  },

  /**
   * Account approved notification template
   */
  accountApproved: (firstName: string): string => {
    return wrapTemplate(`
      <div class="message">
        <p>Ola <strong>${firstName}</strong>,</p>

        <div class="success">
          <strong>Otimas noticias!</strong> Sua conta foi aprovada e esta pronta para uso.
        </div>

        <p>Agora voce pode acessar todas as funcionalidades da plataforma MyIO.</p>

        <p style="text-align: center;">
          <a href="#" class="button">Acessar MyIO</a>
        </p>

        <p>Se precisar de ajuda, nossa equipe de suporte esta a disposicao.</p>
      </div>
    `);
  },

  /**
   * Account rejected notification template
   */
  accountRejected: (firstName: string, reason: string): string => {
    return wrapTemplate(`
      <div class="message">
        <p>Ola <strong>${firstName}</strong>,</p>

        <p>Infelizmente, seu cadastro na plataforma MyIO nao foi aprovado.</p>

        <div class="warning">
          <strong>Motivo:</strong> ${reason}
        </div>

        <p>Se voce acredita que houve um erro ou deseja mais informacoes,
        entre em contato com nossa equipe de suporte.</p>

        <p>Atenciosamente,<br>Equipe MyIO</p>
      </div>
    `);
  },

  /**
   * Account unlocked notification template
   */
  accountUnlocked: (firstName: string): string => {
    return wrapTemplate(`
      <div class="message">
        <p>Ola <strong>${firstName}</strong>,</p>

        <div class="success">
          Sua conta foi desbloqueada com sucesso!
        </div>

        <p>Voce pode acessar a plataforma normalmente agora.</p>

        <p><strong>Dica de seguranca:</strong> Se voce nao reconhece as tentativas
        de acesso que causaram o bloqueio, recomendamos alterar sua senha.</p>

        <p style="text-align: center;">
          <a href="#" class="button">Acessar MyIO</a>
        </p>
      </div>
    `);
  },
};
