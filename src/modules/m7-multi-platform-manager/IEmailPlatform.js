class IEmailPlatform {
  constructor(platformType) {
    if (new.target === IEmailPlatform) {
      throw new Error('IEmailPlatform is an abstract class and cannot be instantiated directly');
    }
    this.platformType = platformType;
    this.isConnected = false;
    this.lastError = null;
  }

  async connect(credentials) {
    throw new Error('Method connect() must be implemented by subclass');
  }

  async send(email) {
    throw new Error('Method send() must be implemented by subclass');
  }

  async fetchUnread(options = {}) {
    throw new Error('Method fetchUnread() must be implemented by subclass');
  }

  async getQuota() {
    throw new Error('Method getQuota() must be implemented by subclass');
  }

  async healthCheck() {
    throw new Error('Method healthCheck() must be implemented by subclass');
  }

  async disconnect() {
    throw new Error('Method disconnect() must be implemented by subclass');
  }

  getPlatformInfo() {
    return {
      type: this.platformType,
      isConnected: this.isConnected,
      lastError: this.lastError
    };
  }
}

module.exports = IEmailPlatform;
