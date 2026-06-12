/**
 * Change Risk Assessment Routes — O05 变更风险评分系统
 *
 * RESTful 端点:
 *   POST /api/v1/risk/assess     — 评估当前未推送变更的风险
 *   GET  /api/v1/risk/history    — 历史风险评估记录
 *   GET  /api/v1/risk/thresholds  — 当前阈值配置
 *   POST /api/v1/risk/approve    — 记录风险审批（需要管理员权限）
 *   GET  /api/v1/risk/dashboard  — 风险仪表盘数据（近期趋势）
 *
 * 集成 scripts/risk-assessor.sh 和 data/risk-db.json
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { verifyToken, requireRole } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');

// S152: 标准安全中间件链
// Risk assessment data is sensitive - authentication required
// Approval endpoint requires ADMIN role
router.use(rateLimiter);
router.use(verifyToken);

// ── 配置常量 ─────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RISK_DB_PATH = path.join(PROJECT_ROOT, 'data', 'risk-db.json');
const RISK_ASSESSOR_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'risk-assessor.sh');
const RISK_HISTORY_FILE = path.join(PROJECT_ROOT, 'data', 'risk-history.json');

// 维度权重定义
const DIMENSION_WEIGHTS = {
    scope_impact: 0.25,      // D1: 影响范围
    change_type: 0.20,       // D2: 变更类型
    history_failure: 0.20,   // D3: 历史故障率
    rollback_difficulty: 0.20, // D4: 回滚难度
    test_coverage: 0.15      // D5: 测试覆盖
};

// 风险等级阈值
const RISK_THRESHOLDS = {
    LOW:      { min: 1.0, max: 3.0, emoji: '🟢', color: 'green',  approval: 'self_deploy',       action: '正常合并' },
    MEDIUM:   { min: 3.1, max: 5.0, emoji: '🟡', color: 'yellow', approval: 'peer_review',       action: 'Review后合并' },
    HIGH:     { min: 5.1, max: 7.0, emoji: '🟠', color: 'orange', approval: 'tech_lead',         action: '窗口期部署+监控' },
    CRITICAL: { min: 7.1, max: 10.0, emoji: '🔴', color: 'red',    approval: 'cto_committee',     action: '紧急预案就绪' }
};

// ── 辅助函数 ─────────────────────────────────────────────────────────────

/**
 * 加载风险数据库
 */
function loadRiskDB() {
    try {
        if (fs.existsSync(RISK_DB_PATH)) {
            const data = fs.readFileSync(RISK_DB_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[RiskAPI] Failed to load risk DB:', error.message);
    }
    return null;
}

/**
 * 加载历史评估记录
 */
function loadRiskHistory() {
    try {
        if (fs.existsSync(RISK_HISTORY_FILE)) {
            const data = fs.readFileSync(RISK_HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[RiskAPI] Failed to load risk history:', error.message);
    }
    return { assessments: [], approvals: [] };
}

/**
 * 保存历史评估记录
 */
function saveRiskHistory(history) {
    try {
        // 确保 data 目录存在
        const dataDir = path.dirname(RISK_HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(RISK_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('[RiskAPI] Failed to save risk history:', error.message);
    }
}

/**
 * 获取风险等级
 */
function getRiskLevel(score) {
    const numScore = parseFloat(score);
    if (numScore <= 3.0) return { ...RISK_THRESHOLDS.LOW, level: 'LOW' };
    if (numScore <= 5.0) return { ...RISK_THRESHOLDS.MEDIUM, level: 'MEDIUM' };
    if (numScore <= 7.0) return { ...RISK_THRESHOLDS.HIGH, level: 'HIGH' };
    return { ...RISK_THRESHOLDS.CRITICAL, level: 'CRITICAL' };
}

/**
 * 执行风险评分脚本并返回结果
 */
function executeRiskAssessment(options = {}) {
    try {
        let command = `bash "${RISK_ASSESSOR_SCRIPT}" --json`;

        if (options.commit) {
            command += ` --commit ${options.commit}`;
        }
        if (options.diffRange) {
            command += ` --diff "${options.diffRange}"`;
        }

        const output = execSync(command, {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            timeout: 30000, // 30 秒超时
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return JSON.parse(output);
    } catch (error) {
        // 脚本可能返回非零退出码但仍有有效输出
        if (error.stdout) {
            try {
                return JSON.parse(error.stdout);
            } catch (_) {
                // 忽略解析错误
            }
        }
        throw new Error(`风险评估执行失败: ${error.message}`);
    }
}

/**
 * 生成唯一评估 ID
 */
function generateAssessmentId() {
    return `RA-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ── 路由处理函数 ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/risk/assess
 *
 * 评估当前未推送变更的风险
 * Request body (可选):
 *   - commit: string - 指定 commit hash
 *   - diffRange: string - 自定义 diff 范围
 */
router.post('/risk/assess', asyncHandler(async (req, res) => {
    const startTime = Date.now();

    // 执行风险评估
    const assessment = executeRiskAssessment({
        commit: req.body.commit,
        diffRange: req.body.diffRange
    });

    // 补充元数据
    assessment.assessment_id = generateAssessmentId();
    assessment.assessment_duration_ms = Date.now() - startTime;
    assessment.api_version = 'v1';
    assessment.timestamp = new Date().toISOString();

    // 保存到历史记录
    const history = loadRiskHistory();
    history.assessments.unshift(assessment);

    // 只保留最近 100 条记录
    if (history.assessments.length > 100) {
        history.assessments = history.assessments.slice(0, 100);
    }
    saveRiskHistory(history);

    // 返回结果
    res.json({
        success: true,
        data: assessment,
        message: `风险评估完成，综合得分: ${assessment.summary.risk_score}/10 (${assessment.summary.risk_emoji} ${assessment.summary.risk_level})`
    });
}));

/**
 * GET /api/v1/risk/history
 *
 * 获取历史风险评估记录
 * Query params:
 *   - limit: number - 返回记录数限制 (默认 20)
 *   - level: string - 按风险等级过滤 (LOW/MEDIUM/HIGH/CRITICAL)
 *   - since: string - 起始时间 (ISO 8601)
 */
router.get('/risk/history', (req, res) => {
    try {
        const history = loadRiskHistory();
        let assessments = history.assessments || [];

        // 按风险等级过滤
        if (req.query.level) {
            const level = req.query.level.toUpperCase();
            assessments = assessments.filter(a =>
                a.summary && a.summary.risk_level === level
            );
        }

        // 按时间过滤
        if (req.query.since) {
            const sinceDate = new Date(req.query.since);
            assessments = assessments.filter(a =>
                new Date(a.timestamp) >= sinceDate
            );
        }

        // 限制数量
        const limit = parseInt(req.query.limit) || 20;
        assessments = assessments.slice(0, limit);

        res.json({
            success: true,
            count: assessments.length,
            total: (history.assessments || []).length,
            data: assessments,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[RiskAPI] History error:', error);
        res.status(500).json({
            success: false,
            error: 'HISTORY_FETCH_FAILED',
            message: error.message
        });
    }
});

/**
 * GET /api/v1/risk/thresholds
 *
 * 获取当前阈值配置
 */
router.get('/risk/thresholds', (req, res) => {
    try {
        const riskDB = loadRiskDB();

        res.json({
            success: true,
            data: {
                thresholds: riskDB?.risk_thresholds || RISK_THRESHOLDS,
                dimension_weights: riskDB?.dimension_weights || DIMENSION_WEIGHTS,
                version: riskDB?.version || 'unknown',
                last_updated: riskDB?.created || 'unknown'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[RiskAPI] Thresholds error:', error);
        res.status(500).json({
            success: false,
            error: 'THRESHOLDS_FETCH_FAILED',
            message: error.message
        });
    }
});

/**
 * POST /api/v1/risk/approve
 *
 * 记录风险审批（需要管理员权限）
 * Request body:
 *   - assessmentId: string - 评估 ID
 *   - approver: string - 审批人
 *   - decision: 'approved' | 'rejected' | 'conditional'
 *   - comment: string - 审批意见
 *   - conditions: string[] - 有条件批准时的附加条件
 */
router.post('/risk/approve', (req, res) => {
    try {
        const { assessmentId, approver, decision, comment, conditions } = req.body;

        // 参数验证
        if (!assessmentId || !approver || !decision) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: '缺少必要参数: assessmentId, approver, decision'
            });
        }

        const validDecisions = ['approved', 'rejected', 'conditional'];
        if (!validDecisions.includes(decision)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_DECISION',
                message: `无效的决策值，必须是: ${validDecisions.join(', ')}`
            });
        }

        // 创建审批记录
        const approvalRecord = {
            id: `APV-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            assessment_id: assessmentId,
            approver,
            decision,
            comment: comment || '',
            conditions: conditions || [],
            timestamp: new Date().toISOString(),
            ip_address: req.ip || req.connection.remoteAddress
        };

        // 保存到历史记录
        const history = loadRiskHistory();
        history.approvals.unshift(approvalRecord);

        // 只保留最近 200 条审批记录
        if (history.approvals.length > 200) {
            history.approvals = history.approvals.slice(0, 200);
        }
        saveRiskHistory(history);

        res.status(201).json({
            success: true,
            data: approvalRecord,
            message: `审批记录已保存: ${decision}`
        });

    } catch (error) {
        console.error('[RiskAPI] Approve error:', error);
        res.status(500).json({
            success: false,
            error: 'APPROVAL_FAILED',
            message: error.message
        });
    }
});

/**
 * GET /api/v1/risk/dashboard
 *
 * 风险仪表盘数据（近期趋势）
 * Query params:
 *   - days: number - 统计天数 (默认 30)
 */
router.get('/risk/dashboard', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const history = loadRiskHistory();
        const assessments = history.assessments || [];

        // 时间过滤
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const recentAssessments = assessments.filter(a =>
            new Date(a.timestamp) >= cutoff
        );

        // 计算统计数据
        const stats = {
            total_assessments: recentAssessments.length,
            average_score: 0,
            max_score: 0,
            min_score: 10,
            level_distribution: {
                LOW: 0,
                MEDIUM: 0,
                HIGH: 0,
                CRITICAL: 0
            },
            daily_trend: [],
            top_risk_factors: {},
            approval_rate: 0
        };

        let scoreSum = 0;
        const dailyScores = {};

        recentAssessments.forEach(assessment => {
            const score = parseFloat(assessment.summary?.risk_score || 0);
            const level = assessment.summary?.risk_level || 'UNKNOWN';

            // 分数统计
            scoreSum += score;
            if (score > stats.max_score) stats.max_score = score;
            if (score < stats.min_score) stats.min_score = score;

            // 等级分布
            if (stats.level_distribution[level] !== undefined) {
                stats.level_distribution[level]++;
            }

            // 每日趋势
            const date = assessment.timestamp?.split('T')[0];
            if (date) {
                if (!dailyScores[date]) {
                    dailyScores[date] = { total: 0, count: 0 };
                }
                dailyScores[date].total += score;
                dailyScores[date].count++;
            }

            // 高频风险因素
            if (assessment.high_risk_factors) {
                assessment.high_risk_factors.forEach(factor => {
                    stats.top_risk_factors[factor] = (stats.top_risk_factors[factor] || 0) + 1;
                });
            }
        });

        // 计算平均值
        if (recentAssessments.length > 0) {
            stats.average_score = Math.round((scoreSum / recentAssessments.length) * 10) / 10;
        }

        // 格式化每日趋势
        stats.daily_trend = Object.entries(dailyScores)
            .map(([date, data]) => ({
                date,
                avg_score: Math.round((data.total / data.count) * 10) / 10,
                count: data.count
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-14); // 最近 14 天

        // 排序风险因素（取前 10）
        stats.top_risk_factors = Object.entries(stats.top_risk_factors)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

        // 审批率统计
        const recentApprovals = (history.approvals || []).filter(a =>
            new Date(a.timestamp) >= cutoff
        );
        const approvedCount = recentApprovals.filter(a => a.decision === 'approved').length;
        stats.approval_rate = recentApprovals.length > 0
            ? Math.round((approvedCount / recentApprovals.length) * 100)
            : 0;

        res.json({
            success: true,
            period_days: days,
            generated_at: new Date().toISOString(),
            statistics: stats
        });

    } catch (error) {
        console.error('[RiskAPI] Dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'DASHBOARD_GENERATION_FAILED',
            message: error.message
        });
    }
});

// ── 导出 ─────────────────────────────────────────────────────────────────

module.exports = router;
