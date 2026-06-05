const db = require('../db');
const { Op } = require('sequelize');

let json2csv;
let XLSX;
let PDFDocument;

try {
  json2csv = require('json2csv').parse;
} catch (e) {
  console.warn('[ExportService] json2csv not available, CSV export disabled');
}

try {
  XLSX = require('xlsx');
} catch (e) {
  console.warn('[ExportService] xlsx not available, Excel export disabled');
}

try {
  PDFDocument = require('pdfkit');
} catch (e) {
  console.warn('[ExportService] pdfkit not available, PDF export disabled');
}

class ExportService {
  async exportEmailsCSV(userId, filters = {}) {
    const whereClause = { '$campaign.userId$': userId };

    if (filters.campaignId) {
      whereClause.campaignId = filters.campaignId;
    }

    if (filters.startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(filters.startDate) };
    }

    if (filters.endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: new Date(filters.endDate),
      };
    }

    const emails = await db.Email.findAll({
      where: whereClause,
      include: [{ model: db.Campaign, attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
    });

    const data = emails.map(e => ({
      id: e.id,
      to_address: e.to_address,
      subject: e.subject,
      status: e.status,
      opened: e.opened ? 'Yes' : 'No',
      clicked: e.clicked ? 'Yes' : 'No',
      converted: e.converted ? 'Yes' : 'No',
      campaign: e.Campaign?.name || '',
      created_at: e.createdAt.toISOString(),
    }));

    const fields = ['id', 'to_address', 'subject', 'status', 'opened', 'clicked', 'converted', 'campaign', 'created_at'];
    const csv = json2csv(data, { fields });

    return {
      filename: `emails_${Date.now()}.csv`,
      content: csv,
      contentType: 'text/csv',
    };
  }

  async exportEmailsExcel(userId, filters = {}) {
    const whereClause = { '$campaign.userId$': userId };

    if (filters.campaignId) {
      whereClause.campaignId = filters.campaignId;
    }

    if (filters.startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(filters.startDate) };
    }

    if (filters.endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: new Date(filters.endDate),
      };
    }

    const emails = await db.Email.findAll({
      where: whereClause,
      include: [{ model: db.Campaign, attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
    });

    const data = emails.map(e => ({
      ID: e.id,
      'To Address': e.to_address,
      Subject: e.subject,
      Status: e.status,
      Opened: e.opened ? 'Yes' : 'No',
      Clicked: e.clicked ? 'Yes' : 'No',
      Converted: e.converted ? 'Yes' : 'No',
      Campaign: e.Campaign?.name || '',
      'Created At': e.createdAt.toLocaleString(),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Emails');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return {
      filename: `emails_${Date.now()}.xlsx`,
      content: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async exportCampaignsCSV(userId, filters = {}) {
    const whereClause = { userId };

    if (filters.status) {
      whereClause.status = filters.status;
    }

    const campaigns = await db.Campaign.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
    });

    const data = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      email_count: c.emailCount || 0,
      created_at: c.createdAt.toISOString(),
    }));

    const fields = ['id', 'name', 'type', 'status', 'email_count', 'created_at'];
    const csv = json2csv(data, { fields });

    return {
      filename: `campaigns_${Date.now()}.csv`,
      content: csv,
      contentType: 'text/csv',
    };
  }

  async exportAnalyticsPDF(userId, filters = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.font('Helvetica-Bold').fontSize(20).text('Email Analytics Report', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    doc.font('Helvetica-Bold').fontSize(14).text('Overview');
    doc.font('Helvetica').fontSize(12);

    const analytics = await this.getAnalyticsData(userId, filters);

    doc.text(`Total Emails: ${analytics.total}`);
    doc.text(`Delivered: ${analytics.delivered} (${analytics.deliveryRate}%)`);
    doc.text(`Opened: ${analytics.opened} (${analytics.openRate}%)`);
    doc.text(`Clicked: ${analytics.clicked} (${analytics.clickRate}%)`);
    doc.text(`Bounced: ${analytics.bounced} (${analytics.bounceRate}%)`);
    doc.text(`Converted: ${analytics.converted} (${analytics.conversionRate}%)`);

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(14).text('Campaign Performance');
    doc.font('Helvetica').fontSize(10);

    const campaigns = await db.Campaign.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    const tableTop = doc.y;
    doc.text('Campaign Name', 50, tableTop);
    doc.text('Status', 250, tableTop);
    doc.text('Emails', 350, tableTop);
    doc.text('Open Rate', 420, tableTop);

    let y = tableTop + 20;
    campaigns.forEach(campaign => {
      doc.text(campaign.name.substring(0, 30), 50, y);
      doc.text(campaign.status, 250, y);
      doc.text(String(campaign.emailCount || 0), 350, y);
      doc.text('-', 420, y);
      y += 15;
    });

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));
    const pdfBuffer = Buffer.concat(buffers);

    return {
      filename: `analytics_report_${Date.now()}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    };
  }

  async getAnalyticsData(userId, filters) {
    const whereClause = { '$campaign.userId$': userId };
    
    if (filters.startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: new Date(filters.endDate),
      };
    }

    const [total, delivered, opened, clicked, bounced, converted] = await Promise.all([
      db.Email.count({ where: whereClause, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, status: 'delivered' }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, opened: true }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, clicked: true }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, status: 'bounced' }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, converted: true }, include: [{ model: db.Campaign }] }),
    ]);

    return {
      total,
      delivered,
      opened,
      clicked,
      bounced,
      converted,
      deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) : '0',
      openRate: delivered > 0 ? ((opened / delivered) * 100).toFixed(1) : '0',
      clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(1) : '0',
      bounceRate: total > 0 ? ((bounced / total) * 100).toFixed(1) : '0',
      conversionRate: clicked > 0 ? ((converted / clicked) * 100).toFixed(1) : '0',
    };
  }
}

const exportService = new ExportService();

module.exports = {
  ExportService,
  exportService,
};