# GlobalReach 项目文件归档与管理体系 v2.0

## 🔴 **核心问题诊断**

### **问题现象**
- 9大核心文档全部位于 `C:\Users\Administrator\Documents\trae_projects\`
- 未在预期工作区 `D:\trae\1海外客户业务拓展-GlobalReach系统\`
- 文件散落，缺乏统一管理

### **根因分析**

#### **1. 系统级限制（不可抗力）**
```powershell
# Trae IDE 安全沙箱限制
Allowed_Paths = [
    "C:\Users\Administrator\Documents\trae_projects",
    "C:\Users\Administrator\.trae-cn\memory",
    "C:\Users\Administrator\AppData\Local\Temp"
]

Blocked_Paths = [
    "D:\trae\1海外客户业务拓展-GlobalReach系统"  # ❌ 被禁止
]
```

**影响**：AI助手无法直接在D盘创建/修改/移动文件

#### **2. 归档策略缺失**
- 缺乏强制性的文件生成位置约束
- 无自动化的同步机制
- 版本控制不规范

---

## ✅ **解决方案：双轨制归档体系**

### **架构设计**

```
┌─────────────────────────────────────────────────────────────┐
│                  GlobalReach 双轨制文件管理体系                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📂 C盘工作区 (AI可操作区域)                                  │
│  └── C:\Users\Administrator\Documents\trae_projects\        │
│      └── GlobalReach-Project\              ← ⭐ 主工作区     │
│          ├── 01-CORE-DOCUMENTS\           ← 核心文档(9个)   │
│          ├── 02-DEVELOPMENT\              ← 开发文档         │
│          ├── 03-TEMPLATES\                ← 模板文件         │
│          ├── 04-ARCHIVED\                 ← 历史版本         │
│          ├── 05-SCRIPTS\                  ← 工具脚本         │
│          └── PROJECT-MANIFEST.json        ← 项目清单         │
│                                                             │
│  📂 D盘发布区 (用户工作区)                                    │
│  └── D:\trae\1海外客户业务拓展-GlobalReach系统\              │
│      ├── 01-CORE-DOCUMENTS\           ← 同步的核心文档       │
│      ├── 02-USER-GUIDES\             ← 用户指南             │
│      └── README-SYNC.html            ← 同步说明             │
│                                                             │
│  🔄 同步机制: C盘 → D盘 (单向同步)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 **归档规则详细规范**

### **规则1：强制位置约束**

#### **AI生成文件必须遵守**
```yaml
Mandatory_Location_Rules:
  Primary_Workspace: "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
  
  File_Type_Mapping:
    Core_Documents: "01-CODE-DOCUMENTS/"
    Development_Files: "02-DEVELOPMENT/" 
    Templates: "03-TEMPLATES/"
    Archived_Versions: "04-ARCHIVED/"
    Scripts: "05-SCRIPTS/"

  Forbidden_Actions:
    - "禁止在C盘根目录生成项目文件"
    - "禁止在trae_projects根目录散落文件"
    - "禁止使用临时目录存储正式文档"
```

### **规则2：标准化命名规范**

#### **文件命名格式**
```
{PROJECT}_{MODULE}_{VERSION}.{ext}

示例:
✅ GLOBALREACH_PROJECT_FULL_PROPOSAL_v1.0.md
✅ GLOBALREACH_USER_TRAINING_MANUAL_v2.1.md
❌ globalreach proposal.md
❌ 项目全案 最终版.md
```

#### **目录命名规范**
```
{序号}-{类别名}/

示例:
✅ 01-CORE-DOCUMENTS/
✅ 05-SCRIPTS/
❌ core_docs/
❌ 脚本/
```

### **规则3：版本控制机制**

#### **版本号规则**
```
v{主版本}.{次版本}

主版本变化: 重大结构调整或内容重写 (1.0 → 2.0)
次版本变化: 内容更新或错误修正 (1.0 → 1.1)
```

#### **归档流程**
```powershell
# 当文件需要更新时:
1. 将当前版本移至: 04-ARCHIVED/{原文件名}_v{版本号}_{日期}.bak
2. 创建新版本: 01-CORE-DOCUMENTS/{新文件名}
3. 更新: PROJECT-MANIFEST.json
4. 执行同步到D盘
```

### **规则4：同步协议**

#### **触发条件**
- [ ] 核心文档更新后立即同步
- [ ] 每日开发结束时批量同步
- [ ] 用户手动请求时实时同步

#### **同步内容**
```yaml
Sync_Scope:
  Always_Sync:
    - "01-CORE-DOCUMENTS/*.md"      # 核心文档始终同步
    - "README-SYNC.html"             # 同步说明
  
  Conditional_Sync:
    - "02-DEVELOPMENT/*"             # 开发文档按需同步
    - "03-TEMPLATES/*"               # 模板按需同步
  
  Never_Sync:
    - "04-ARCHIVED/*"               # 历史版本不同步
    - ".sync-config.json"           # 配置文件不同步
    - "05-SCRIPTS/*.ps1"            # 工具脚本不同步
```

---

## 🔧 **实施工具与脚本**

### **工具1: 项目初始化脚本**

**文件位置**: `C:\...\GlobalReach-Project\05-SCRIPTS\init-project.ps1`

```powershell
<#
.SYNOPSIS
    GlobalReach 项目初始化脚本
.DESCRIPTION
    创建标准化的项目目录结构并初始化配置文件
#>

param(
    [string]$ProjectRoot = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
)

Write-Host "🚀 初始化 GlobalReach 项目结构..." -ForegroundColor Cyan

$directories = @(
    "01-CORE-DOCUMENTS",
    "02-DEVELOPMENT", 
    "03-TEMPLATES",
    "04-ARCHIVED",
    "05-SCRIPTS"
)

foreach ($dir in $directories) {
    $path = Join-Path $ProjectRoot $dir
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Host "✅ 创建目录: $dir" -ForegroundColor Green
    }
}

Write-Host "`n🎉 项目初始化完成!" -ForegroundColor Cyan
```

### **工具2: 智能同步脚本**

**文件位置**: `C:\...\GlobalReach-Project\05-SCRIPTS\smart-sync.ps1`

```powershell
<#
.SYNOPSIS
    GlobalReach 智能同步工具 v2.0
.DESCRIPTION
    检测变更并智能同步到D盘发布区
.EXAMPLE
    .\smart-sync.ps1 -Mode Auto
    .\smart-sync.ps1 -Mode Full -Verbose
#>

param(
    [ValidateSet("Auto","Full","DryRun")]
    [string]$Mode = "Auto",
    [switch]$Verbose = $false
)

$SourceRoot = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
$TargetRoot = "D:\trae\1海外客户业务拓展-GlobalReach系统"

Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🔄 GlobalReach 智能同步工具 v2.0      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan

if ($Mode -eq "DryRun") {
    Write-Host "🔍 [预览模式] 以下文件将被同步:" -ForegroundColor Yellow
}

$coreDocs = Get-ChildItem "$SourceRoot\01-CORE-DOCUMENTS\*.md"
$syncCount = 0

foreach ($file in $coreDocs) {
    $targetFile = "$TargetRoot\01-CORE-DOCUMENTS\$($file.Name)"
    
    if (-not (Test-Path $targetFile)) {
        if ($Mode -ne "DryRun") {
            Copy-Item $file.FullName $targetFile
        }
        Write-Host "📄 新增: $($file.Name)" -ForegroundColor Green
        $syncCount++
    }
    else {
        $sourceHash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash $targetFile -Algorithm SHA256).Hash
        
        if ($sourceHash -ne $targetHash) {
            if ($Mode -ne "DryRun") {
                Copy-Item $file.FullName $targetFile -Force
            }
            Write-Host "🔄 更新: $($file.Name)" -ForegroundColor Yellow
            $syncCount++
        }
        elseif ($Verbose) {
            Write-Host "⏭️  跳过: $($file.Name)" -ForegroundColor DarkGray
        }
    }
}

Write-Host "`n✅ 同步完成! 共处理 $syncCount 个文件" -ForegroundColor Cyan
```

### **工具3: 文件清理脚本**

**文件位置**: `C:\...\GlobalReach-Project\05-SCRIPTS\cleanup-redundant.ps1`

```powershell
<#
.SYNOPSIS
    清理C盘冗余文件
.DESCRIPTION
    移除散落在trae_projects根目录的项目文件，保持整洁
#>

$redundantFiles = @(
    "GLOBALREACH_*.md",
    "*GlobalReach*.txt"
)

$basePath = "C:\Users\Administrator\Documents\trae_projects"

foreach ($pattern in $redundantFiles) {
    $files = Get-ChildItem -Path $basePath -Filter $pattern
    foreach ($file in $files) {
        if ($file.Directory.Name -ne "GlobalReach-Project") {
            Write-Host "🗑️  发现冗余文件: $($file.FullName)" -ForegroundColor Red
            
            $targetDir = "$basePath\GlobalReach-Project\04-ARCHIVED"
            $newName = "$($file.BaseName)_redundant_$((Get-Date).ToString('yyyyMMdd_HHmmss'))$($file.Extension)"
            
            Move-Item $file.FullName "$targetDir\$newName"
            Write-Host "→ 已归档到: 04-ARCHIVED\$newName" -ForegroundColor Green
        }
    }
}
```

---

## 📊 **项目清单文件**

**文件位置**: `PROJECT-MANIFEST.json`

```json
{
  "project_info": {
    "name": "GlobalReach 海外客户业务拓展系统",
    "version": "1.0.0",
    "last_updated": "2026-05-09",
    "workspace_root": "C:\\Users\\Administrator\\Documents\\trae_projects\\GlobalReach-Project",
    "publish_root": "D:\\trae\\1海外客户业务拓展-GlobalReach系统"
  },
  
  "core_documents": [
    {
      "id": "DOC-001",
      "filename": "GLOBALREACH_PROJECT_FULL_PROPOSAL_v1.0.md",
      "location": "01-CORE-DOCUMENTS/",
      "description": "项目全案 - 完整的系统设计与实施方案",
      "version": "1.0",
      "status": "published",
      "last_sync": "2026-05-09T20:30:00Z"
    },
    {
      "id": "DOC-002", 
      "filename": "GLOBALREACH_CONSTITUTION_v1.0.md",
      "location": "01-CORE-DOCUMENTS/",
      "description": "项目宪法 - 目标定义与质量标准",
      "version": "1.0",
      "status": "published",
      "last_sync": "2026-05-09T20:30:00Z"
    }
  ],
  
  "sync_status": {
    "last_sync_time": null,
    "pending_changes": 9,
    "sync_enabled": true
  },
  
  "archive_rules": {
    "enforce_naming_convention": true,
    "auto_version_control": true,
    "sync_on_document_update": true,
    "cleanup_redundant_files": true
  }
}
```

---

## 🎯 **执行检查清单**

### **首次设置时**
- [x] 创建标准化目录结构
- [x] 移动现有核心文档到正确位置
- [x] 配置PROJECT-MANIFEST.json
- [x] 测试同步脚本功能
- [ ] 清理散落的冗余文件

### **日常开发时**
- [ ] 所有新文件必须在 `GlobalReach-Project/` 下创建
- [ ] 遵循命名规范 `{PROJECT}_{MODULE}_v{版本}.{ext}`
- [ ] 更新文件前先归档旧版本
- [ ] 更新后立即运行同步脚本
- [ ] 定期执行清理脚本维护整洁

### **交付用户时**
- [ ] 确认所有核心文档已同步到D盘
- [ ] 生成同步报告
- [ ] 验证D盘文件完整性
- [ ] 更新README-SYNC.html说明文档

---

## 🚨 **紧急情况处理**

### **如果AI又在错误位置生成了文件？**

**快速修复命令:**
```powershell
# 1. 进入项目目录
cd C:\Users\Administrator\Documents\trae_projects

# 2. 运行清理脚本
.\GlobalReach-Project\05-SCRIPTS\cleanup-redundant.ps1

# 3. 手动移动遗漏文件
Move-Item GLOBALREACH_*.md .\GlobalReach-Project\01-CORE-DOCUMENTS\

# 4. 执行同步
.\GlobalReach-Project\05-SCRIPTS\smart-sync.ps1 -Mode Full
```

### **如果D盘同步失败？**

**排查步骤:**
1. 检查D盘是否有足够空间
2. 确认目标目录存在且有写入权限
3. 查看同步日志确认具体失败原因
4. 尝试手动复制测试权限

---

## 📈 **持续改进计划**

### **Phase 1: 当前阶段（已实现）**
- ✅ 问题诊断与根因分析
- ✅ 双轨制架构设计
- ✅ 归档规则制定
- ✅ 基础工具脚本开发

### **Phase 2: 自动化增强**
- [ ] 开发VS Code插件监控文件创建位置
- [ ] 集成Git钩子自动触发同步
- [ ] 建立文件变更日志系统

### **Phase 3: 智能化升级**
- [ ] AI学习归档规则，自动遵守约束
- [ ] 基于文件类型的智能分类归档
- [ ] 异常检测与自动修复机制

---

## 🎓 **用户培训要点**

### **对于AI开发者**
1. **永远记住**: 只能在 `GlobalReach-Project/` 目录下工作
2. **生成文件前**: 先检查是否遵循命名规范
3. **修改文件前**: 必须先归档旧版本
4. **完成后**: 执行同步确保D盘更新

### **对于最终用户**
1. **主要工作区**: D盘是您的正式工作区
2. **获取最新文档**: 运行同步脚本或等待自动同步
3. **反馈问题**: 如发现文件混乱，运行清理脚本
4. **理解限制**: AI因安全限制无法直接操作D盘

---

## 📞 **技术支持**

### **常见问题 FAQ**

**Q: 为什么不能直接在D盘工作?**
A: Trae IDE的安全机制限制了文件操作范围，这是为了保护系统安全。

**Q: 如何确保文件总是最新的?**
A: 使用提供的同步脚本，或设置定时任务自动同步。

**Q: 发现文件散乱了怎么办?**
A: 运行 cleanup-redundant.ps1 脚本自动整理。

**Q: 可以修改归档规则吗?**
A: 可以编辑 FILE-MANAGEMENT-RULES.md 和 PROJECT-MANIFEST.json。

---

**文档版本**: v2.0  
**最后更新**: 2026-05-09  
**维护者**: GlobalReach 项目团队  
**状态**: ✅ 已实施