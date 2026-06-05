class EmailFormatter {
  constructor(options = {}) {
    this.defaultEncoding = options.defaultEncoding || 'utf-8';
    this.maxAttachmentSize = options.maxAttachmentSize || 25 * 1024 * 1024;
    this.allowedImageFormats = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
    this.allowedDocumentFormats = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'];
  }

  formatEmail(rawEmail, targetPlatform = 'gmail') {
    const formatted = {
      from: this._formatAddress(rawEmail.from),
      to: this._formatRecipientList(rawEmail.to),
      cc: rawEmail.cc ? this._formatRecipientList(rawEmail.cc) : [],
      bcc: rawEmail.bcc ? this._formatRecipientList(rawEmail.bcc) : [],
      subject: this._formatSubject(rawEmail.subject),
      html: this._formatHTMLBody(rawEmail.html || rawEmail.body, targetPlatform),
      text: this._formatTextBody(rawEmail.text || rawEmail.body),
      attachments: this._formatAttachments(rawEmail.attachments || []),
      headers: this._formatHeaders(rawEmail.headers || {}, targetPlatform)
    };

    formatted.replyTo = rawEmail.replyTo ? this._formatAddress(rawEmail.replyTo) : null;
    
    if (rawEmail.inReplyTo) {
      formatted.headers['In-Reply-To'] = rawEmail.inReplyTo;
    }
    
    if (rawEmail.references) {
      formatted.headers['References'] = Array.isArray(rawEmail.references) 
        ? rawEmail.references.join(' ') 
        : rawEmail.references;
    }

    return this._applyPlatformSpecifics(formatted, targetPlatform);
  }

  _formatAddress(address) {
    if (!address) return null;

    if (typeof address === 'string') {
      const match = address.match(/^(.+?)\s*<(.+?)>$/);
      if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
      }
      return { name: '', email: address.trim() };
    }

    if (typeof address === 'object' && address.email) {
      return {
        name: address.name || '',
        email: address.email.trim()
      };
    }

    return null;
  }

  _formatRecipientList(recipients) {
    if (!recipients) return [];

    if (typeof recipients === 'string') {
      return recipients.split(',').map(r => this._formatAddress(r.trim())).filter(Boolean);
    }

    if (Array.isArray(recipients)) {
      return recipients.map(r => this._formatAddress(r)).filter(Boolean);
    }

    return [];
  }

  _formatSubject(subject) {
    if (!subject) return '(No Subject)';
    
    let formatted = subject.toString().trim();
    
    if (formatted.length > 200) {
      formatted = formatted.substring(0, 197) + '...';
    }

    return this._encodeHeaderField(formatted);
  }

  _formatHTMLBody(html, platform) {
    if (!html) return null;

    let cleaned = html.toString();

    cleaned = this._sanitizeHTML(cleaned);
    cleaned = this._convertRelativeURLs(cleaned);
    cleaned = this._optimizeImages(cleaned, platform);
    cleaned = this._addTrackingPixel(cleaned);

    return cleaned;
  }

  _formatTextBody(text) {
    if (!text) return null;

    let formatted = text.toString();
    
    formatted = this._normalizeLineEndings(formatted);
    formatted = this._wordWrap(formatted, 78);
    
    return formatted;
  }

  _formatAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments)) return [];

    return attachments
      .map((att, index) => this._processAttachment(att, index))
      .filter(att => att !== null);
  }

  _processAttachment(attachment, index) {
    if (!attachment) return null;

    const processed = {
      filename: attachment.filename || `attachment_${index + 1}`,
      content: attachment.content,
      encoding: attachment.encoding || 'base64',
      contentType: attachment.contentType || this._guessContentType(attachment.filename),
      disposition: attachment.disposition || 'attachment',
      contentId: attachment.contentId || null,
      size: attachment.size || (attachment.content ? attachment.content.length : 0)
    };

    if (processed.size > this.maxAttachmentSize) {
      console.warn(`Attachment ${processed.filename} exceeds maximum size`);
      return null;
    }

    if (this._isImage(processed.contentType)) {
      processed.disposition = 'inline';
      processed.contentId = `<${processed.filename.replace(/[^a-zA-Z0-9]/g, '_')}@globalreach>`;
    }

    return processed;
  }

  _formatHeaders(headers, platform) {
    const standardHeaders = {
      'X-Mailer': 'GlobalReach V2.0 Enterprise',
      'X-Priority': headers.priority || '3',
      'MIME-Version': '1.0',
      'Date': new Date().toUTCString()
    };

    const platformHeaders = this._getPlatformSpecificHeaders(platform);

    return {
      ...standardHeaders,
      ...platformHeaders,
      ...headers
    };
  }

  _getPlatformSpecificHeaders(platform) {
    const headers = {
      gmail: {
        'X-Priority': '3',
        'Precedence': 'bulk'
      },
      outlook: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal'
      },
      qq: {},
      '163': {},
      custom: {}
    };

    return headers[platform] || {};
  }

  _applyPlatformSpecifics(email, platform) {
    switch (platform) {
      case 'gmail':
        email.html = this._addGmailSpecificMarkup(email.html);
        break;
      case 'outlook':
        break;
      default:
        break;
    }

    return email;
  }

  _sanitizeHTML(html) {
    let sanitized = html;

    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*'[^']*'/gi, '');

    return sanitized;
  }

  _convertRelativeURLs(html) {
    return html.replace(
      /(src|href)=["'](?!(?:https?:\/\/|data:|#\/))/gi,
      '$1="http://$&"'
    );
  }

  _optimizeImages(html, platform) {
    return html.replace(/<img([^>]*)>/gi, (match, attrs) => {
      if (attrs.includes('width=') && attrs.includes('height=')) {
        return match;
      }
      
      return `<img${attrs} style="max-width:600px; height:auto;">`;
    });
  }

  _addTrackingPixel(html) {
    const pixel = '<img src="https://tracking.globalreach.com/pixel" width="1" height="1" alt="" style="display:none;">';
    return html.replace(/<\/body>/i, `${pixel}</body>`) || html + pixel;
  }

  _addGmailSpecificMarkup(html) {
    if (!html) return html;

    const gmailStyles = `
      <style>
        .gmail_default { font-family: Arial, sans-serif; }
        .gmail_quote { border-left: 1px solid #ccc; padding-left: 10px; margin-left: 5px; color: #777; }
        .gmail_signature { color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    `;

    return html.replace('<head>', `<head>${gmailStyles}`);
  }

  _normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  _wordWrap(text, maxLineLength) {
    const lines = text.split('\n');
    const wrapped = lines.map(line => {
      if (line.length <= maxLineLength) return line;

      const wrappedLines = [];
      let remaining = line;

      while (remaining.length > maxLineLength) {
        const wrapPoint = remaining.lastIndexOf(' ', maxLineLength);
        const point = wrapPoint > 0 ? wrapPoint : maxLineLength;
        
        wrappedLines.push(remaining.substring(0, point));
        remaining = remaining.substring(point).trim();
      }

      if (remaining) {
        wrappedLines.push(remaining);
      }

      return wrappedLines.join('\n');
    });

    return wrapped.join('\n');
  }

  _encodeHeaderField(value) {
    if (/^[\x20-\x7e]*$/.test(value)) {
      return value;
    }

    return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
  }

  _guessContentType(filename) {
    if (!filename) return 'application/octet-stream';

    const ext = filename.split('.').pop().toLowerCase();

    const types = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      txt: 'text/plain',
      csv: 'text/csv'
    };

    return types[ext] || 'application/octet-stream';
  }

  _isImage(contentType) {
    return contentType.startsWith('image/');
  }

  validateEmail(email) {
    const errors = [];

    if (!email.from || !email.from.email) {
      errors.push('Missing or invalid sender address');
    }

    if (!email.to || (Array.isArray(email.to) && email.to.length === 0)) {
      errors.push('Missing recipient addresses');
    }

    if (!email.subject && !email.text && !email.html) {
      errors.push('Email must have subject or body content');
    }

    if (email.attachments && Array.isArray(email.attachments)) {
      email.attachments.forEach((att, i) => {
        if (att.size > this.maxAttachmentSize) {
          errors.push(`Attachment ${i + 1} exceeds maximum size`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  generatePlainText(html) {
    if (!html) return '';

    let text = html;

    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<li[^>]*>/gi, '\n• ');
    text = text.replace(/<tr[^>]*>/gi, '\n');

    text = text.replace(/<[^>]+>/g, '');
    text = this._decodeEntities(text);
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

    return text;
  }

  _decodeEntities(text) {
    const entities = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'"
    };

    for (const [entity, char] of Object.entries(entities)) {
      text = text.split(entity).join(char);
    }

    return text;
  }
}

module.exports = EmailFormatter;
