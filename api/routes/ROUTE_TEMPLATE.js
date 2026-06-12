/**
 * @file Route Handler Template (DEBT-015)
 * @description GlobalReach V2.0 标准路由处理函数模板
 *
 * 所有异步路由处理函数 MUST 使用 asyncHandler 包装，确保未捕获的异常
 * 被统一转发到 errorHandler 中间件处理，避免 Node.js 进程崩溃。
 *
 * ============================================
 * 标准模式（推荐）— 简单 CRUD 路由
 * ============================================
 *
 *   const { asyncHandler } = require('../middleware/errorHandler');
 *
 *   router.get('/resource', verifyToken, asyncHandler(async (req, res) => {
 *     const data = await someService.getData(req.user.id, req.query);
 *     res.json({ success: true, data });
 *   }));
 *
 * --------------------------------------------
 *
 * ============================================
 * 带输入验证的模式 — 使用 express-validator
 * ============================================
 *
 *   router.post('/resource',
 *     ...validationRules(),
 *     validateRequest,
 *     asyncHandler(async (req, res) => {
 *       const { name } = req.body;
 *       const item = await someService.create({ name });
 *       res.status(201).json({ success: true, data: item });
 *     })
 *   );
 *
 * --------------------------------------------
 *
 * ============================================
 * 保留 try-catch 的场景（Category C）
 * ============================================
 *
 * 仅在以下情况保留内部 try-catch：
 * - catch 块中有特殊业务逻辑（如安全相关的成功响应防枚举）
 * - catch 块需要根据错误内容返回不同 HTTP 状态码且无法通过 AppError 替代
 * - catch 块需要执行清理操作（如记录失败事件到 DB）
 *
 * 示例（安全相关 — 防止用户名/邮箱枚举攻击）：
 *
 *   router.post('/forgot-password', async (req, res) => {
 *     try {
 *       // ... 处理逻辑
 *     } catch (error) {
 *       // 安全：始终返回成功，防止枚举有效用户
 *       res.json({ success: true, message: '如果该邮箱已注册，重置链接已发送' });
 *     }
 *   });
 *
 * 示例（特殊状态码 + 清理操作）：
 *
 *   router.post('/webhook/alertmanager', async (req, res) => {
 *     try {
 *       // ... 处理逻辑
 *     } catch (error) {
 *       await webhookListenerService.logEvent('alertmanager', 'error', { ... });
 *       res.status(500).json({ success: false, error: 'PROCESSING_ERROR' });
 *     }
 *   });
 *
 * --------------------------------------------
 *
 * ============================================
 * ❌ 禁止模式（DEBT-015 修复前的问题代码）
 * ============================================
 *
 *   // 错误：async 函数无任何错误保护 → 未捕获 promise 拒绝 → 进程崩溃
 *   router.get('/data', async (req, res) => {
 *     const data = await service.getData(); // 如果这里抛出异常，进程崩溃！
 *     res.json({ success: true, data });
 *   });
 *
 *   // 错误：try-catch 只做通用 500 响应 → 应使用 asyncHandler 简化
 *   router.get('/data', async (req, res) => {
 *     try {
 *       const data = await service.getData();
 *       res.json({ success: true, data });
 *     } catch (error) {
 *       console.error(error);
 *       res.status(500).json({ success: false, message: error.message }); // 冗余代码
 *     }
 *   });
 *
 * --------------------------------------------
 *
 * ============================================
 * 技术要点
 * ============================================
 *
 * 1. asyncHandler 实现（api/middleware/errorHandler.js）:
 *    function asyncHandler(fn) {
 *      return (req, res, next) => {
 *        Promise.resolve(fn(req, res, next)).catch(next);
 *      };
 *    }
 *
 * 2. 工作原理:
 *    - 将 async 函数包装为同步签名的中间件
 *    - 通过 .catch(next) 将异常转发给 Express 的错误处理链
 *    - 最终被全局 errorHandler 中间件统一处理（含 AppError 分类、日志、监控）
 *
 * 3. 为什么不用 try-catch:
 *    - 减少样板代码（每个路由减少 ~4 行）
 *    - 统一错误响应格式（errorHandler 保证一致的 API 错误结构）
 *    - 集中式监控（errorRateTracker 自动追踪所有错误）
 *    - 避免 Node.js 15+ 默认的 unhandledRejection 进程退出行为
 *
 * 4. 同步路由无需 asyncHandler:
 *    - 同步代码的异常会被 Express 自动捕获并传递给 errorHandler
 *    - 只有 async/await 路由才需要 asyncHandler 包装
 *
 * @see api/middleware/errorHandler.js — asyncHandler 实现与 AppError 类层次
 * @see DEBT-015 — 技术债务修复记录
 */
