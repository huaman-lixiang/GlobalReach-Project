/**
 * Technical Debt Tracker API — S132/O08
 *
 * RESTful endpoints for managing GlobalReach V2.0 technical debt.
 * Provides debt registration, quantification, prioritization, and repayment tracking.
 *
 * Endpoints:
 *   GET    /api/v1/debt/register           — List all debts (filterable)
 *   GET    /api/v1/debt/register/:id       — Single debt detail
 *   POST   /api/v1/debt/register           — Register new debt
 *   PATCH  /api/v1/debt/register/:id       — Update debt status/priority
 *   DELETE /api/v1/debt/register/:id       — Archive repaid debt
 *   GET    /api/v1/debt/stats              — Dashboard metrics
 *   GET    /api/v1/debt/interest           — Calculate accrued interest
 *   GET    /api/v1/debt/repayment-plan     — ROI-sorted repayment plan
 *   POST   /api/v1/debt/:id/start-repayment — Start repayment
 *   POST   /api/v1/debt/:id/complete-repayment — Mark complete
 */

const express = require('express');
const router = express.Router();
const { createLogger } = require('../middleware/logger');

const debtLog = createLogger('TechDebt');

// ============================================
// In-Memory Debt Store (Production: migrate to PostgreSQL)
// ============================================

/**
 * 技术债务数据模型 (基于 TECHNICAL_DEBT_REGISTER.md)
 */
const debtStore = [
  // ===== Infrastructure Debts (DEBT-001 ~ DEBT-006) =====
  {
    id: 'DEBT-001', category: 'Infrastructure', component: 'nginx-prod, certbot',
    discoveredAt: 'S128', discoverer: 'Protocol Audit',
    description: 'Nginx SSL证书缺失 - ssl-le-production.conf引用的Let\'s Encrypt证书路径不存在，certbot需--profile ssl启动',
    impact: '生产环境无法启用HTTPS；4个域名不可用；HSTS受阻；PCI-DSS不满足',
    rootCause: 'Phase L被阻塞：缺少公网IP+域名DNS+ACME访问权限',
    interestRate: 0.02, interestLevel: 'HIGH',
    principal: 7, principalLevel: 'MEDIUM',
    priority: 'P0', status: 'BLOCKED',
    repaymentPlan: 'Phase L: 公网IP → DNS → certbot --profile ssl → Nginx reload → HTTPS验证',
    dependencies: '公网IPv4, 域名DNS解析权, 80/443端口, ACME出站访问',
    risk: '生产无法上线; 延迟无额外增长(BLOCKED)',
    relatedFiles: ['nginx/conf.d/ssl-le-production.conf', 'docker-compose.prod.yml'],
    acceptanceCriteria: ['curl -I https://api.globalreach.com/api/v1/health 返回200', 'SSL Labs A+', 'OCSP Stapling正常'],
    createdAt: new Date('2026-04-15'), daysOutstanding: 55,
    statusHistory: [{ date: '2026-04-15', from: null, to: 'BLOCKED', reason: 'Phase L blocked' }],
    repayments: []
  },
  {
    id: 'DEBT-002', category: 'Infrastructure→Security', component: 'redis, cacheService',
    discoveredAt: 'S121', discoverer: 'Security Audit',
    description: 'Redis密码认证禁用 - docker-compose中Redis服务未启用requirepass，Docker network内无认证连接，容器逃逸可获完整访问权',
    impact: '缓存数据可被任意读写删除；Session篡改；Rate limiting重置；缓存投毒攻击',
    rootCause: '开发阶段跳过认证；Docker内部网络视为可信区域；cacheService未强制AUTH',
    interestRate: 0.05, interestLevel: 'CRITICAL',
    principal: 3, principalLevel: 'SMALL',
    priority: 'P0', status: 'OPEN',
    repaymentPlan: 'openssl rand -hex 32生成密码 → docker-compose添加REDIS_PASSWORD → redis.conf requirepass → cacheService修改 → 重启验证',
    dependencies: '无硬性依赖',
    risk: '任何获Docker网络访问的攻击者可完全控制Redis; 随微服务数量增加暴露面扩大',
    relatedFiles: ['docker-compose.prod.yml(第29-42行)', 'api/services/cacheService.js'],
    acceptanceCriteria: ['redis-cli -a <pwd> ping 返回PONG', 'redis-cli(无密码)返回NOAUTH', 'Trivy不再报告Redis无认证'],
    createdAt: new Date('2026-05-10'), daysOutstanding: 30,
    statusHistory: [{ date: '2026-05-10', from: null, to: 'OPEN', reason: 'S121 security audit发现' }],
    repayments: []
  },
  {
    id: 'DEBT-003', category: 'Infrastructure', component: 'Dockerfile, api/, src/',
    discoveredAt: 'S089', discoverer: 'Image Size Audit',
    description: 'Docker镜像优化不足 - multi-stage build存在缺陷：未用npm ci、复制整个api/src、缺.dockerignore、未利用layer caching，镜像>500MB',
    impact: '镜像拉取慢；存储成本增加；攻击面增大；CI延长至3-5分钟',
    rootCause: '快速迭代优先功能交付；缺乏Docker最佳实践知识库；无镜像大小监控',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 7, principalLevel: 'MEDIUM',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: '.dockerignore → COPY顺序优化 → 分离test/config → npm ci确定性构建 → CI调整 → 文档',
    dependencies: '无',
    risk: '随项目增长镜像持续膨胀；每周增加约50MB',
    relatedFiles: ['Dockerfile'],
    acceptanceCriteria: ['镜像<250MB', 'build context<5MB', 'CI构建<2min'],
    createdAt: new Date('2026-05-20'), daysOutstanding: 20,
    statusHistory: [{ date: '2026-05-20', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-004', category: 'Infrastructure→Security', component: 'postgres, docker-compose.prod.yml',
    discoveredAt: 'S118', discoverer: 'Security Hardening Review',
    description: 'PostgreSQL默认密码changeme未强制修改 - POSTGRES_PASSWORD/DB_PASSWORD默认值changeme，无startup检测，postgres-exporter也硬编码',
    impact: '数据库可能弱密码暴露；备份含明文密码；CIS Benchmark不通过',
    rootCause: 'Docker示例直接复制未修改；缺乏生产配置验证机制',
    interestRate: 0.02, interestLevel: 'HIGH',
    principal: 3, principalLevel: 'SMALL',
    priority: 'P1', status: 'IN_PROGRESS',
    repaymentPlan: 'validate-env.sh脚本 → entrypoint检测默认值 → .env.prod.template → CI validation step',
    dependencies: '无',
    risk: '生产可能以弱密码运行数据库；风险线性增长',
    relatedFiles: ['docker-compose.prod.yml(第20,59-64,224行)', '.github/workflows/ci-cd.yml'],
    acceptanceCriteria: ['默认密码时容器启动失败', '.env.prod.template存在', 'CI deploy前有validation gate'],
    createdAt: new Date('2026-05-01'), daysOutstanding: 39,
    statusHistory: [
      { date: '2026-05-01', from: null, to: 'OPEN' },
      { date: '2026-05-20', from: 'OPEN', to: 'IN_PROGRESS', reason: '部分缓解措施已讨论' }
    ],
    repayments: []
  },
  {
    id: 'DEBT-005', category: 'Infrastructure→Operations', component: 'scripts/verify-backup.sh, CI backup-verification',
    discoveredAt: 'M-D04', discoverer: 'DR Drill Review',
    description: '备份验证自动化不完善 - verify-backup.sh仅检查存在性未验证可恢复性(无pg_restore)；disaster-recovery-drill仅schedule触发且continue-on-error；RTO/RPO未量化',
    impact: '可能假阳性备份；灾难恢复时发现不可用；RPO可能远超预期；合规不满足',
    rootCause: 'DR演练资源消耗大；缺乏备份质量度量体系',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 32, principalLevel: 'LARGE',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'pg_restore dry-run验证 → BQS指标系统 → 自动清理策略(每日30天/周12周/月12月/年3年) → RTO/RPO量化监控',
    dependencies: '独立PostgreSQL测试实例; 足够磁盘空间',
    risk: '真正灾难时发现备份不可用(最坏情况数据永久丢失); 数据量增长使后续成本指数上升',
    relatedFiles: ['scripts/verify-backup.sh', 'scripts/disaster-recovery-drill.sh', '.github/workflows/ci-cd.yml'],
    acceptanceCriteria: ['pg_restore --clean --list成功率100%', 'BQS>=90', 'RTO<=4h RPO<=1h'],
    createdAt: new Date('2026-06-01'), daysOutstanding: 8,
    statusHistory: [{ date: '2026-06-01', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-006', category: 'Infrastructure', component: 'docker-compose.prod.yml(certbot)',
    discoveredAt: 'S121', discoverer: 'Image Version Pinning Audit',
    description: 'Certbot镜像使用:latest标签 - 第354行违反S121版本pinning规范，其他14个服务均已pin具体版本',
    impact: '构建不确定性；安全扫描基线不稳定；潜在SSL签发breaking change',
    root因: 'S121审计时遗漏certbot(使用profiles:[\"ssl\"]默认不启动)；certbot官方推荐latest与内部策略冲突',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 0.5, principalLevel: 'TINY',
    priority: 'P3', status: 'OPEN',
    repaymentPlan: '查询certbot最新stable版 → 修改image tag → 验证 → 提交PR',
    dependencies: '无',
    risk: '极低风险(certbot更新频率低且向后兼容性好)',
    relatedFiles: ['docker-compose.prod.yml(第354行)'],
    acceptanceCriteria: ['certbot image为具体版本号如2.11.0'],
    createdAt: new Date('2026-05-15'), daysOutstanding: 25,
    statusHistory: [{ date: '2026-05-15', from: null, to: 'OPEN' }],
    repayments: []
  },

  // ===== Security Debts (DEBT-007 ~ DEBT-011) =====
  {
    id: 'DEBT-007', category: 'Security', component: 'grafana, docker-compose.prod.yml',
    discoveredAt: 'S126', discoverer: 'Secrets Scanning',
    description: 'GF_SMTP_PASSWORD硬编码🔴 - docker-compose第190行硬编码QQ邮箱SMTP授权码zhrtbpzlgfoehjgj，alertmanager.yml第21/96/133/158行共5处',
    impact: 'QQ邮箱可被未授权发送邮件；Grafana/Alertmanager告警可伪造；GDPR违约；CIS Benchmark不通过',
    rootCause: 'S126迁移时快速验证SMTP直接硬编码；迁移后忘记替换；无pre-commit secrets scanning',
    interestRate: 0.05, interestLevel: 'CRITICAL',
    principal: 3.7, principalLevel: 'SMALL',
    priority: 'P0', status: 'OPEN',
    repaymentPlan: 'IMMEDIATE: 撤销当前授权码 → 修改docker-compose/alertmanager引用环境变量 → 安装git-secrets → BFG清理git历史 → force push通知团队',
    dependencies: 'QQ邮箱管理后台; GitHub repo admin; 团队协调',
    risk: '密码已泄露给所有repo访问者随时可被滥用; git history永久无法完全删除',
    relatedFiles: ['docker-compose.prod.yml(第190行)', 'alertmanager.yml(第21,96,133,158行)'],
    acceptanceCriteria: ['docker-compose无明文密码', 'alertmanager无明文密码', 'git log -p -S "zhrtbpzlgfoehjgj" 返回空', 'git-secrets --scan 通过'],
    createdAt: new Date('2026-04-15'), daysOutstanding: 55,
    statusHistory: [{ date: '2026-04-15', from: null, to: 'OPEN', reason: 'S126 SMTP migration引入' }],
    repayments: []
  },
  {
    id: 'DEBT-008', category: 'Security', component: 'grafana, docker-compose.prod.yml',
    discoveredAt: 'S128', discoverer: 'Default Credential Scanner',
    description: 'GF_SECURITY_ADMIN_PASSWORD弱默认值admin123🔴 - 第184行，Top 10最常见弱密码，Grafana监听3002端口映射宿主机可直接绕过nginx auth',
    impact: 'Grafana管理员权限易获取；监控数据泄露；告警规则可禁用篡改；数据源密码可能提取',
    rootCause: 'Grafana官方示例使用admin/admin123；快速部署复制示例未修改；未纳入统一身份认证',
    interestRate: 0.05, interestLevel: 'CRITICAL',
    principal: 1.8, principalLevel: 'SMALL',
    priority: 'P0', status: 'OPEN',
    repaymentPlan: 'TODAY: 默认值改为空字符串强制必填 → 移除/限制3002端口映射 → .env.prod设置20+字符随机密码 → 验证localhost:3002不可直接访问',
    dependencies: '无(可立即执行)',
    risk: 'Grafana可能在数小时内被暴力破解(admin123秒破); 每延迟一天自动化扫描发现概率增约5%',
    relatedFiles: ['docker-compose.prod.yml(第184,197行)'],
    acceptanceCriteria: ['默认值为空或强制报错', '3002端口不映射或受防火墙限制', '密码>=20字符含大小写+数字+特殊字符'],
    createdAt: new Date('2026-06-01'), daysOutstanding: 8,
    statusHistory: [{ date: '2026-06-01', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-009', category: 'Security', component: 'api/server.js, docker-compose.prod.yml, alertmanager',
    discoveredAt: 'S118', discoverer: 'Secret Entropy Analysis',
    description: 'JWT/WEBHOOK/CSRF_SECRET使用可预测默认值 - JWT_SECRET(change-this-secret...)熵~3bits可伪造token; WEBHOOK_SECRET(gr_webhook_secret_2026_prod)高度可猜测; CSRF_SECRET同样简单',
    impact: 'JWT伪造→完整API接管; Webhook伪造→告警污染; CSRF失效→跨站请求伪造',
    rootCause: 'Express/JWT教程常用提示性默认值；缺乏deployment checklist; 未使用secrets management工具',
    interestRate: 0.02, interestLevel: 'HIGH',
    principal: 2.8, principalLevel: 'SMALL',
    priority: 'P0', status: 'OPEN',
    repaymentPlan: 'openssl rand -base64 48生成3个高熵secret → 改为${VAR:?ERROR}强制必填 → generate-secrets.sh → CI secret strength check → 更新DEPLOYMENT_CHECKLIST',
    dependencies: '无',
    risk: 'JWT secret泄露可导致完整身份认证绕过(最严重安全事件之一)',
    relatedFiles: ['docker-compose.prod.yml(第67,69,90行)', 'alertmanager.yml(第315行)'],
    acceptanceCriteria: ['默认值为空或${VAR:?ERROR}', 'Secret length>=32bytes entropy>=128bits', 'grep change-this|changeme docker-compose返回空'],
    createdAt: new Date('2026-05-01'), daysOutstanding: 39,
    statusHistory: [{ date: '2026-05-01', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-010', category: 'Security→Privacy', component: 'docker-compose.prod.yml, alertmanager.yml',
    discoveredAt: 'S126', discoverer: 'PII Scanner',
    description: 'SMTP_QQ_USER/FROM硬编码邮箱地址1390885333@qq.com - 属PII，重复在grafana和alertmanager共8处',
    impact: '个人隐私泄露(低风险)；可作为社工攻击信息锚点',
    rootCause: 'S126迁移时简化配置直接写死；未考虑邮箱地址属敏感信息',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 0.5, principalLevel: 'TINY',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: '改为${SMTP_QQ_USER/FROM}环境变量引用 → .env.prod.template使用example.com占位符',
    dependencies: '无',
    risk: '隐私风险持续但概率低; 无显著增长',
    relatedFiles: ['docker-compose.prod.yml(第79-80,189-191行)', 'alertmanager.yml(第17,93,129-130行)'],
    acceptanceCriteria: ['grep 1390885333 项目目录(除.env.prod外)返回空'],
    createdAt: new Date('2026-04-15'), daysOutstanding: 55,
    statusHistory: [{ date: '2026-04-15', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-011', category: 'Security→Process', component: '.git/hooks, CI/CD pipeline',
    discoveredAt: 'S132/O08', discoverer: 'Root Cause Analysis of DEBT-007',
    description: '缺少Pre-commit Secrets Scanning - 导致DEBT-007能合入的根因：无pre-commit hook/CI secrets scan/.gitignore rules/CODEOWNERS/team培训。证据：DEBT-007密码跨越2个月经多次review均未被捕获',
    impact: '未来仍可能引入新硬编码密码; 每次manual review加重负担; 安全事件响应成本高',
    rootCause: '快速迭代优先功能交付; security tooling投入产出比不明显; 缺乏security champion角色',
    interestRate: 0.02, interestLevel: 'HIGH',
    principal: 3.5, principalLevel: 'SMALL',
    priority: 'P0', status: 'OPEN',
    repaymentPlan: 'Week1: gitleaks安装配置 + pre-commit hook + CI集成 + SECURITY_GUIDELINES + CODEOWNERS',
    dependencies: '无(本地即可安装)',
    risk: '预计每季度新引入1-2个secrets泄露事件(基于历史频率推断)',
    relatedFiles: ['缺失: .gitleaks.toml, .husky/pre-commit, .github/workflows/ci-cd.yml'],
    acceptanceCriteria: ['含password/secret文件无法commit(pre-commit拦截)', 'CI PR触发gitleaks scan fail on detection', 'CODEOWNERS存在敏感文件规则'],
    createdAt: new Date('2026-06-09'), daysOutstanding: 0,
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN', reason: '本次审计发现作为预防措施' }],
    repayments: []
  },

  // ===== Code Quality Debts (DEBT-012 ~ DEBT-016) =====
  {
    id: 'DEBT-012', category: 'Code Quality', component: 'tests/, api/, CI/CD pipeline',
    discoveredAt: 'S128', discoverer: 'Test Gap Analysis',
    description: '单元测试覆盖率不足 - 现有k6性能测试7个+E2E 6个+DB 1个，**单元测试0个**。middleware/services/routes全覆盖0%。**CI问题**: npm test和ESLint均continue-on-error:true，quality-gate实际不gate任何东西。估算总覆盖率<5%',
    impact: '重构信心零; Bug回归率高; Code Review负担重; 无法安全重构导致债务利息加速累积',
    rootCause: '先跑通再补测试策略从未回头; k6/E2E给了"有测试"错觉; 缺乏testing champion',
    interestRate: 0.02, interestLevel: 'HIGH',
    principal: 30, principalLevel: 'LARGE',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Sprint1-2: Jest搭建+errorHandler测试(核心middleware 30%) → Sprint3-4: rateLimiter/auth/validator(安全代码70%) → Sprint5-8: service/route测试 + CI coverage gate>=60% (全项目60%)',
    dependencies: 'Jest选型确定; 测试DB实例(CI已有postgres service); 每Sprint分配20% capacity给测试',
    risk: '代码腐化速度~每周1%可维护性下降; 每延迟一月偿还成本增加约15%',
    relatedFiles: ['tests/', 'api/package.json', '.github/workflows/ci-cd.yml(第106-107,196行)'],
    acceptanceCriteria: ['Jest 0 failures', 'Coverage >=60%, critical security code >=80%', 'CI coverage <60%则build fails'],
    createdAt: new Date('2026-03-15'), daysOutstanding: 86,
    statusHistory: [{ date: '2026-03-15', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-013', category: 'Code Quality', component: 'api/middleware/logger.js, api/server.js',
    discoveredAt: 'S132/O08', discoverer: 'Log Consistency Review',
    description: '日志格式不完全一致 - 虽有统一requestLogger(logger.js)但server.js大量console.log/warn/error直接输出(20+处)，时间戳/字段命名/级别使用不规范。Loki聚合后查询困难',
    impact: '日志可观测性降低; 故障排查时间+30%; 日志存储成本增加; Loki查询性能下降',
    rootCause: '调试后忘记替换回structured logger; 不同开发者习惯不同; 缺乏eslint-plugin-log',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 9, principalLevel: 'MEDIUM',
    priority: 'P2', status: 'IN_PROGRESS',
    repaymentPlan: '渐进式迁移: server.js console.log→appLog → middleware console.*→createLogger(moduleName) → services/ → routes/ → eslint no-console + CI启用',
    dependencies: '无(可立即开始)',
    risk: '日志系统逐渐变成噪声发生器; 每新增一个使用console.log的文件迁移成本+1',
    relatedFiles: ['api/server.js(20+处console.log)', 'api/middleware/*.js'],
    acceptanceCriteria: ['grep console.(log|warn|error) api/*.js | wc -l 返回0(排除logger.js)', '所有日志含timestamp/level/component/message', 'Loki query level="ERROR"捕获全部错误日志'],
    createdAt: new Date('2026-05-25'), daysOutstanding: 15,
    statusHistory: [
      { date: '2026-05-25', from: null, to: 'OPEN' },
      { date: '2026-06-05', from: 'OPEN', to: 'IN_PROGRESS', reason: 'logger.js基础设施就绪待全面迁移' }
    ],
    repayments: []
  },
  {
    id: 'DEBT-014', category: 'Code Quality→UX', component: 'frontend/src/pages/*.tsx, i18n/',
    discoveredAt: 'D18', discoverer: 'i18n Coverage Scanner',
    description: 'i18n国际化覆盖不完整 - Login.tsx硬编码中文(企业微信/钉钉/SSO加载失败等); Dashboard.tsx platformLabels在组件顶层调t()导致runtime error(hook顺序违反React规则); 其他页面i18n覆盖率未知',
    impact: '中英文混合界面; SSO国际用户困惑; 新增locale返工量大; platformLabels可能导致运行时报错',
    rootCause: 'D18初始实现仅覆盖核心页面(Login/Dashboard); 后续新增页面开发者忘记遵循i18n规范; 缺乏eslint-plugin-i18n-alert',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 12, principalLevel: 'MEDIUM',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Sprint-based: 修复platformLabels(high-risk bug)+Login i18n → Dashboard+Settings → Campaigns+Accounts+Emails → Reports+TenantAdmin+Register → 后端错误消息i18n key + eslint rule',
    dependencies: 'i18n translation file structure确定; 前端开发时间分配',
    risk: '随页面数量增加i18n gap越来越大(每新增1页平均遗漏5-10字符串); 如果突然需要支持新语言返工成本=当前debt×3',
    relatedFiles: ['frontend/src/pages/Login.tsx(第36-37,61,69行)', 'frontend/src/pages/Dashboard.tsx(第39-44,72,79,87行)', 'frontend/src/i18n/'],
    acceptanceCriteria: ["grep '[\\u4e00-\\u9fa5]' frontend/src/pages/*.tsx 返回空", 'platformLabels使用useMemo或移入组件内', 'zh.json en.json key数差距<5%'],
    createdAt: new Date('2026-05-10'), daysOutstanding: 30,
    statusHistory: [{ date: '2026-05-10', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-015', category: 'Code Quality', component: 'api/routes/*.js, errorHandler.js',
    discoveredAt: 'S132/O08', discoverer: 'Async Error Handling Pattern Review',
    description: '错误处理不一致 - errorHandler导出asyncHandler(407-411行)但实际使用不一致：部分路由用asyncHandler/部分try-catch/部分**完全没有错误处理**。后果: Node.js 15+ UnhandledPromiseRejection默认exit进程=API崩溃; errorRateTracker不记录→监控盲区',
    impact: 'API稳定性降低; 错误监控不完整; debugging困难',
    rootCause: '不同开发者采用不同模式; 缺乏route template; code review未将错误处理一致性作为checklist item',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 4, principalLevel: 'SMALL',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Week1: 审计19个路由文件标记缺asyncHandler → Week2: 批量修复(可script自动化) → Week3: .vscode/snippets/route.snippet template → Week4: CONTRIBUTING.md Error Handling Requirements章节',
    dependencies: '无',
    risk: '随async路由增多崩溃概率增加(统计学上每100个async路由约3-5个unhandled rejection路径)',
    relatedFiles: ['api/routes/*.js(全部19个文件)', 'api/middleware/errorHandler.js(第407行)'],
    acceptanceCriteria: ['所有async handler被asyncHandler包装或有等效try-catch-next(err)', 'Route template snippet存在并被团队使用'],
    createdAt: new Date('2026-06-09'), daysOutstanding: 0,
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-016', category: 'Code Quality→DX', component: 'frontend/, CDN(M-E02)',
    discoveredAt: 'M-E02', discoverer: 'Git History Audit',
    description: '前端.env.cdn.example缺失 - M-E02预期产物在git add时被发现不存在。CDN环境变量(VITE_CDN_URL等)无参考模板。新开发者onboarding不知需配置哪些变量',
    impact: '新环境搭建可能失败或使用错误CDN配置; 前端构建可能warning/error',
    rootCause: '子代理产出文件未经验证就标记complete; 缺乏task completion checklist',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 0.7, principalLevel: 'TINY',
    priority: 'P3', status: 'OPEN',
    repaymentPlan: '检查frontend/现有.env*文件 → 创建.cdn.example含所有CDN变量及注释 → 更新CDN_INTEGRATION_PLAN.md引用此文件',
    dependencies: '确认CDN所需完整环境变量列表(vite.config.ts或package.json scripts)',
    risk: '极低风险(仅在特定场景下影响)',
    relatedFiles: ['缺失: frontend/.env.cdn.example'],
    acceptanceCriteria: ['.env.cdn.example存在含所有CDN环境变量及注释'],
    createdAt: new Date('2026-05-28'), daysOutstanding: 12,
    statusHistory: [{ date: '2026-05-28', from: null, to: 'OPEN' }],
    repayments: []
  },

  // ===== Architecture Debts (DEBT-017 ~ DEBT-019) =====
  {
    id: 'DEBT-017', category: 'Architecture', component: 'api/server.js, apiVersion.js, routes/',
    discoveredAt: 'D12', discoverer: 'API Versioning Strategy Review',
    description: 'API版本化Legacy路由未设废弃日期 - D12实现v1 versioning但legacy兼容路由(/api/* 12组280-291行)无Sunset header(RFC 8594)/deprecation warning/usage监控/removal timeline',
    impact: 'API演进受阻; 客户端混乱; 文档成本double; v2引入breaking changes时legacy成维护负担',
    rootCause: 'D12渐进式迁移策略但plan从未执行; legacy作为shortcut保留至今; 缺乏API governance process',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 12, principalLevel: 'MEDIUM',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Month1 Visibility(Sunset header+legacy usage metrics+Grafana dashboard) → Month2-3 Communication(deprecation notice+migration guide) → Month4-6 Removal(usage<1%持续2周后移除legacy或301 redirect)',
    dependencies: '客户端清单(谁用legacy?); Prometheus(D15已完成); Swagger UI(D16已完成)',
    risk: 'v2设计无限期推迟(legacy包袱太重); legacy client数量可能增长使迁移更难',
    relatedFiles: ['api/server.js(第250-295行)', 'api/middleware/apiVersion.js', 'api/routes/docs.js'],
    acceptanceCriteria: ['legacy路由返回Deprecation+Sunset header', 'Prometheus metric globalreach_legacy_api_requests_total存在', 'Grafana dashboard显示legacy usage trend(<5%目标)'],
    createdAt: new Date('2026-04-20'), daysOutstanding: 50,
    statusHistory: [{ date: '2026-04-20', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-018', category: 'Architecture', component: 'tenantContext.js, tenants.js, db schema',
    discoveredAt: 'Multi-Tenant Design Review', discoverer: 'Architecture Audit',
    description: '多租户架构实施不完整 - tenantContext基本identification完成但isolation enforcement不完整(部分query缺tenant_id filter); DB Schema可能缺tenant_id列/RLS策略; cacheService key是否含tenant_id未验证; **核心风险**: tenant isolation漏洞→data breach(GDPR违约)',
    impact: '数据隔离安全性(最高风险); noisy neighbor; 计费准确性; SOC2 Type II要求',
    rootCause: '多租户作为Phase 2 feature规划基础框架搭好但细节未填充; 缺乏formal verification or pen test针对tenant isolation',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 32, principalLevel: 'LARGE',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Pre-Launch Checklist: Phase1 Isolation audit(all 19routes+services) → Phase2 Hardening(DB RLS + automated cross-tenant test + middleware assertion) → Phase3 Monitoring(per-tenant metrics + Grafana dashboard + cross-tenant alert should never fire)',
    dependencies: '业务决策何时启动多租户? 当前是否有外部客户? DB schema最终确定',
    risk: '若多租户已激活: 数据泄露(legal action/customer loss/regulatory fine); 若单租户: 低风险但不还清无法安全启用多租户',
    relatedFiles: ['api/middleware/tenantContext.js', 'api/routes/tenants.js', 'api/services/cacheService.js', 'docs/MULTI_TENANT_ARCHITECTURE.md'],
    acceptanceCriteria: ['所有routes handler验证req.tenantId', '所有query含WHERE tenant_id=? 或RLS', 'Cache keys: {tenantId}:{type}:{id}', 'Automated test: cross-tenant returns 403/404'],
    createdAt: new Date('2026-05-05'), daysOutstanding: 35,
    statusHistory: [{ date: '2026-05-05', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-019', category: 'Architecture→Security', component: 'Login.tsx, api/routes/auth.js?, SSO_INTEGRATION_GUIDE.md',
    discoveredAt: 'Frontend-Backend Contract Audit', discoverer: 'SSO Feature Completeness Review',
    description: 'SSO集成配置不完整(Frontend-Backend Contract Gap) - Login.tsx已实现完整SSO UI(6个provider图标/名称映射/fetch sso providers/OAuth flow)但**后端状态不明**: server.js路由注册表**未见sso routes**; OAuth callback endpoint是否存在? provider credentials在哪(docker-compose未见SSO env vars)? 典型gap: 前端UI就绪但后端可能只有stub→用户点SSO按钮→404/500',
    impact: '用户信任度下降; 企业客户要求SSO则无法交付; 前端dead code维护负担',
    rootCause: '前端开发先行(UI mockup)但backend implementation deprioritized; 缺乏API contract testing; SSO_GUIDE.md可能描述plan而非status',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 16, principalLevel: 'MEDIUM',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Investigation Phase(2天): 搜索backend确认sso routes/services existence → 读SSO_INTEGRATION_GUIDE确认status → Decision Point: if exists but incomplete→complete(P2); if not exist at all→implement(P2) or remove frontend SSO UI to avoid confusion(P3, 1h work)',
    dependencies: 'Business decision: SSO must-have or nice-to-have? Provider selection?',
    risk: '前端SSO UI成为ghost feature(看得见摸不着); 如果突然有客户需求SSO rush implementation质量堪忧',
    relatedFiles: ['frontend/src/pages/Login.tsx(第22-72行)', '缺失或待确认: api/routes/sso.js?, api/services/ssoService.js?'],
    acceptanceCriteria: ['Backend /api/v1/sso/providers返回正确列表(或frontend移除SSO UI)', '至少1个provider(推荐Google OAuth2) complete E2E', 'SSO_INTEGRATION_GUIDE.md准确反映status(plan vs done)'],
    createdAt: new Date('2026-05-15'), daysOutstanding: 25,
    statusHistory: [{ date: '2026-05-15', from: null, to: 'OPEN' }],
    repayments: []
  },

  // ===== Documentation Debts (DEBT-020 ~ DEBT-022) =====
  {
    id: 'DEBT-020', category: 'Documentation→Code Quality', component: '整个项目',
    discoveredAt: 'S132/O08', discoverer: 'Comment & TODO Scanner',
    description: '过时注释和TODO标记散布 - docker-compose(S071过时注释/PG upgrade path矛盾/M-A07 M-C03 status未update); server.js(PhaseH完成注释/V8历史/S085/L04历史应移至git history); 预估15-30个TODO/FIXME散布各文件部分已过时',
    impact: '代码可读性降低; 新开发者困惑; IDE TODO panel噪音; code review分心',
    rootCause: '快速迭代添加context记录但从未cleanup; 缺乏comment expiry文化; 无定期TODO cleanup session',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 4, principalLevel: 'SMALL',
    priority: 'P3', status: 'OPEN',
    repaymentPlan: 'Next Sprint Cleanup Session(Sprint最后半天): grep TODO/FIXME/HACK/XXX收集 → 逐一review(resolved→delete/still valid→GitHub issue link/obsolete→delete) → 更新过时session reference comments → CONTRIBUTING.md Comment Policy章节',
    dependencies: '无',
    risk: 'TODO noise持续增加(预估每周新增2-3个); accumulation makes future cleanup more expensive',
    relatedFiles: ['整个项目(需全局搜索)'],
    acceptanceCriteria: ['grep TODO/FIXME结果均linked to GitHub issues(#数字)', 'Session reference comments仅出现在recent session代码中'],
    createdAt: new Date('2026-06-09'), daysOutstanding: 0,
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-021', category: 'Documentation', component: 'api/routes/docs.js, swagger spec, D16',
    discoveredAt: 'D16 / Coverage Audit', discoverer: 'Swagger Spec Completeness Review',
    description: 'API文档覆盖率不足 - D16实现Swagger UI声称endpointsDocumented:68但需验证：(1)实际覆盖率未知(68/95potential=71.5%?)；(2)较新routes(D22-D29 11modules, M-A05, N03)swagger coverage未经确认；(3)文档质量(request/response examples? error responses? auth? rate limiting?)',
    impact: '第三方integrator无法探索API; frontend developer需问backend; Postman collection过时; onboarding成本高',
    rootCause: 'D16覆盖当时routes但后续新增routes开发者忘记同步更新swagger annotations; 缺乏CI check确保新route有doc; swagger annotation syntax繁琐',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 13, principalLevel: 'MEDIUM',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Sprint1-2: Audit completeness + quick wins(补充D23-D29 N03最新routes文档) → Sprint3-4: Quality Improvement(error responses + auth headers + rate limit headers + CI swagger lint warning)',
    dependencies: 'Swagger/UI framework已就位(D16); 确认当前使用的swagger library',
    risk: 'API文档逐渐与实际API diverge(drift加速); 每新增undocumented endpoint后续documentation effort +1',
    relatedFiles: ['api/routes/docs.js', 'swagger configuration files(TBD)', 'api/routes/*.js(swagger annotations)'],
    acceptanceCriteria: ['Swagger UI显示全部19个routes modules', 'Coverage >=90%', '每endpoint至少summary+200 example+auth'],
    createdAt: new Date('2026-04-25', daysOutstanding: 45),
    statusHistory: [{ date: '2026-04-25', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-022', category: 'Documentation', component: 'README.md, CHANGELOG.md',
    discoveredAt: 'Project Landing Page Review', discoverer: 'Documentation Freshness Check',
    description: 'README.md和CHANGELOG未同步最新状态 - README可能未反映15个Docker services架构图/Node24 PG15 Redis7.4 tech stack/D22-D29 features list/Contributing standards/Badge准确性; CHANGELOG是否记录S128-S132? SemVer? Unreleased section?',
    impact: '新contributor第一印象; release management混乱',
    rootCause: 'Documentation被视为low priority work总是被feature development挤掉; 缺乏document-as-you-go文化; 无automated changelog generation',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 4, principalLevel: 'SMALL',
    priority: 'P3', status: 'OPEN',
    repaymentPlan: '审计README标记过时/不准确内容 → 更新architecture diagram/features/tech stack → 补充CHANGELOG S128-S132 entries → (可选)安装@conventional-changelog/cli配置.versionc',
    dependencies: '确认所有features完整列表(可能查看GLOBALREACH_V2_完整文档资产清单.md)',
    risk: '轻微reputation impact; 无显著growth(gap widenings)',
    relatedFiles: ['README.md', 'CHANGELOG.md', 'docs/CHANGELOG.md'],
    acceptanceCriteria: ['README tech stack与docker-compose一致', 'Features list含all major modules', 'CHANGELOG含S128-S132 entries且format consistent'],
    createdAt: new Date('2026-06-09', daysOutstanding: 0,
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  },

  // ===== Performance Debts (DEBT-023 ~ DEBT-025) =====
  {
    id: 'DEBT-023', category: 'Performance→Database', component: 'api/db/optimize.js, models/*, PostgreSQL',
    discoveredAt: 'D17 / Schema Audit', discoverer: 'Query Performance Review',
    description: '数据库索引策略未文档化 - createIndexes()(server.js 417-422行调用)存在问题：(1)索引策略不透明(创建了哪些?为什么选择?size overhead?);(2)缺少效能监控(pg_stat_user_indexes, unused index detection, index bloat);(3)缺少query performance baseline;(4)与Sequelize sync({alter:true})冲突(可能duplicate indexes)',
    impact: 'DB查询可能suboptimal; write性能受影响; disk space浪费; 无法proactive detect regression',
    rootCause: 'D17实现了创建索引功能但未配套管理索引流程; 缺乏DBA role/knowledge; Sequelize ORM抽象了SQL',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 14, principalLevel: 'MEDIUM',
    priority: 'P1', status: 'IN_PROGRESS',
    repaymentPlan: 'Month1 Visibility(createIndexes logging + pg_stat monitoring + Grafana Index Usage panel + top-10 queries baseline) → Month2 Optimization(unused indexes drop + missing indexes identify + Sequelize model review) → Month3 Automation(weekly new sequential scan alert + indexing strategy doc)',
    dependencies: 'postgres-exporter已部署(docker-compose 218-233); Grafana已部署; DB size data(row counts per table)',
    risk: '当数据量达阈值(campaigns>10万行 emails>100万行)时某些queries出现明显performance degradation; 每延迟一月urgency增加',
    relatedFiles: ['api/db/optimize.js(createIndexes function)', 'api/db/models/*', 'api/server.js(417-422行)'],
    acceptanceCriteria: ['createIndexes()有详细日志(created/skipped/duplicate counts)', 'Grafana Index Usage dashboard存在且显示数据', 'Top-10 queries baseline recorded', 'No unused indexes(or documented reason for keeping)'],
    createdAt: new Date('2026-05-15', daysOutstanding: 25),
    statusHistory: [
      { date: '2026-05-15', from: null, to: 'OPEN' },
      { date: '2026-06-01', from: 'OPEN', to: 'IN_PROGRESS', reason: 'createIndexes exists but needs hardening' }
    ],
    repayments: []
  },
  {
    id: 'DEBT-024', category: 'Performance', component: 'api/services/cacheService.js, Redis',
    discoveredAt: 'D17 / Cache Strategy Audit', discoverer: 'Cache Usage Pattern Review',
    description: '缓存策略未文档化 - cacheService(Redis wrapper)以下方面未documented/implemented: (1)Cache Key Naming Convention(format? collision? max length?);(2)TTL Strategy(user session? campaign stats? account pool? rate limiting? consistent policy?);(3)Invalidation Strategy(write-through/back/around? stampede protection? warming?);(4)Hit Ratio Monitoring(tracked? current ratio target>90%? alerts<80%?);(5)Memory Usage(maxmemory policy set? current vs max? largest keys?)',
    impact: 'Cache effectiveness unknown; debugging困难; Redis OOM risk',
    rootCause: 'D17 focused on making Redis work(connection, basic get/set) but deferred using it correctly; Lack of Redis expertise in team; No cache architecture design doc',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 13, principalLevel: 'MEDIUM',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Sprint1-2: Audit current impl + Redis maxmemory config + cacheService DEBUG log → Sprint3-4: docs/CACHE_STRATEGY.md(key naming/TTL matrix/invalidation) + TTL enforcement + hit/miss monitoring → Sprint5-6: Prometheus globalreach_cache_hit_ratio + Grafana alert(hit ratio<80%) + Redis memory>80% alert',
    dependencies: 'cacheService source code; Redis instance access; Prometheus+Grafana(已部署)',
    risk: 'Redis可能在未来某时间点OOM(如果cache growth unbounded且no eviction policy); cache staleness可能导致business decisions based on outdated data',
    relatedFiles: ['api/services/cacheService.js', 'redis.conf(if exists else need to create)', 'docker-compose.prod.yml(redis service)'],
    acceptanceCriteria: ['docs/CACHE_STRATEGY.md存在(key naming/TTL matrix/invalidation rules)', 'cacheService.log每operation(DEBUG level)', 'Redis CONFIG GET maxmemory非零', 'Prometheus globalreach_cache_hit_ratio存在且有数据', 'Grafana alert: cache hit ratio<80%'],
    createdAt: new Date('2026-05-15', daysOutstanding: 25),
    statusHistory: [{ date: '2026-05-15', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-025', category: 'Performance→Database', component: 'api/services/*, routes/*, Sequelize',
    discoveredAt: 'Query Pattern Review (Proactive)', discoverer: 'N+1 Query Anti-Pattern Scanner',
    description: '潜在N+1查询问题(Sequelize ORM层) - 可能存在的模式(需profiling确认): Classic N+1 in list endpoints(Campaign.findAll()+loop getStats/getAccount()); Relationship traversal without include; Inside loop writes(individual INSERT vs bulkCreate); Missing eager loading in frequent routes(GET /campaigns, /accounts, /analytics/dashboard)。**注意: 基于pattern识别推测需EXPLAIN ANALYZE确认**',
    impact(若confirmed): 'API response time秒级; DB load; scalability bottleneck',
    rootCause: 'Sequelize association API太方便了loop中使用习惯; 缺乏query counting middleware; code review不易肉眼发现N+1',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 14, principalLevel: 'MEDIUM', // confirmed: 14h, false positive: 4h(profiling only)
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Immediate This Week Profiling: enable Sequelize logging + run k6 smoke test against high-traffic endpoints(10/100/1000 campaigns) + analyze query count per request → If >20 queries/request and grows with data size → N+1 confirmed → fix with eager loading/include + bulk operations + query count alert + Sequelize best practices docs',
    dependencies: 'Development environment with realistic data(need seed 1000+ records); k6 load testing tool(already have tests/performance/)',
    risk: '若confirmed: 当数据量超过阈值时用户体验急剧下降(page load 200ms→5s+); 数据库成为bottleneck阻碍horizontal scaling; 若false positive: 仅profiling cost 4h',
    relatedFiles: ['api/routes/campaigns.js', 'api/routes/accounts.js', 'api/routes/analytics.js', 'api/services/accountService.js', 'api/services/emailService.js', 'api/db/config.js'],
    acceptanceCriteria: ['Profiling report: query count per endpoint documented', 'If N+1 existed: fixed and query count reduced >80%', 'Development mode: query count warning when >10/request', 'k6 p95 <500ms for list endpoints(1000+ records)'],
    createdAt: new Date('2026-06-09', daysOutstanding: 0),
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN', reason: 'Proactive pattern recognition, needs profiling confirmation' }],
    repayments: []
  },

  // ===== Operations Debts (DEBT-026 ~ DEBT-028) =====
  {
    id: 'DEBT-026', category: 'Operations', component: 'prometheus/rules/*, alertmanager.yml, Grafana',
    discoveredAt: 'S132/O08 Monitoring Coverage Audit', discoverer: 'Alert Rules Completeness Review',
    description: '监控Gaps(Missing Alerts) - alertmanager声明Prometheus(14 rules)但监控覆盖可能存在gaps: (1)Application-layer: error rate spike/P99 latency/unhandled exception/JWT failure rate?(2)Infrastructure: Container restart loop/disk space/memory OOM/network DNS/refused?(3)Business-layer(likely completely missing): Email delivery failure rate>5%/campaign anomaly/account pool exhaustion/new user spike(bot)?(4)Alert quality: false positive rate/alert fatigue/on-call coverage/pagerduty?',
    impact: 'MTTD增加; Potential outages undetected until user complaint; On-call efficiency',
    rootCause: 'Monitoring implemented incrementally(Phase H) focused on infrastructure first; Business metrics require instrumentation; Alert tuning requires operational experience feedback loop; Lack of monitoring gaps periodic audit process',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 16, principalLevel: 'MEDIUM',
    priority: 'P1', status: 'OPEN',
    repaymentPlan: 'Month1 Gap Analysis & Quick Wins: List all current Prometheus rules + map to components + Use failure modes(docs/failure-modes/) to identify unmapped failure modes → Implement top-5 highest-impact missing alerts(error rate spike, disk space, email delivery failure, container OOM, P99 latency) → Test alerts(manually trigger conditions) → Verify alertmanager routing works\nMonth2 Business Metrics & Alert Quality: Instrument application code with custom Prometheus counters for business metrics → Run Silent Week(observe all alerts mark false positives tune thresholds) → Document monitoring coverage matrix + establish quarterly review process',
    dependencies: 'Prometheus+AlertManager+Grafana(all deployed); Access to production metrics; Incident history for tuning reference',
    risk: '下一次major incident很可能因为"没人监控这个component"而被用户发现而非proactive alert',
    relatedFiles: ['prometheus/rules/*', 'alertmanager/alertmanager.yml(routing config)', 'grafana/dashboards/*', 'docs/failure-modes/'],
    acceptanceCriteria: ['Monitoring Coverage Matrix document exists(component×failure mode×rule)', 'All critical failure modes(from docs/failure-modes/) have corresponding Prometheus rule', 'Business metrics instrumented and alerted', 'Alert quality: false positive rate<20%(based on 2-week observation)'],
    createdAt: new Date('2026-06-09', daysOutstanding: 0),
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-027', category: 'Operations', component: 'alertmanager.yml, prometheus/rules/*',
    discoveredAt: 'S132/O08 Alert Tuning / DEBT-026衍生', discoverer: 'Alert Quality Analysis',
    description: '告警调优不足(Alert Fatigue Risk) - 已有alerts质量问题: (1)Route 1 critical repeat_interval=30m → 未resolved issue 48次/day太频繁(适合immediate action不适合hours-to-resolve如SSL cert);(2)Inhibition Rule 3(APIDown suppresses API-related): 若APIDown因latency(非crash)则suppressing可能hide root cause;(3)Missing severity classification guidance(no runbook per alert);(4)No alert ownership metadata(team/service/runbook labels);(5)No postmortem process(alert usefulness never improves)',
    impact: 'Alert fatigue→ignore real alerts(boy who cried wolf effect); Longer MTTR; On-call burnout(self-reinforcing problem)',
    rootCause: 'Alertmanager config copied from template/best-practice without customization for GlobalReach context; Lack of operational experience(system hasn\'t been in production long enough); No dedicated SRE/operations engineer role; Alert tuning treated as one-time setup rather than continuous improvement',
    interestRate: 0.005, interestLevel: 'MEDIUM',
    principal: 5, principalLevel: 'SMALL',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Recommended: Combine with DEBT-026 repayment Month2:\nAnalyze alert history/simulate(2h) → Tune repeat_intervals based on typical resolution time(critical infrastructure down 15m vs known issue 4h vs warning 8h) → Add runbook links to each Prometheus rule(annotation: runbook: "docs/runbooks/RB-XXX.md") → Add ownership labels(team label to enable future routing to specific on-call person) → Create docs/ALERT_TUNING_PLAYBOOK.md with postmortem checklist → Test tuned config',
    dependencies: 'Some operational history (even 1-2 weeks of alert data would help); Or simulation based on failure modes',
    risk: 'Alert fatigue是self-reinforcing problem(越多的noise → 越多的ignoring → 越多的missed real alerts → 越多的incidents → 越多的alerts); 一旦形成"ignore all alerts" culture很难逆转',
    relatedFiles: ['alertmanager/alertmanager.yml(routing + inhibition rules)', 'prometheus/rules/*(rule definitions with annotations)', 'docs/runbooks/*(existing runbooks)'],
    acceptanceCriteria: ['repeat_interval values documented with justification("typical resolution time: X, so repeat at 1.5X")', 'Each Prometheus rule has annotation: runbook: "docs/runbooks/RB-XXX.md"', 'Each rule has label: team: <platform|database|infra>', 'docs/ALERT_TUNING_PLAYBOOK.md exists with postmortem checklist'],
    createdAt: new Date('2026-06-09', daysOutstanding: 0),
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  },
  {
    id: 'DEBT-028', category: 'Operations→Performance', component: 'Entire system, tests/performance/, docker-compose resource limits',
    discoveredAt: 'Capacity Planning Review', discoverer: 'Scalability Assessment',
    description: '容量规划缺失 - 虽有k6 tests(7文件)和CAPACITY_PLANNING_AUTOMATION.md但缺少关键要素: (1)No performance baseline(max throughput/p50/p95/p99/concurrent users/bottleneck component?);(2)Resource limits may be arbitrary(api:512M/1CPU why? postgres no limits? OOM host risk);(3)No scaling guide(horizontal: multiple api behind nginx? vertical: redistribution? DB: read replicas/PgBouncer?);(4)No capacity alerts(CPU>70%? mem>80%? disk>85%? connections>80%?);(5)k6 tests may not reflect production workload(real traffic patterns?)',
    impact: 'Cannot answer"How many users supported?"; May encounter unexpected degradation; Resource provisioning wasteful or risky; No data-driven basis for hardware requests',
    rootCause: 'System not yet in production with real users(still in dev/staging); Capacity planning seen as premature optimization before knowing real workload; Lack of performance engineering skills in team; k6 tests created for checkbox not genuine capacity planning tool',
    interestRate: 0.001, interestLevel: 'LOW',
    principal: 30, principalLevel: 'LARGE',
    priority: 'P2', status: 'OPEN',
    repaymentPlan: 'Recommended timing: 1-2 weeks BEFORE production go-live:\nPhase 1 Baseline Establishment(3 days): Prepare test env with realistic data(seed 10K users 1K campaigns 100K emails) → Run k6 tests with incremental load(1/10/50/100/500 RPS) → Record throughput/error rate/p50/p95/p99/CPU/memory/DB connections per level → Identify knee point(bottleneck component) → Run sustained load test(24h at 80% of knee point) for memory leaks/connection exhaustion\nPhase 2 Documentation & Alerting(2 days): Write CAPACITY_BASELINE.md(throughput curve/bottleneck/resource recommendations) → Set up capacity alerts(CPU/memory/disk/connections at 70-80-90% thresholds)\nPhase 3 Scaling Guide(2 days): Horizontal scaling procedure(add api replica behind nginx upstream) → Vertical scaling guide(host upgrade resource redistribution) → Database scaling readiness assessment(read replica PgBouncer evaluation)',
    dependencies: 'Test environment with production-equivalent hardware(or cloud); Realistic test data; k6 tool(already available); Performance monitoring(Prometheus+Grafana already available)',
    risk: '如果不还(且已上线production): 第一次traffic spike或marketing campaign可能导致outage(因为没有baseline不知道system limits); 如果delay(上线前): go-live变成gamble(不知道能不能撑住expected load)',
    relatedFiles: ['tests/performance/*(k6 test scripts)', 'docker-compose.prod.yml(resource limits)', 'docs/CAPACITY_PLANNING_AUTOMATION.md(existing doc need update)', 'docs/PERFORMANCE_BENCHMARK_SUITE.md(existing doc)'],
    acceptanceCriteria: ['docs/CAPACITY_BASELINE.md exists(throughput curve/bottleneck/resource recs)', 'k6 results archived(JSON+HTML reports for baseline reference)', 'docker limits have baseline justification comments', 'Capacity alerts at 70-80-90% thresholds', 'Horizontal scaling tested(2+ api replicas working)'],
    createdAt: new Date('2026-06-09', daysOutstanding: 0),
    statusHistory: [{ date: '2026-06-09', from: null, to: 'OPEN' }],
    repayments: []
  }
];

// ============================================
// Helper Functions
// ============================================

/**
 * 计算累计利息（复利公式）
 * @param {number} principal 本金（小时）
 * @param {number} dailyRate 日利率（小数形式，如0.05表示5%）
 * @param {number} days 天数
 * @returns {number} 累计利息（小时）
 */
function calculateAccruedInterest(principal, dailyRate, days) {
  return principal * (Math.pow(1 + dailyRate, days) - 1);
}

/**
 * 计算ROI（投资回报率 = 利率 / 本金）
 */
function calculateROI(interestRate, principal) {
  return Number((interestRate / principal).toFixed(3));
}

/**
 * 获取债务摘要统计
 */
function getDebtSummary() {
  const totalDebts = debtStore.length;
  const totalPrincipal = debtStore.reduce((sum, d) => sum + d.principal, 0);
  
  const byStatus = {};
  const byCategory = {};
  const byPriority = {};
  const byInterestLevel = {};
  
  debtStore.forEach(debt => {
    byStatus[debt.status] = (byStatus[debt.status] || 0) + 1;
    byCategory[debt.category] = (byCategory[debt.category] || 0) + 1;
    byPriority[debt.priority] = (byPriority[debt.priority] || 0) + 1;
    byInterestLevel[debt.interestLevel] = (byInterestLevel[debt.interestLevel] || 0) + 1;
    
    // 计算累计利息
    debt.accruedInterest = calculateAccruedInterest(
      debt.principal,
      debt.interestRate,
      debt.daysOutstanding || Math.floor((Date.now() - new Date(debt.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    );
  });
  
  const totalInterest = debtStore.reduce((sum, d) => sum + (d.accruedInterest || 0), 0);
  
  return {
    totalDebts,
    totalPrincipal: Math.round(totalPrincipal * 10) / 10,
    totalInterest: Math.round(totalInterest * 10) / 10,
    totalWithInterest: Math.round((totalPrincipal + totalInterest) * 10) / 10,
    byStatus,
    byCategory,
    byPriority,
    byInterestLevel,
    avgDaysOutstanding: Math.round(debtStore.reduce((sum, d) => sum + (d.daysOutstanding || 0), 0) / totalDebts)
  };
}

// ============================================
// Routes
// ============================================

/**
 * GET /api/v1/debt/register
 * 全部债务列表（支持分类/状态/优先级过滤）
 */
router.get('/register', (req, res) => {
  try {
    let filteredDebts = [...debtStore];
    
    // Filter by category
    if (req.query.category) {
      const categories = req.query.category.split(',').map(c => c.trim());
      filteredDebts = filteredDebts.filter(d => 
        categories.some(cat => d.category.toLowerCase().includes(cat.toLowerCase()))
      );
    }
    
    // Filter by status
    if (req.query.status) {
      const statuses = req.query.status.split(',').map(s => s.trim().toUpperCase());
      filteredDebts = filteredDebts.filter(d => statuses.includes(d.status));
    }
    
    // Filter by priority
    if (req.query.priority) {
      const priorities = req.query.priority.split(',').map(p => p.trim().toUpperCase());
      filteredDebts = filteredDebts.filter(d => priorities.includes(d.priority));
    }
    
    // Filter by interest level
    if (req.query.interest) {
      const levels = req.query.interest.split(',').map(l => l.trim().toUpperCase());
      filteredDebts = filteredDebts.filter(d => levels.includes(d.interestLevel));
    }
    
    // Sort options
    const sortBy = req.query.sortBy || 'priority';
    const sortOrder = req.query sortOrder === 'asc' ? 1 : -1;
    
    const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
    const interestOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    const principalOrder = { 'TINY': 0, 'SMALL': 1, 'MEDIUM': 2, 'LARGE': 3, 'XLARGE': 4 };
    
    filteredDebts.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'priority': cmp = (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99); break;
        case 'interest': cmp = (interestOrder[a.interestLevel] || 99) - (interestOrder[b.interestLevel] || 99); break;
        case 'principal': cmp = (principalOrder[a.principalLevel] || 99) - (principalOrder[b.principalLevel] || 99); break;
        case 'roi': cmp = calculateROI(b.interestRate, b.principal) - calculateROI(a.interestRate, a.principal); break;
        case 'age': cmp = (a.daysOutstanding || 0) - (b.daysOutstanding || 0); break;
        default: cmp = 0;
      }
      return cmp * sortOrder;
    });
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const start = (page - 1) * limit;
    const paginatedDebts = filteredDebts.slice(start, start + limit);
    
    res.json({
      success: true,
      data: paginatedDebts,
      pagination: {
        page,
        limit,
        total: filteredDebts.length,
        totalPages: Math.ceil(filteredDebts.length / limit)
      },
      summary: getDebtSummary()
    });
  } catch (error) {
    debtLog.error('Failed to fetch debt register', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch debt register' });
  }
});

/**
 * GET /api/v1/debt/register/:id
 * 单条债务详情
 */
router.get('/register/:id', (req, res) => {
  try {
    const debt = debtStore.find(d => d.id === req.params.id.toUpperCase());
    
    if (!debt) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Debt ${req.params.id.toUpperCase()} not found`
      });
    }
    
    // Calculate current accrued interest
    const daysSinceCreation = Math.floor((Date.now() - new Date(debt.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    debt.currentAccruedInterest = Math.round(calculateAccruedInterest(debt.principal, debt.interestRate, daysSinceCreation) * 100) / 100;
    debt.totalCost = Math.round((debt.principal + debt.currentAccruedInterest) * 100) / 100;
    debt.daysSinceCreation = daysSinceCreation;
    
    res.json({ success: true, data: debt });
  } catch (error) {
    debtLog.error('Failed to fetch debt detail', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch debt detail' });
  }
});

/**
 * POST /api/v1/debt/register
 * 登记新债务
 */
router.post('/register', (req, res) => {
  try {
    const {
      id, category, component, discoveredAt, discoverer,
      description, impact, rootCause,
      interestRate, interestLevel, principal, principalLevel,
      priority, status, repaymentPlan, dependencies, risk,
      relatedFiles, acceptanceCriteria
    } = req.body;
    
    // Validation
    if (!id || !category || !description || !impact) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Required fields: id, category, description, impact'
      });
    }
    
    // Check for duplicate ID
    if (debtStore.some(d => d.id === id.toUpperCase())) {
      return res.status(409).json({
        success: false,
        error: 'CONFLICT_ERROR',
        message: `Debt ${id.toUpperCase()} already exists`
      });
    }
    
    const newDebt = {
      id: id.toUpperCase(),
      category,
      component: component || '',
      discoveredAt: discoveredAt || 'Manual',
      discoverer: discoverer || 'Unknown',
      description,
      impact: impact || '',
      rootCause: rootCause || '',
      interestRate: interestRate || 0.005,
      interestLevel: interestLevel || 'MEDIUM',
      principal: principal || 4,
      principalLevel: principalLevel || 'SMALL',
      priority: priority || 'P2',
      status: status || 'OPEN',
      repaymentPlan: repaymentPlan || '',
      dependencies: dependencies || '',
      risk: risk || '',
      relatedFiles: relatedFiles || [],
      acceptanceCriteria: acceptanceCriteria || [],
      createdAt: new Date(),
      daysOutstanding: 0,
      statusHistory: [{ date: new Date().toISOString().split('T')[0], from: null, to: status || 'OPEN', reason: 'Newly registered' }],
      repayments: []
    };
    
    debtStore.push(newDebt);
    
    debtLog.info(`New debt registered: ${newDebt.id} - ${newDebt.description.substring(0, 50)}...`, {
      debtId: newDebt.id,
      category: newDebt.category,
      principal: newDebt.principal,
      interestLevel: newDebt.interestLevel
    });
    
    res.status(201).json({
      success: true,
      data: newDebt,
      message: `Debt ${newDebt.id} registered successfully`,
      summary: getDebtSummary()
    });
  } catch (error) {
    debtLog.error('Failed to register new debt', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to register debt' });
  }
});

/**
 * PATCH /api/v1/debt/register/:id
 * 更新债务状态/优先级
 */
router.patch('/register/:id', (req, res) => {
  try {
    const debtIndex = debtStore.findIndex(d => d.id === req.params.id.toUpperCase());
    
    if (debtIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Debt ${req.params.id.toUpperCase()} not found`
      });
    }
    
    const debt = debtStore[debtIndex];
    const { status, priority, principal, interestRate, description, repaymentPlan } = req.body;
    
    // Track status changes
    if (status && status !== debt.status) {
      debt.statusHistory.push({
        date: new Date().toISOString().split('T')[0],
        from: debt.status,
        to: status,
        reason: req.body.reason || 'Status update via API'
      });
      debt.status = status;
      debtLog.info(`Debt ${debt.id} status changed: ${debt.status} → ${status}`, { reason: req.body.reason });
    }
    
    if (priority) debt.priority = priority;
    if (principal) { debt.principal = principal; debt.principalLevel = req.body.principalLevel || 'SMALL'; }
    if (interestRate) { debt.interestRate = interestRate; debt.interestLevel = req.body.interestLevel || 'MEDIUM'; }
    if (description) debt.description = description;
    if (repaymentPlan) debt.repaymentPlan = repaymentPlan;
    
    debtStore[debtIndex] = debt;
    
    res.json({
      success: true,
      data: debt,
      message: `Debt ${debt.id} updated successfully`
    });
  } catch (error) {
    debtLog.error('Failed to update debt', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to update debt' });
  }
});

/**
 * DELETE /api/v1/debt/register/:id
 * 归档已偿还债务
 */
router.delete('/register/:id', (req, res) => {
  try {
    const debtIndex = debtStore.findIndex(d => d.id === req.params.id.toUpperCase());
    
    if (debtIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Debt ${req.params.id.toUpperCase()} not found`
      });
    }
    
    const archivedDebt = debtStore.splice(debtIndex, 1)[0];
    archivedDebt.status = 'ARCHIVED';
    archivedDebt.archivedAt = new Date();
    archivedDebt.archiveReason = req.body.reason || 'Repaid and archived';
    
    debtLog.info(`Debt ${archivedDebt.id} archived (repaid)`, { reason: archivedDebt.archiveReason });
    
    res.json({
      success: true,
      data: archivedDebt,
      message: `Debt ${archivedDebt.id} archived successfully`
    });
  } catch (error) {
    debtLog.error('Failed to archive debt', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to archive debt' });
  }
});

/**
 * GET /api/v1/debt/stats
 * 债务仪表盘数据
 */
router.get('/stats', (req, res) => {
  try {
    const summary = getDebtSummary();
    
    // High-interest warnings (interest level CRITICAL or HIGH)
    const highInterestDebts = debtStore
      .filter(d => ['CRITICAL', 'HIGH'].includes(d.interestLevel))
      .map(d => ({
        id: d.id,
        description: d.description.substring(0, 60) + '...',
        interestLevel: d.interestLevel,
        interestRate: d.interestRate,
        principal: d.principal,
        priority: d.priority,
        status: d.status,
        daysOutstanding: d.daysOutstanding || Math.floor((Date.now() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        accruedInterest: Math.round(calculateAccruedInterest(d.principal, d.interestRate, d.daysOutstanding || 0) * 100) / 100
      }))
      .sort((a, b) => b.interestRate - a.interestRate);
    
    // Repayment progress
    const totalRepayments = debtStore.reduce((sum, d) => sum + (d.repayments?.length || 0), 0);
    const completedRepayments = debtStore.filter(d => d.status === 'DONE' || d.status === 'ARCHIVED').length;
    
    // Category breakdown with interest
    const categoryBreakdown = {};
    debtStore.forEach(d => {
      const cat = d.category.split('→')[0].trim(); // Take primary category
      if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { count: 0, principal: 0, interest: 0 };
      categoryBreakdown[cat].count++;
      categoryBreakdown[cat].principal += d.principal;
      categoryBreakdown[cat].interest += calculateAccruedInterest(d.principal, d.interestRate, d.daysOutstanding || 0);
    });
    
    Object.keys(categoryBreakdown).forEach(cat => {
      categoryBreakdown[cat].interest = Math.round(categoryBreakdown[cat].interest * 100) / 100;
    });
    
    res.json({
      success: true,
      data: {
        overview: summary,
        highInterestWarnings: highInterestDebts,
        categoryBreakdown,
        repaymentProgress: {
          totalRegistered: debtStore.length,
          totalRepaid: completedRepayments,
          activeRepayments: totalRepayments,
          repaymentRate: completedRepayments > 0 ? Math.round((completedRepayments / debtStore.length) * 1000) / 10 : 0
        },
        healthScore: Math.max(0, 100 - (summary.totalDebts * 2) - (highInterestDebts.length * 5)), // Simple heuristic
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    debtLog.error('Failed to generate debt stats', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to generate debt stats' });
  }
});

/**
 * GET /api/v1/debt/interest
 * 计算累计利息（自登记日起）
 */
router.get('/interest', (req, res) => {
  try {
    const interestDetails = debtStore.map(d => {
      const days = d.daysOutstanding || Math.floor((Date.now() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      const accrued = calculateAccruedInterest(d.principal, d.interestRate, days);
      
      return {
        id: d.id,
        category: d.category,
        description: d.description.substring(0, 50) + '...',
        principal: d.principal,
        dailyInterestRate: d.interestRate,
        interestLevel: d.interestLevel,
        daysOutstanding: days,
        accruedInterest: Math.round(accrued * 100) / 100,
        totalCost: Math.round((d.principal + accrued) * 100) / 100,
        status: d.status,
        roi: calculateROI(d.interestRate, d.principal)
      };
    }).sort((a, b) => b.accruedInterest - a.accruedInterest);
    
    const totalPrincipal = interestDetails.reduce((sum, d) => sum + d.principal, 0);
    const totalInterest = interestDetails.reduce((sum, d) => sum + d.accruedInterest, 0);
    
    res.json({
      success: true,
      data: {
        items: interestDetails,
        summary: {
          totalPrincipal: Math.round(totalPrincipal * 10) / 10,
          totalAccruedInterest: Math.round(totalInterest * 10) / 10,
          totalWithInterest: Math.round((totalPrincipal + totalInterest) * 10) / 10,
          averageDailyInterestRate: Math.round((totalInterest / totalPrincipal / (Math.floor((Date.now() - new Date(debtStore[0]?.createdAt).getTime()) / (1000 * 60 * 60 * 24) || 1)) * 10000) / 100)
        }
      }
    });
  } catch (error) {
    debtLog.error('Failed to calculate interest', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to calculate interest' });
  }
});

/**
 * GET /api/v1/debt/repayment-plan
 * 推荐偿还计划（ROI排序）
 */
router.get('/repayment-plan', (req, res) => {
  try {
    const openDebts = debtStore
      .filter(d => d.status === 'OPEN' || d.status === 'IN_PROGRESS' || d.status === 'BLOCKED')
      .map(d => ({
        ...d,
        daysOutstanding: d.daysOutstanding || Math.floor((Date.now() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        roi: calculateROI(d.interestRate, d.principal),
        accruedInterest: calculateAccruedInterest(d.principal, d.interestRate, d.daysOutstanding || 0)
      }))
      .sort((a, b) => b.roi - a.roi); // Sort by ROI descending
    
    // Group into phases based on priority and effort
    const immediateRepayment = openDebts.filter(d => d.priority === 'P0');
    const shortTermRepayment = openDebts.filter(d => d.priority === 'P1' && d.principal <= 8);
    const mediumTermRepayment = openDebts.filter(d => d.priority === 'P1' && d.principal > 8 || d.priority === 'P2');
    
    res.json({
      success: true,
      data: {
        recommendedOrder: openDebts.map((d, i) => ({
          rank: i + 1,
          id: d.id,
          description: d.description.substring(0, 60) + '...',
          interestLevel: d.interestLevel,
          dailyRate: `${(d.interestRate * 100)}%`,
          principal: `${d.principal}h`,
          roi: d.roi,
          priority: d.priority,
          status: d.status,
          suggestedTimeline: d.priority === 'P0' ? '1-2 weeks' : d.priority === 'P1' ? '2-8 weeks' : '8-16 weeks',
          whyThisOrder: d.priority === 'P0' ? 'Security critical - highest business risk' :
                        d.roi > 0.5 ? 'High ROI - quick win with significant interest reduction' :
                        'Standard priority - part of incremental repayment'
        })),
        phases: {
          phase1_immediate: {
            name: 'Critical Security Fix (Week 1-2)',
            debts: immediateRepayment.map(d => d.id),
            totalPrincipal: Math.round(immediateRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10,
            estimatedHours: Math.round(immediateRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10
          },
          phase2_quickWins: {
            name: 'High ROI Quick Wins (Week 3-4)',
            debts: shortTermRepayment.map(d => d.id),
            totalPrincipal: Math.round(shortTermRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10,
            estimatedHours: Math.round(shortTermRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10
          },
          phase3_systematic: {
            name: 'Systematic Repayment (Week 5-16)',
            debts: mediumTermRepayment.map(d => d.id),
            totalPrincipal: Math.round(mediumTermRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10,
            estimatedHours: Math.round(mediumTermRepayment.reduce((sum, d) => sum + d.principal, 0) * 10) / 10
          }
        },
        totalEffort: {
          hours: Math.round(openDebts.reduce((sum, d) => sum + d.principal, 0) * 10) / 10,
          sprintsWith20Percent: Math.ceil(openDebts.reduce((sum, d) => sum + d.principal, 0) / 6), // Assuming 6h/sprint at 20%
          weeksAtFullTime: Math.ceil(openDebts.reduce((sum, d) => sum + d.principal, 0) / 40) // 40h/week
        }
      }
    });
  } catch (error) {
    debtLog.error('Failed to generate repayment plan', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to generate repayment plan' });
  }
});

/**
 * POST /api/v1/debt/:id/start-repayment
 * 开始偿还
 */
router.post('/:id/start-repayment', (req, res) => {
  try {
    const debtIndex = debtStore.findIndex(d => d.id === req.params.id.toUpperCase());
    
    if (debtIndex === -1) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: `Debt ${req.params.id} not found` });
    }
    
    const debt = debtStore[debtIndex];
    
    if (debt.status === 'DONE' || debt.status === 'ARCHIVED') {
      return res.status(400).json({ success: false, error: 'CONFLICT_ERROR', message: `Debt ${debt.id} is already ${debt.status}` });
    }
    
    if (!debt.repayments) debt.repayments = [];
    
    // Check if already in progress
    const activeRepayment = debt.repayments.find(r => r.status === 'IN_PROGRESS');
    if (activeRepayment) {
      return res.status(400).json({ success: false, error: 'CONFLICT_ERROR', message: `Debt ${debt.id} already has an active repayment` });
    }
    
    const repayment = {
      id: `RP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startedAt: new Date(),
      startedBy: req.body.startedBy || 'system',
      status: 'IN_PROGRESS',
      notes: req.body.notes || ''
    };
    
    debt.repayments.push(repayment);
    debt.status = 'IN_PROGRESS';
    
    debt.statusHistory.push({
      date: new Date().toISOString().split('T')[0],
      from: debt.statusHistory?.[debt.statusHistory.length - 1]?.to || 'UNKNOWN',
      to: 'IN_PROGRESS',
      reason: `Repayment started: ${repayment.notes}`
    });
    
    debtLog.info(`Repayment started for debt ${debt.id}`, { repaymentId: repayment.id, startedBy: repayment.startedBy });
    
    res.status(201).json({
      success: true,
      data: { debt: { id: debt.id, status: debt.status }, repayment },
      message: `Repayment started for debt ${debt.id}`
    });
  } catch (error) {
    debtLog.error('Failed to start repayment', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to start repayment' });
  }
});

/**
 * POST /api/v1/debt/:id/complete-repayment
 * 标记偿还完成
 */
router.post('/:id/complete-repayment', (req, res) => {
  try {
    const debtIndex = debtStore.findIndex(d => d.id === req.params.id.toUpperCase());
    
    if (debtIndex === -1) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: `Debt ${req.params.id} not found` });
    }
    
    const debt = debtStore[debtIndex];
    
    if (!debt.repayments || debt.repayments.length === 0) {
      return res.status(400).json({ success: false, error: 'BAD_REQUEST', message: `No active repayment for debt ${debt.id}. Start repayment first.` });
    }
    
    const activeRepayment = debt.repayments.find(r => r.status === 'IN_PROGRESS');
    if (!activeRepayment) {
      return res.status(400).json({ success: false, error: 'BAD_REQUEST', message: `No IN_PROGRESS repayment for debt ${debt.id}` });
    }
    
    activeRepayment.status = 'COMPLETED';
    activeRepayment.completedAt = new Date();
    activeRepletionNotes = req.body.notes || '';
    
    debt.status = 'DONE';
    debt.statusHistory.push({
      date: new Date().toISOString().split('T')[0],
      from: 'IN_PROGRESS',
      to: 'DONE',
      reason: `Repayment completed: ${activeRepletionNotes}`
    });
    
    debtLog.info(`Repayment COMPLETED for debt ${debt.id}`, { 
      repaymentId: activeRepayment.id, 
      durationMs: Date.now() - new Date(activeRepayment.startedAt).getTime(),
      notes: activeRepletionNotes 
    });
    
    res.json({
      success: true,
      data: { 
        debt: { id: debt.id, status: debt.status, totalRepayments: debt.repayments.length },
        repayment: activeRepayment 
      },
      message: `Congratulations! Debt ${debt.id} has been fully repaid! 🎉`
    });
  } catch (error) {
    debtLog.error('Failed to complete repayment', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to complete repayment' });
  }
});

module.exports = router;
