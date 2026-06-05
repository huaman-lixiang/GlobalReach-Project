# 📁 GlobalReach 项目文件归档管理制度 v1.0

> **生效日期**: 2026-05-09  
> **适用范围**: GlobalReach项目所有开发文档、配置文件、代码资源  
> **核心原则**: 单一事实来源 (Single Source of Truth) + 双轨同步机制

---

## 🔴 第一章：根本原则

### 1.1 黄金法则

```
⛔ 禁止事项:
❌ 将项目文档散落在多个位置
❌ 在临时目录编辑后不归档
❌ 同时维护多个版本的同一文件
❌ 删除原始文件只保留副本
❌ 文件命名不规范导致无法识别版本

✅ 必须遵守:
☑ 所有项目文档统一存放在指定目录
☑ 文件命名遵循 GLOBALREACH_[模块]_v[版本].md 格式
☑ 编辑必须在"工作区"进行，禁止直接修改"发布区"
☑ 版本更新时保留旧版并标记日期
☑ 定期执行同步操作确保两区一致
```

### 1.2 双轨制架构

```
┌─────────────────────────────────────────────────────────────┐
│                    双轨制文件管理架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   轨道A: 工作区 (WORKING DIRECTORY)                      │
│   ══════════════════════════════════════════════════        │
│                                                             │
│   物理路径:                                                │
│   C:\Users\Administrator\Documents\trae_projects\            │
│   └── GlobalReach-Official\                                │
│                                                             │
│   目录用途:                                                │
│   ├── 📝 活跃开发 (AI实时读写)                              │
│   ├── 🔄 版本迭代 (频繁更新)                               │
│   ├── 🔧 配置管理 (运行时配置)                             │
│   └── 📊 临时文件 (日志/缓存)                              │
│                                                             │
│   访问权限:                                                │
│   ✅ Trae IDE (完全读写)                                   │
│   ✅ 开发者 (完全读写)                                     │
│   ⚠️  其他人员 (只读建议)                                  │
│                                                             │
│   同步方向: → (源)                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   轨道B: 发布区 (PUBLICATION DIRECTORY)                   │
│   ══════════════════════════════════════════════════        │
│                                                             │
│   物理路径:                                                │
│   D:\trae\1海外客户业务拓展-GlobalReach系统\               │
│                                                             │
│   目录用途:                                                │
│   ├── 📖 用户查阅 (最终交付物)                             │
│   ├── 🤝 团队共享 (对外展示)                               │
│   ├── 💾 长期存档 (历史版本保留)                            │
│   └── 🎯 备份恢复 (灾难恢复点)                              │
│                                                             │
│   访问权限:                                                │
│   ✅ 所有相关人员 (只读)                                    │
│   ✅ 管理员 (可更新, 但需先在工作区更新)                    │
│                                                             │
│   同步方向: ← (目标/镜像)                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘

同步流程:
工作区(编辑完成) → 执行同步脚本 → 发布区(自动更新)
```

---

## 📍 第二章：目录结构规范

### 2.1 轨道A：工作区完整结构

```
C:\Users\Administrator\Documents\trae_projects\
└── GlobalReach-Official\                    ← 项目根目录 (唯一!)
    │
    ├── 00-PROJECT-ROOT\                   ← 项目入口标识
    │   └── PROJECT_INFO.json              ← 项目元数据
    │
    ├── 01-CORE-DOCUMENTS\                ← 核心文档 (9个)
    │   ├── GLOBALREACH_PROJECT_FULL_PROPOSAL_v1.0.md
    │   ├── GLOBALREACH_CONSTITUTION_v1.0.md
    │   ├── GLOBALREACH_COMPLETENESS_MATRIX_100_v1.0.md
    │   ├── GLOBALREACH_SESSION_START_v1.0.md
    │   ├── GLOBALREACH_ULTIMATE_START_COMMAND_v1.0.md
    │   ├── GLOBALREACH_USER_TRAINING_MANUAL_v1.0.md
    │   ├── GLOBALREACH_MARKETING_COPY_v1.0.md
    │   ├── GLOBALREACH_BUSINESS_VALUE_REPORT_v1.0.md
    │   └── GLOBALREACH_AI_DIGITAL_EMPLOYEE_v1.0.md
    │
    ├── 02-ARCHITECTURE\                  ← 架构设计文档
    │   ├── SYSTEM-ARCHITECTURE_v1.0.md
    │   ├── DATA-MODEL-DESIGN_v1.0.md
    │   └── SECURITY-DESIGN_v1.0.md
    │
    ├── 03-SKILLS\                        ← Skill插件代码
    │   ├── business-email-writer\
    │   ├── email-scheduler\
    │   ├── inbox-monitor\
    │   └── [其他7个Skill]
    │
    ├── 04-CONFIG\                        ← 配置文件
    │   ├── config.yaml
    │   ├── schedule-config.yaml
    │   └── rules\
    │
    ├── 05-DATA-TEMPLATES\               ← 数据模板
    │   ├── client-template.json
    │   ├── product-template.json
    │   └── email-account-template.json
    │
    ├── 06-SCRIPTS\                       ← 自动化脚本
    │   ├── sync-to-public.ps1          ← 同步脚本 ⭐
    │   ├── backup-daily.ps1
    │   ├── validate-files.ps1
    │   └── init-project.ps1
    │
    ├── 07-LOGS\                          ← 日志文件
    │   ├── session-history\
    │   └── error-logs\
    │
    ├── .archive\                         ← 历史版本归档
    │   └── [按日期归档旧版本]
    │
    ├── README.md                         ← 项目说明
    └── FILE-MANAGEMENT-RULES.md          ← 本文件 (归档规则)
```

### 2.2 轨道B：发布区结构（镜像）

```
D:\trae\1海外客户业务拓展-GlobalReach系统\
│
├── [与工作区01-CORE-DOCUMENTS内容完全一致]
│   ├── GLOBALREACH_PROJECT_FULL_PROPOSAL_v1.0.md
│   ├── ... (其余8个文档)
│   │
├── docs\                              ← 补充文档
│   └── CHANGELOG.md                    ← 变更日志
│
└── VERSION.txt                        ← 当前同步版本号
```

---

## 🏷️ 第三章：文件命名规范

### 3.1 强制命名格式

```
标准格式: GLOBALREACH_[模块名]_[类型]_v[版本号].[扩展名]

各字段说明:
├── 前缀: GLOBALREACH_ (固定, 标识项目归属)
├── 模块名: 
│   ├── CORE (核心文档)
│   ├── ARCHITECTURE (架构)
│   ├── SKILL (功能模块)
│   ├── CONFIG (配置)
│   ├── SCRIPT (脚本)
│   └── TEMP (临时)
├── 类型:
│   ├── PROPOSAL (全案)
│   ├── CONSTITUTION (宪法)
│   ├── MATRIX (矩阵)
│   ├── SESSION (协议)
│   ├── COMMAND (指令)
│   ├── MANUAL (手册)
│   ├── COPY (文案)
│   ├── REPORT (报告)
│   └── WHITEPAPER (白皮书)
├── 版本号: 
│   ├── 格式: v[大版本].[小版本]
│   ├── 示例: v1.0, v1.1, v2.0
│   └── 规则: 大版本变更=重大重构, 小版本=增量更新
└── 扩展名: .md / .yaml / .json / .ps1 / .js

示例:
✅ GLOBALREACH_CORE_PROPOSAL_v1.0.md
✅ GLOBALREACH_SKILL_EMAIL-WRITER_v1.0.js
✅ GLOBALREACH_CONFIG_MAIN_v1.0.yaml
✅ GLOBALREACH_SCRIPT_SYNC_v1.0.ps1

❌ 全案v1.md (缺少前缀)
❌ GR-proposal-final.md (缩写不明确)
❌ document-v1 (无模块/类型信息)
❌ 新建文本文档.docx (中文+无版本)
```

### 3.2 版本管理规则

```
版本演进路径:

v1.0 (初始版本)
  ↓ [小修: 错别字/个别措辞调整]
v1.1 (小版本更新)
  ↓ [中改: 增加章节/重构部分内容]
v1.2 (小版本更新)
  ↓ [大改: 架构调整/范围变化]
v2.0 (大版本升级)

归档要求:
✅ 每次更新保留旧版本 (移入 .archive/ 目录)
✅ 旧版本命名: [原文件名]_archived_YYYYMMDD
✅ 更新 CHANGELOG.md 记录变更原因
✅ 主文件始终是最新版本
```

---

## 🔄 第四章：同步机制

### 4.1 同步方式选择

| 方式 | 适用场景 | 操作频率 | 推荐度 |
|------|---------|---------|--------|
| **方式1: PowerShell脚本** | 日常开发 | 每次编辑后 | ⭐⭐⭐⭐⭐ 推荐 |
| **方式2: 手动复制** | 偶尔查看 | 按需 | ⭐⭐ 简单但易忘 |
| **方式3: Git版本控制** | 多人协作 | 每日提交 | ⭐⭐⭐ 高级 |

### 4.2 一键同步脚本 (方式1)

```powershell
# ═══════════════════════════════════════════════════════════
#  GlobalReach 项目文件同步脚本 v1.0
#  用途: 将工作区文档同步到发布区
#  使用: .\sync-to-public.ps1
# ═══════════════════════════════════════════════════════════

param(
    [string]$SourcePath = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Official",
    [string]$TargetPath = "D:\trae\1海外客户业务拓展-GlobalReach系统",
    [switch]$WhatIf = $false,
    [switch]$Verbose = $false
)

Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🔄 GlobalReach 文件同步工具 v1.0           ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan

# Step 1: 验证源目录存在
if (-not (Test-Path $SourcePath)) {
    Write-Host "❌ 错误: 源目录不存在: $SourcePath" -ForegroundColor Red
    exit 1
}

# Step 2: 验证/创建目标目录
if (-not (Test-Path $TargetPath)) {
    Write-Host "⚠️  目标目录不存在, 正在创建..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
}

# Step 3: 定义需要同步的文件模式
$syncPatterns = @(
    "GLOBALREACH_*.md",           # 所有核心文档
    "README.md",                 # 项目说明
    "FILE-MANAGEMENT-RULES.md"    # 本规则文件
)

# Step 4: 执行同步
$syncCount = 0
$errorCount = 0

foreach ($pattern in $syncPatterns) {
    $files = Get-ChildItem -Path $SourcePath -Filter $pattern -File
    
    foreach ($file in $files) {
        $sourceFile = $file.FullName
        $targetFile = Join-Path $TargetPath $file.Name
        
        if ($WhatIf) {
            Write-Host "[预览] 会复制: $($file.Name)" -ForegroundColor Yellow
        }
        else {
            try {
                Copy-Item -Path $sourceFile -Destination $targetFile -Force
                $syncCount++
                
                if ($Verbose) {
                    Write-Host "✅ 已同步: $($file.Name)" -ForegroundColor Green
                }
            }
            catch {
                $errorCount++
                Write-Host "❌ 失败: $($file.Name) - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

# Step 5: 生成版本标记
$versionStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$versionContent = @"
GlobalReach Project Files
========================
Sync Timestamp: $versionStamp
Source: $SourcePath
Total Files Synced: $syncCount
Errors: $errorCount
"@
$versionContent | Out-File (Join-Path $TargetPath "VERSION.txt") -Encoding UTF8

# Step 6: 显示结果
Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor White
Write-Host "📊 同步结果统计:" -ForegroundColor White
Write-Host "   ✅ 成功同步: $syncCount 个文件" -ForegroundColor Green
Write-Host "   ❌ 失败数量: $errorCount 个文件" -ForegroundColor $(if($errorCount -gt 0){"Red"}else{"Green"})
Write-Host "   📍 目标位置: $TargetPath" -ForegroundColor Cyan
Write-Host "   🕐 时间戳: $versionStamp" -ForegroundColor Gray
Write-Host "════════════════════════════════════════════" -ForegroundColor White

if ($errorCount -eq 0) {
    Write-Host "`n🎉 同步完成! 所有文件已成功复制到发布区." -ForegroundColor Green
}
else {
    Write-Host "`n⚠️  同步完成但有错误, 请检查上方失败列表." -ForegroundColor Yellow
}
```

### 4.3 使用方法

```
日常开发流程:

【编辑阶段】(在轨道A-工作区)
1. 打开: C:\...\GlobalReach-Official\
2. 编辑任意 .md 文件
3. 保存

【同步阶段】(执行同步)
1. 打开 PowerShell
2. cd C:\...\GlobalReach-Official\
3. .\sync-to-public.ps1
4. 查看: D:\trae\1海外客户业务拓展-GlobalReach系统\
5. 确认文件已更新

【验证阶段】(确认一致性)
1. 对比两个目录的文件修改时间
2. 或运行 validate-files.ps1 (校验脚本)
```

---

## 🚫 第五章：禁止行为与违规处理

### 5.1 违规清单

```
严重违规 (立即纠正):
❌ 在发布区(B轨道)直接编辑文件
   后果: 下次同步会被覆盖, 修改丢失!
   
❌ 删除工作区的原始文件
   后果: 版本丢失, 无法追溯历史
   
❌ 使用非标准命名创建新文档
   后果: 文件无法被识别和管理
   
❌ 同时在两个位置编辑同一文件
   后果: 产生冲突版本, 造成混乱

中等违规 (本周内纠正):
⚠️ 超过3天未执行同步操作
⚠️ .archive/ 目录超过30天未清理
⚠️ 文件描述(metadata)未更新

轻微违规 (下次注意):
• 注释中使用过时信息
• 文件内部引用了错误的相对路径
```

### 5.2 违规处理流程

```
发现违规时的处理步骤:

Step 1: 立即停止当前操作
Step 2: 评估影响范围 (是否覆盖重要数据?)
Step 3: 恢复策略:
   ├─ 如果是误删 → 从 .archive/ 或发布区恢复
   ├─ 如果是冲突版本 → 保留较新版本, 重命名旧版为 _conflict
   └─ 如果是命名不规范 → 立即重命名为标准格式
Step 4: 记录到 ERROR-LOG (便于复盘)
Step 5: 通知相关方 (如果是多人协作)
Step 6: 更新本规则文件 (如果发现规则漏洞)
```

---

## 📊 第六章：健康检查清单

### 6.1 每日检查 (Daily Check - <2分钟)

```
□ 打开工作区目录, 确认所有9个核心文档存在
□ 检查是否有未命名的新文件 (Temp?)
□ 确认今日编辑的文件已保存
□ (可选) 执行一次同步操作
```

### 6.2 每周检查 (Weekly Check - <10分钟)

```
□ 运行 validate-files.ps1 校验文件完整性
□ 清理 .archive/ 中超过30天的旧版本
□ 检查 CHANGELOG.md 是否需要更新
□ 确认两区(工作区/发布区)文件数量一致
□ 备份整个项目目录到外部存储
```

### 6.3 每月检查 (Monthly Check - <30分钟)

```
□ 全面审查所有文档版本号, 确认是否需要升级
□ 评估目录结构是否需要调整
□ 检查磁盘空间使用情况
□ 回顾本月违规记录, 总结经验教训
□ 更新 FILE-MANAGEMENT-RULES.md 本身 (如果需要优化)
```

---

## 🆘 第七章：特殊情况处理

### 7.1 多人协作场景

```
当团队有多人参与时:

方案A: 主从模式 (推荐)
├─ 只有1人有"写入权" (Owner)
├─ 其他人只有"读取权" (Reviewer)
├─ 修改请求通过 Issue/Comment 提出
└─ Owner 统一修改并同步

方案B: 分区负责
├─ Person A 负责: 01-CORE-DOCUMENTS/
├─ Person B 负责: 03-SKILLS/
├─ Person C 负责: 04-CONFIG/
└─ 各自负责区域的文件在自己分支修改

方案C: Git版本控制 (高级)
├─ 所有文件纳入 Git 管理
├─ 通过 Pull Request 合并修改
├─ 保留完整历史记录
└─ 可回滚到任意版本
```

### 7.2 灾难恢复

```
场景1: 工作区文件损坏/丢失
解决: 从发布区恢复 (它是镜像)
      或从 .archive/ 恢复上一版本

场景2: 两区不一致
解决: 以工作区为准 (它是源头), 重新执行同步

场景3: 整个目录被误删
解决: 从外部备份恢复 (应有定期备份)
      或从Git仓库clone (如果用了Git)

场景4: 文件冲突 (多人同时编辑)
解决: 使用Git merge工具, 或人工对比合并
```

---

## 📝 第八章：附录

### A. 快速参考卡

```
╔════════════════════════════════════════════╗
║   GlobalReach 文件管理速查卡 v1.0           ║
╠════════════════════════════════════════════╣
║                                              ║
║ 📍 工作区(编辑):                           ║
║ C:\...\trae_projects\GlobalReach-Official\ ║
║                                              ║
║ 📍 发布区(查阅):                           ║
║ D:\trae\1海外客户业务拓展-GlobalReach系统\ ║
║                                              ║
║ 🔄 同步命令:                                ║
║ cd GlobalReach-Official                   ║
║ .\sync-to-public.ps1                       ║
║                                              ║
║ 📝 命名格式:                                ║
║ GLOBALREACH_[模块]_[类型]_v[版本].md      ║
║                                              ║
║ 🗂️ 核心文档(9个):                          ║
║ PROPOSAL / CONSTITUTION / MATRIX / SESSION  ║
║ COMMAND / MANUAL / COPY / REPORT / WP       ║
║                                              ║
╚════════════════════════════════════════════╝
```

### B. 文件状态定义

| 状态 | 图标 | 含义 | 操作 |
|------|------|------|------|
| **Draft** | 📝 | 初稿, 正在编写中 | 可自由编辑 |
| **Review** | 👁 | 待审核 | 提交审核 |
| **Active** | ✅ | 当前生效版本 | 只能通过正式流程修改 |
| **Archived** | 📦 | 历史版本 | 只读, 不再编辑 |

### C. 联系与支持

```
遇到文件管理问题?
→ 先查阅本章 FAQ
→ 再检查是否违反命名规范
→ 最后联系项目负责人

紧急情况:
→ 立即停止操作
→ 通知相关人员
→ 从备份恢复
```

---

*规则版本*: v1.0-FINAL  
*生效日期*: 2026-05-09  
*维护者*: AI Assistant (基于 Trae IDE范式体系)  
*下次评审*: 2026-06-09 (一个月后)
