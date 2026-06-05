const db = require('../db');

let admin;
let apn;

try {
  admin = require('firebase-admin');
} catch (e) {
  console.warn('[PushNotification] firebase-admin not available, FCM disabled');
}

try {
  apn = require('apn');
} catch (e) {
  console.warn('[PushNotification] apn not available, APN disabled');
}

class PushNotificationService {
  constructor() {
    this.fcmInitialized = false;
    this.apnProvider = null;
  }

  initializeFCM() {
    if (this.fcmInitialized) return;
    
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
      if (Object.keys(serviceAccount).length > 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.fcmInitialized = true;
        console.log('[PushNotification] FCM initialized successfully');
      }
    } catch (error) {
      console.warn('[PushNotification] FCM initialization failed:', error.message);
    }
  }

  initializeAPN() {
    if (this.apnProvider) return;
    
    try {
      const apnOptions = {
        token: {
          key: process.env.APN_KEY || '',
          keyId: process.env.APN_KEY_ID || '',
          teamId: process.env.APN_TEAM_ID || '',
        },
        production: process.env.NODE_ENV === 'production',
      };
      
      if (apnOptions.token.key && apnOptions.token.keyId && apnOptions.token.teamId) {
        this.apnProvider = new apn.Provider(apnOptions);
        console.log('[PushNotification] APN initialized successfully');
      }
    } catch (error) {
      console.warn('[PushNotification] APN initialization failed:', error.message);
    }
  }

  async registerDevice(userId, deviceToken, platform, deviceId) {
    const existingDevice = await db.Device.findOne({
      where: { deviceId, userId },
    });

    if (existingDevice) {
      return existingDevice.update({ deviceToken, platform });
    }

    return db.Device.create({
      userId,
      deviceToken,
      platform,
      deviceId,
      enabled: true,
    });
  }

  async unregisterDevice(userId, deviceId) {
    return db.Device.destroy({
      where: { userId, deviceId },
    });
  }

  async disableDevice(userId, deviceId) {
    return db.Device.update(
      { enabled: false },
      { where: { userId, deviceId } }
    );
  }

  async getDevices(userId) {
    return db.Device.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  async sendToUser(userId, title, body, data = {}) {
    const devices = await db.Device.findAll({
      where: { userId, enabled: true },
    });

    if (devices.length === 0) {
      return { success: 0, failed: 0 };
    }

    let success = 0;
    let failed = 0;

    for (const device of devices) {
      try {
        if (device.platform === 'ios') {
          await this.sendToAPN(device.deviceToken, title, body, data);
        } else {
          await this.sendToFCM(device.deviceToken, title, body, data);
        }
        success++;
      } catch (error) {
        console.error('[PushNotification] Failed to send to device:', error.message);
        failed++;
      }
    }

    return { success, failed };
  }

  async sendToDevice(deviceToken, platform, title, body, data = {}) {
    if (platform === 'ios') {
      return this.sendToAPN(deviceToken, title, body, data);
    }
    return this.sendToFCM(deviceToken, title, body, data);
  }

  async sendToAPN(deviceToken, title, body, data = {}) {
    this.initializeAPN();
    
    if (!this.apnProvider) {
      throw new Error('APN not configured');
    }

    const note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600;
    note.badge = 1;
    note.sound = 'ping.aiff';
    note.alert = { title, body };
    note.payload = data;
    note.topic = process.env.APN_TOPIC || '';

    const result = await this.apnProvider.send(note, deviceToken);
    
    if (result.failed.length > 0) {
      throw new Error(`APN delivery failed: ${result.failed[0].response.reason}`);
    }
  }

  async sendToFCM(deviceToken, title, body, data = {}) {
    this.initializeFCM();
    
    if (!this.fcmInitialized) {
      throw new Error('FCM not configured');
    }

    const message = {
      token: deviceToken,
      notification: {
        title,
        body,
      },
      data,
      priority: 'high',
    };

    const response = await admin.messaging().send(message);
    
    if (!response) {
      throw new Error('FCM delivery failed');
    }
  }

  async sendEmailEventNotification(userId, eventType, emailData) {
    const title = this.getNotificationTitle(eventType);
    const body = this.getNotificationBody(eventType, emailData);
    
    const data = {
      eventType,
      emailId: emailData.id,
      timestamp: Date.now().toString(),
    };

    return this.sendToUser(userId, title, body, data);
  }

  getNotificationTitle(eventType) {
    const titles = {
      email_delivered: 'Email Delivered',
      email_opened: 'Email Opened',
      email_clicked: 'Link Clicked',
      email_bounced: 'Email Bounced',
      email_converted: 'Conversion!',
      campaign_completed: 'Campaign Completed',
    };
    return titles[eventType] || 'Notification';
  }

  getNotificationBody(eventType, data) {
    const bodies = {
      email_delivered: `Email delivered to ${data.to_address}`,
      email_opened: `Email opened by ${data.to_address}`,
      email_clicked: `Link clicked in email to ${data.to_address}`,
      email_bounced: `Email bounced to ${data.to_address}`,
      email_converted: `Conversion from ${data.to_address}!`,
      campaign_completed: `Campaign "${data.name}" completed`,
    };
    return bodies[eventType] || 'New notification';
  }
}

const pushNotificationService = new PushNotificationService();

module.exports = {
  PushNotificationService,
  pushNotificationService,
};