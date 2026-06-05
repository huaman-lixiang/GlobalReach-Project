const GmailPlatform = require('../../adapters/gmail-adapter');
const OutlookPlatform = require('../../adapters/outlook-adapter');
const QQMailPlatform = require('../../adapters/qq-mail-adapter');
const Mail163Platform = require('../../adapters/mail163-adapter');
const CustomSMTPPlatform = require('../../adapters/custom-smtp-adapter');

class PlatformFactory {
  static create(type) {
    switch(type.toLowerCase()) {
      case 'gmail':
        return new GmailPlatform();
      case 'outlook':
        return new OutlookPlatform();
      case 'qq':
        return new QQMailPlatform();
      case '163':
        return new Mail163Platform();
      case 'custom':
      case 'custom-smtp':
        return new CustomSMTPPlatform();
      default:
        throw new Error(`Unsupported platform type: ${type}`);
    }
  }

  static getSupportedPlatforms() {
    return [
      { type: 'gmail', name: 'Gmail', authModes: ['oauth2', 'app-password'] },
      { type: 'outlook', name: 'Outlook', authModes: ['oauth2', 'basic'] },
      { type: 'qq', name: 'QQ邮箱', authModes: ['authorization-code'] },
      { type: '163', name: '163邮箱', authModes: ['authorization-code'] },
      { type: 'custom', name: '企业自定义SMTP', authModes: ['basic', 'tls'] }
    ];
  }
}

module.exports = PlatformFactory;
