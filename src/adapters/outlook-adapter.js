const IEmailPlatform = require('../modules/m7-multi-platform-manager/IEmailPlatform');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

class OutlookPlatform extends IEmailPlatform {
  constructor() {
    super('outlook');
    this.imapConnection = null;
    this.smtpTransporter = null;
  }

  async connect(credentials) {
    const { email, password, accessToken } = credentials;

    try {
      this.imapConnection = new ImapFlow({
        host: 'outlook.office365.com',
        port: 993,
        secure: true,
        auth: {
          user: email,
          pass: password || accessToken
        },
        logger: false
      });

      await this.imapConnection.connect();

      this.smtpTransporter = nodemailer.createTransport({
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: email,
          pass: password || accessToken
        }
      });

      await this.smtpTransporter.verify();
      this.isConnected = true;
      this.lastError = null;

      return { success: true, message: 'Outlook connected successfully' };
    } catch (error) {
      this.isConnected = false;
      this.lastError = error.message;
      throw new Error(`Outlook connection failed: ${error.message}`);
    }
  }

  async send(email) {
    if (!this.isConnected) {
      throw new Error('Outlook not connected');
    }

    const mailOptions = {
      from: email.from,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
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
      throw new Error(`Outlook send failed: ${error.message}`);
    }
  }

  async fetchUnread(options = {}) {
    if (!this.isConnected) {
      throw new Error('Outlook not connected');
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
      throw new Error(`Outlook fetch failed: ${error.message}`);
    }
  }

  async getQuota() {
    if (!this.isConnected) {
      throw new Error('Outlook not connected');
    }

    try {
      const status = await this.imapConnection.status('INBOX', ['MESSAGES', 'UNSEEN']);
      return {
        totalMessages: status.messages || 0,
        unreadMessages: status.unseen || 0,
        storageUsed: null,
        storageLimit: 52428800000
      };
    } catch (error) {
      this.lastError = error.message;
      throw new Error(`Outlook quota check failed: ${error.message}`);
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
        platform: 'outlook'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        platform: 'outlook'
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
      console.error('Outlook disconnect error:', error.message);
    }
  }

  async moveToFolder(messageUid, targetFolder) {
    if (!this.isConnected) {
      throw new Error('Outlook not connected');
    }

    try {
      await this.imapConnection.messageMove([messageUid], targetFolder);
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to move message: ${error.message}`);
    }
  }
}

module.exports = OutlookPlatform;
