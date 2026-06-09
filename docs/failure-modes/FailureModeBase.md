# GlobalReach 故障模式库 (FMB - Failure Mode Base)

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **创建日期**: 2026-06-09
> **条目总数**: 22

---

## 使用说明

每个故障模式 (Failure Mode) 条目包含标准字段，支持按 ID、类别、影响等级快速检索。

**字段定义:**
- **ID**: 唯一标识符 (格式: FM-{CATEGORY}-{NNN})
- **类别**: 网络类 / 存储类 / 计算类 / 应用类 / 安全类 / 外部依赖类
- **影响等级**: 🔴 Critical (服务不可用) / 🟠 High (功能降级) / 🟡 Medium (性能影响) / 🟢 Low (可忽略)
- **发生概率**: 高 / 中 / 低 / 极低
- **影响范围**: 受影响的组件/用户群
- **检测方法**: 如何自动或手动发现此故障
- **MTTR 估算**: 平均修复时间
- **预防措施**: 减少发生概率的方法
- **相关 Runbook**: 排查指南链接
- **相关 FMB**: 关联的故障模式

---

## 分类索引

- [网络类](#网络类) — DNS / 防火墙 / TLS证书 / 端口冲突
- [存储类](#存储类) — 磁盘满 / IO瓶颈 / 数据损坏 / 备份失败
- [计算类](#计算类) — CPU过载 / OOM / 进程崩溃 / 僵尸进程
- [应用类](#应用类) — DB连接池耗尽 / Redis超时 / 队列堵塞 / 内存泄漏 / 死锁
- [安全类](#安全类) — 未授权访问 / 密钥泄露 / DDoS / 证书错误
- [外部依赖类](#外部依赖类) — SMTP宕机 / GitHub API限流 / NPM registry不可达

---

## 故障模式条目

### 网络类

---

#### FM-NET-001: DNS 解析失败

| 字段 | 值 |
|------|-----|
| ID | FM-NET-001 |
| 类别 | 网络 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 低 |
| 影响范围 | 全部外部访问 (API/前端/监控) |
| 检测方法 | `nslookup api.globalreach.com` 失败; Nginx upstream 连接错误; AlertManager APIDown 触发 |
| MTTR 估算 | 5-30 分钟 |
| 预防措施 | 配置多个 DNS 解析器 (resolver 1.1.1.1 1.0.0.1); 使用 /etc/hosts 作为后备; 监控 DNS 响应时间 |
| 相关 Runbook | [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md) |
| 相关 FMB | FM-NET-003 |

---

#### FM-NET-002: 防火墙规则阻断

| 字段 | 值 |
|------|-----|
| ID | FM-NET-002 |
| 类别 | 网络 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 低 |
| 影响范围 | 受阻端口对应的服务 (通常为 80/443) |
| 检测方法 | `nmap -p 80,443 <server_ip>` 显示 filtered; `iptables -L -n` 检查规则; 用户报告无法连接 |
| MTTR 估算 | 10-60 分钟 |
| 预防措施 | 变更防火墙规则必须走审批流程; 维护防火墙变更日志; 定期审计 iptables/nftables 规则 |
| 相关 Runbook | [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md), [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) |
| 相关 FMB | FM-NET-001 |

---

#### FM-NET-003: TLS/SSL 证书过期

| 字段 | 值 |
|------|-----|
| ID | FM-NET-003 |
| 类别 | 网络 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 中 (证书有固定有效期) |
| 影响范围 | 所有 HTTPS 访问 (api/app/monitor 域名) |
| 检测方法 | 浏览器 ERR_CERT_* 错误; `openssl s_client -connect` 显示过期; SSLyze 扫描; Let's Encrypt 到期提醒邮件 |
| MTTR 估算 | 5-15 分钟 (自动续期) 或 1-2 小时 (手动) |
| 预防措施 | 启用 certbot 自动续期 + deploy hook; 设置到期前 30 天告警; 使用 LE 证书替代自签名; 参考 [docs/SECURITY_KEY_ROTATION_POLICY.md](../SECURITY_KEY_ROTATION_POLICY.md) |
| 相关 Runbook | [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md) 场景 2 |
| 相关 FMB | FM-SEC-004 |

---

#### FM-NET-004: 端口冲突

| 字段 | 值 |
|------|-----|
| ID | FM-NET-004 |
| 类别 | 网络 |
| 影响等级 | 🟠 High |
| 发生概率 | 低 |
| 影响范围 | 冲突端口对应的容器无法启动 |
| 检测方法 | `docker compose up` 报 "address already in use"; `netstat -tlnp \| grep :<port>` 显示占用; 容器 Exit 状态非 0 |
| MTTR 估算 | 5-20 分钟 |
| 预防措施 | 使用 docker-compose 统一管理端口映射; 避免在宿主机直接监听已映射的端口; 文档化所有端口分配 |
| 相关 Runbook | [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) 场景 1 |
| 相关 FMB | — |

---

### 存储类

---

#### FM-STO-001: 磁盘空间耗尽

| 字段 | 值 |
|------|-----|
| ID | FM-STO-001 |
| 类别 | 存储 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 中 (随时间推移必然发生) |
| 影响范围 | 所有需要写磁盘的服务 (PG/Loki/Prometheus/Nginx logs/Docker layers) |
| 检测方法 | NodeFileSystemFull 告警 (<15% free); `df -h` 显示 Use% > 95%; PG 进入只读模式; Docker pull/write 失败 |
| MTTR 估算 | 15 分钟 - 2 小时 (取决于清理策略) |
| 预防措施 | 配置 NodeFileSystemFull 告警 (<85% warning, <95% critical); 定期清理旧日志/备份; Loki 保留 7 天自动淘汰; Prometheus TSDB 设置 retention; Docker system prune 定期执行 |
| 相关 Runbook | [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 3, [RB-005 监控栈运行手册](runbooks/RB-005_MONITORING_STACK.md) 场景 6 |
| 相关 FMB | FM-STO-002, FM-CAL-002 |

---

#### FM-STO-002: 磁盘 I/O 瓶颈

| 字段 | 值 |
|------|-----|
| ID | FM-STO-002 |
| 类别 | 存储 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | PostgreSQL (查询慢), Prometheus (TSDB 写入慢), Loki (日志摄入慢), 整体延迟升高 |
| 检测方法 | `iostat -xz 1 5` 显示 %iowait > 20%; PG checkpoint 时间增长; Prometheus rule 评估延迟升高; API P95 延迟突增 |
| MTTR 估算 | 30 分钟 - 2 小时 |
| 预防措施 | 将 PG data/WAL 分盘; Prometheus/Loki 使用独立 SSD; 监控 iowait 和 disk latency 指标; 避免 VACUUM FULL 在高峰期执行 |
| 相关 Runbook | [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 4, [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 6 |
| 相关 FMB | FM-STO-001, FM-APP-001 |

---

#### FM-STO-003: 数据文件损坏

| 字段 | 值 |
|------|-----|
| ID | FM-STO-003 |
| 类别 | 存储 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 极低 |
| 影响范围 | PostgreSQL (数据损坏), Redis (RDB/AOF 损坏), Prometheus TSDB 损坏 |
| 检测方法 | PG 报 "corruption detected"; `pg_verifychecksums` 返回错误; Redis 启动报 RDB checksum fail; Prometheus 启动报 WAL corruption |
| MTTR 估算 | 1-4 小时 (取决于备份恢复速度) |
| 预防措施 | 启用 PG checksums (PG 15 默认开启); 使用企业级 SSD (带 ECC); UPS 保护防止异常断电; 定期备份并验证备份完整性; 参考 [docs/REMOTE_BACKUP_STRATEGY.md](../REMOTE_BACKUP_STRATEGY.md) |
| 相关 Runbook | [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 5, [RB-003 Redis 运行手册](runbooks/RB-003_REDIS.md) 场景 4 |
| 相关 FMB | FM-STO-001 |

---

#### FM-STO-004: 备份任务失败

| 字段 | 值 |
|------|-----|
| ID | FM-STO-004 |
| 类别 | 存储 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | 灾难恢复能力下降; RPO 目标可能无法满足 |
| 检测方法 | Cron/job 输出错误码非 0; 备份文件大小为 0 或不存在; 备份脚本日志中的 ERROR; 定期备份校验失败 |
| MTTR 估算 | 15-60 分钟 (修复备份流程) |
| 预防措施 | 备份任务本身纳入监控 (失败即告警); 定期做恢复演练 (参考 [docs/DISASTER_RECOVERY_DRILL_PLAN.md](../DISASTER_RECOVERY_DRILL_PLAN.md)); 多地多副本存储; 备份加密 |
| 相关 Runbook | [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 6 |
| 相关 FMB | FM-STO-001, FM-STO-003 |

---

### 计算类

---

#### FM-CAL-001: CPU 过载

| 字段 | 值 |
|------|-----|
| ID | FM-CAL-001 |
| 类别 | 计算 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | 全部容器的响应延迟增加; 调度延迟; 可能触发级联故障 |
| 检测方法 | NodeHighCPU 告警 (>90%, 20min); `top` 显示 idle ≈ 0%; docker stats 显示所有容器 CPU 飙高; API P50 延迟升高 |
| MTTR 估算 | 15-60 分钟 |
| 预防措施 | 为每个容器设置 CPU limit; 监控 host CPU 趋势; 在高峰前扩容或限流; 识别并优化 CPU 密集型操作 (如模板渲染、Gzip) |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 6, [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) |
| 相关 FMB | FM-CAL-002, FM-APP-005 |

---

#### FM-CAL-002: OOMKilled (内存不足被杀)

| 字段 | 值 |
|------|-----|
| ID | FM-CAL-002 |
| 类别 | 计算 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 中 |
| 影响范围 | 被 kill 的容器完全停止服务; API 容器 OOM → 全站不可用 |
| 检测方法 | `docker inspect` 显示 OOMKilled=true; dmesg 显示 "Out of memory: Kill process"; ContainerRestartLoop 告警触发; APIMemoryPressure 告警未处理导致 OOM |
| MTTR 估算 | 5-30 分钟 (重启恢复) + 根因排查时间 |
| 预防措施 | 为所有容器设置 memory limit (当前仅 API 有 512MB); APIMemoryPressure 告警 (>80% RSS) 提前预警; V8 heap 限制 384MB (75% of container); 定期 GC (已配置 60s interval); 参考 TT-003 决策树 |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 5, [TT-003 高内存使用率决策树](troubleshooting-trees/TT-003_HIGH_MEMORY_USAGE.md) |
| 相关 FMB | FM-CAL-001, FM-APP-007 |

---

#### FM-CAL-003: 进程崩溃 (非 OOM)

| 字段 | 值 |
|------|-----|
| ID | FM-CAL-003 |
| 类别 | 计算 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 低 |
| 影响范围 | 崩溃的容器服务中断; 如果是 API 则全站不可用 |
| 检测方法 | APIDown 告警 (up==0, 2min); ContainerRestartLoop 告警 (>5次/h); docker logs 中的 FATAL/panic/SIGSEGV |
| MTTR 估算 | 10-60 分钟 (需分析 core dump 或日志定位根因) |
| 预防措施 | uncaughtException handler (已在 server.js 配置); Graceful shutdown (SIGTERM/SIGINT handler 已实现); 健康检查 + restart policy; 参考 TT-004 决策树 |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 1, [TT-004 容器崩溃循环决策树](troubleshooting-trees/TT-004_CONTAINER_CRASH_LOOP.md) |
| 相关 FMB | FM-CAL-002 |

---

#### FM-CAL-004: 僵尸进程累积

| 字段 | 值 |
|------|-----|
| ID | FM-CAL-004 |
| 类别 | 计算 |
| 影响等级 | 🟡 Medium |
| 发生概率 | 低 |
| 影响范围 | 占用 PID 资源; 最终可能导致 PID 耗尽无法 fork 新进程 |
| 检测方法 | `ps aux \| grep Z \| wc -l` 数量持续增长; `docker top <container>` 显示僵尸; node-exporter 的 process_zombies 指标 |
| MTTR 估算 | 10-30 分钟 |
| 预防措施 | 正确处理 child process exit 事件; 避免 spawn 未管理生命周期的子进程; 定期检查和清理 |
| 相关 Runbook | [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) |
| 相关 FMB | FM-CAL-003 |

---

### 应用类

---

#### FM-APP-001: 数据库连接池耗尽

| 字段 | 值 |
|------|-----|
| ID | FM-APP-001 |
| 类别 | 应用 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 中 |
| 影响范围 | API 无法执行任何数据库操作 → 全部数据接口返回错误 |
| 检测方法 | PostgresConnectionHigh 告警 (>80 connections, 20min); API 日志 "connection acquire timeout"; SequelizeConnectionError |
| MTTR 估算 | 5-30 分钟 |
| 预防措施 | 合理设置 pool max/min (当前 max:10/min:2); 设置 acquire timeout (30s); 排查长事务和连接泄漏; 参考 RB-002 场景 2 |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 3, [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 2 |
| 相关 FMB | FM-APP-005 |

---

#### FM-APP-002: Redis 连接超时

| 字段 | 值 |
|------|-----|
| ID | FM-APP-002 |
| 类别 | 应用 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | 缓存失效 → API 延迟升高; 限流计数器丢失 → 限流策略失效; 会话管理异常 → 用户登出; 队列操作失败 → 邮件发送暂停 |
| 检测方法 | RedisMemoryHigh 告警; API 日志 "Redis timeout" / "ECONNREFUSED"; 缓存命中率骤降; SLOWLOG 出现慢命令 |
| MTTR 估算 | 5-20 分钟 |
| 预防措施 | API 可降级运行 (无缓存模式); Redis 客户端使用连接池; 设置合理的 command timeout; 禁止生产环境 KEYS *; 参考 RB-003 |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 4, [RB-003 Redis 运行手册](runbooks/RB-003_REDIS.md) 场景 1/3 |
| related FMB | FM-APP-006 |

---

#### FM-APP-003: 邮件队列堵塞

| 字段 | 值 |
|------|-----|
| ID | FM-APP-003 |
| 类别 | 应用 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | Campaign 无法正常发送; 营销活动停滞; 业务收入影响 |
| 检测方法 | EmailQueueCritical / EmailQueueBacklog 告警; wait 队列 LLEN 持续增长; active 队列为空; Campaign 状态卡在 SENDING |
| MTTR 估算 | 10-60 分钟 |
| 预防措施 | EmailQueueCritical 告警及时通知; Worker 健康检查; Redis 连接监控; Provider 速率限制可视化; 参考 RB-007 |
| 相关 Runbook | [RB-007 邮件流水线运行手册](runbooks/RB-007_EMAIL_PIPELINE.md) 场景 1/4, [TT-002 邮件发送失败决策树](troubleshooting-trees/TT-002_EMAIL_DELIVERY_FAILURE.md) |
| related FMB | FM-EXT-001 |

---

#### FM-APP-004: 内存泄漏

| 字段 | 值 |
|------|-----|
| ID | FM-APP-004 |
| 类别 | 应用 |
| 影响等级 | 🟠 High → 🔴 Critical (长期不处理) |
| 发生概率 | 中 (Node.js 常见问题) |
| 影响范围 | API 容器 RSS 持续增长 → 最终 OOM → 服务重启 → 请求丢失 |
| 检测方法 | APIMemoryPressure 告警 (>80% RSS, 15min); container_memory_rss 持续上升趋势; V8 heap_used 接近 384MB 上限; GC 后内存不释放 |
| MTTR 估算 | 30 分钟 - 2 小时 (定位泄漏点较耗时) |
| 预防措施 | 定期 V8 GC (已配置 60s); V8 heap 限制 384MB; Prometheus 内存趋势监控; 避免闭包引用大对象; EventEmitter 最大监听器警告; heap snapshot 分析 |
| 相关 Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 5, [TT-003 高内存使用率决策树](troubleshooting-trees/TT-003_HIGH_MEMORY_USAGE.md) |
| related FMB | FM-CAL-002 |

---

#### FM-APP-005: 数据库死锁

| 字段 | 值 |
|------|-----|
| ID | FM-APP-005 |
| 类别 | 应用 |
| 影响等级 | 🟠 High |
| 发生概率 | 低 |
| 影响范围 | 涉及死锁的事务全部阻塞或回滚; 对应 API 请求超时或失败 |
| 检测方法 | PG 日志 "DEADLOCK detected"; pg_stat_activity 中等待事件为 lock; API 请求超时集中在某些端点 |
| MTTR 估算 | 5-30 分钟 (手动终止一个事务即可解除) |
| 预防措施 | 统一事务中资源访问顺序; 缩短事务持有时间; 设置 lock_timeout; 使用 SELECT FOR UPDATE SKIP LOCKED; 乐观并发控制 |
| related Runbook | [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) 场景 4 |
| related FMB | FM-APP-001 |

---

#### FM-APP-006: 缓存雪崩

| 字段 | 值 |
|------|-----|
| ID | FM-APP-006 |
| 类别 | 应用 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 |
| 影响范围 | 大量请求同时穿透到数据库 → DB 过载 → 级联故障 |
| 检测方法 | Redis 命中率突然降至接近 0%; PG QPS 突然飙升 5-10x; API P95 延迟突增; PostgresConnectionHigh 告警 |
| MTTR 估算 | 15-60 分钟 (DB 恢复 + 缓存预热) |
| 预防措施 | 缓存 TTL 加随机偏移 (jitter); 多级缓存 (L1 内存 + L2 分布式); 熔断机制 (DB 过载时快速失败); 缓存预热策略 |
| related Runbook | [RB-003 Redis 运行手册](runbooks/RB-003_REDIS.md), [RB-002 PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) |
| related FMB | FM-APP-001, FM-APP-002 |

---

#### FM-APP-007: JWT Secret 泄露

| 字段 | 值 |
|------|-----|
| ID | FM-APP-007 |
| 类别 | 应用 (跨安全边界) |
| 影响等级 | 🔴 Critical |
| 发生概率 | 极低 |
| 影响范围 | 攻击者可伪造任意用户 token → 完全接管账户; 可访问所有 API 端点 |
| 检测方式 | 异常登录模式 (大量新 device/token); AuditLog 中的可疑操作; 异常地理位置登录; token 签发频率突增 |
| MTTR 估算 | 1-4 小时 (轮换 secret + 通知所有用户重新登录) |
| 预防措施 | JWT_SECRET 存储在 .env 中不入库; 定期轮换 (参考 docs/SECURITY_KEY_ROTATION_POLICY.md); 使用短过期时间 (24h) + refresh token; IP/设备绑定校验 |
| related Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md) 场景 7 |
| related FMB | FM-SEC-002 |

---

### 安全类

---

#### FM-SEC-001: 未授权访问 / 身份伪造

| 字段 | 值 |
|------|-----|
| ID | FM-SEC-001 |
| 类别 | 安全 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 低 |
| 影响范围 | 数据泄露; 未授权操作; 合规违规 (GDPR/PIPL) |
| 检测方法 | AuditLog 中出现异常操作 (非工作时间/非常规路径); 大量 401 后突然 200; Grafana/monitoring 非法访问尝试 |
| MTTR 估算 | 1-4 小时 (取证 + 封堵 + 通知) |
| 预防措施 | Helmet 安全头; CSRF 保护 (已启用); Rate Limiting 三层架构; RBAC 角色 (ADMIN/USER/VIEWER); 审计日志全覆盖; 参考 docs/COMPLIANCE_POLICY.md |
| related Runbook | [RB-001 API 服务运行手册](runbooks/RB-001_API_SERVICE.md), [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md) |
| related FMB | FM-SEC-002, FM-SEC-003 |

---

#### FM-SEC-002: 密钥/凭据泄露

| 字段 | 值 |
|------|-----|
| ID | FM-SEC-002 |
| 类别 | 安全 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 极低 |
| 影响范围 | 取决于泄露的密钥类型: DB_PASSWORD → 数据全览; SMTP_QQ_PASS → 邮件滥用; JWT_SECRET → 身份伪造; WEBHOOK_SECRET → 告警伪造 |
| 检测方法 | Git 历史扫描 (git-secrets/truffleHog); .env 文件误提交检测; 异常 API 调用模式; 凭据使用位置监控 |
| MTTR 估算 | 2-8 小时 (轮换所有密钥 + 检查入侵痕迹) |
| 预防措施 | .env 加入 .gitignore; pre-commit hook 扫描密钥; Docker secrets / vault 管理; 定期轮换 (docs/SECURITY_KEY_ROTATION_POLICY.md); 最小权限原则 |
| related Runbook | [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md), docs/SECURITY_KEY_ROTATION_POLICY.md |
| related FMB | FM-SEC-001, FM-APP-007 |

---

#### FM-SEC-003: DDoS 攻击

| 字段 | 值 |
|------|-----|
| ID | FM-SEC-003 |
| 类别 | 安全 |
| 影响等级 | 🔴 Critical |
| 发生概率 | 低 |
| 影响范围 | Nginx 层带宽/连接耗尽 → 合法用户无法访问; API 层资源耗尽 → 服务降级 |
| 检测方法 | Nginx access_log 中同 IP 高频请求; 限流 429/503 骤增; CPU/带宽异常; HighErrorRate 告警 |
| MTTR 估算 | 15 分钟 - 2 小时 (取决于攻击规模和缓解手段) |
| 预防措施 | Nginx L1 限流 (50r/s per IP, burst=100); Express L2+L3 限流; Cloudflare/WAF 前置防护; IP 黑名单; GEO 封禁; 参考 docs/COMPLIANCE_POLICY.md |
| related Runbook | [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md) 场景 3 |
| related FMB | FM-NET-002, FM-CAL-001 |

---

#### FM-SEC-004: TLS 配置错误 / 弱密码套件

| 字段 | 值 |
|------|-----|
| ID | FM-SEC-004 |
| 类别 | 安全 |
| 影响等级 | 🟡 Medium → 🟠 High (如果允许弱加密) |
| 发生概率 | 低 |
| 影响范围 | 中间人攻击风险; 安全扫描不合格; 合规审计失败 |
| 检测方法 | SSL Labs 评级 (目标 A+); sslscan / testssl.sh 扫描; 安全基线扫描工具结果 |
| MTTR 估算 | 30 分钟 - 2 小时 (修改 nginx 配置 + 重载) |
| 预防措施 | 定期安全扫描 (每月); 禁用 TLSv1.0/1.1; 仅使用现代密码套件; HSTS preload; OCSP Stapling; 配置审查 (code review) |
| related Runbook | [RB-004 Nginx 运行手册](runbooks/RB-004_NGINX.md) |
| related FMB | FM-NET-003 |

---

### 外部依赖类

---

#### FM-EXT-001: SMTP 提供商宕机/限流

| 字段 | 值 |
|------|-----|
| ID | FM-EXT-001 |
| 类别 | 外部依赖 |
| 影响等级 | 🟠 High |
| 发生概率 | 中 (QQ Mail/Gmail 等偶有限流) |
| 影响范围 | 通过该 Provider 的邮件发送失败; EmailQueue failed 队列增长; Account health_score 下降 |
| 检测方法 | emailService 发送失败日志; SMTP 421/450/451/454 响应码; EmailAccount health_score 骤降; Mailpit 无新邮件到达 |
| MTTR 估算 | 15 分钟 - 4 小时 (取决于 Provider 恢复时间) |
| 预防措施 | 多 Provider 故障转移 (M8 FailoverManager 已实现); 每个 Provider 独立限额; 降低单 Provider 依赖比例; health_score 自动切换 |
| related Runbook | [RB-007 邮件流水线运行手册](runbooks/RB-007_EMAIL_PIPELINE.md) 场景 1/3, [TT-002 邮件发送失败决策树](troubleshooting-trees/TT-002_EMAIL_DELIVERY_FAILURE.md) |
| related FMB | FM-APP-003 |

---

#### FM-EXT-002: GitHub API 限流

| 字段 | 值 |
|------|-----|
| ID | FM-EXT-002 |
| 类别 | 外部依赖 |
| 影响等级 | 🟡 Medium |
| 发生概率 | 中 (CI/CD 频繁调用) |
| 影响范围 | CI/CD 流水线失败; Self-hosted Runner 注册/通信失败; 自动部署中断 |
| 检测方法 | GitHub API 返回 403 (rate limit); x-ratelimit-remaining header 接近 0; CI job 失败 "API rate limit exceeded" |
| MTTR 估算 | 5-60 分钟 (等待重置或增加 token) |
| 预防措施 | 使用 GitHub Token (提高限额到 5000/h); 缓存 API 响应; 请求合并/批量化; 退避重试; 参考 docs/SELF_HOSTED_RUNNER_GUIDE.md |
| related Runbook | docs/SELF_HOSTED_RUNNER_GUIDE.md |
| related FMB | — |

---

#### FM-EXT-003: NPM Registry 不可达

| 字段 | 值 |
|------|-----|
| ID | FM-EXT-003 |
| 类别 | 外部依赖 |
| 影响等级 | 🟡 Medium |
| 发生概率 | 低 |
| 影响范围 | 无法构建/部署新的 API 版本; npm install 失败; CI 流水线阻塞 |
| 检测方法 | `npm install` 超时或 ECONNREFUSED; `npm ping registry.npmjs.org` 失败; CI build step 失败 |
| MTTR 估算 | 15 分钟 - 4 小时 (取决于 registry 恢复) |
| 预防措施 | 使用镜像源 (淘宝/cnpm); 私有 NPM registry (Verdaccio); 本地 npm cache; 离线包锁定 (package-lock.json) |
| related Runbook | [RB-006 Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) 场景 5 |
| related FMB | FM-NET-001 |

---

## 快速检索表

### 按严重程度排列 (🔴 Critical)

| ID | 名称 | 类别 | 发生概率 | MTTR |
|----|------|------|---------|------|
| FM-NET-001 | DNS 解析失败 | 网络 | 低 | 5-30 min |
| FM-NET-002 | 防火墙阻断 | 网络 | 低 | 10-60 min |
| FM-NET-003 | TLS 证书过期 | 网络 | 中 | 5-120 min |
| FM-STO-001 | 磁盘空间耗尽 | 存储 | 中 | 15-120 min |
| FM-STO-003 | 数据文件损坏 | 存储 | 极低 | 1-4 h |
| FM-CAL-002 | OOMKilled | 计算 | 中 | 5-30 min |
| FM-CAL-003 | 进程崩溃 | 计算 | 低 | 10-60 min |
| FM-APP-001 | DB 连接池耗尽 | 应用 | 中 | 5-30 min |
| FM-APP-007 | JWT Secret 泄露 | 应用(安全) | 极低 | 1-4 h |
| FM-SEC-001 | 未授权访问 | 安全 | 低 | 1-4 h |
| FM-SEC-002 | 密钥/凭据泄露 | 安全 | 极低 | 2-8 h |
| FM-SEC-003 | DDoS 攻击 | 安全 | 低 | 15-120 min |

### 按组件/系统排列

| 组件 | 相关 FM IDs |
|------|------------|
| Nginx | FM-NET-001~004, FM-SEC-003~004 |
| API | FM-APP-001~007, FM-CAL-002~003 |
| PostgreSQL | FM-STO-001~004, FM-APP-001, FM-APP-005~006 |
| Redis | FM-APP-002, FM-APP-006 |
| 邮件流水线 | FM-APP-003, FM-EXT-001 |
| Docker/主机 | FM-CAL-001~004, FM-STO-001~002 |
| 监控栈 | FM-STO-001~002, FM-STO-004 |
| 外部依赖 | FM-EXT-001~003 |
