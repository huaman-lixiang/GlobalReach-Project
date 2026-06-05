const IEmailPlatform = require('../modules/m7-multi-platform-manager/IEmailPlatform');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

class GmailPlatform extends IEmailPlatform {
  constructor() {
    super('gmail');
    this.imapConnection = null;
    this.smtpTransporter = null;
  }

  async connect(credentials) {
    const { email, password, oauthToken } = credentials;

    try {
      this.imapConnection = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
          user: email,
          pass: password || oauthToken
        },
        logger: false
      });

      await this.imapConnection.connect();

      this.smtpTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: email,
          pass: password || oauthToken
        }
      });

      await this.smtpTransporter.verify();
      this.isConnected = true;
      this.lastError = null;

      return { success: true, message: 'Gmail connected successfully' };
    } catch (error) {
      this.isConnected = false;
      this.lastError = error.message;
      throw new Error(`Gmail connection failed: ${error.message}`);
    }
  }

  async send(email) {
    if (!this.isConnected) {
      throw new Error('Gmail not connected');
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
      throw new Error(`Gmail send failed: ${error.message}`);
    }
  }

  async fetchUnread(options = {}) {
    if (!this.isConnected) {
      throw new Error('Gmail not connected');
    }

    const { limit = 10, folder = 'INBOX', since } = options;
    let messages = [];

    try {
      const lock = await this.imapConnection.getMailboxLock(folder);

      try {
        let searchCriteria = ['unseen'];
        if (since) {
          searchCriteria.push(['SINCE', since]);
        }

        messages = await this.imapConnection.search(searchCriteria);

        if (limit && messages.length > limit) {
          messages = messages.slice(0, limit);
        }

        const fetchedMessages = [];
        for (const uid of messages) {
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
      throw new Error(`Gmail fetch failed: ${error.message}`);
    }
  }

  async getQuota() {
    if (!this.isConnected) {
      throw new Error('Gmail not connected');
    }

    try {
      const status = await this.imapConnection.status('INBOX', ['MESSAGES', 'UNSEEN']);
      return {
        totalMessages: status.messages || 0,
        unreadMessages: status.unseen || 0,
        storageUsed: null,
        storageLimit: 15728640000
      };
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`Gmail quota check failed: ${error.message}`);
    }
  }

  async healthCheck() {
    if (!this.isConnected) {
      return { status: 'error', error: 'Not connected' };
    }

    try {
      const startTime = Date.now();
      await this.imapConnection.noop();
      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
        platform: 'gmail'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        platform: 'gmail'
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
      console.error('Gmail disconnect error:', error.message);
    }
  }

  async addLabel(messageUid, label) {
    if (!this.isConnected) {
      throw new Error('Gmail not connected');
    }

    try {
      await this.imapConnection.messageFlagsAdd([messageUid], [`$${label}`]);
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to add label: ${error.message}`);
    }
  }
}

module.exports = GmailPlatform;
