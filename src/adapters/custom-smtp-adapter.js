const IEmailPlatform = require('../modules/m7-multi-platform-manager/IEmailPlatform');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

class CustomSMTPPlatform extends IEmailPlatform {
  constructor() {
    super('custom');
    this.imapConnection = null;
    this.smtpTransporter = null;
    this.config = {};
  }

  async connect(credentials) {
    const { 
      imapHost, 
      smtpHost, 
      email, 
      password, 
      imapPort = 993, 
      smtpPort = 587,
      secure = false,
      tls = true
    } = credentials;

    if (!smtpHost || !email) {
      throw new Error('企业自定义SMTP必须提供smtpHost和email');
    }

    this.config = {
      imapHost,
      smtpHost,
      imapPort,
      smtpPort,
      secure,
      tls
    };

    try {
      if (imapHost) {
        this.imapConnection = new ImapFlow({
          host: imapHost,
          port: imapPort,
          secure: secure,
          tls: tls,
          auth: {
            user: email,
            pass: password
          },
          logger: false
        });
        await this.imapConnection.connect();
      }

      this.smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: secure,
        requireTLS: tls,
        auth: {
          user: email,
          pass: password
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      await this.smtpTransporter.verify();
      this.isConnected = true;
      this.lastError = null;

      return { success: true, message: '企业SMTP连接成功' };
    } catch (error) {
      this.isConnected = false;
      this.lastError = error.message;
      throw new Error(`企业SMTP连接失败: ${error.message}`);
    }
  }

  async send(email) {
    if (!this.isConnected) {
      throw new Error('企业SMTP未连接');
    }

    const mailOptions = {
      from: email.from,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.html || email.text,
      text: email.text,
      attachments: email.attachments || [],
      headers: email.headers || {}
    };

    try {
      const result = await this.smtpTransporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`企业SMTP发送失败: ${error.message}`);
    }
  }

  async fetchUnread(options = {}) {
    if (!this.isConnected || !this.imapConnection) {
      throw new Error('企业IMAP未配置或未连接');
    }

    const { limit = 10, folder = 'INBOX', since } = options;

    try {
      const lock = await this.imapConnection.getMailboxLock(folder);

      try {
        let searchCriteria = ['unseen'];
        if (since) {
          searchCriteria.push(['SINCE', since]);
        }

        const messages = await this.imapConnection.search(searchCriteria);
        const limitedMessages = limit ? messages.slice(0, limit) : messages;

        const fetchedMessages = [];
        for (const uid of limitedMessages) {
          const msg = await this.imapConnection.fetchOne(uid, { source: true });
          fetchedMessages.push({
            uid: msg.uid,
            from: msg.from?.text || '',
            to: msg.to?.text || '',
            subject: msg.subject || '',
            date: msg.date,
            body: msg.source.toString()
          });
        }
        return fetchedMessages;
      } finally {
        lock.release();
      }
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`企业IMAP获取邮件失败: ${error.message}`);
    }
  }

  async getQuota() {
    if (!this.isConnected || !this.imapConnection) {
      return {
        totalMessages: 0,
        unreadMessages: 0,
        storageUsed: null,
        storageLimit: null
      };
    }

    try {
      const status = await this.imapConnection.status('INBOX', ['MESSAGES', 'UNSEEN']);
      return {
        totalMessages: status.messages || 0,
        unreadMessages: status.unseen || 0,
        storageUsed: null,
        storageLimit: null
      };
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`企业IMAP配额检查失败: ${error.message}`);
    }
  }

  async healthCheck() {
    if (!this.isConnected) {
      return { status: 'error', error: '未连接', platform: 'custom' };
    }

    try {
      const startTime = Date.now();

      if (this.imapConnection) {
        await this.imapConnection.noop();
      } else {
        await this.smtpTransporter.verify();
      }

      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
        platform: 'custom'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        platform: 'custom'
      };
    }
  }

  async disconnect() {
    try {
      if (this.imapConnection) {
        await this.imapConnection.logout();
      }
      if (this.smtpTransporter) {
        this.smtpTransporter.close();
      }
      this.isConnected = false;
    } catch (error) {
      console.error('企业SMTP断开连接错误:', error.message);
    }
  }

  getConfig() {
    return { ...this.config };
  }
}

module.exports = CustomSMTPPlatform;
