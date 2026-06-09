const db = require('../db');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

// ============================================
// 字段映射配置（支持中英文列名）
// ============================================
const FIELD_MAP = {
  // 公司名称
  '公司名称': 'company',
  'company_name': 'company',
  'company': 'company',
  // 联系人
  '联系人': 'contact_name',
  'contact_name': 'contact_name',
  'contact': 'contact_name',
  // 邮箱
  '邮箱': 'email',
  'email': 'email',
  'Email': 'email',
  // 电话
  '电话': 'phone',
  'phone': 'phone',
  'Phone': 'phone',
  // 地址
  '地址': 'address',
  'address': 'address',
  'Address': 'address',
  // 行业
  '行业': 'industry',
  'industry': 'industry',
  'Industry': 'industry',
  // 备注
  '备注': 'notes',
  'notes': 'notes',
  'Notes': 'notes',
};

// 必填字段映射到模型字段
const REQUIRED_FIELDS = ['company', 'email'];

// 单次最大行数限制
const MAX_ROWS = 1000;

// 邮箱格式正则
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ClientImportService {
  /**
   * 从上传的文件中解析数据（支持 .xlsx 和 .csv）
   */
  async parseFile(buffer, originalName) {
    const ext = originalName.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      return this._parseExcel(buffer);
    } else if (ext === 'csv') {
      return this._parseCSV(buffer);
    } else {
      throw new Error('不支持的文件格式，请上传 .xlsx 或 .csv 文件');
    }
  }

  /**
   * 解析 Excel 文件
   */
  async _parseExcel(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('Excel 文件中没有工作表');
    }

    const rows = [];
    let headerRow = null;
    let headerMap = {};

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        // 解析表头，建立列名映射
        headerRow = row.values;
        headerRow.forEach((cell, colIndex) => {
          if (colIndex > 0 && cell) {
            const key = String(cell).trim();
            if (FIELD_MAP[key]) {
              headerMap[colIndex] = FIELD_MAP[key];
            } else {
              // 尝试不区分大小写匹配
              const normalizedKey = key.toLowerCase().trim();
              for (const [cnKey, cnValue] of Object.entries(FIELD_MAP)) {
                if (cnKey.toLowerCase() === normalizedKey) {
                  headerMap[colIndex] = cnValue;
                  break;
                }
              }
              // 如果还是没找到，用原始列名
              if (!headerMap[colIndex]) {
                headerMap[colIndex] = key;
              }
            }
          }
        });
      } else {
        // 数据行
        const rowData = {};
        let hasData = false;
        row.values.forEach((cell, colIndex) => {
          if (colIndex > 0 && headerMap[colIndex]) {
            const value = cell !== undefined && cell !== null ? String(cell).trim() : '';
            rowData[headerMap[colIndex]] = value;
            if (value) hasData = true;
          }
        });
        if (hasData && Object.keys(rowData).length > 0) {
          rowData._rowNumber = rowNumber;
          rows.push(rowData);
        }
      }
    });

    return rows;
  }

  /**
   * 解析 CSV 文件（简单实现）
   */
  async _parseCSV(buffer) {
    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());

    if (lines.length < 2) {
      throw new Error('CSV 文件至少需要包含表头和一行数据');
    }

    // 解析 CSV 行（处理引号包裹的字段）
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const headerMap = {};

    headers.forEach((h, idx) => {
      const key = h.trim();
      if (FIELD_MAP[key]) {
        headerMap[idx] = FIELD_MAP[key];
      } else {
        const normalizedKey = key.toLowerCase().trim();
        for (const [cnKey, cnValue] of Object.entries(FIELD_MAP)) {
          if (cnKey.toLowerCase() === normalizedKey) {
            headerMap[idx] = cnValue;
            break;
          }
        }
        if (!headerMap[idx]) {
          headerMap[idx] = key;
        }
      }
    });

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const rowData = {};
      let hasData = false;

      values.forEach((val, idx) => {
        if (headerMap[idx]) {
          rowData[headerMap[idx]] = val || '';
          if (val && val.trim()) hasData = true;
        }
      });

      if (hasData && Object.keys(rowData).length > 0) {
        rowData._rowNumber = i + 1; // CSV行号从1开始，+1因为第1行是表头
        rows.push(rowData);
      }
    }

    return rows;
  }

  /**
   * 验证并导入客户数据
   * @param {Array} rows - 解析后的数据行
   * @param {string} userId - 当前用户ID
   * @returns {Object} 导入结果摘要
   */
  async importClients(rows, userId) {
    // 检查行数限制
    if (rows.length > MAX_ROWS) {
      throw new Error(`单次导入最多支持 ${MAX_ROWS} 行数据，当前 ${rows.length} 行`);
    }

    if (rows.length === 0) {
      return {
        total: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };
    }

    const errors = [];
    const validRows = [];
    const seenEmails = new Set(); // 本次导入内的去重

    // 第一轮：验证每行数据
    for (const row of rows) {
      const rowNum = row._rowNumber || 0;

      // 检查必填字段：公司名称
      if (!row.company || !row.company.trim()) {
        errors.push({ row: rowNum, reason: '公司名称为必填项' });
        continue;
      }

      // 检查必填字段：邮箱
      if (!row.email || !row.email.trim()) {
        errors.push({ row: rowNum, reason: '邮箱为必填项' });
        continue;
      }

      // 验证邮箱格式
      if (!EMAIL_REGEX.test(row.email.trim())) {
        errors.push({ row: rowNum, reason: '邮箱格式无效' });
        continue;
      }

      const email = row.email.trim().toLowerCase();

      // 本次导入内去重
      if (seenEmails.has(email)) {
        errors.push({ row: rowNum, reason: '同一文件内邮箱重复' });
        continue;
      }
      seenEmails.add(email);

      validRows.push({
        company: row.company.trim(),
        email: email,
        contact_name: row.contact_name ? row.contact_name.trim() : null,
        phone: row.phone ? row.phone.trim() : null,
        address: row.address ? row.address.trim() : null,
        industry: row.industry ? row.industry.trim() : null,
        notes: row.notes ? row.notes.trim() : null,
        _rowNumber: rowNum,
      });
    }

    // 第二轮：数据库去重 + 批量插入（使用事务）
    let imported = 0;
    let skipped = 0;

    if (validRows.length > 0) {
      // 查询已存在的邮箱
      const emailsToCheck = validRows.map(r => r.email);
      const existingClients = await db.Client.findAll({
        where: {
          userId: userId,
          email: { [Op.in]: emailsToCheck },
        },
        attributes: ['email'],
      });

      const existingEmailSet = new Set(existingClients.map(c => c.email.toLowerCase()));

      const toInsert = [];

      for (const row of validRows) {
        if (existingEmailSet.has(row.email)) {
          skipped++;
          errors.push({ row: row._rowNumber, reason: `邮箱 ${row.email} 已存在` });
        } else {
          toInsert.push({
            userId: userId,
            company: row.company,
            email: row.email,
            firstName: row.contact_name ? row.contact_name.split(/\s+/)[0] : null,
            lastName: row.contact_name ? row.contact_name.split(/\s+/).slice(1).join(' ') : null,
            phone: row.phone,
            industry: row.industry,
            notes: row.notes,
          });
        }
      }

      // 使用事务批量插入
      if (toInsert.length > 0) {
        const t = await db.sequelize.transaction();
        try {
          await db.Client.bulkCreate(toInsert, { transaction: t });
          await t.commit();
          imported = toInsert.length;
        } catch (error) {
          await t.rollback();
          throw new Error(`数据库写入失败: ${error.message}`);
        }
      }
    }

    return {
      total: rows.length,
      imported,
      skipped,
      failed: errors.length - skipped, // skipped 的已经在 errors 中了
      errors,
    };
  }

  /**
   * 导出客户数据为 Excel 或 CSV
   * @param {string} userId - 用户ID
   * @param {string} format - 'xlsx' 或 'csv'
   * @returns {Object} { filename, content, contentType }
   */
  async exportClients(userId, format = 'xlsx') {
    const clients = await db.Client.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    const data = clients.map(c => ({
      ID: c.id,
      '公司名称': c.company,
      '联系人': [c.firstName, c.lastName].filter(Boolean).join(' ') || '',
      '邮箱': c.email,
      '电话': c.phone || '',
      '国家/地区': c.country || '',
      '行业': c.industry || '',
      '状态': c.status || '',
      '网站': c.website || '',
      '备注': c.notes || '',
      '创建时间': c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : '',
      '更新时间': c.updated_at ? new Date(c.updated_at).toLocaleString('zh-CN') : '',
    }));

    if (format === 'csv') {
      return this._exportCSV(data);
    } else {
      return this._exportExcel(data);
    }
  }

  /**
   * 导出为 Excel 格式
   */
  async _exportExcel(data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GlobalReach V2.0';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('客户数据', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    if (data.length > 0) {
      worksheet.columns = Object.keys(data[0]).map(key => ({
        header: key,
        key: key,
        width: Math.max(key.length * 2, 15),
      }));

      worksheet.addRows(data);

      // 设置表头样式
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6F3FF' },
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.height = 22;

      // 自动调整列宽
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, cell => {
          const len = (cell.value || '').toString().length;
          if (len > maxLength) maxLength = len;
        });
        column.width = Math.max(maxLength + 2, 12);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      filename: `clients_export_${Date.now()}.xlsx`,
      content: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * 导出为 CSV 格式
   */
  _exportCSV(data) {
    let json2csv;
    try {
      json2csv = require('json2csv').parse;
    } catch (e) {
      throw new Error('CSV导出功能不可用');
    }

    if (data.length === 0) {
      return {
        filename: `clients_export_${Date.now()}.csv`,
        content: '\uFEFFID,公司名称,联系人,邮箱,电话,国家/地区,行业,状态,网站,备注,创建时间,更新时间\n',
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const fields = Object.keys(data[0]);
    const csv = json2csv(data, { fields, withBOM: true });

    return {
      filename: `clients_export_${Date.now()}.csv`,
      content: csv,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  /**
   * 生成导入模板（带示例数据和说明）
   * @returns {Object} { filename, content, contentType }
   */
  async generateImportTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GlobalReach V2.0';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('导入模板', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // 定义列
    worksheet.columns = [
      { header: '公司名称 *', key: 'company', width: 25 },
      { header: '联系人', key: 'contact_name', width: 18 },
      { header: '邮箱 *', key: 'email', width: 28 },
      { header: '电话', key: 'phone', width: 18 },
      { header: '地址', key: 'address', width: 30 },
      { header: '行业', key: 'industry', width: 15 },
      { header: '备注', key: 'notes', width: 35 },
    ];

    // 示例数据
    const sampleData = [
      { company: '示例科技有限公司', contact_name: '张三', email: 'zhangsan@example.com', phone: '13800138000', address: '北京市朝阳区建国路88号', industry: '信息技术', notes: 'VIP客户' },
      { company: '示例贸易集团', contact_name: '李四', email: 'lisi@example.com', phone: '13900139000', address: '上海市浦东新区陆家嘴金融中心', industry: '贸易/进出口', notes: '' },
      { company: '示例制造有限公司', contact_name: '王五', email: 'wangwu@example.com', phone: '', address: '', industry: '制造业', notes: '潜在客户，待跟进' },
    ];

    sampleData.forEach(row => worksheet.addRow(row));

    // 表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 24;

    // 示例数据行样式（浅色背景）
    for (let i = 2; i <= 4; i++) {
      const row = worksheet.getRow(i);
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF9E6' },
      };
    }

    // 添加说明工作表
    const infoSheet = workbook.addWorksheet('使用说明');
    infoSheet.columns = [
      { header: '项目', key: 'item', width: 20 },
      { header: '说明', key: 'desc', width: 70 },
    ];

    const instructions = [
      { item: '文件格式', desc: '支持 .xlsx 和 .csv 格式，单次最大 1000 行数据，文件大小不超过 5MB' },
      { item: '必填字段', desc: '公司名称、邮箱（标记 * 的列为必填项）' },
      { item: '邮箱校验', desc: '系统会自动验证邮箱格式，无效邮箱将被跳过并记录错误' },
      { item: '去重规则', desc: '同一邮箱不会重复插入，已存在的邮箱将被跳过' },
      { item: '列名映射', desc: '支持中英文列名自动识别：公司名称/company_name/Company、联系人/contact_name/Contact、邮箱/email/Email、电话/phone/Phone、地址/address/Address、行业/industry/Industry、备注/notes/Notes' },
      { item: '示例数据', desc: '模板中包含3行示例数据（黄色背景），请删除后填写真实数据' },
      { item: '注意事项', desc: '1. 不要修改表头列名；2. 确保邮箱唯一性；3. 建议先导入少量数据测试' },
    ];

    instructions.forEach(row => infoSheet.addRow(row));

    const infoHeader = infoSheet.getRow(1);
    infoHeader.font = { bold: true };
    infoHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    infoHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      filename: `client_import_template_${Date.now()}.xlsx`,
      content: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}

module.exports = new ClientImportService();
