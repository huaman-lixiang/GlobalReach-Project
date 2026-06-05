# 🚀 GlobalReach v1.0 SESSION_START 自执行协议 (标准执行文件)

> **文件类型**: SESSION_START_PROTOCOL (活协议)  
> **版本**: v1.0-INITIAL  
> **前置条件**: 已阅读 CONSTITUTION_v1.0.md + COMPLETENESS_MATRIX_100_v1.0.md  
> **目标**: 从0%完整度提升至100%，打造AI驱动的海外商务拓展智能体系统  
> **预估工期**: Phase 1(2周) + Phase 2(2周) + Phase 3(2周) + Phase 4(2周) = **8周**  

---

## ⚡ 快速启动检查清单

### 启动前必读 (2分钟)

```
□ 已读取: CONSTITUTION_v1.0.md (了解全域目标和质量标准)
□ 已读取: COMPLETENESS_MATRIX_100_v1.0.md (了解127个功能点和路线图)
□ 确认工作区根路径: D:\GlobalReach\ (或自定义路径)
□ 确认Node.js已安装 (node --version 显示 ^18)
□ 确认PowerShell 7+已安装 (pwsh --version)
```

---

## 📊 当前系统状态快照

### 项目进度指标 (2026-05-09)

| 指标 | 当前值 | 目标值 | 差距 | 状态 |
|------|--------|--------|------|------|
| **整体完整度** | **0%** ❌ | **100%** | -100% | 🔴 项目启动 |
| **Phase 1 (数据基础)** | 0% | 25% | -25% | ⏳ 待开始 |
| **Phase 2 (核心Skill)** | 0% | 65% | -65% | ⏳ 待开始 |
| **Phase 3 (学习系统)** | 0% | 85% | -85% | ⏳ 待开始 |
| **Phase 4 (联调优化)** | 0% | 100% | -100% | ⏳ 待开始 |

### 功能模块完成度

| 模块 | 功能点总数 | 已完成 | 完成度 | 状态 |
|------|----------|--------|-------|------|
| M1: 邮箱管理 | 7 | 0 | **0%** | 🔴 未开始 |
| M2: 发送引擎 | 10 | 0 | **0%** | 🔴 未开始 |
| M3: 回复收集 | 8 | 0 | **0%** | 🔴 未开始 |
| M4: 邮件撰写 | 9 | 0 | **0%** | 🔴 未开始 |
| M5: 记忆系统 | 7 | 0 | **0%** | 🔴 未开始 |
| M6: 蒸馏机制 | 9 | 0 | **0%** | 🔴 未开始 |
| **Skill系统** | **54** | **0** | **0%** | 🔴 未开始 |
| **安全合规** | **7** | **0** | **0%** | 🔴 未开始 |
| **总计** | **127** | **0** | **0%** | 🔴 启动阶段 |

### 质量门禁状态

| 门禁项 | 当前值 | 目标值 | 状态 |
|--------|--------|--------|------|
| 邮件发送成功率 | N/A | ≥99.5% | ⏸️ 待验证 |
| 数据加密强度 | N/A | AES-256-GCM | ⏸️ 待验证 |
| 备份完整性 | N/A | 100% | ⏸️ 待验证 |
| 日志审计覆盖率 | N/A | 100% | ⏸️ 待验证 |

---

## 🎯 执行路线图 (四阶段)

### Phase 1: 数据基础建设 (Week 1-2) ⭐ 当前阶段

#### 目标
- 整体完整度: 0% → **25%**
- 建立完整的工作区目录结构
- 导入80个邮箱账号配置
- 导入8000条客户数据
- 建立产品知识库初始版本

---

#### Task 1-1: 创建工作区目录结构

**预估工时**: 2小时  
**优先级**: 🔴 P0  
**依赖**: 无  

**具体步骤**:

```powershell
# 在 PowerShell 中执行 (管理员权限)

# Step 1: 定义根目录
$rootPath = "D:\GlobalReach"

# Step 2: 创建主工作区目录
$workspaceDirs = @(
    "workspace\inbox",
    "workspace\outbox", 
    "workspace\reports",
    "workspace\replies",
    "workspace\drafts"
)

# Step 3: 创建数据层目录
$dataDirs = @(
    "data\clients\by-email-account\account-001\profiles",
    "data\clients\by-email-account\account-001\history",
    "data\clients\archived",
    "data\products\categories\rc-toys\items",
    "data\products\materials",
    "data\products\templates",
    "data\email-accounts"
)

# Step 4: 创建Skill插件目录
$skillDirs = @(
    "skills\business-email-writer",
    "skills\email-scheduler",
    "skills\inbox-monitor",
    "skills\reply-analyzer",
    "skills\daily-reporter",
    "skills\skill-distiller",
    "skills\client-profiler",
    "skills\product-parser"
)

# Step 5: 创建记忆系统目录
$memoryDirs = @(
    ".memory\working",
    ".memory\episodic\emails\2026",
    ".memory\episodic\interactions",
    ".memory\episodic\events",
    ".memory\semantic"
)

# Step 6: 创建安全模块目录
$securityDirs = @(
    ".security\keys",
    ".security\logs",
    ".security\backups\daily"
)

# Step 7: 创建调度系统目录
$schedulerDirs = @(
    ".scheduler\tasks",
    ".scheduler\queues",
    ".scheduler\history"
)

# Step 8: 执行创建
allDirs = $workspaceDirs + $dataDirs + $skillDirs + $memoryDirs + $securityDirs + $schedulerDirs

foreach ($dir in allDirs) {
    $fullPath = Join-Path $rootPath $dir
    if (!(Test-Path $fullPath)) {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        Write-Host "✓ Created: $dir" -ForegroundColor Green
    }
}

Write-Host "`n🎉 目录结构创建完成!" -ForegroundColor Cyan
```

**验收标准**:
- [ ] `D:\GlobalReach\` 根目录存在
- [ ] 所有子目录创建成功（共50+个）
- [ ] `.memory/`, `.security/`, `.scheduler/` 设置为隐藏属性

---

#### Task 1-2: 初始化配置文件

**预估工时**: 3小时  
**优先级**: 🔴 P0  
**依赖**: Task 1-1  

**具体步骤**:

```yaml
# 创建 .config/config.yaml

project:
  name: "GlobalReach"
  code_name: "全球触达"
  version: "1.0.0"
  environment: "development"  # development / production
  root_path: "D:\\GlobalReach"

security:
  encryption_algorithm: "AES-256-GCM"
  key_location: ".security/keys/master.key"
  audit_log_enabled: true
  session_timeout_minutes: 30
  
email_system:
  total_accounts: 80
  accounts_config_path: "data/email-accounts/accounts.json"
  
  rate_limiting:
    seconds_between_emails: 3
    max_emails_per_account_per_day: 100
    max_concurrent_connections: 10
    
  supported_providers:
    - provider: "gmail"
      imap_host: "imap.gmail.com"
      imap_port: 993
      smtp_host: "smtp.gmail.com"
      smtp_port: 587
      
    - provider: "outlook"
      imap_host: "outlook.office365.com"
      imap_port: 993
      smtp_host: "smtp.office365.com"
      smtp_port: 587
      
    - provider: "qq"
      imap_host: "imap.qq.com"
      imap_port: 993
      smtp_host: "smtp.qq.com"
      smtp_port: 465
      
    - provider: "163"
      imap_host: "imap.163.com"
      imap_port: 993
      smtp_host: "smtp.163.com"
      smtp_port: 465

scheduling:
  timezone: "Asia/Shanghai"
  sending_hours:
    start: "09:00"
    end: "17:00"
    
  monitoring:
    check_interval_hours: 2
    monitoring_window_start: "08:00"
    monitoring_window_end: "22:00"
    
  reporting:
    daily_report_time: "22:30"
    backup_time: "02:00"

distillation:
  enabled: true
  interval_days: 3
  match_threshold: 0.95
  
  evaluation_weights:
    content_completeness: 0.30
    language_style: 0.25
    structure_layout: 0.20
    cta_effectiveness: 0.15
    personalization: 0.10

languages:
  default: "en"
  supported:
    - code: "en"
      name: "English"
      
    - code: "es"
      name: "Spanish"
      
    - code: "fr"
      name: "French"
      
    - code: "ar"
      name: "Arabic"
      
    - code: "de"
      name: "German"

logging:
  level: "info"
  retain_days: 90
  paths:
    application: ".logs/app.log"
    errors: ".logs/errors.log"
    security: ".security/logs/security.log"
```

**验收标准**:
- [ ] config.yaml 文件存在且格式正确
- [ ] YAML语法校验通过 (`yamllint .config/config.yaml`)
- [ ] 所有必需配置项都已填写

---

#### Task 1-3: 配置80个邮箱账号

**预估工时**: 8小时  
**优先级**: 🔴 P0  
**依赖**: Task 1-2  

**具体步骤**:

```json
// 创建 data/email-accounts/accounts.json

{
  "version": "1.0",
  "last_updated": "2026-05-09T00:00:00Z",
  "accounts": [
    {
      "id": "account-001",
      "provider": "gmail",
      "email": "user001@gmail.com",
      "password_encrypted": "<AES-256-ENCRYPTED-PASSWORD>",
      "smtp_user": "user001@gmail.com",
      "smtp_pass_encrypted": "<AES-256-ENCRYPTED-SMTP-PASS>",
      "client_count": 100,
      "assigned_clients_range": ["CLT-00001", "CLT-00100"],
      "status": "active",
      "daily_sent_count": 0,
      "last_sent_at": null,
      "notes": "主要面向北美市场"
    },
    // ... 重复至 account-080
    {
      "id": "account-080",
      "provider": "enterprise",
      "email": "sales080@company.com",
      "password_encrypted": "<AES-256-ENCRYPTED-PASSWORD>",
      // ... 其他字段
    }
  ],
  "statistics": {
    "total_accounts": 80,
    "active_accounts": 80,
    "total_client_capacity": 8000,
    "providers_breakdown": {
      "gmail": 20,
      "outlook": 15,
      "enterprise": 25,
      "qq": 10,
      "163": 10
    }
  }
}
```

**重要提示**:
- ⚠️ 密码必须使用AES-256加密存储，禁止明文！
- ⚠️ 实际部署时需要使用安全的方式输入密码（如环境变量或交互式输入）

**验收标准**:
- [ ] accounts.json 文件包含80个邮箱配置
- [ ] 所有密码字段均为加密格式
- [ ] provider分布合理（覆盖5种服务商）
- [ ] 总容量=80×100=8000客户

---

#### Task 1-4: 导入客户数据库

**预估工时**: 12小时  
**优先级**: 🔴 P0  
**依赖**: Task 1-1, 1-3  

**具体步骤**:

```javascript
// 创建客户数据导入工具 scripts/import-clients.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 客户档案JSON Schema
function createClientTemplate(accountId, index) {
  return {
    clientId: `CLT-${String(index).padStart(5, '0')}`,
    emailAccount: accountId,
    
    basicInfo: {
      name: "",                    // 从Excel导入
      email: "",                   // 从Excel导入
      company: "",                // 从Excel导入
      website: "",
      country: "",               // 必填: 国家代码 (US/CN/DE等)
      timezone: "",              // 自动映射
      language: "en",            // 默认英语
    },
    
    businessProfile: {
      clientLevel: "C",          // A/B/C (后续自动升级)
      purchaseCategory: [],       // toys/daily-products/mixed
      estimatedVolume: "small",   // small/medium/large
      firstContactExhibition: "", // 来源展会
      lastContactDate: null,
      status: "sleeping",        // active/sleeping/churned
      preferredContactTime: "",  // AI学习后填充
    },
    
    communicationHistory: {
      totalEmailsSent: 0,
      totalRepliesReceived: 0,
      lastReplyDate: null,
      replyRate: 0,
      lastReplyIntent: null
    },
    
    aiInsights: {
      bestSendingDay: null,
      optimalTime: null,
      responsePattern: null,
      interestProducts: [],
      stylePreference: null,
      lastDistillMatchScore: 0
    },
    
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      dataHash: ""
    }
  };
}

// Excel导入函数 (使用xlsx库)
async function importFromExcel(excelPath, outputDir) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`📊 从 ${excelPath} 导入 ${data.length} 条客户记录`);
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const accountId = row['邮箱账号'] || 'account-001';
    const client = createClientTemplate(accountId, i + 1);
    
    // 映射Excel列到JSON字段
    client.basicInfo.name = row['客户姓名'] || '';
    client.basicInfo.email = row['邮箱地址'] || '';
    client.basicInfo.company = row['公司名称'] || '';
    client.basicInfo.country = row['国家'] || 'UNKNOWN';
    client.basicInfo.timezone = mapCountryToTimezone(client.basicInfo.country);
    client.businessProfile.firstContactExhibition = row['首次接触展会'] || '';
    
    // 计算数据哈希
    client.metadata.dataHash = hashObject(client);
    
    // 写入JSON文件
    const filename = `${client.clientId}.json`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(client, null, 2), 'utf-8');
  }
  
  console.log(`✅ 导入完成!`);
}

// 时区映射函数
function mapCountryToTimezone(countryCode) {
  const tzMap = {
    'US': 'America/New_York',
    'GB': 'Europe/London',
    'DE': 'Europe/Berlin',
    'FR': 'Europe/Paris',
    'ES': 'Europe/Madrid',
    'BR': 'America/Sao_Paulo',
    'JP': 'Asia/Tokyo',
    'CN': 'Asia/Shanghai',
    // ... 更多国家
  };
  return tzMap[countryCode] || 'UTC';
}

// 对象哈希函数
function hashObject(obj) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .substring(0, 16);
}

module.exports = { importFromExcel, createClientTemplate };
```

**验收标准**:
- [ ] 成功导入至少100条测试客户数据
- [ ] 每个客户JSON符合Schema定义
- [ ] country字段必填且有效
- [ ] timezone字段自动正确映射
- [ ] dataHash字段生成正确

---

#### Task 1-5: 建立产品知识库初始版本

**预估工时**: 4小时  
**优先级**: 🔴 P0  
**依赖**: Task 1-1  

**具体步骤**:

```json
// 创建 data/products/categories/rc-toys/items/product-001.json

{
  "productId": "PRD-001",
  "category": "rc-toys",
  "subcategory": "remote-control",
  
  "basicInfo": {
    "name": "RC Racing Car Model X1",
    "nameZh": "遥控赛车模型X1",
    "brand": "ToyMaster",
    "sku": "TM-RC-X1-2026",
    "version": "2026-Q2",
    "releaseDate": "2026-06-01"
  },
  
  "specifications": {
    "material": "ABS Plastic + Electronic Components",
    "dimensions": "32cm x 14cm x 8cm",
    "weight": "450g",
    "ageRange": "8-14 years",
    "battery": "Rechargeable Li-ion (included)",
    "remoteRange": "50 meters",
    "speed": "Up to 15 km/h",
    "colorsAvailable": ["Red", "Blue", "Green"]
  },
  
  "pricing": {
    "moq": "500 pcs",
    "priceRange": "$3.50 - $5.00 FOB",
    "paymentTerms": "T/T 30% deposit, 70% before shipment",
    "leadTime": "25-30 days after order confirmed",
    "packaging": "Color box + Master carton (24pcs/carton)"
  },
  
  "sellingPoints": [
    "High-speed racing experience with realistic design",
    "Durable ABS material passes EN71 safety standards",
    "Long-lasting battery (2 hours continuous play)",
    "Easy to control - suitable for beginners",
    "Competitive pricing with premium quality"
  ],
  
  "targetMarkets": {
    "primary": ["North America", "Western Europe"],
    "secondary": ["South America", "Middle East"],
    "seasonalDemand": ["Q3 (Back to School)", "Q4 (Christmas)"]
  },
  
  "multimedia": {
    "images": [],
    "videoUrl": "",
    "catalogPdf": "products/materials/catalog-q2-2026.pdf"
  },
  
  "aiGeneratedContent": {
    "shortDescriptionEn": "Experience the thrill of high-speed racing with our RC Racing Car X1! Designed for young racers aged 8-14, this durable remote-controlled car features realistic styling, long-lasting battery life, and easy-to-use controls. Perfect for both indoor and outdoor fun.",
    "shortDescriptionZh": "体验高速赛车的刺激！我们的遥控赛车X1专为8-14岁年轻赛车手设计，采用耐用材料、长效电池和易用控制。室内外皆宜的完美选择。",
    "keywords": ["RC car", "racing toy", "remote control", "kids toy", "gift idea"]
  },
  
  "metadata": {
    "createdAt": "2026-05-09T00:00:00Z",
    "updatedAt": "2026-05-09T00:00:00Z",
    "status": "active"
  }
}
```

**验收标准**:
- [ ] 至少建立5个产品档案（覆盖不同品类）
- [ ] 每个产品包含完整的specifications和pricing信息
- [ ] sellingPoints至少3条且有说服力
- [ ] aiGeneratedContent字段预填中英文描述

---

## 🔄 Phase 1 任务清单汇总

| Task ID | 任务名称 | 预估工时 | 依赖 | 优先级 | 状态 |
|---------|---------|---------|------|--------|------|
| **1-1** | 创建工作区目录结构 | 2h | 无 | P0 | ⏳ 待开始 |
| **1-2** | 初始化配置文件(config.yaml) | 3h | 1-1 | P0 | ⏳ 待开始 |
| **1-3** | 配置80个邮箱账号 | 8h | 1-2 | P0 | ⏳ 待开始 |
| **1-4** | 导入客户数据库 | 12h | 1-1, 1-3 | P0 | ⏳ 待开始 |
| **1-5** | 建立产品知识库初始版 | 4h | 1-1 | P0 | ⏳ 待开始 |

**Phase 1 总计**: **29小时 (约4个工作日)** → 目标完整度 **25%**

---

## 📝 Session交付模板

每次开发Session结束时请填写:

```markdown
## Session 交付报告

**日期**: YYYY-MM-DD  
**Session时长**: X小时  
**当前Phase**: Phase 1 (数据基础建设)  
**整体完整度**: XX% → YY% (+Z%)

### 本次完成的Task
- [x] Task X-Y: 任务名称 (耗时Xh)
  - 产出物: 文件列表
  - 遇到的问题及解决方案: ...

### 质量检查结果
- [ ] 配置文件YAML校验通过
- [ ] JSON Schema验证通过
- [ ] 目录结构完整性确认
- [ ] 安全性检查(权限/加密)

### 下一步计划
- 推荐Task: Task X-Z (原因...)
- 预估工时: Xh
- 阻塞项: 无 / 有(说明...)

### 经验教训
- ✅ 成功经验: ...
- ⚠️ 踩坑记录: ...
- 💡 改进建议: ...
```

---

## 📚 关联文档索引

| 文档 | 相对路径 | 用途 |
|------|---------|------|
| **项目宪法** | CONSTITUTION_v1.0.md | 全域对齐目标和质量标准 |
| **完整度矩阵** | COMPLETENESS_MATRIX_100_v1.0.md | 127个功能点+进度跟踪 |
| **项目全案** | GLOBALREACH_PROJECT_FULL_PROPOSAL_v1.0.md | 详细规划文档 |
| **终极启动指令** | ULTIMATE_START_COMMAND_v1.0.md | 跨对话框无缝衔接 |

---

## ✅ 协议生效声明

```
本SESSION_START协议自 2026-05-09 起正式生效。

所有参与"GlobalReach"项目的AI助手,
都必须以本协议作为每日开发的执行指南。

当出现冲突时, 优先级顺序:
1. CONSTITUTION_v1.0.md (最高)
2. 本 SESSION_START.md
3. COMPLETENESS_MATRIX_100_v1.0.md
4. Trae IDE开发范式体系 v2.0

维护者: AI Assistant (Trae IDE)
最后更新: 2026-05-09
Session计数: #001 (首次初始化)
```

---

**💡 使用提示**:
- 本文件是**活协议(Living Protocol)**, 每次Session结束后更新
- 请在每次新对话开始时读取此文件恢复上下文
- 完成任务后及时更新COMPLETENESS_MATRIX中的进度
