const IEmailPlatform = require('../modules/m7-multi-platform-manager/IEmailPlatform');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

class QQMailPlatform extends IEmailPlatform {
  constructor() {
    super('qq');
    this.imapConnection = null;
    this.smtpTransporter = null;
  }

  async connect(credentials) {
    const { email, authCode } = credentials;

    if (!authCode) {
      throw new Error('QQ邮箱需要授权码(authCode)');
    }

    try {
      this.imapConnection = new ImapFlow({
        host: 'imap.qq.com',
        port: 993,
        secure: true,
        auth: {
          user: email,
          pass: authCode
        },
        logger: false
      });

      await this.imapConnection.connect();

      this.smtpTransporter = nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: {
          user: email,
          pass: authCode
        }
      });

      await this.smtpTransporter.verify();
      this.isConnected = true;
      this.lastError = null;

      return { success: true, message: 'QQ邮箱连接成功' };
    } catch (error) {
      this.isConnected = false;
      this.lastError = error.message;
      throw new Error(`QQ邮箱连接失败: ${error.message}`);
    }
  }

  async send(email) {
    if (!this.isConnected) {
      throw new Error('QQ邮箱未连接');
    }

    const mailOptions = {
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html || email.text,
      text: email.text,
      attachments: email.attachments || []
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
      throw new Error(`QQ邮箱发送失败: ${error.message}`);
    }
  }

  async fetchUnread(options = {}) {
    if (!this.isConnected) {
      throw new Error('QQ邮箱未连接');
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
      throw new Error(`QQ邮箱获取邮件失败: ${error.message}`);
    }
  }

  async getQuota() {
    if (!this.isConnected) {
      throw new Error('QQ邮箱未连接');
    }

    try {
      const status = await this.imapConnection.status('INBOX', ['MESSAGES', 'UNSEEN']);
      return {
        totalMessages: status.messages || 0,
        unreadMessages: status.unseen || 0,
        storageUsed: null,
        storageLimit: 16106127360
      };
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`QQ邮箱配额检查失败: ${error.message}`);
    }
  }

  async healthCheck() {
    if (!this.isConnected) {
      return { status: 'error', error: '未连接', platform: 'qq' };
    }

    try {
      const startTime = Date.now();
      await this.imapConnection.noop();
      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
        platform: 'qq'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        platform: 'qq'
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
      console.error('QQ邮箱断开连接错误:', error.message);
    }
  }
}

module.exports = QQMailPlatform;
