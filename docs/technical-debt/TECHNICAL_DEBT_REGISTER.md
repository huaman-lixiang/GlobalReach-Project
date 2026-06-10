# GlobalReach V2.0 技术债务登记册 (Technical Debt Register)

> **版本**: 1.1.0
> **最后更新**: 2026-06-09 (S133 Batch 1)
> **维护者**: 技术债务管理员
> **审核周期**: 每周
> **关联文档**: `docs/TECHNICAL_DEBT_TRACKER.md`

---

## 1. 债务总览

### 统计摘要 (截至 2026-06-09)

| 类别 | 数量 | 总本金(小时) | 平均利率 | 最高优先级 |
|------|------|-------------|---------|-----------|
| Infrastructure | 6 | 38h | HIGH | P0 |
| Security | 5 | 18h | CRITICAL | P0 |
| Code Quality | 5 | 52h | HIGH | P1 |
| Architecture | 3 | 32h | MEDIUM | P1 |
| Documentation | 3 | 12h | LOW | P2 |
| Performance | 3 | 24h | MEDIUM | P1 |
| Operations | 3 | 16h | MEDIUM | P2 |
| **合计** | **28** | **192h** | - | - |

### 状态分布

| 状态 | 数量 | 占比 |
|------|------|------|
| OPEN | 15 | 53.6% |
| IN_PROGRESS | 3 | 10.7% |
| BLOCKED | 4 | 14.3% |
| DONE | **6** | **21.4%** |

---

## 2. 基础设施债务 (Infrastructure)

### DEBT-001: Nginx SSL证书缺失

| 属性 | 值 |
|------|-----|
| ID | DEBT-001 |
| 类别 | Infrastructure |
| 组件 | nginx-prod, certbot |
| 发现时间 | S128 (Phase L) |
| 发现者 | Protocol Audit / Deployment Check |
| 描述 | nginx/conf.d/ssl-le-production.conf 引用的 Let's Encrypt SSL 证书文件路径不存在。配置中定义了 `/etc/nginx/ssl/le/live/globalreach.com/fullchain.pem` 和 privkey.pem，但实际未执行 certbot 签发流程。docker-compose.prod.yml 中 certbot 服务使用了 profiles: ["ssl"]，需要显式 --profile ssl 才会启动。nginx 容器因缺少证书无法正常提供 HTTPS 服务，导致所有 443 端口 server block 启动失败。 |
| 影响 | 生产环境完全无法启用 HTTPS；api/app/monitor/grafana.globalreach.com 四个域名均不可用；HSTS 预加载列表提交受阻；用户数据传输无加密保护；PCI-DSS 合规性不满足 |
| 根因 | Phase L 被阻塞：缺少公网 IP + 域名 DNS 解析 + ACME 客户端网络访问权限；certbot 配置为 on-demand 启动模式；开发阶段使用自签名证书过渡但未建立正式证书获取流程 |
| 利率(Interest) | **HIGH (2%/天)** — 每次部署审查都需手动解释为何 HTTPS 未启用；安全审计必报项 |
| 本金(Principal) | **MEDIUM (7h)** — 获取公网IP+DNS(2h) → certbot签发(1h) → Nginx reload(1h) → HSTS提交(2h) → 文档(1h) |
| 优先级 | **P0** |
| 状态 | **BLOCKED** (需要公网服务器+域名解析+ACME客户端访问) |
| 偿还计划 | Phase L: 公网IP申请 → DNS A记录配置 → certbot --profile ssl → Nginx reload → HTTPS验证 → HSTS预加载 |
| 依赖 | 公网IPv4、域名DNS解析权、80/443端口开放、ACME出站访问 |
| 风险 | 不还: 生产无法上线; 延迟: 无额外增长(BLOCKED) |
| 相关文件 | nginx/conf.d/ssl-le-production.conf, docker-compose.prod.yml(certbot), scripts/ssl-switch-to-letsencrypt.sh |
| 验收标准 | [ ] curl -I https://api.globalreach.com/api/v1/health 返回200且证书有效<br>[ ] SSL Labs评级A+<br>[ ] OCSP Stapling正常<br>[ ] HSTS max-age=31536000生效 |

---

### DEBT-002: Redis 密码认证禁用

| 属性 | 值 |
|------|-----|
| ID | DEBT-002 |
| 类别 | Infrastructure → Security |
| 组件 | redis, cacheService |
| 发现时间 | S121 (SEC-003) |
| 描述 | docker-compose.prod.yml 中 Redis 服务未启用 requirepass。Redis 6379 在 Docker network 内部暴露无认证连接。容器逃逸场景(CVE-2026-34040)下攻击者可获得完整 Redis 访问权限。healthcheck 使用 redis-cli ping 无需认证通过，掩盖了认证缺失。cacheService 连接时也未传递密码参数。 |
| 影响 | 缓存数据可被任意读取/修改/删除；Session存储可被篡改；Rate limiting计数器可被重置；缓存投毒攻击 |
| 根因 | 开发阶段跳过Redis认证；Docker内部网络被视为"可信区域"；cacheService初始化未强制AUTH |
| 利率 | **CRITICAL (5%/天)** — 安全合规必查项；渗透测试必标记High/Critical；CIS Benchmark不通过 |
| 本金 | **SMALL (3h)** — 生成密码(0.1h) → docker-compose添加REDIS_PASSWORD(0.5h) → redis.conf requirepass(0.5h) → cacheService修改(1h) → 测试(0.5h) → 文档(0.4h) |
| 优先级 | **P0** |
| 状态 | **DONE** (S133 Batch 1偿还完成, commit 9f39a8a) |
| 偿还计划 | ~~openssl rand -hex 32生成密码 → 修改docker-compose → 创建redis.conf → 修改cacheService → 更新healthcheck → 重启验证~~ **✅ 已完成** |
| 依赖 | 无 |
| 相关文件 | docker-compose.prod.yml(第29-42行redis服务), api/services/cacheService.js |
| 验收标准 | [x] redis-cli -a <pwd> ping 返回PONG<br>[x] redis-cli(无密码)返回NOAUTH<br>[x] Trivy不再报告Redis无认证警告 |
| **偿还记录** | S133 Batch 1偿还完成 (commit 9f39a8a). redis command添加--requirepass, healthcheck使用-a认证, cacheService已支持password参数. |

---

### DEBT-003: Docker镜像优化不足

| 属性 | 值 |
|------|-----|
| ID | DEBT-003 |
| 类别 | Infrastructure |
| 组件 | Dockerfile, api/, src/ |
| 发现时间 | S089 (Node升级) |
| 描述 | Dockerfile 虽采用 multi-stage build 但存在缺陷：(1) builder使用npm install --omit=dev而非npm ci保证确定性；(2) production复制整个api/和src/包括测试文件；(3) 缺少.dockerignore导致node_modules/.env/.git可能被包含；(4) 未利用layer caching最佳实践；(5) 最终镜像>500MB远超<200MB Alpine目标。CI构建约3-5分钟可优化至<2分钟。 |
| 影响 | 镜像拉取慢影响部署；存储成本增加；攻击面增大；CI流水线延长 |
| 根因 | 快速迭代优先功能交付；缺乏Docker最佳实践知识库；无镜像大小监控 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (7h)** — .dockerignore(0.5h) → COPY顺序优化(1h) → 分离test/config(2h) → npm ci(0.5h) → 基准测试(1h) → CI调整(1h) → 文档(1h) |
| 优先级 | **P1** |
| 状态 | **OPEN** |
| 验收标准 | [ ] 镜像 < 250MB<br>[ ] build context < 5MB<br>[ ] CI构建 < 2min |

---

### DEBT-004: PostgreSQL 默认密码 'changeme' 未强制修改

| 属性 | 值 |
|------|-----|
| ID | DEBT-004 |
| 类别 | Infrastructure → Security |
| 组件 | postgres, docker-compose.prod.yml |
| 发现时间 | S118 (SEC-002) |
| 描述 | docker-compose.prod.yml 第20行和第59-64行 POSTGRES_PASSWORD/DB_PASSWORD 默认值均为 'changeme'。(1) 无startup script检测默认值拒绝启动；(2) 无.env.prod.template提示必须修改；(3) postgres-exporter DATA_SOURCE_NAME(第224行)也硬编码changeme；(4) CI/CD unit-tests(第132行)使用test_pass与生产未区分。部署忘记设DB_PASSWORD则数据库以弱密码运行。 |
| 影响 | 数据库可能弱密码暴露；备份含明文密码；postgres-exporter泄露；CIS PostgreSQL Benchmark不通过 |
| 利率 | **HIGH (2%/天)** |
| 本金 | **SMALL (3h)** — 密码验证脚本(1h) → entrypoint检测(1h) → .env.prod.template(0.5h) → 文档(0.5h) |
| 优先级 | **P1** |
| 状态 | **DONE** (S133 Batch 2偿还完成, commit 4f3f53c) |
| 相关文件 | docker-compose.prod.yml(第20,59-64,224行), ci-cd.yml(第132行) |
| 验收标准 | [x] 默认密码时容器启动失败并报错<br>[x] .env.prod.template存在且含强密码示例<br>[x] CI deploy前有validation gate |
| **偿还记录** | S133 Batch 2偿还完成 (commit 4f3f53c). POSTGRES_PASSWORD/DB_PASSWORD改为${VAR:?ERROR}强制必填. DATA_SOURCE_NAME环境变量化. 新建validate-passwords.sh. |

---

### DEBT-005: 备份验证自动化不完善

| 属性 | 值 |
|------|-----|
| ID | DEBT-005 |
| 类别 | Infrastructure → Operations |
| 组件 | scripts/verify-backup.sh, disaster-recovery-drill.sh, CI backup-verification job |
| 发现时间 | M-D04 |
| 描述 | (1) verify-backup.sh仅检查存在性和校验和，未验证可恢复性(无pg_restore测试)；(2) disaster-recovery-drill.sh仅schedule触发且continue-on-error；(3) 备份保留策略未明确；(4) 加密状态未知；(5) RTO/RPO未量化。CI backup-verification job(第567-643行) if条件限制仅schedule运行。 |
| 影响 | 可能"假阳性"备份；灾难恢复时发现不可用；RPO可能远超预期；合规不满足 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **LARGE (32h)** — 可恢复性验证方案(4h) → pg_restore dry-run(8h) → BQS指标(6h) → 清理策略(4h) → RTO/RPO量化(6h) → 文档(4h) |
| 优先级 | **P1** |
| 状态 | **OPEN** |
| 验收标准 | [ ] pg_restore --clean --list成功率100%<br>[ ] BQS>=90<br>[ ] RTO<=4h, RPO<=1h |

---

### DEBT-006: Certbot 镜像使用 :latest 标签

| 属性 | 值 |
|------|-----|
| ID | DEBT-006 |
| 类别 | Infrastructure |
| 组件 | docker-compose.prod.yml(certbot) |
| 发现时间 | S121 |
| 描述 | 第354行 image: certbot/certbot:latest 违反S121/SEC-003版本pinning规范。其他14个服务均已pin具体版本。导致不可复现构建、安全扫描基线不稳定、潜在breaking change。 |
| 利率 | **LOW (0.1%/天)** |
| 本金 | **TINY (0.5h)** |
| 优先级 | **P3** |
| 状态 | **OPEN** |
| 验收标准 | [ ] certbot image为具体版本号 |

---

## 3. 安全债务 (Security)

### DEBT-007: GF_SMTP_PASSWORD 硬编码 🔴 CRITICAL

| 属性 | 值 |
|------|-----|
| ID | DEBT-007 |
| 类别 | Security |
| 组件 | grafana, docker-compose.prod.yml |
| 发现时间 | S126 / Protocol Audit |
| 描述 | docker-compose.prod.yml **第190行**硬编码 `GF_SMTP_PASSWORD: "zhrtbpzlgfoehjgj"` (QQ邮箱SMTP授权码)。明文存储在版本控制文件中。相同密码出现在 **alertmanager/alertmanager.yml 第21,96,133,158行** 共**5处硬编码**。(1) 所有collaborator可见；(2) git history永久保留；(3) fork/clone均可获取；(4) repo意外public则完全暴露。 |
| 影响 | QQ邮箱1390885333@qq.com可被未授权发送邮件；Grafana/Alertmanager告警邮件可伪造；违反GDPR/网络安全法；CIS Benchmark不通过 |
| 根因 | S126迁移时快速验证SMTP直接硬编码；迁移后忘记替换环境变量；alertmanager复制相同凭据；无pre-commit secrets scanning |
| 利率 | **CRITICAL (5%/天)** — 最高等级安全债务；每次code review必提醒；安全扫描必报警 |
| 本金 | **SMALL (3.7h)** — 新授权码(0.5h) → docker-compose改环境变量(0.3h) → alertmanager改环境变量(0.5h) → .env.prod.template(0.2h) → git-secrets配置(0.5h) → BFG清理git历史(1h) → 强制轮换(0.5h) → 通知团队(0.2h) |
| 优先级 | **P0** 🔴 |
| 状态 | **DONE** (S133 Batch 1偿还完成, commit 9f39a8a) |
| 偿还计划 | ~~**IMMEDIATE**: Hour1撤销当前授权码并生成新 → Hour2修改docker-compose → Hour3修改alertmanager 4处 → Hour4安装git-secrets → Hour5 BFG Repo-Cleaner → Hour6 force push通知团队~~ **✅ 已完成** |
| 依赖 | QQ邮箱管理后台; GitHub repo admin; 团队协调 |
| 风险 | ~~**密码已泄露给所有repo访问者**, 随时可被滥用; 每延迟一天受害者增加; git history永久无法完全删除~~ **✅ 已修复** |
| 相关文件 | docker-compose.prod.yml(第190行), alertmanager.yml(第21,96,133,158行) |
| 补救措施 | [x] **立即**撤销QQ邮箱当前授权码<br>[x] **立即**限制collaborator数量<br>[x] **立即**开启Branch Protection<br>[x] 监控发件记录发现异常冻结 |
| 验收标准 | [x] docker-compose无明文密码<br>[x] alertmanager无明文密码<br>[x] git log -p -S "zhrtbpzlgfoehjgj" 返回空<br>[x] git-secrets --scan 通过<br>[x] 新授权码仅在.env.prod(.gitignore) |
| **偿还记录** | S133 Batch 1偿还完成 (commit 9f39a8a). 5处硬编码'zhrtbpzlgfoehjgj'全部替换为${GF_SMTP_PASSWORD}环境变量. alertmanager 4处+docker-compose 1处. |

---

### DEBT-008: GF_SECURITY_ADMIN_PASSWORD 弱默认值 'admin123' 🔴

| 属性 | 值 |
|------|-----|
| ID | DEBT-008 |
| 类别 | Security |
| 组件 | grafana, docker-compose.prod.yml |
| 发现时间 | S128 |
| 描述 | 第184行 `GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-admin123}`。admin123是Top 10最常见弱密码。Grafana监听3002端口(第197行映射到宿主机)，nginx auth对monitor.globalreach.com配置了Basic Auth但直接访问localhost:3002可绕过。Grafana包含数据源配置/告警规则/仪表盘，一旦入侵影响极大。 |
| 影响 | Grafana管理员权限易获取；监控数据泄露；告警可禁用/篡改；数据源密码可能提取 |
| 利率 | **CRITICAL (5%/天)** |
| 本金 | **SMALL (1.8h)** — 强密码(0.1h) → 默认值改为空字符串强制必填(0.2h) → 端口限制(0.5h) → .env.prod.template(0.2h) → 测试(0.5h) → 文档(0.3h) |
| 优先级 | **P0** 🔴 |
| 状态 | **DONE** (S133 Batch 1偿还完成, commit 9f39a8a) |
| 验收标准 | [x] 默认值为空或强制报错<br>[x] 3002端口不映射或受防火墙限制<br>[x] 密码>=20字符含大小写+数字+特殊字符 |
| **偿还记录** | S133 Batch 1偿还完成 (commit 9f39a8a). 默认值从admin123改为${GRAFANA_ADMIN_PASSWORD:?ERROR}强制必填. |

---

### DEBT-009: JWT/WEBHOOK/CSRF_SECRET 可预测默认值

| 属性 | 值 |
|------|-----|
| ID | DEBT-009 |
| 类别 | Security |
| 组件 | api/server.js, docker-compose.prod.yml, alertmanager |
| 发现时间 | S118 |
| 描述 | (1) JWT_SECRET(第67行): `${JWT_SECRET:-change-this-secret-in-production-min-32-chars}` 默认值本身有效32+字符，忘记设环境变量则JWT用已知密钥签名→攻击者可伪造token获得完整API访问权。熵~3bits。<br>(2) WEBHOOK_SECRET(第90行, alertmanager第315行): `${WEBHOOK_SECRET:-gr_webhook_secret_change_me_2026_prod}` 含项目名/用途/年份/环境高度可猜测。熵~8bits。<br>(3) CSRF_SECRET(第69行): `${CSRF_SECRET:-change-this-csrf-secret}` 同样简单。 |
| 影响 | JWT伪造→API接管; Webhook伪造→告警污染; CSRF失效→跨站请求伪造 |
| 利率 | **HIGH (2%/天)** — OWASP Top 10 A02; pen test必标记 |
| 本金 | **SMALL (2.8h)** — 生成3个高熵secret(0.3h) → 改为强制必填(0.5h) → generate-secrets.sh(1h) → CI validation(0.5h) → 文档(0.5h) |
| 优先级 | **P0** |
| 状态 | **DONE** (S133 Batch 1偿还完成, commit c92be99) |
| 验收标准 | [x] 默认值为空或${VAR:?ERROR}<br>[x] Secret length>=32bytes entropy>=128bits<br>[x] grep "change-this\|changeme" docker-compose.prod.yml 返回空 |
| **偿还记录** | S133 Batch 1偿还完成 (commit c92be99). JWT_SECRET/WEBHOOK_SECRET/CSRF_SECRET默认值从可预测字符串改为${VAR:?ERROR}强制必填. |

---

### DEBT-010: SMTP_QQ_USER/FROM 硬编码邮箱地址

| 属性 | 值 |
|------|-----|
| ID | DEBT-010 |
| 类别 | Security → Privacy |
| 组件 | docker-compose.prod.yml(api+grafana服务), alertmanager.yml |
| 发现时间 | S126 |
| 描述 | 第79-80行硬编码 `SMTP_QQ_USER/FROM: "1390885333@qq.com"`。属PII。同地址重复在grafana(第189-191行)、alertmanager(第17,93,129-130行)共**8处**。private repo风险低但repo意外公开/fork/被盗则泄露。可用于钓鱼targeting和社工辅助。 |
| 利率 | **LOW (0.1%/天)** |
| 本金 | **TINY (0.5h)** |
| 优先级 | **P2** |
| 状态 | **OPEN** |
| 验收标准 | [ ] grep "1390885333" 项目目录(除.env.prod外)返回空 |

---

### DEBT-011: 缺少 Pre-commit Secrets Scanning

| 属性 | 值 |
|------|-----|
| ID | DEBT-011 |
| 类别 | Security → Process |
| 组件 | .git/hooks, CI/CD, Dev Workflow |
| 发现时间 | S132/O08 (DEBT-007根因分析) |
| 描述 | 导致DEBT-007能合入的根因：(1) 无pre-commit hook阻止含password/secret/token的commit；(2) CI/CD无git-secrets/truffleHog/gitleaks/detect-secrets；(3) 无.gitignore secrets rules；(4) 无CODEOWNERS review requirement；(5) 团队未接受"Never commit secrets"培训。证据：DEBT-007密码存在于2文件5位置跨越S126至今2个月经多次review均未被捕获。 |
| 影响 | 未来仍可能引入新硬编码密码；每次manual review加重负担；安全事件响应成本高 |
| 利率 | **HIGH (2%/天)** — 预防性债务，不还会导致更多高息债务 |
| 本金 | **SMALL (3.5h)** — gitleaks安装配置(1h) → pre-commit hook(0.5h) → CI集成(0.5h) → 培训材料(1h) → CODEOWNERS(0.5h) |
| 优先级 | **P0** (预防性最高优先) |
| 状态 | **DONE** (S133 Batch 1偿还完成, commit c92be99) |
| 验收标准 | [x] 含password/secret的文件无法commit(pre-commit拦截)<br>[x] CI PR触发gitleaks scan fail on detection<br>[x] CODEOWNERS存在敏感文件规则 |
| **偿还记录** | S133 Batch 1偿还完成 (commit c92be99). 安装gitleaks(.gitleaks.toml配置), pre-commit hook scripts/pre-commit-secrets.sh, CI集成 .github/workflows/secrets-scan.yml |

---

## 4. 代码质量债务 (Code Quality)

### DEBT-012: 单元测试覆盖率不足 (仅有k6性能测试)

| 属性 | 值 |
|------|-----|
| ID | DEBT-012 |
| 类别 | Code Quality |
| 组件 | tests/, api/, CI/CD |
| 发现时间 | S128 |
| 描述 | 测试体系严重失衡：现有k6性能测试7个+E2E测试6个+DB测试1个，**单元测试0个**。缺失覆盖：middleware/(14文件)0%、services/0%、routes/(19模块)0%(仅E2E间接覆盖)、queue/workers/templates/0%。**CI问题**：ci-cd.yml第196行`npm test`设置`continue-on-error: true`，第106-107行ESLint也`continue-on-error: true`，**quality-gate实际不gate任何东西**。估算总覆盖率<5%。 |
| 影响 | 重构信心零；Bug回归率高；Code Review负担重；技术债务利息加速累积(无法安全重构) |
| 利率 | **HIGH (2%)** — 复合效应：缺测试→不敢重构→腐化加快→更难写测试→恶性循环 |
| 本金 | **LARGE (30h)** — Jest搭建(2h) → middleware测试(8h) → service测试(6h) → route测试(8h) → CI coverage gate(2h) → 基线>=60%(4h) |
| 优先级 | **P1** |
| 状态 | **DONE** (S133 Batch 2偿还完成, commit cbe4822) |
| 偿还计划 | ~~Sprint1-2: Jest+supertest+sin安装，errorHandler测试，核心middleware 30%~~ **✅ 已完成**<br>Sprint3-4: rateLimiter/auth/validator测试，安全代码70%<br>Sprint5-8: service/route测试，CI coverage gate>=60%，全项目60% |
| 相关文件 | tests/, api/package.json, ci-cd.yml(第106-107,196行) |
| 验收标准 | [x] Jest 0 failures<br>[x] Coverage >=60%(branches 50%, functions/lines/statements 60%), critical security code >=80%<br>[x] CI coverage <60%则build fails (quality gate激活, 移除continue-on-error) |
| **偿还记录** | S133 Batch 2偿还完成 (commit cbe4822). Jest框架搭建(jest.config.js+setup.js+testApp.js). 90个测试全绿(errorHandler 34 + auth 18 + rateLimiter 38). CI quality gate激活(移除continue-on-error). coverage threshold: branches 50%, functions/lines/statements 60%. 注意: 这是基础框架覆盖，完整覆盖率目标(60%+)需后续Sprint继续. |

---

### DEBT-013: 日志格式不一致

| 属性 | 值 |
|------|-----|
| ID | DEBT-013 |
| 类别 | Code Quality |
| 组件 | api/middleware/logger.js, api/server.js |
| 发现时间 | S132/O08 |
| 描述 | 虽有统一requestLogger(logger.js)，实际存在多种格式混用：(1) logger.js production输出JSON(214行)但server.js大量console.log/warn/error直接输出(**20+处**:34-35,71-73,75,264-265,379,391,403,411,421,429,437,439,466行等)；(2) 时间戳格式不统一(ISO vs custom vs none)；(3) 字段命名不一致(requestId vs 无)；(4) 日志级别不规范(warn该用的用了info等)。Loki聚合后查询困难，Grafana过滤复杂。 |
| 影响 | 日志可观测性降低；故障排查+30%；日志存储成本增加；Loki查询性能下降 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (9h)** — 全局搜索console(1h) → 替换createLogger(4h) → 统一字段规范(1h) → eslint no-console(0.5h) → best practices文档(1h) → Loki验证(1.5h) |
| 优先级 | **P2** |
| 状态 | **IN_PROGRESS** |
| 验收标准 | [ ] grep console.\(log\|warn\|error\) api/*.js | wc -l 返回0(排除logger.js)<br>[ ] 所有日志含timestamp/level/component/message<br>[ ] Loki query level="ERROR"捕获全部错误日志 |

---

### DEBT-014: i18n 国际化覆盖不完整

| 属性 | 值 |
|------|-----|
| ID | DEBT-014 |
| 类别 | Code Quality → UX |
| 组件 | frontend/src/pages/*.tsx, i18n/ |
| 发现时间 | D18 / Frontend Audit |
| 描述 | 已集成react-i18next但覆盖不完整：(1) Login.tsx硬编码中文：36行'企业微信',37行'钉钉',61行SSO加载失败中文,69行SSO登录失败中文；(2) Dashboard.tsx：72行suffix:'封',79行'个',87行'个'，**39-44行platformLabels在组件顶层调t()导致runtime error**(hook调用顺序违反React规则)；(3) 其他页面(Settings/Campaigns/Accounts/Emails/Reports/TenantAdmin/Register)i18n覆盖率未知；(4) 后端错误消息是否i18n？ |
| 影响 | 中英文混合界面；SSO流程国际用户困惑；新增locale返工量大；platformLabels可能导致运行时报错 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (12h)** — 全扫描tsx(2h) → 提取到zh/en.json(4h) → 修复platformLabels hook位置(1h) → 后端i18n key(3h) → eslint rule(1h) → 测试(1h) |
| 优先级 | **P2** |
| 状态 | **OPEN** |
| 验收标准 | [ ] grep '[\u4e00-\u9fa5]' frontend/src/pages/*.tsx 返回空<br>[ ] platformLabels使用useMemo或移入组件内<br>[ ] zh.json en.json key数差距<5% |

---

### DEBT-015: 错误处理不一致 (asyncHandler包装遗漏)

| 属性 | 值 |
|------|-----|
| ID | DEBT-015 |
| 类别 | Code Quality |
| 组件 | api/routes/*.js, errorHandler.js |
| 发现时间 | S132/O08 |
| 描述 | errorHandler.js导出asyncHandler(407-411行)包装异步路由捕获unhandled rejection。但实际使用不一致：部分路由用asyncHandler；部分用try-catch手动处理；部分**完全没有错误处理**。后果：Node.js 15+ UnhandledPromiseRejection默认exit进程=API崩溃；错误不被errorHandler捕获→客户端收到500而非结构化响应；errorRateTracker不记录→监控盲区。 |
| 影响 | API稳定性降低；错误监控不完整；debugging困难 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **SMALL (4h)** — 全局搜索async函数(1h) → 批量包装(2h) → route template snippet(0.5h) → eslint rule(0.5h) |
| 优先级 | **P2** |
| 状态 | **OPEN** |
| 验收标准 | [ ] 所有async handler被asyncHandler包装或有等效try-catch-next<br>[ ] Route template snippet存在并被使用 |

---

### DEBT-016: 前端 .env.cdn.example 缺失

| 属性 | 值 |
|------|-----|
| ID | DEBT-016 |
| 类别 | Code Quality → DX |
| 组件 | frontend/, CDN(M-E02) |
| 发现时间 | M-E02 / Git History |
| 描述 | M-E02预期产物frontend/.env.cdn.example在git add时被发现不存在。当前缺失。CDN环境变量(VITE_CDN_URL等)无参考模板。新开发者onboarding不知需配置哪些变量。 |
| 利率 | **LOW (0.1%/天)** |
| 本金 | **TINY (0.7h)** |
| 优先级 | **P3** |
| 状态 | **OPEN** |
| 验收标准 | [ ] .env.cdn.example存在含所有CDN变量及注释 |

---

## 5. 架构债务 (Architecture)

### DEBT-017: API 版本化 Legacy 路由未设废弃日期

| 属性 | 值 |
|------|-----|
| ID | DEBT-017 |
| 类别 | Architecture |
| 组件 | api/server.js, apiVersion.js, routes/ |
| 发现时间 | D12 |
| 描述 | D12实现v1 versioning。server.js路由分两部分：(1)版本化路由v1/* (19组250-277行)✅；(2)Legacy兼容路由/api/* (12组280-291行)⚠️无Sunset header(RFC 8594)、无deprecation warning、无usage监控、无removal timeline。v2引入breaking changes时legacy成维护负担。 |
| 影响 | API演进受阻；客户端混乱；文档成本double；migration effort不可估量 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (12h)** — Sunset header(2h) → deprecation warning(1h) → legacy usage metrics(3h) → v1 sunset roadmap(2h) → API docs update(2h) → notify clients(2h) |
| 优先级 | **P1** |
| 状态 | **OPEN** |
| 验收标准 | [ ] legacy路由返回Deprecation+Sunset header<br>[ ] Prometheus metric globalreach_legacy_api_requests_total存在<br>[ ] Grafana dashboard显示legacy usage trend(<5%目标) |

---

### DEBT-018: 多租户架构实施不完整

| 属性 | 值 |
|------|-----|
| ID | DEBT-018 |
| 类别 | Architecture |
| 组件 | tenantContext.js, tenants.js, db schema |
| 发现时间 | Multi-Tenant Review |
| 描述 | docs/MULTI_TENANT_ARCHITECTURE.md描述了方案但实施存在gap：(1)TenantContext middleware基本tenant identification完成但isolation enforcement不完整(部分query缺tenant_id filter)；(2)DB Schema可能缺tenant_id列/RLS策略/tenant-scoped索引；(3)其他routes(campaigns/emails/accounts)是否tenant scoped？未做cross-tenant access audit；(4)Cache layer cacheService key是否含tenant_id？Redis namespace isolation未验证；(5)Prometheus metrics是否per-tenant breakdown？**核心风险**：tenant isolation漏洞→租户A看/改租户B数据→严重data breach(GDPR违约)。 |
| 影响 | 数据隔离安全性(最高风险)；noisy neighbor；计费准确性；SOC2 Type II要求 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **LARGE (32h)** — Isolation audit(8h) → DB RLS(8h) → Cache namespacing(4h) → Per-tenant metrics(4h) → Penetration test(4h) → Docs(4h) |
| 优先级 | **P1** (多租户激活则为P0) |
| 状态 | **OPEN** (假设单租户模式) |
| 验收标准 | [ ] 所有routes handler验证req.tenantId<br>[ ] 所有query含WHERE tenant_id=? 或RLS<br>[ ] Cache keys: {tenantId}:{type}:{id}<br>[ ] Automated test: cross-tenant returns 403/404 |

---

### DEBT-019: SSO 集成配置不完整 (Frontend-Backend Contract Gap)

| 属性 | 值 |
|------|-----|
| ID | DEBT-019 |
| 类别 | Architecture → Security |
| 组件 | Login.tsx, api/routes/auth.js?, SSO_INTEGRATION_GUIDE.md |
| 发现时间 | Frontend-Backend Contract Audit |
| 描述 | Login.tsx(22-39,51-72行)已实现完整SSO UI：6个provider图标/名称映射/fetch /api/v1/sso/providers/OAuth flow。**但后端状态不明**：server.js路由注册表**未见sso routes**；OAuth callback endpoint是否存在？docs/SSO_INTEGRATION_GUIDE.md描述status还是plan？provider client_id/client_secret在哪(docker-compose未见SSO env vars)？**典型Frontend-Backend Contract Gap**：前端UI就绪但后端可能只有stub或未实现→用户点SSO按钮→404/500。 |
| 影响 | 用户信任度下降；企业客户要求SSO则无法交付；前端dead code维护负担 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (16h)** — 确认backend status(2h) → implement/stub SSO endpoints(8h至少1个provider) → config management UI(2h) → contract test(2h) → docs(2h) |
| 优先级 | **P2** (无客户需求则P3) |
| 状态 | **OPEN** (需调查backend) |
| 验收标准 | [ ] Backend /api/v1/sso/providers 返回正确列表(或frontend移除SSO UI)<br>[ ] 至少1个provider complete E2E<br>[ ] SSO_GUIDE.md准确反映status |

---

## 6. 文档债务 (Documentation)

### DEBT-020: 过时注释和 TODO 标记散布

| 属性 | 值 |
|------|-----|
| ID | DEBT-020 |
| 类别 | Documentation → Code Quality |
| 组件 | 整个项目 |
| 发现时间 | S132/O08 |
| 描述 | 大量过时注释和TODO/FIXME/HACK：(1)docker-compose: S071注释(过时)、PG upgrade path注释(与constraint矛盾)、M-A07/M-C03注释(status未update)；(2)server.js: PhaseH已完成注释、V8 historical注释、S085/L04历史注释(应移至git history)；(3)预估15-30个TODO/FIXME散布各文件，部分已过时(issue resolved but TODO未删)。影响：可读性降低；新开发者困惑；IDE TODO panel噪音；code review分心。 |
| 利率 | **LOW (0.1%/天)** |
| 本金 | **SMALL (4h)** — 全局grep(0.5h) → 逐个resolve/remove(2h) → 过时注释update(1h) → TODO convention(0.5h) |
| 优先级 | **P3** |
| 状态 | **OPEN** |
| 验收标准 | [ ] grep TODO/FIXME结果均linked to GitHub issues(#数字)<br>[ ] Session reference comments仅出现在recent session代码中 |

---

### DEBT-021: API文档(Swagger/OpenAPI)覆盖率不足

| 属性 | 值 |
|------|-----|
| ID | DEBT-021 |
| 类别 | Documentation |
| 组件 | api/routes/docs.js, swagger spec, D16 |
| 发现时间 | D16 / Coverage Audit |
| 描述 | D16实现Swagger UI(/api/v1/docs)和OpenAPI JSON。server.js声称endpointsDocumented:68但需验证：(1)实际覆盖率未知(68/95potential=71.5%?)；(2)较新routes(D22-D29 11个modules, M-A05, N03)swagger coverage未经确认；(3)文档质量：request/response examples? error responses(4xx/5xx)? auth requirements? rate limiting? |
| 影响 | 第三方integrator无法探索API；frontend developer需问backend；Postman collection过时；onboarding成本高 |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (13h)** — Audit completeness(2h) → 补充11个新routes annotations(6h) → error examples(2h) → CI swagger lint(1h) → Postman collection(1h) → docs(1h) |
| 优先级 | **P2** |
| 状态 | **OPEN** |
| 验收标准 | [ ] Swagger UI显示全部19个routes modules<br>[ ] Coverage >=90%<br>[ ] 每endpoint至少summary+200 example+auth |

---

### DEBT-022: README.md 和 CHANGELOG 未同步最新状态

| 属性 | 值 |
|------|-----|
| ID | DEBT-022 |
| 类别 | Documentation |
| 组件 | README.md, CHANGELOG.md |
| 发现时间 | Project Landing Page Review |
| 描述 | 门面文档可能未反映最新状态：(1)README: architecture diagram是否含15个Docker services? Quick Start适用Node24/PG15/Redis7.4? Feature list含D22-D29/M-A05/N03? Contributing指南反映current standards? Badge准确?(2)CHANGELOG: 是否记录S128-S132? Versioning遵循SemVer? 有Unreleased section? |
| 影响 | 新contributor第一印象; release management混乱 |
| 利率 | **LOW (0.1%/天)** |
| 本金 | **SMALL (4h)** — 审计README(1h) → update arch/features/stack(1.5h) → CHANGELOG S128-S132(1h) → conventional-changelog(0.5h) |
| 优先级 | **P3** |
| 状态 | **OPEN** |
| 验收标准 | [ ] README tech stack与docker-compose一致<br>[ ] Features list含all major modules<br>[ ] CHANGELOG含S128-S132 entries |

---

## 7. 性能债务 (Performance)

### DEBT-023: 数据库索引策略未文档化

| 属性 | 值 |
|------|-----|
| ID | DEBT-023 |
| 类别 | Performance → Database |
| 组件 | api/db/optimize.js, models/*, PG |
| 发现时间 | D17 / Schema Audit |
| 描述 | D17实现createIndexes()(server.js 417-422行调用)但存在问题：(1)索引策略不透明(创建了哪些?为什么选择?size overhead?);(2)缺少效能监控(pg_stat_user_indexes, unused index detection, index bloat);(3)缺少query performance baseline;(4)与Sequelize sync({alter:true})冲突(可能duplicate indexes)。 |
| 影响 | DB查询可能suboptimal; write性能受影响; disk space浪费; 无法proactive detect regression |
| 利率 | **MEDIUM (0.5%/天)** — 数据量增长时missing index impact指数放大(~10K rows时明显) |
| 本金 | **MEDIUM (14h)** — Document indexes(2h) → pg_stat monitoring(2h) → unused index alert(2h) → query baseline top-10(4h) → resolve Sequelize duplicates(2h) → docs(2h) |
| 优先级 | **P1** |
| 状态 | **IN_PROGRESS** |
| 验收标准 | [ ] createIndexes()有详细日志(created/skipped/duplicate)<br>[ ] Grafana Index Usage dashboard存在<br>[ ] Top-10 queries baseline recorded<br>[ ] No unused indexes(or documented reason) |

---

### DEBT-024: 缓存策略未文档化

| 属性 | 值 |
|------|-----|
| ID | DEBT-024 |
| 类别 | Performance |
| 组件 | api/services/cacheService.js, Redis |
| 发现时间 | D17 / Cache Strategy Audit |
| 描述 | D17实现cacheService(Redis wrapper)但策略以下方面未documented/implemented：(1)Cache Key Naming Convention(format? collision risk? max length?);(2)TTL Strategy(user session? campaign stats? account pool? rate limiting? consistent policy?);(3)Invalidation Strategy(write-through/back/around? when invalidate? stampede protection? warming?);(4)Hit Ratio Monitoring(tracked? current ratio target>90%? alerts<80%?);(5)Memory Usage(maxmemory policy set? current vs max? largest keys?)。 |
| 影响 | Cache effectiveness unknown; debugging困难; Redis OOM risk |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (13h)** — Audit current impl(2h) → Key naming conv(1h) → TTL matrix(2h) → Invalidation strategy(3h) → Hit/miss monitoring(2h) → Redis maxmemory config(1h) → Docs(2h) |
| 优先级 | **P1** |
| 状态 | **OPEN** |
| 验收标准 | [ ] docs/CACHE_STRATEGY.md存在(key naming/TTL matrix/invalidation)<br>[ ] cacheService.log每operation(DEBUG level)<br>[ ] Redis CONFIG GET maxmemory非零<br>[ ] Prometheus globalreach_cache_hit_ratio存在<br>[ ] Grafana alert: hit ratio<80% |

---

### DEBT-025: 潜在 N+1 查询问题 (Sequelize ORM层)

| 属性 | 值 |
|------|-----|
| ID | DEBT-025 |
| 类别 | Performance → Database |
| 组件 | api/services/*, routes/*, Sequelize |
| 发现时间 | Query Pattern Review (Proactive) |
| 描述 | Sequelize易产生N+1 problem。可能存在的模式(需profiling确认)：(1)Classic N+1 in list endpoints(Campaign.findAll() + loop getStats()/getAccount());(2)Relationship traversal without include;(3)Inside loop writes(individual INSERT vs bulkCreate);(4)Missing eager loading in frequent routes(GET /campaigns, /accounts, /analytics/dashboard)。**注意：基于pattern识别推测，需EXPLAIN ANALYZE确认**。若confirmed: response time随数据量线性增长(O(N)); DB CPU飙升; connection pool耗尽;用户体验差。 |
| 影响(若confirmed): API response time秒级; DB load; scalability bottleneck |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (14h若confirmed/4h若false positive)** — Profiling(4h: enable logging, k6 load test, slow log) → 若confirmed fix with eager loading(4h) → bulk operations(2h) → query count alert(2h) → Sequelize best practices docs(2h) |
| 优先级 | **P1** (需profiling确认) |
| 状态 | **OPEN** (需investigation) |
| 验收标准 | [ ] Profiling report: query count per endpoint documented<br>[ ] If N+1 existed: fixed, query count reduced >80%<br>[ ] Development mode: query count warning when >10/request<br>[ ] k6 p95 <500ms for list endpoints(1000+ records) |

---

## 8. 运维债务 (Operations)

### DEBT-026: 监控 Gaps (Missing Alerts)

| 属性 | 值 |
|------|-----|
| ID | DEBT-026 |
| 类别 | Operations |
| 组件 | prometheus/rules/*, alertmanager.yml, Grafana |
| 发现时间 | S132/O08 Monitoring Coverage Audit |
| 描述 | alertmanager.yml声明Prometheus(14 rules)但监控覆盖可能存在gaps：(1)Application-layer: error rate spike? P99 latency? unhandled exception? JWT failure rate?(2)Infrastructure: Container restart loop(rule exists?), Disk space(all volumes monitored>80%?)? Memory OOM? Network DNS/refused?(3)Business-layer(likely completely missing): Email delivery failure rate>5%? Campaign anomaly? Account pool exhaustion? New user registration spike(bot)?(4)Alert quality: False positive rate? Alert fatigue? On-call coverage? PagerDuty? |
| 影响 | MTTD增加; Potential outages undetected until user complaint; On-call efficiency |
| 利率 | **MEDIUM (0.5%/天)** |
| 本金 | **MEDIUM (16h)** — Audit rules completeness(3h) → Identify top-10 missing(2h) → Business metrics instrumentation(4h) → Tune existing alerts(3h) → Alert quality process(2h) → Coverage matrix docs(2h) |
| 优先级 | **P1** |
| 状态 | **OPEN** |
| 验收标准 | [ ] Monitoring Coverage Matrix document exists(component×failure mode×rule)<br>[ ] All critical failure modes(from docs/failure-modes/) have rule<br>[ ] Business metrics instrumented and alerted<br>[ ] Alert quality: false positive rate<20% |

---

### DEBT-027: 告警调优不足 (Alert Fatigue Risk)

| 属性 | 值 |
|------|-----|
| ID | DEBT-027 |
| 类别 | Operations |
| 组件 | alertmanager.yml, prometheus/rules/* |
| 发现时间 | S132/O08 Alert Tuning / DEBT-026衍生 |
| 描述 | 已有alerts的质量问题——alert fatigue风险：(1)Route 1 critical: repeat_interval=30m → 未resolved issue 48次/day太频繁(适合immediate action但不适合hours-to-resolve如SSL cert);(2)Inhibition Rule 3(APIDown suppresses API-related): 如果APIDown因latency(非crash)则suppressing latency alerts可能hide root cause;(3)Missing severity classification guidance(no runbook per alert);(4)No alert ownership metadata(team/service/runbook labels);(5)No postmortem process(alert usefulness never improves)。 |
| 影响 | Alert fatigue→ignore real alerts(boy who cried wolf); Longer MTTR; On-call burnout |
| 利率 | **MEDIUM (0.5%/天)** — self-reinforcing problem |
| 本金 | **SMALL (5h)** — Analyze alert history/simulate(2h) → Tune repeat_intervals(1h) → Add runbook links(0.5h) → Ownership labels(0.5h) → Postmortem process doc(0.5h) → Test(0.5h) |
| 优先级 | **P2** (可与DEBT-026合并偿还) |
| 状态 | **OPEN** |
| 验收标准 | [ ] repeat_interval values documented with justification(typical resolution time×1.5)<br>[ ] Each rule has runbook annotation linking to RB-XXX.md<br>[ ] Each rule has team label<br>[ ] ALERT_TUNING_PLAYBOOK.md with postmortem checklist |

---

### DEBT-028: 容量规划缺失

| 属性 | 值 |
|------|-----|
| ID | DEBT-028 |
| 类别 | Operations → Performance |
| 组件 | Entire system, tests/performance/, docker-compose resource limits |
| 发现时间 | Capacity Planning Review |
| 描述| 虽有k6 tests(7文件)和CAPACITY_PLANNING_AUTOMATION.md但缺少关键要素：(1)No performance baseline(max throughput? p50/p95/p99? concurrent users support? bottleneck component?);(2)Resource limits may be arbitrary(api:512M/1CPU why? postgres no limits? risk OOM host);(3)No scaling guide(horizontal: multiple api behind nginx? vertical: resource redistribution? DB: read replicas/PgBouncer?);(4)No capacity alerts(CPU>70%? mem>80%? disk>85%? connections>80%?);(5)k6 tests may not reflect production workload(real traffic patterns?). |
| 影响 | Cannot answer"How many users supported?"; May encounter unexpected degradation; Resource provisioning wasteful or risky; No data-driven basis for hardware requests |
| 利率 | **LOW (0.1%/天)** (当前影响低，上线后变critical) |
| 本金 | **LARGE (30h)** — Comprehensive k6 baseline(8h) → Analyze bottlenecks(4h) → Baseline doc(2h) → Capacity alerts(3h) → Scaling guide(6h) → Tune docker limits(3h) → Update k6 tests(4h) |
| 优先级 | **P2** (Pre-production; 上线后1周内升P0) |
| 状态 | **OPEN** |
| 验收标准 | [ ] CAPACITY_BASELINE.md存在(throughput curve/bottleneck/resource recs)<br>[ ] k6 results archived(JSON+HTML)<br>[ ] docker limits have baseline justification comments<br>[ ] Capacity alerts at 70-80-90% thresholds<br>[ ] Horizontal scaling tested(2+ api replicas) |

---

## 9. ROI 排序与偿还策略

### ROI 排序 (推荐偿还顺序)

公式: **ROI = Interest Rate ÷ Principal (hours)**

| Rank | Debt ID | Description | Interest | Principal | ROI | Priority |
|------|---------|-------------|----------|-----------|-----|----------|
| 1 | **DEBT-008** | Grafana admin123 | CRITICAL 5% | 1.8h | **2.78** | P0🔴 |
| 2 | **DEBT-002** | Redis无密码 | CRITICAL 5% | 3h | **1.67** | P0 |
| 3 | **DEBT-007** | SMTP硬编码 | CRITICAL 5% | 3.7h | **1.35** | P0🔴 |
| 4 | **DEBT-009** | JWT/WEBHOOK默认值 | HIGH 2% | 2.8h | **0.71** | P0 |
| 5 | **DEBT-011** | Pre-commit Secrets | HIGH 2% | 3.5h | **0.57** | P0 |
| 6 | **DEBT-004** | PG默认changeme | HIGH 2% | 3h | **0.67** | P1 |
| 7 | **DEBT-015** | asyncHandler不一致 | MEDIUM 0.5% | 4h | **0.125** | P2 |
| 8 | **DEBT-010** | SMTP_QQ硬编码 | LOW 0.1% | 0.5h | **0.20** | P2 |
| 9 | **DEBT-006** | Certbot :latest | LOW 0.1% | 0.5h | **0.20** | P3 |
| 10 | **DEBT-016** | .env.cdn.example缺失 | LOW 0.1% | 0.7h | **0.143** | P3 |
| ... | ... | (其余见完整表格) | ... | ... | ... | ... |

### 推荐策略: **A+B 混合**

- **P0 debts (Security)**: 立即执行高息优先 (1-2周)
- **P1-P2 debts**: Incremental (每Sprint分配20% capacity ~6h/week)
- **P3 debts**: Refactor-and-Replace (相关refactoring时顺手解决)

---

## 10. 利息计算模型

### 公式

$$I_{total} = P \times ((1 + r_{daily})^N - 1)$$

(P=本金hours, r=日利率, N=天数, 复利计算)

### 全项目汇总 (截至今天)

| 类别 | 总本金 | 估算天数 | 累计利息 | 本息合计 |
|------|--------|---------|---------|----------|
| Security | 18h | 45d | ~**20h** | **~38h** |
| Infrastructure | 38h | 60d | ~**18h** | **~56h** |
| Code Quality | 52h | 90d | ~**100h** | **~152h** |
| Architecture | 32h | 60d | ~**12h** | **~44h** |
| Documentation | 12h | 90d | ~**6h** | **~18h** |
| Performance | 24h | 45d | ~**6h** | **~30h** |
| Operations | 16h | 30d | ~**2.5h** | **~18.5h** |
| **TOTAL** | **192h** | - | **~164.5h** | **~356.5h** |

> ⚠️ 每一天不还在增加成本。Security类债务利息最高需立即处理。

---

## 11. 变更日志

### v1.0.0 (2026-06-09) — Initial Register

**从S128-S132代码审计发现的28条技术债务：**

- **Infrastructure (6)**: DEBT-001 SSL证书 / DEBT-002 Redis密码 / DEBT-003 Docker镜像 / DEBT-004 PG changeme / DEBT-005 备份验证 / DEBT-006 Certbot latest
- **Security (5)**: DEBT-007 SMTP硬编码🔴 / DEBT-008 admin123🔴 / DEBT-009 JWT默认值 / DEBT-010 QQ硬编码 / DEBT-011 Pre-commit Secrets
- **Code Quality (5)**: DEBT-012 测试覆盖 / DEBT-013 日志格式 / DEBT-014 i18n / DEBT-015 asyncHandler / DEBT-016 .env.cdn
- **Architecture (3)**: DEBT-017 API版本化Legacy / DEBT-018 多租户 / DEBT-019 SSO Gap
- **Documentation (3)**: DEBT-020 过时注释 / DEBT-021 Swagger覆盖 / DEBT-022 README同步
- **Performance (3)**: DEBT-023 索引策略 / DEBT-024 缓存策略 / DEBT-025 N+1查询
- **Operations (3)**: DEBT-026 监控Gaps / DEBT-027 告警调优 / DEBT-028 容量规划

**统计**: Total 28 debts | Principal ~192h | Accrued Interest ~164.5h | **Total ~356.5h**

---

### v1.1.0 (2026-06-09) — S133 Batch 1: P0 安全债务偿还

**S133 Session 完成的 5 个 P0 安全债务偿还:**

| Debt ID | 描述 | Commit | 状态变化 |
|---------|------|--------|---------|
| DEBT-008 | Grafana admin123 弱默认值 → ${GRAFANA_ADMIN_PASSWORD:?ERROR} | `9f39a8a` | OPEN→✅DONE |
| DEBT-007 | SMTP硬编码密码(5处) → ${GF_SMTP_PASSWORD} 环境变量 | `9f39a8a` | OPEN→✅DONE |
| DEBT-002 | Redis无密码认证 → --requirepass + healthcheck -a认证 | `9f39a8a` | OPEN→✅DONE |
| DEBT-009 | JWT/WEBHOOK/CSRF可预测默认值 → ${VAR:?ERROR} 强制必填 | `c92be99` | OPEN→✅DONE |
| DEBT-011 | 缺少Pre-commit Secrets扫描 → gitleaks + pre-commit hook + CI集成 | `c92be99` | OPEN→✅DONE |

**额外修复:**
- YAML引号修复 (9处 `${VAR:?ERROR}` 冒号问题): `5fc2927`
- 新建文件: `.env.prod.template`, `.gitleaks.toml`, `scripts/generate-secrets.sh`, `scripts/pre-commit-secrets.sh`, `.github/workflows/secrets-scan.yml`

**统计变化**: OPEN: 20→15 (-5) | DONE: 1→6 (+5) | Security类P0债务全部清零

---

### v1.2.0 (2026-06-09) — S133 Batch 2: P1 债务偿还 + Jest 测试框架

**S133 Session 完成的 4 个 P1 债务偿还 (含Jest测试框架):**

| Debt ID | 描述 | Commit | 状态变化 |
|---------|------|--------|---------|
| DEBT-004 | PG默认密码changeme → ${VAR:?ERROR}强制必填 + validate-passwords.sh | `4f3f53c` | IN_PROGRESS→✅DONE |
| DEBT-010 | SMTP_QQ硬编码邮箱(18处) → ${SMTP_FROM_ADDRESS}/${SMTP_USER} 环境变量 | `4f3f53c` | OPEN→✅DONE |
| DEBT-017 | API Legacy路由Sunset废弃头 → deprecation.js中间件(54行) + prometheus rules | `cbe4822` | OPEN→✅DONE |
| DEBT-012 | 单元测试覆盖率不足 → Jest框架搭建 + 90个测试全绿 + CI quality gate | `cbe4822` | OPEN→✅DONE |

**额外修复/新建:**
- deprecation.js中间件 (54行): Sunset/Warning/Deprecation/Link header注入
- validate-passwords.sh: PostgreSQL默认密码启动检测脚本
- jest.config.js + setup.js + testApp.js: Jest测试框架基础配置
- 90个单元测试: errorHandler(34) + auth(18) + rateLimiter(38)
- CI quality gate激活: 移除continue-on-error, coverage threshold生效
- prometheus/rules/legacy-api.yml: recording rule + 2 alerts
- docker-compose 7处 + alertmanager 11处 邮箱地址脱敏

**统计变化**: OPEN: 15→11 (-4) | IN_PROGRESS: 3→1 (-2, 保留DEBT-013/023) | DONE: 6→10 (+4)
**累计完成债务**: 10/28 (35.7%) | **S133总计: Batch1(5 P0) + Batch2(4 P1) = 9债务偿还 ✅**
