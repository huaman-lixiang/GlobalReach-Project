const db = require('../db');

class TemplateService {
  async createTemplate(userId, name, subject, body, description = '', isDefault = false) {
    if (isDefault) {
      await db.EmailTemplate.update(
        { isDefault: false },
        { where: { userId, isDefault: true } }
      );
    }

    return db.EmailTemplate.create({
      userId,
      name,
      subject,
      body,
      description,
      isDefault,
    });
  }

  async getTemplates(userId) {
    return db.EmailTemplate.findAll({
      where: { userId },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    });
  }

  async getTemplateById(id, userId) {
    return db.EmailTemplate.findOne({
      where: { id, userId },
    });
  }

  async updateTemplate(id, userId, updates) {
    if (updates.isDefault) {
      await db.EmailTemplate.update(
        { isDefault: false },
        { where: { userId, isDefault: true, id: { [db.Sequelize.Op.ne]: id } } }
      );
    }

    return db.EmailTemplate.update(updates, {
      where: { id, userId },
    });
  }

  async deleteTemplate(id, userId) {
    return db.EmailTemplate.destroy({
      where: { id, userId },
    });
  }

  async setDefaultTemplate(id, userId) {
    await db.EmailTemplate.update(
      { isDefault: false },
      { where: { userId, isDefault: true } }
    );

    return db.EmailTemplate.update(
      { isDefault: true },
      { where: { id, userId } }
    );
  }

  renderTemplate(template, data) {
    let subject = template.subject;
    let body = template.body;

    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      subject = subject.replace(new RegExp(placeholder, 'g'), String(value ?? ''));
      body = body.replace(new RegExp(placeholder, 'g'), String(value ?? ''));
    }

    return { subject, body };
  }

  async renderTemplateById(id, userId, data) {
    const template = await this.getTemplateById(id, userId);
    if (!template) {
      throw new Error('TEMPLATE_NOT_FOUND');
    }
    return this.renderTemplate(template, data);
  }

  getAvailableVariables() {
    return [
      { name: 'firstName', description: '收件人名字', example: 'John' },
      { name: 'lastName', description: '收件人姓氏', example: 'Doe' },
      { name: 'company', description: '公司名称', example: 'Acme Inc' },
      { name: 'email', description: '收件人邮箱', example: 'john@example.com' },
      { name: 'campaignName', description: '活动名称', example: 'Summer Sale' },
      { name: 'today', description: '今天日期', example: '2024-01-15' },
      { name: 'link', description: '链接', example: 'https://example.com' },
      { name: 'unsubscribeLink', description: '退订链接', example: 'https://example.com/unsubscribe' },
      { name: 'senderName', description: '发件人姓名', example: 'Jane Smith' },
      { name: 'senderCompany', description: '发件人公司', example: 'GlobalReach' },
    ];
  }
}

const templateService = new TemplateService();

module.exports = {
  TemplateService,
  templateService,
};