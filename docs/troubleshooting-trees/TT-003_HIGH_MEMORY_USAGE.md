# TT-003 高内存使用率决策树

> **文档版本**: v1.0
> **适用场景**: API 容器内存使用持续升高 / OOM 告警 / 系统整体内存紧张
> **预估排查时间**: 10-60 分钟
> **关联 Runbook**: [RB-001 API 服务运行手册](../runbooks/RB-001_API_SERVICE.md) 场景 5
> **关联 FMB**: [FM-CAL-002 OOMKilled](../failure-modes/FailureModeBase.md), [FM-APP-004 内存泄漏](../failure-modes/FailureModeBase.md)

---

## 决策树总览

```
[开始: 收到 APIMemoryPressure 告警 (>80% RSS) 或发现内存异常]
│
├─ Step 1: 确认内存使用现状
│  │  命令:
│  │    # 容器级别
│  │    docker stats --no-stream globalreach-api-prod --format "table {{.MemUsage}} {{.MemPerc}}"
│  │    # Prometheus 趋势
│  │    curl -s 'http://localhost:9090/api/v1/query?query=container_memory_rss{container="globalreach-api-prod"}' \
│  │      | jq '.data.result[0].value[1]'
│  │  预估: 2 min
│  │
│  ├─ RSS < 350MB (68%) ────────────────→ [误报或已自愈] → 观察即可
│  ├─ RSS 350-400MB (70-80%) ──────────→ [🟡 警告区间] ↓ 继续 Step 2
│  ├─ RSS 400-450MB (80-88%) ──────────→ [🟠 高压区间] ↓ 紧急处理
│  └─ RSS > 450MB (>88%) 或 OOM ───────→ [🔴 危险/已崩溃] ↓ 立即行动
│
├─ Step 2: 区分是 V8 Heap 还是其他内存
│  │  命令:
│  │    docker exec globalreach-api-prod node -e "
│  │      const v8 = require('v8');
│  │      const h = v8.getHeapStatistics();
│  │      console.log('=== V8 Heap ===');
│  │      console.log('used:', (h.used_heap_size/1024/1024).toFixed(1), 'MB');
│  │      console.log('total:', (h.total_heap_size/1024/1024).toFixed(1), 'MB');
│  │      console.log('limit:', (h.heap_size_limit/1024/1024).toFixed(1), 'MB');
│  │      console.log('malloced:', (h.malloced_memory/1024/1024).toFixed(1), 'MB');
│  │      console.log('external:', (h.external_memory/1024/1024).toFixed(1), 'MB');
│  │      if (global.gc) { global.gc(); console.log('GC executed'); }
│  │    "
│  │  预估: 2 min
│  │
│  ├─ V8 used_heap 接近 limit (384MB) ─→ [分支 A: JS 堆问题] ↓
│  ├─ V8 heap 正常但 RSS 高 ───────────→ [分支 B: 非 Heap 内存] ↓
│  └─ GC 后显著下降 ─────────────────→ [正常 GC 波动] → 已配置 60s 定期 GC，观察趋势
│
╔════════════════════════════════════════════════════╗
║           分支 A: V8 Heap 过高                       ║
╚════════════════════════════════════════════════════╝
│
│  可能原因: JavaScript 对象未释放 / 闭包泄漏 / 大数组缓存
│
├─ Step A1: 检查 Buffer 和 ArrayBuffer 使用
│  │  命令:
│  │    docker exec globalreach-api-prod node -e "
│  │      const v8 = require('v8');
│  │      const h = v8.getHeapStatistics();
│  │      console.log('heap_size:', (h.heap_size_size/1024/1024).toFixed(1), 'MB');
│  │      console.log('total_heap_size:', (h.total_heap_size/1024/1024).toFixed(1), 'MB');
│  │    "
│  │  额外: 1 min
│  │
│  ├─ heap_size 占比高 ───────────────→ 可能有大量 Buffer (如读取大文件/模板)
│  │   │  排查方向: 文件上传? 大模板缓存? 日志字符串拼接?
│  │   │  解决: 流式处理; 缓存上限; 及时释放引用
│  │   └─→ RB-001 场景 5 + FM-APP-004
│  │
│  └─ heap_size 正常 ─────────────────→ Step A2 ↓
│
├─ Step A2: 检查是否有大对象常驻
│  │  方案: 需要获取 heap snapshot 分析 (生产环境谨慎操作)
│  │  命令:
│  │    docker exec globalreach-api-prod node -e "
│  │      const v8 = require('v8');
│  │      const fs = require('fs');
│  │      const snapshot = v8.getHeapSnapshot();
│  │      // 写入文件后用 Chrome DevTools 加载分析
│  │      // 注意: 这会暂停事件循环!
│  │    "  # ⚠️ 生产环境慎用
│  │
│  │  替代方案 (非侵入式):
│  │    # 查看 GlobalReach 自定义 metrics 中的 heap 指标
│  │    curl -sf http://localhost:3000/api/v1/metrics | grep -i heap
│  │  额外: 5 min
│  │
│  └─ 根据分析结果定位泄漏点
│     常见泄漏源:
│     • CacheService 无限增长 → 设置 LRU 上限
│     • EventEmitter 未 removeListener → 检查 MaxListenersExceededWarning
│     • 闭包捕获了大对象 → 重构代码解除引用
│     → FM-APP-004 + RB-001 场景 5
│
╔════════════════════════════════════════════════════╗
║           分支 B: 非 Heap 内存过高                    ║
╚════════════════════════════════════════════════════╝
│
│  可能原因: Node.js C++ addon 分配 / 子进程内存 / 共享库映射
│
├─ Step B1: 检查子进程和连接
│  │  命令:
│  │    # 容器内进程树
│  │    docker exec globalreach-api-prod sh -c "ps aux"
│  │    # 文件描述符数量
│  │    docker exec globalreach-api-prod sh -c "ls /proc/*/fd 2>/dev/null \| wc -l"
│  │  额外: 1 min
│  │
│  ├─ 有子进程残留 ─────────────────→ zombie/orphan 进程 → 清理
│  │  └─→ FM-CAL-004
│  │
│  ├─ fd 数量过大 (>1000) ───────────→ 文件描述符泄漏 → 排查代码
│  │  └─→ RB-001
│  │
│  └─ 只有 Node 主进程 ─────────────→ Step B2 ↓
│
├─ Step B2: 检查是否使用了 native addon
│  │  命令:
│  │    # 列出 .node 文件
│  │    docker exec globalreach-api-prod find /app/node_modules -name "*.node" 2>/dev/null
│  │    # 检查 buffer module 的外部内存
│  │  额外: 1 min
│  │
│  └─ 如果有 bcrypt/argon2/sqlite 等 addon
│     → 这些模块在 C++ 层分配内存不计入 V8 heap
│     → 减少并发使用; 升级到纯 JS 实现 (如 bcrypt → argon2 在 JS 中)
│     → FM-CAL-002
│
╔════════════════════════════════════════════════════╗
║           🔴 紧急: 即将或已经 OOM                     ║
╚════════════════════════════════════════════════════╝
│
├─ 立即操作 (按顺序):
│  │
│  │  1. 【止损】创建 AlertManager 静默 (避免告警风暴)
│  │     → TT-005 或 AM Web UI
│  │
│  │  2. 【临时】强制 GC + 观察
│  │     docker exec globalreach-api-prod node -e "if(global.gc){global.gc();console.log('GC done')}else{console.log('no gc')}"
│  │     等 10 秒后再次检查 RSS
│  │
│  │  3. 【如果 GC 无效】优雅重启 API
│  │     docker compose -f docker-compose.prod.yml restart api
│  │     ⚠️ 注意: 会丢失当前正在处理的请求和队列中的 in-flight jobs
│  │     ✅ SendWorker 有 graceful shutdown (15s drain timeout)
│  │
│  │  4. 【重启后】观察内存增长曲线
│  │     每 5 分钟检查一次 RSS, 记录数据点
│  │     如果 30 分钟内再次超过 80% → 存在真实泄漏, 需要深度排查
│  │
│  └─ 根本修复:
│     → TT-004 (如果是 CrashLoop) 或 RB-001 场景 5 (深度分析)
│     → FM-APP-004 (如果确认泄漏)
```

---

## 内存基线参考值

| 指标 | 正常 | 警告 | 危险 |
|------|------|------|------|
| Container RSS | < 350 MB | 350-400 MB | > 400 MB |
| V8 Heap Used | < 280 MB | 280-340 MB | > 340 MB |
| V8 Heap Total | < 320 MB | 320-360 MB | > 360 MB |
| RSS/Heap Ratio | < 1.3 | 1.3-1.6 | > 1.6 (可能有非堆内存泄漏) |
| GC 后释放比例 | > 15% | 5-15% | < 5% (真实泄漏信号) |

---

## 快速命令速查

```bash
# 一键诊断 (复制粘贴到终端)
echo "=== 1. Container Memory ===" && \
docker stats --no-stream globalreach-api-prod --format "{{.MemUsage}} {{.MemPerc}}" && \
echo "" && echo "=== 2. V8 Heap ===" && \
docker exec globalreach-api-prod node -e "
const v8=require('v8');const h=v8.getHeapStatistics();
console.log('used:',(h.used_heap_size/1e6).toFixed(1),'MB',
  '/ total:',(h.total_heap_size/1e6).toFixed(1),'MB',
  '/ limit:',(h.heap_size_limit/1e6).toFixed(1),'MB',
  '| malloced:',(h.malloced_memory/1e6).toFixed(1),'MB',
  '| external:',(h.external_memory/1e6).toFixed(1),'MB');
" && \
echo "" && echo "=== 3. Process Count ===" && \
docker exec globalreach-api-prod sh -c "ps aux \| wc -l" && \
echo "" && echo "=== 4. Force GC ===" && \
docker exec globalreach-api-prod node -e "if(global.gc){global.gc();console.log('GC OK')}else{console.log('NO_GC')}"
```
