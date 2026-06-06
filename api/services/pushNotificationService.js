const db = require('../db');

let admin;

try {
  admin = require('firebase-admin');
} catch (e) {
  console.warn('[PushNotification] firebase-admin not available, FCM disabled');
}

// S095/PhaseH: Removed apn package (unmaintained, jsonwebtoken HIGH CVEs)
// iOS push notifications now routed through FCM (firebase-admin)
// APNs direct support removed — requires Apple credentials not configured

class PushNotificationService {
  constructor() {
    this.fcmInitialized = false;
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

  // S095: initializeAPN removed — apn package removed (unmaintained, HIGH CVEs)

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
        // S095: All platforms routed through FCM (apn removed)
        await this.sendToFCM(device.deviceToken, title, body, data);
        success++;
      } catch (error) {
        console.error('[PushNotification] Failed to send to device:', error.message);
        failed++;
      }
    }

    return { success, failed };
  }

  async sendToDevice(deviceToken, platform, title, body, data = {}) {
    // S095: All platforms use FCM (apn package removed)
    return this.sendToFCM(deviceToken, title, body, data);
  }

  // S095: sendToAPN removed — apn package removed, iOS via FCM

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