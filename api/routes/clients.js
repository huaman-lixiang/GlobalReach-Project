const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { verifyToken } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const clientImportService = require('../services/clientImportService');
const { asyncHandler } = require('../middleware/errorHandler');

// S152: 标准安全中间件链
router.use(rateLimiter);
router.use(verifyToken);

// ============================================
// Multer 配置（内存存储，用于文件上传）
// ============================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.xlsx', '.xls', '.csv'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，请上传 .xlsx、.xls 或 .csv 文件'));
    }
  },
});

// ============================================
// POST /api/v1/clients/import
// 客户数据批量导入（Excel/CSV）
// ============================================
router.post('/import', verifyToken, upload.single('file'), asyncHandler(async (req, res) => {
  // 检查文件是否存在
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'FILE_REQUIRED',
      message: '请上传文件',
    });
  }

  console.log(`[ClientImport] User ${req.user.id} uploading file: ${req.file.originalname}, size: ${req.file.size} bytes`);

  // 解析文件
  const rows = await clientImportService.parseFile(req.file.buffer, req.file.originalname);

  // 导入数据
  const result = await clientImportService.importClients(rows, req.user.id);

  console.log(`[ClientImport] Import complete - total: ${result.total}, imported: ${result.imported}, skipped: ${result.skipped}, failed: ${result.failed}`);

  return res.json({
    success: true,
    message: `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`,
    data: result,
  });
}));

// ============================================
// GET /api/v1/clients/export
// 客户数据导出（支持 xlsx/csv 格式）
// ============================================
router.get('/export', verifyToken, asyncHandler(async (req, res) => {
  const format = req.query.format || 'xlsx';
  const allowedFormats = ['xlsx', 'csv'];

  if (!allowedFormats.includes(format)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_FORMAT',
      message: '不支持的导出格式，请使用 xlsx 或 csv',
    });
  }

  console.log(`[ClientExport] User ${req.user.id} exporting clients as ${format}`);

  const result = await clientImportService.exportClients(req.user.id, format);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
  res.send(result.content);
}));

// ============================================
// GET /api/v1/clients/import-template
// 导入模板下载
// ============================================
router.get('/import-template', verifyToken, asyncHandler(async (req, res) => {
  console.log(`[ClientTemplate] User ${req.user.id} downloading import template`);

  const result = await clientImportService.generateImportTemplate();

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
  res.send(result.content);
}));

module.exports = router;
