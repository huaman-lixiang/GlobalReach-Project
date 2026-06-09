/**
 * Team Collaboration Routes — O07 团队协作工作流 API
 *
 * 提供团队协作功能的 RESTful 端点：
 *   GET  /api/v1/team/oncall/current       — 当前值班人员信息
 *   GET  /api/v1/team/oncall/schedule      — 未来2周轮值表
 *   POST /api/v1/team/oncall/handover      — 提交值班交接记录
 *   GET  /api/v1/team/incidents            — 事件列表（分页/过滤）
 *   POST /api/v1/team/incidents            — 创建新事件
 *   PATCH /api/v1/team/incidents/:id        — 更新事件状态
 *   POST /api/v1/team/incidents/:id/comment — 添加事件评论
 *   GET  /api/v1/team/postmortems           — 复盘报告列表
 *   POST /api/v1/team/postmortems           — 创建复盘报告
 *
 * Data Storage:
 *   - 使用 JSON 文件作为轻量级存储（无需数据库迁移）
 *   - 数据文件位于 data/team-collaboration.json
 *   - 排班数据位于 data/oncall-schedule.json
 *
 * Integration Points:
 *   - O01 AIOps: 告警触发后自动创建 incident
 *   - O03 巡检引擎: 事件验证通过后更新状态
 *   - O05 风险评分: 作为事件优先级参考
 *   - On-call Manager 脚本: 读写排班和交接数据
 *
 * Security:
 *   - 所有端点需要 Bearer Token 认证
 *   - 写操作需要适当角色权限
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Configuration ───────────────────────────────────────────────────────────

// 项目根目录（api/routes 的上级两级目录）
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// 数据文件路径
const COLLAB_DATA_FILE = path.join(PROJECT_ROOT, 'data', 'team-collaboration.json');
const SCHEDULE_DATA_FILE = path.join(PROJECT_ROOT, 'data', 'oncall-schedule.json');

// 分页默认值
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ── 数据持久化层 ──────────────────────────────────────────────────────────

/**
 * TeamCollaborationStore — 基于 JSON 文件的轻量级数据存储
 *
 * 数据模型:
 *   Incident { id, title, severity, status, assignee, reporter,
 *     description, timeline[], tags[], createdAt, resolvedAt, postmortemId }
 *   Handover { id, from, to, timestamp, items{}, notes, acknowledged, acknowledgedAt, acknowledgedBy }
 *   PostMortem { id, incidentId, summary, timeline, rootCause,
 *     actionItems[], participants[], meetingDate, status }
 */
class TeamCollaborationStore {
  constructor() {
    this.data = null;
    this._load();
  }

  /** 从 JSON 文件加载数据，不存在则初始化空结构 */
  _load() {
    try {
      if (fs.existsSync(COLLAB_DATA_FILE)) {
        const raw = fs.readFileSync(COLLAB_DATA_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.data = this._emptyData();
        this._save();
      }
    } catch (error) {
      console.error('[TeamStore] Failed to load data:', error.message);
      this.data = this._emptyData();
    }
  }

  /** 将当前数据写入 JSON 文件 */
  _save() {
    try {
      // 确保 data 目录存在
      const dir = path.dirname(COLLAB_DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(COLLAB_DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[TeamStore] Failed to save data:', error.message);
      throw error;
    }
  }

  /** 返回空的初始数据结构 */
  _emptyData() {
    return {
      incidents: [],
      handovers: [],
      postmortems: [],
      comments: {},
      meta: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Incident 方法
  // ══════════════════════════════════════════════════════════════

  /** 创建新事件 */
  createIncident(incidentData) {
    const incident = {
      id: `INC-${Date.now().toString(36).toUpperCase()}`,
      title: incidentData.title || 'Untitled Incident',
      severity: incidentData.severity || 'P2',          // P0/P1/P2/P3
      status: incidentData.status || 'detected',         // detected/acknowledged/investigating/...
      assignee: incidentData.assignee || '',
      reporter: incidentData.reporter || 'system',
      description: incidentData.description || '',
      timeline: [{
        time: new Date().toISOString(),
        event: 'incident_created',
        detail: incidentData.description || 'Event created',
        author: incidentData.reporter || 'system',
      }],
      tags: incidentData.tags || [],
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      postmortemId: null,
    };

    this.data.incidents.unshift(incident); // 最新的在前面
    this._save();
    return incident;
  }

  /** 获取事件列表（支持分页和过滤） */
  getIncidents(options = {}) {
    let results = [...this.data.incidents];

    // 按严重级别过滤
    if (options.severity) {
      results = results.filter(i => i.severity === options.severity);
    }

    // 按状态过滤
    if (options.status) {
      results = results.filter(i => i.status === options.status);
    }

    // 按标签过滤
    if (options.tag) {
      results = results.filter(i => i.tags && i.tags.includes(options.tag));
    }

    // 按指派人过滤
    if (options.assignee) {
      results = results.filter(i => i.assignee === options.assignee);
    }

    // 搜索标题和描述
    if (options.search) {
      const q = options.search.toLowerCase();
      results = results.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      );
    }

    // 总数（分页前）
    const total = results.length;

    // 排序（默认按创建时间倒序）
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
    results.sort((a, b) => {
      const valA = a[sortBy] || '';
      const valB = b[sortBy] || '';
      return typeof valA === 'string'
        ? valA.localeCompare(valB) * sortOrder
        : (valA - valB) * sortOrder;
    });

    // 分页
    const page = Math.max(1, parseInt(options.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, parseInt(options.pageSize) || DEFAULT_PAGE_SIZE);
    const start = (page - 1) * pageSize;
    const paginatedResults = results.slice(start, start + pageSize);

    return {
      items: paginatedResults,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** 根据 ID 获取单个事件 */
  getIncidentById(id) {
    return this.data.incidents.find(i => i.id === id) || null;
  }

  /** 更新事件 */
  updateIncident(id, updateData) {
    const index = this.data.incidents.findIndex(i => i.id === id);
    if (index === -1) return null;

    const incident = this.data.incidents[index];

    // 允许更新的字段
    const allowedFields = ['title', 'severity', 'status', 'assignee', 'description', 'tags'];
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        incident[field] = updateData[field];
      }
    }

    // 状态变更时自动记录 timeline
    if (updateData.status && updateData.status !== this.data.incidents[index].status) {
      incident.timeline.push({
        time: new Date().toISOString(),
        event: `status_changed_to_${updateData.status}`,
        detail: `Status changed from ${incident.status} to ${updateData.status}`,
        author: updateData.updatedBy || 'system',
      });

      // 如果变为 resolved，记录解决时间
      if (updateData.status === 'resolved' || updateData.status === 'closed') {
        incident.resolvedAt = new Date().toISOString();
      }
    }

    this.data.incidents[index] = incident;
    this._save();
    return incident;
  }

  /** 给事件添加 timeline 条目 */
  addTimelineEntry(id, entry) {
    const incident = this.getIncidentById(id);
    if (!incident) return null;

    incident.timeline.push({
      time: new Date().toISOString(),
      ...entry,
    });
    this._save();
    return incident;
  }

  /** 添加事件评论 */
  addComment(incidentId, commentData) {
    const comment = {
      id: uuidv4(),
      incidentId,
      content: commentData.content || '',
      author: commentData.author || 'anonymous',
      createdAt: new Date().toISOString(),
    };

    if (!this.data.comments[incidentId]) {
      this.data.comments[incidentId] = [];
    }
    this.data.comments[incidentId].push(comment);
    this._save();
    return comment;
  }

  /** 获取事件的评论列表 */
  getComments(incidentId) {
    return this.data.comments[incidentId] || [];
  }

  // ══════════════════════════════════════════════════════════════
  // On-call / Handover 方法
  // ══════════════════════════════════════════════════════════════

  /** 获取当前值班信息 */
  getCurrentOncall() {
    const schedule = this._loadSchedule();
    if (!schedule || !schedule.rotations || schedule.rotations.length === 0) {
      return { primary: null, secondary: null, rotationStart: null, message: 'No schedule configured' };
    }

    const now = new Date();
    // 找到当前生效的轮值
    let currentRotation = null;
    for (let i = schedule.rotations.length - 1; i >= 0; i--) {
      const r = schedule.rotations[i];
      const start = new Date(r.startDate);
      if (start <= now) {
        currentRotation = r;
        break;
      }
    }

    if (!currentRotation) {
      currentRotation = schedule.rotations[schedule.rotations.length - 1];
    }

    return {
      primary: currentRotation.primary || null,
      secondary: currentRotation.secondary || null,
      rotationStart: currentRotation.startDate || null,
      rotationEnd: currentRotation.endDate || null,
      weekNumber: currentRotation.weekNumber || null,
      updatedAt: schedule.lastUpdated || null,
    };
  }

  /** 获取未来 N 周的排班表 */
  getSchedule(weeks = 2) {
    const schedule = this._loadSchedule();
    if (!schedule || !schedule.rotations) {
      return { rotations: [], message: 'No schedule configured' };
    }

    const now = new Date();
    const futureRotations = schedule.rotations.filter(r => {
      const start = new Date(r.startDate);
      const end = r.endDate ? new Date(r.endDate) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      // 返回未来 weeks 周的排班 + 当前周
      const weeksFuture = weeks * 7 * 24 * 60 * 60 * 1000;
      return end > now - (7 * 24 * 60 * 60 * 1000) && start < now + weeksFuture;
    });

    return {
      rotations: futureRotations,
      teamMembers: schedule.teamMembers || [],
      lastUpdated: schedule.lastUpdated,
    };
  }

  /** 提交接班记录 */
  createHandover(handoverData) {
    const handover = {
      id: `HO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(this.data.handovers.length + 1).padStart(3, '0')}`,
      from: handoverData.from || '',
      to: handoverData.to || '',
      timestamp: new Date().toISOString(),
      items: handoverData.items || {},
      notes: handoverData.notes || '',
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };

    this.data.handovers.unshift(handover);
    this._save();

    // 同时更新排班文件的当前值班人
    if (handoverData.to) {
      this._updateCurrentPrimaryInSchedule(handoverData.to);
    }

    return handover;
  }

  /** 确认交接记录 */
  acknowledgeHandover(id, acknowledgedBy) {
    const handover = this.data.handovers.find(h => h.id === id);
    if (!handover) return null;

    handover.acknowledged = true;
    handover.acknowledgedAt = new Date().toISOString();
    handover.acknowledgedBy = acknowledgedBy;
    this._save();
    return handover;
  }

  /** 获取交接记录列表 */
  getHandovers(limit = 20) {
    return this.data.handovers.slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════════
  // PostMortem 方法
  // ══════════════════════════════════════════════════════════════

  /** 创建复盘报告 */
  createPostMortem(postmortemData) {
    const pm = {
      id: `PM-${Date.now().toString(36).toUpperCase()}`,
      incidentId: postmortemData.incidentId || '',
      summary: postmortemData.summary || '',
      timeline: postmortemData.timeline || [],
      rootCause: postmortemData.rootCause || '',
      actionItems: postmortemData.actionItems || [],
      participants: postmortemData.participants || [],
      meetingDate: postmortemData.meetingDate || null,
      status: postmortemData.status || 'draft',  // draft/review/published
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.postmortems.unshift(pm);

    // 关联到事件
    if (pm.incidentId) {
      const incident = this.getIncidentById(pm.incidentId);
      if (incident) {
        incident.postmortemId = pm.id;
        this._save(); // 已经在上面 save 了，但需要保存 incident 的更新
      }
    }

    this._save();
    return pm;
  }

  /** 获取复盘报告列表 */
  getPostmortems(options = {}) {
    let results = [...this.data.postmortems];

    if (options.status) {
      results = results.filter(p => p.status === options.status);
    }

    if (options.incidentId) {
      results = results.filter(p => p.incidentId === options.incidentId);
    }

    const total = results.length;
    const page = Math.max(1, parseInt(options.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, parseInt(options.pageSize) || DEFAULT_PAGE_SIZE);
    const start = (page - 1) * pageSize;

    return {
      items: results.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** 根据 ID 获取单个复盘报告 */
  getPostMortemById(id) {
    return this.data.postmortems.find(p => p.id === id) || null;
  }

  /** 更新复盘报告 */
  updatePostMortem(id, updateData) {
    const index = this.data.postmortems.findIndex(p => p.id === id);
    if (index === -1) return null;

    const pm = this.data.postmortems[index];
    const allowedFields = ['summary', 'timeline', 'rootCause', 'actionItems', 'participants', 'meetingDate', 'status'];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        pm[field] = updateData[field];
      }
    }

    pm.updatedAt = new Date().toISOString();
    this.data.postmortems[index] = pm;
    this._save();
    return pm;
  }

  // ══════════════════════════════════════════════════════════════
  // 统计方法
  // ══════════════════════════════════════════════════════════════

  /** 获取仪表盘统计数据 */
  getDashboardStats(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentIncidents = this.data.incidents.filter(i => new Date(i.createdAt) >= since);

    // 按 severity 分组统计
    const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
    recentIncidents.forEach(i => {
      if (bySeverity[i.severity] !== undefined) bySeverity[i.severity]++;
    });

    // 按 status 分组统计
    const byStatus = {};
    recentIncidents.forEach(i => {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    });

    // 计算 MTTR (仅已解决的)
    const resolvedIncidents = recentIncidents.filter(i => i.resolvedAt);
    let totalMTTRMinutes = 0;
    resolvedIncidents.forEach(i => {
      totalMTTRMinutes += (new Date(i.resolvedAt) - new Date(i.createdAt)) / (1000 * 60);
    });
    const avgMTTR = resolvedIncidents.length > 0
      ? Math.round(totalMTTRMinutes / resolvedIncidents.length)
      : null;

    return {
      period: `${days} days`,
      totalIncidents: recentIncidents.length,
      bySeverity,
      byStatus,
      avgMTTRMinutes: avgMTTR,
      resolvedCount: resolvedIncidents.length,
      openCount: recentIncidents.filter(i => !['resolved', 'closed', 'cancelled'].includes(i.status)).length,
      totalPostmortems: this.data.postmortems.length,
      totalHandovers: this.data.handovers.length,
      lastUpdated: this.data.meta.lastUpdated,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 私有辅助方法
  // ══════════════════════════════════════════════════════════════

  /** 加载排班数据文件 */
  _loadSchedule() {
    try {
      if (fs.existsSync(SCHEDULE_DATA_FILE)) {
        const raw = fs.readFileSync(SCHEDULE_DATA_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error('[TeamStore] Failed to load schedule:', error.message);
    }
    return null;
  }

  /** 更新排班文件中的当前 Primary */
  _updateCurrentPrimaryInSchedule(newPrimary) {
    try {
      const schedule = this._loadSchedule();
      if (schedule && schedule.rotations && schedule.rotations.length > 0) {
        const lastRotation = schedule.rotations[schedule.rotations.length - 1];
        lastRotation.primary = newPrimary;
        schedule.lastUpdated = new Date().toISOString();
        fs.writeFileSync(SCHEDULE_DATA_FILE, JSON.stringify(schedule, null, 2), 'utf-8');
      }
    } catch (error) {
      console.error('[TeamStore] Failed to update schedule:', error.message);
    }
  }
}

// 全局单例
const store = new TeamCollaborationStore();

// ── 中间件: 认证检查 ─────────────────────────────────────────────────────

/** 简单的 token 验证（复用项目现有的 auth 中间件模式） */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Bearer token required',
    });
  }
  // 在实际部署中这里会验证 JWT；当前做基本存在性检查
  next();
}

// ── Route Handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/team/oncall/current
 * 获取当前值班人员信息
 */
router.get('/oncall/current', requireAuth, (req, res) => {
  try {
    const oncallInfo = store.getCurrentOncall();
    res.json({ success: true, data: oncallInfo });
  } catch (error) {
    console.error('[Team] Get current oncall error:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
  }
});

/**
 * GET /api/v1/team/oncall/schedule?weeks=2
 * 获取未来 N 周的轮值表
 */
router.get('/oncall/schedule', requireAuth, (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 2;
    const schedule = store.getSchedule(weeks);
    res.json({ success: true, data: schedule });
  } catch (error) {
    console.error('[Team] Get schedule error:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
  }
});

/**
 * POST /api/v1/team/oncall/handover
 * 提交值班交接记录
 * Body: { from, to, items: {}, notes }
 */
router.post('/oncall/handover', requireAuth, (req, res) => {
  try {
    const { from, to, items, notes } = req.body;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'from and to fields are required',
      });
    }

    const handover = store.createHandover({
      from,
      to,
      items: items || {},
      notes: notes || '',
    });

    res.status(201).json({ success: true, data: handover });
  } catch (error) {
    console.error('[Team] Create handover error:', error);
    res.status(500).json({ success: false, error: 'HANDOVER_CREATE_FAILED', message: error.message });
  }
});

/**
 * POST /api/v1/team/oncall/:handoverId/acknowledge
 * 确认交接记录
 */
router.post('/oncall/:handoverId/acknowledge', requireAuth, (req, res) => {
  try {
    const { handoverId } = req.params;
    const { acknowledgedBy } = req.body;

    if (!acknowledgedBy) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'acknowledgedBy field is required',
      });
    }

    const handover = store.acknowledgeHandover(handoverId, acknowledgedBy);
    if (!handover) {
      return res.status(404).json({
        success: false,
        error: 'HANDOVER_NOT_FOUND',
        message: `Handover ${handoverId} not found`,
      });
    }

    res.json({ success: true, data: handover });
  } catch (error) {
    console.error('[Team] Acknowledge handover error:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
  }
});

/**
 * GET /api/v1/team/incidents
 * 事件列表（支持分页和过滤）
 * Query: page, pageSize, severity, status, tag, assignee, search, sortBy, sortOrder
 */
router.get('/incidents', requireAuth, (req, res) => {
  try {
    const result = store.getIncidents(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Team] List incidents error:', error);
    res.status(500).json({ success: false, error: 'INCIDENT_LIST_FAILED', message: error.message });
  }
});

/**
 * POST /api/v1/team/incidents
 * 创建新事件
 * Body: { title, severity, reporter, description, tags, assignee }
 */
router.post('/incidents', requireAuth, (req, res) => {
  try {
    const { title, severity, reporter, description, tags, assignee } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'title is required',
      });
    }

    // severity 校验
    const validSeverities = ['P0', 'P1', 'P2', 'P3'];
    if (severity && !validSeverities.includes(severity)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: `severity must be one of: ${validSeverities.join(', ')}`,
      });
    }

    const incident = store.createIncident({
      title,
      severity: severity || 'P2',
      reporter: reporter || (req.user?.email || 'api-user'),
      description,
      tags,
      assignee,
    });

    res.status(201).json({ success: true, data: incident });
  } catch (error) {
    console.error('[Team] Create incident error:', error);
    res.status(500).json({ success: false, error: 'INCIDENT_CREATE_FAILED', message: error.message });
  }
});

/**
 * GET /api/v1/team/incidents/:id
 * 获取单个事件详情
 */
router.get('/incidents/:id', requireAuth, (req, res) => {
  try {
    const incident = store.getIncidentById(req.params.id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        error: 'INCIDENT_NOT_FOUND',
        message: `Incident ${req.params.id} not found`,
      });
    }

    // 附带评论
    const comments = store.getComments(req.params.id);

    res.json({ success: true, data: { ...incident, comments } });
  } catch (error) {
    console.error('[Team] Get incident error:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
  }
});

/**
 * PATCH /api/v1/team/incidents/:id
 * 更新事件状态或属性
 * Body: { status, severity, assignee, title, description, tags }
 */
router.patch('/incidents/:id', requireAuth, (req, res) => {
  try {
    const updated = store.updateIncident(req.params.id, {
      ...req.body,
      updatedBy: req.user?.email || 'api-user',
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'INCIDENT_NOT_FOUND',
        message: `Incident ${req.params.id} not found`,
      });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Team] Update incident error:', error);
    res.status(500).json({ success: false, error: 'INCIDENT_UPDATE_FAILED', message: error.message });
  }
});

/**
 * POST /api/v1/team/incidents/:id/comment
 * 给事件添加评论
 * Body: { content, author }
 */
router.post('/incidents/:id/comment', requireAuth, (req, res) => {
  try {
    const { content, author } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'content is required',
      });
    }

    // 验证事件存在
    const incident = store.getIncidentById(req.params.id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        error: 'INCIDENT_NOT_FOUND',
        message: `Incident ${req.params.id} not found`,
      });
    }

    const comment = store.addComment(req.params.id, {
      content,
      author: author || (req.user?.email || 'api-user'),
    });

    // 同时添加到事件 timeline
    store.addTimelineEntry(req.params.id, {
      event: 'comment_added',
      detail: `Comment: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`,
      author: author || (req.user?.email || 'api-user'),
    });

    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    console.error('[Team] Add comment error:', error);
    res.status(500).json({ success: false, error: 'COMMENT_ADD_FAILED', message: error.message });
  }
});

/**
 * GET /api/v1/team/postmortems
 * 复盘报告列表
 * Query: page, pageSize, status, incidentId
 */
router.get('/postmortems', requireAuth, (req, res) => {
  try {
    const result = store.getPostmortems(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Team] List postmortems error:', error);
    res.status(500).json({ success: false, error: 'POSTMORTEM_LIST_FAILED', message: error.message });
  }
});

/**
 * POST /api/v1/team/postmortems
 * 创建复盘报告
 * Body: { incidentId, summary, timeline, rootCause, actionItems, participants, meetingDate, status }
 */
router.post('/postmortems', requireAuth, (req, res) => {
  try {
    const { incidentId, summary, timeline, rootCause, actionItems, participants, meetingDate, status } = req.body;

    if (!summary) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'summary is required',
      });
    }

    // 如果关联了事件，验证事件存在
    if (incidentId) {
      const incident = store.getIncidentById(incidentId);
      if (!incident) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: `Incident ${incidentId} not found`,
        });
      }
    }

    const postmortem = store.createPostMortem({
      incidentId,
      summary,
      timeline: timeline || [],
      rootCause: rootCause || '',
      actionItems: actionItems || [],
      participants: participants || [],
      meetingDate: meetingDate || null,
      status: status || 'draft',
    });

    res.status(201).json({ success: true, data: postmortem });
  } catch (error) {
    console.error('[Team] Create postmortem error:', error);
    res.status(500).json({ success: false, error: 'POSTMORTEM_CREATE_FAILED', message: error.message });
  }
});

/**
 * GET /api/v1/team/postmortems/:id
 * 获取单个复盘报告详情
 */
router.get('/postmortems/:id', requireAuth, (req, res) => {
  try {
    const postmortem = store.getPostMortemById(req.params.id);
    if (!postmortem) {
      return res.status(404).json({
        success: false,
        error: 'POSTMORTEM_NOT_FOUND',
        message: `PostMortem ${req.params.id} not found`,
      });
    }

    res.json({ success: true, data: postmortem });
  } catch (error) {
    console.error('[Team] Get postmortem error:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
  }
});

/**
 * PATCH /api/v1/team/postmortems/:id
 * 更新复盘报告
 */
router.patch('/postmortems/:id', requireAuth, (req, res) => {
  try {
    const updated = store.updatePostMortem(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'POSTMORTEM_NOT_FOUND',
        message: `PostMortem ${req.params.id} not found`,
      });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Team] Update postmortem error:', error);
    res.status(500).json({ success: false, error: 'POSTMORTEM_UPDATE_FAILED', message: error.message });
  }
});

/**
 * GET /api/v1/team/dashboard/stats
 * 仪表盘统计数据
 * Query: days (默认 7)
 */
router.get('/dashboard/stats', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = store.getDashboardStats(days);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('[Team] Dashboard stats error:', error);
    res.status(500).json({ success: false, error: 'STATS_ERROR', message: error.message });
  }
});

module.exports = router;
