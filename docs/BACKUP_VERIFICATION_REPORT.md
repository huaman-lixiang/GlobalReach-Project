# 备份验证报告模板

> GlobalReach V2.0 — M-D04 备份完整性自动验证报告
> 由 `scripts/verify-backup.sh` 和 `scripts/disaster-recovery-drill.sh` 自动生成

## 验证日期: YYYY-MM-DD HH:MM
## 备份文件: globalreach_backup_YYYYMMDD_HHMMSS.tar.gz
## 校验和: SHA256=xxxxxxxxxx

---

### 检查项清单

| # | 检查项 | 结果 | 详情 |
|---|--------|------|------|
| 1 | SHA256校验 | PASS / FAIL | 哈希值匹配状态 |
| 2 | 文件完整性(tar) | PASS / FAIL | tar.gz 归档可正常解压，包含 N 个条目 |
| 3 | PG备份存在 | PASS / FAIL | 大小: X MB (custom format dump) |
| 4 | Redis备份存在 | PASS / FAIL | 大小: X KB (dump.rdb / appendonly.aof) |
| 5 | Grafana备份存在 | PASS / FAIL | 大小: X MB (grafana.db SQLite) |
| 6 | Nginx配置存在 | PASS / FAIL | nginx.conf + conf.d + SSL证书 |
| 7 | 备份年龄 | OK / WARN | X 天前 (警告线: 7 天) |
| 8 | 备份大小趋势 | OK / WARN / FAIL | 当前/历史平均 ≈ XX% |
| 9 | 磁盘剩余空间 | OK / WARN | X GB 可用 |

---

### PG 恢复性测试 (dry-run)

| 项目 | 结果 | 详情 |
|------|------|------|
| pg_restore --list | PASS / WARN / FAIL | N 个数据库对象, N 张表 |
| 完整 dry-run | PASS / N/A | 需要数据库连接才能完成 |

### Redis 数据验证

| 项目 | 结果 | 详情 |
|------|------|------|
| RDB 文件格式 | PASS / WARN / FAIL | redis-check-rdb 验证结果 |
| 键数量 (备份时) | INFO | N keys |

### Grafana 数据验证

| 项目 | 结果 | 详情 |
|------|------|------|
| SQLite integrity_check | PASS / FAIL | ok / error details |
| Dashboard 数量 | INFO | N 条 |
| Datasource 数量 | INFO | N 条 |

### 灾难恢复演练摘要

| 步骤 | 描述 | 结果 |
|------|------|------|
| 1 | 创建隔离环境 | PASS — 临时目录已创建 |
| 2 | 解压备份归档 | PASS — N 个文件, 总计 X GB |
| 3 | PostgreSQL 恢复验证 | PASS / WARN / FAIL |
| 4 | Redis RDB 格式验证 | PASS / WARN / FAIL |
| 5 | Grafana SQLite 验证 | PASS / WARN / FAIL |
| 6 | Nginx 配置语法检查 | PASS / WARN / FAIL |
| 7 | Docker Compose 配置验证 | PASS / WARN / FAIL |
| 8 | 数据量概览汇总 | INFO |

---

### 结论: **PASS** / **WARN** / **FAIL**

#### 通过条件:
- **PASS**: 所有检查项均为 PASS，无 FAIL 或 WARN
- **WARN**: 存在 WARN 但无 FAIL（需人工关注）
- **FAIL**: 存在任意 FAIL（必须立即处理）

#### 后续操作建议:

- [ ] 若为 **PASS**: 记录本次验证结果，继续常规监控
- [ ] 若为 **WARN**: 查看具体 WARN 项，评估是否需要干预
- [ ] 若为 **FAIL**: 立即排查失败原因，必要时触发重新备份
- [ ] 定期运行演练: `./scripts/disaster-recovery-drill.sh`

---

*报告由 GlobalReach V2.0 M-D04 自动化工具生成*
