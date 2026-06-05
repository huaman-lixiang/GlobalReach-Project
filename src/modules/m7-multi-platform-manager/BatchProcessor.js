const fs = require('fs');
const path = require('path');

class BatchProcessor {
  constructor(accountPoolManager) {
    this.poolManager = accountPoolManager;
    this.supportedFormats = ['csv', 'json', 'xlsx'];
    this.validationRules = {
      requiredFields: ['email'],
      optionalFields: ['password', 'authCode', 'oauthToken', 'platform', 'metadata'],
      maxFileSize: 10 * 1024 * 1024,
      maxRecords: 1000
    };
  }

  async importFromFile(filePath, options = {}) {
    const fileExtension = path.extname(filePath).toLowerCase().replace('.', '');
    
    if (!this.supportedFormats.includes(fileExtension)) {
      throw new Error(`Unsupported file format: ${fileExtension}`);
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize > this.validationRules.maxFileSize) {
      throw new Error(`File too large. Maximum size: ${this.validationRules.maxFileSize / 1024 / 1024}MB`);
    }

    let records = [];
    
    switch (fileExtension) {
      case 'csv':
        records = await this._parseCSV(filePath);
        break;
      case 'json':
        records = await this._parseJSON(filePath);
        break;
      case 'xlsx':
        records = await this._parseExcel(filePath);
        break;
      default:
        throw new Error(`Format not implemented: ${fileExtension}`);
    }

    if (records.length > this.validationRules.maxRecords) {
      throw new Error(`Too many records. Maximum: ${this.validationRules.maxRecords}`);
    }

    const validatedRecords = this._validateAndNormalize(records, options.defaultPlatform);
    const importResult = await this.poolManager.batchImport(validatedRecords.valid);

    return {
      success: true,
      total: validatedRecords.valid.length,
      imported: importResult.filter(r => r.success).length,
      failed: importResult.filter(r => !r.success).length,
      errors: validatedRecord.errors,
      details: importResult
    };
  }

  async _parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('CSV file must have header and at least one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const record = {};
      
      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });

      records.push(record);
    }

    return records;
  }

  async _parseJSON(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    let data;

    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }

    if (!Array.isArray(data)) {
      data = [data];
    }

    return data;
  }

  async _parseExcel(filePath) {
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      return data;
    } catch (error) {
      throw new Error(`Excel parsing failed: ${error.message}. Please install xlsx package.`);
    }
  }

  _validateAndNormalize(records, defaultPlatform = 'gmail') {
    const valid = [];
    const errors = [];

    records.forEach((record, index) => {
      const normalized = {
        id: `batch-${Date.now()}-${index}`,
        platform: (record.platform || defaultPlatform).toLowerCase(),
        credentials: {},
        metadata: {}
      };

      const missingFields = [];

      if (!record.email) {
        missingFields.push('email');
        errors.push({
          row: index + 2,
          error: 'Missing email field',
          record
        });
        return;
      }

      normalized.credentials.email = record.email;

      if (record.password) {
        normalized.credentials.password = record.password;
      }

      if (record.authCode) {
        normalized.credentials.authCode = record.authCode;
      }

      if (record.oauthToken) {
        normalized.credentials.oauthToken = record.oauthToken;
      }

      if (record.smtpHost) {
        normalized.credentials.smtpHost = record.smtpHost;
        normalized.credentials.imapHost = record.imapHost || '';
        normalized.platform = 'custom';
      }

      if (record.metadata) {
        try {
          normalized.metadata = typeof record.metadata === 'string' 
            ? JSON.parse(record.metadata) 
            : record.metadata;
        } catch (e) {
          normalized.metadata = { raw: record.metadata };
        }
      }

      valid.push(normalized);
    });

    return { valid, errors };
  }

  async exportToFile(outputPath, options = {}) {
    const { format = 'csv', includeCredentials = false, platform = null } = options;
    
    const accounts = this.poolManager.exportAccounts({ includeCredentials, platform });
    
    let content = '';

    switch (format.toLowerCase()) {
      case 'csv':
        content = this._generateCSV(accounts);
        break;
      case 'json':
        content = JSON.stringify(accounts, null, 2);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');

    return {
      success: true,
      filePath: outputPath,
      recordCount: accounts.length,
      format: format.toUpperCase()
    };
  }

  _generateCSV(accounts) {
    if (accounts.length === 0) {
      return 'ID,Platform,Email,Status,Health,CreatedAt\n';
    }

    const headers = ['ID', 'Platform', 'Email', 'Status', 'Health Status', 'Created At'];
    const rows = accounts.map(acc => [
      acc.id,
      acc.platform,
      acc.credentials?.email || 'N/A',
      acc.status,
      acc.healthStatus,
      acc.createdAt?.toISOString() || 'N/A'
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  generateTemplate(format = 'csv') {
    const template = {
      csv: 'email,password,authCode,platform,metadata\nuser@example.com,pass123,,gmail,"{region:\\"US\\"}"',
      json: JSON.stringify([
        {
          email: 'user@example.com',
          password: 'pass123',
          authCode: '',
          platform: 'gmail',
          metadata: { region: 'US' }
        }
      ], null, 2)
    };

    return template[format] || template.csv;
  }

  validateFileStructure(filePath) {
    try {
      const fileExtension = path.extname(filePath).toLowerCase().replace('.', '');
      const stat = fs.statSync(filePath);

      const result = {
        valid: true,
        format: fileExtension,
        size: stat.size,
        sizeMB: (stat.size / 1024 / 1024).toFixed(2),
        errors: [],
        warnings: []
      };

      if (!this.supportedFormats.includes(fileExtension)) {
        result.valid = false;
        result.errors.push(`Unsupported format: ${fileExtension}`);
      }

      if (stat.size > this.validationRules.maxFileSize) {
        result.valid = false;
        result.errors.push(`File exceeds maximum size`);
      }

      if (stat.size === 0) {
        result.valid = false;
        result.errors.push('File is empty');
      }

      if (fileExtension === 'csv') {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        
        if (lines.length < 2) {
          result.warnings.push('File has only header or is empty');
        }

        const headers = lines[0]?.split(',').map(h => h.trim()) || [];
        if (!headers.includes('email')) {
          result.valid = false;
          result.errors.push('Missing required field: email');
        }
      }

      return result;
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        errors: [error.message]
      };
    }
  }
}

module.exports = BatchProcessor;
