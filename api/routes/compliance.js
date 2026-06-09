/**
 * Compliance Routes (N03) — GDPR/PIPL 合规端点
 *
 * 端点：
 * GET  /api/v1/compliance/data-export        — 导出用户自身全部数据(JSON) [GDPR Art.15]
 * POST /api/v1/compliance/data-delete-request  — 提交数据删除请求(需二次确认) [GDPR Art.17]
 * GET  /api/v1/compliance/delete-status       — 查询删除请求进度
 * GET  /api/v1/compliance/privacy-policy      — 获取隐私政策文本
 *
 * 权限要求：
 * - 所有端点需要认证
 * - 数据导出只能导出当前登录用户自己的数据
 * - 数据删除请求需要二次确认（邮件验证）
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { verifyToken } = require('../middleware/auth');
const { auditLogger, ACTION_TYPES, SEVERITY, STATUS } = require('../middleware/auditLogger');
const complianceReportService = require('../services/complianceReportService');
const db = require('../db');

// 内存存储删除请求（生产环境应使用数据库或Redis）
const deleteRequests = new Map();

// ============================================
// 所有路由需要认证
// ============================================
router.use(verifyToken);

// ============================================
// GET /api/v1/compliance/data-export — 用户数据导出(GDPR DSAR)
// ============================================
router.get('/data-export', async (req, res) => {
  try {
    const userId = req.user.id;

    // 记录数据导出操作
    await auditLogger.log(req, {
      action: ACTION_TYPES.EXPORT_DATA,
      resourceType: 'user',
      resourceId: userId,
      details: {
        type: 'GDPR_DATA_EXPORT',
        regulation: 'GDPR Art.15 / PIPL 第44条',
        requestedBy: userId,
      },
      severity: SEVERITY.INFO,
      status: STATUS.SUCCESS,
    });

    // 生成完整的用户数据报告
    const userDataReport = await complianceReportService.generateUserDataReport(userId);

    // 设置下载响应头
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=user-data-export-${userId}-${new Date().toISOString().split('T')[0]}.json`);

    res.json({
      success: true,
      ...userDataReport,
      metadata: {
        exportedAt: new Date().toISOString(),
        formatVersion: '1.0',
        platform: 'GlobalReach V2.0',
        complianceNote: '本文件包含您的所有个人数据，符合GDPR和PIPL要求。请妥善保管，不要分享给他人。',
      },
    });
  } catch (error) {
    console.error('[Compliance] Data export failed:', error);

    await auditLogger.log(req, {
      action: ACTION_TYPES.EXPORT_DATA,
      resourceType: 'user',
      details: { error: error.message },
      severity: SEVERITY.ERROR,
      status: STATUS.FAILURE,
    });

    res.status(500).json({
      success: false,
      error: 'DATA_EXPORT_FAILED',
      message: 'Failed to export user data. Please try again later.',
    });
  }
});

// ============================================
// POST /api/v1/compliance/data-delete-request — 提交数据删除请求
// ============================================
router.post('/data-delete-request', async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason, confirmation } = req.body;

    // 验证确认声明
    if (!confirmation || confirmation !== 'I_CONFIRM_DELETION') {
      return res.status(400).json({
        success: false,
        error: 'CONFIRMATION_REQUIRED',
        message: '必须提供明确的删除确认声明',
      });
    }

    // 检查是否已有进行中的删除请求
    const existingRequest = Array.from(deleteRequests.values()).find(
      r => r.userId === userId && r.status === 'PENDING'
    );

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        error: 'DELETE_REQUEST_EXISTS',
        message: '您已有一个待处理的删除请求',
        requestId: existingRequest.requestId,
      });
    }

    // 创建删除请求
    const requestId = `DEL-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const confirmToken = crypto.randomBytes(32).toString('hex');

    const deleteRequest = {
      requestId,
      userId,
      userEmail: req.user.email,
      userName: req.user.name,
      reason: reason || '未提供原因',
      confirmToken,
      status: 'PENDING', // PENDING → CONFIRMED → PROCESSING → COMPLETED
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时有效期
      steps: [
        { step: 1, name: '请求提交', status: 'COMPLETED', timestamp: new Date() },
        { step: 2, name: '二次确认', status: 'PENDING', timestamp: null },
        { step: 3, name: '数据处理', status: 'PENDING', timestamp: null },
        { step: 4, name: '完成通知', status: 'PENDING', timestamp: null },
      ],
    };

    deleteRequests.set(requestId, deleteRequest);

    // 记录删除请求
    await auditLogger.log(req, {
      action: 'DATA_DELETE_REQUEST',
      resourceType: 'user',
      resourceId: userId,
      details: {
        requestId,
        reason,
        regulation: 'GDPR Art.17 / PIPL 第47条',
      },
      severity: SEVERITY.WARN,
      status: STATUS.SUCCESS,
    });

    // 在实际应用中，这里应该发送确认邮件给用户
    // 包含确认链接：/api/v1/compliance/confirm-delete/:requestId?token=confirmToken

    res.status(202).json({
      success: true,
      message: '数据删除请求已提交，请在24小时内完成二次确认',
      data: {
        requestId,
        status: 'PENDING',
        expiresAt: deleteRequest.expiresAt,
        nextStep: '请检查邮箱并点击确认链接完成二次验证',
        warning: '此操作不可逆！删除后您的所有数据将被永久清除且无法恢复。',
      },
    });
  } catch (error) {
    console.error('[Compliance] Delete request failed:', error);
    res.status(500).json({
      success: false,
      error: 'DELETE_REQUEST_FAILED',
      message: 'Failed to process deletion request.',
    });
  }
});

// ============================================
// POST /api/v1/compliance/confirm-delete/:requestId — 确认删除请求
// ============================================
router.post('/confirm-delete/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { token } = req.body;

    const deleteRequest = deleteRequests.get(requestId);

    if (!deleteRequest) {
      return res.status(404).json({
        success: false,
        error: 'REQUEST_NOT_FOUND',
        message: '删除请求不存在或已过期',
      });
    }

    // 验证token
    if (deleteRequest.confirmToken !== token) {
      return res.status(403).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: '确认令牌无效',
      });
    }

    // 验证请求者身份
    if (deleteRequest.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: '无权确认此删除请求',
      });
    }

    // 检查是否过期
    if (new Date() > deleteRequest.expiresAt) {
      deleteRequests.delete(requestId);
      return res.status(410).json({
        success: false,
        error: 'REQUEST_EXPIRED',
        message: '删除请求已过期，请重新提交',
      });
    }

    // 更新状态为已确认
    deleteRequest.status = 'CONFIRMED';
    deleteRequest.steps[1].status = 'COMPLETED';
    deleteRequest.steps[1].timestamp = new Date();
    deleteRequest.confirmedAt = new Date();

    // 记录确认操作
    await auditLogger.log(req, {
      action: 'DELETE_CONFIRMED',
      resourceType: 'user',
      resourceId: deleteRequest.userId,
      details: { requestId },
      severity: SEVERITY.CRITICAL,
      status: STATUS.SUCCESS,
    });

    res.json({
      success: true,
      message: '删除请求已确认，系统将开始处理数据删除',
      data: {
        requestId,
        status: 'CONFIRMED',
        estimatedProcessingTime: '7个工作日内完成',
        note: '根据法律要求，部分数据可能需要在法律保留期后才能完全删除',
      },
    });
  } catch (error) {
    console.error('[Compliance] Confirm delete failed:', error);
    res.status(500).json({
      success: false,
      error: 'CONFIRMATION_FAILED',
      message: 'Failed to confirm deletion request.',
    });
  }
});

// ============================================
// GET /api/v1/compliance/delete-status — 查询删除请求进度
// ============================================
router.get('/delete-status/:requestId?', async (req, res) => {
  try {
    const { requestId } = req.params;

    if (requestId) {
      // 查询特定请求
      const deleteRequest = deleteRequests.get(requestId);

      if (!deleteRequest) {
        return res.status(404).json({
          success: false,
          error: 'REQUEST_NOT_FOUND',
          message: '删除请求不存在',
        });
      }

      // 权限检查
      if (deleteRequest.userId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          error: 'ACCESS_DENIED',
          message: '无权查看此请求状态',
        });
      }

      return res.json({
        success: true,
        data: {
          requestId: deleteRequest.requestId,
          status: deleteRequest.status,
          createdAt: deleteRequest.createdAt,
          confirmedAt: deleteRequest.confirmedAt,
          expiresAt: deleteRequest.expiresAt,
          steps: deleteRequest.steps,
        },
      });
    } else {
      // 列出当前用户的所有删除请求
      const userRequests = Array.from(deleteRequests.values())
        .filter(r => r.userId === req.user.id)
        .map(r => ({
          requestId: r.requestId,
          status: r.status,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
        }));

      return res.json({
        success: true,
        data: {
          requests: userRequests,
          total: userRequests.length,
        },
      });
    }
  } catch (error) {
    console.error('[Compliance] Delete status failed:', error);
    res.status(500).json({
      success: false,
      error: 'STATUS_CHECK_FAILED',
      message: 'Failed to check deletion status.',
    });
  }
});

// ============================================
// GET /api/v1/compliance/privacy-policy — 获取隐私政策
// ============================================
router.get('/privacy-policy', async (req, res) => {
  try {
    const privacyPolicy = {
      version: '2.0',
      lastUpdated: '2026-06-09',
      effectiveDate: '2026-01-01',

      title: 'GlobalReach V2.0 隐私政策',

      sections: [
        {
          title: '1. 信息收集',
          content: `我们收集以下类型的信息：
• 个人身份信息(PII)：姓名、邮箱地址、电话号码
• 业务信息：公司名称、行业类别、营销偏好
• 技术信息：IP地址、浏览器类型、操作系统
• 使用数据：功能使用情况、访问时间戳`,
        },

        {
          title: '2. 信息使用',
          content: `收集的信息用于：
• 提供、维护和改进我们的邮件营销服务
• 处理交易和发送相关通知
• 监控和分析使用趋势以改善用户体验
• 保护服务安全和防止欺诈
• 符合法律法规要求`,
        },

        {
          title: '3. 数据共享',
          content: `我们不会出售您的个人数据。
我们可能在以下情况下共享数据：
• 获得您的明确同意
• 法律法规要求
• 保护我们的权利和安全
• 与可信的服务提供商合作（受严格合同约束）`,
        },

        {
          title: '4. 数据安全',
          content: `我们采用行业标准的安全措施：
• 传输加密(TLS 1.3)
• 存储加密(AES-256)
• 定期安全审计和渗透测试
• 访问控制和身份验证
• 完整的审计日志记录`,
        },

        {
          title: '5. 数据保留',
          content: `各类数据的保留期限：
• 活跃账户数据：账户期间内保留
• 已注销账户数据：90天后自动清理
• 审计日志：365天
• 安全事件日志：730天(2年)
• 营销活动数据：180天`,
        },

        {
          title: '6. 您的权利 (GDPR)',
          content: `根据GDPR和PIPL，您享有以下权利：
• 访问权：获取我们持有的关于您的数据副本
• 更正权：更正不准确或不完整的数据
• 删除权("被遗忘权")：在某些情况下要求删除您的数据
• 限制处理权：限制某些数据处理活动
• 数据可携带权：以结构化格式接收您的数据
• 反对权：反对基于合法利益或公共利益的处理`,
        },

        {
          title: '7. 行使权利',
          content: `如需行使上述权利：
• 数据导出：GET /api/v1/compliance/data-export
• 数据删除请求：POST /api/v1/compliance/data-delete-request
• 查询删除状态：GET /api/v1/compliance/delete-status
• 联系邮箱：privacy@globalreach.example.com`,
        },

        {
          title: '8. Cookie政策',
          content: `我们使用Cookie来：
• 保持您的登录状态
• 记住您的偏好设置
• 分析网站使用情况
• 提供个性化体验

您可以通过浏览器设置管理Cookie偏好。`,
        },

        {
          title: '9. 第三方服务',
          content: `我们的服务可能集成以下第三方服务：
• 邮件服务提供商（Gmail, Outlook等）
• 云存储服务
• 分析工具

这些服务有自己的隐私政策，我们建议您查阅。`,
        },

        {
          title: '10. 政策更新',
          content: `我们会定期审查和更新本隐私政策。
重大变更将通过以下方式通知您：
• 网站公告
• 邮件通知
• 应用内提示

继续使用我们的服务即表示您接受更新后的政策。`,
        },

        {
          title: '11. 联系我们',
          content: `如有任何隐私相关问题：
• 数据保护官(DPO)：dpo@globalreach.example.com
• 一般咨询：privacy@globalreach.example.com
• 地址：[公司注册地址]

我们将尽快回复您的询问，最迟不超过30天。`,
        },
      ],

      regulatoryReferences: {
        GDPR: '欧盟通用数据保护条例 (EU) 2016/679',
        PIPL: '中华人民共和国个人信息保护法',
        SOC2: 'SOC 2 Type II 安全标准',
      },
    };

    res.json({
      success: true,
      data: privacyPolicy,
    });
  } catch (error) {
    console.error('[Compliance] Privacy policy failed:', error);
    res.status(500).json({
      success: false,
      error: 'POLICY_FETCH_FAILED',
      message: 'Failed to fetch privacy policy.',
    });
  }
});

module.exports = router;
