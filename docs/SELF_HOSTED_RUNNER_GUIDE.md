# GlobalReach V2.0 Self-hosted Runner 部署指南

> **任务编号**: M-E01 | **版本**: 1.0 | **日期**: 2026-06-09

---

## 目录

1. [为什么需要 Self-hosted Runner?](#1-为什么需要-self-hosted-runner)
2. [前置条件](#2-前置条件)
3. [注册 Runner (Windows 版)](#3-注册-runner-windows-版)
4. [Runner 标签管理](#4-runner-标签管理)
5. [CI/CD Workflow 适配](#5-cicd-workflow-适配)
6. [Runner 安全最佳实践](#6-runner-安全最佳实践)
7. [监控和维护](#7-监控和维护)
8. [故障排查](#8-故障排查)

---

## 1. 为什么需要 Self-hosted Runner?

### GitHub-hosted Runner 的限制

| 维度 | GitHub-hosted | Self-hosted |
|------|--------------|-------------|
| **免费额度** | 2,000 分钟/月（公共仓库无限） | 无限制 |
| **自定义环境** | 固定 OS 镜像，无法预装私有依赖 | 完全可控 |
| **构建速度** | 取决于 GitHub 调度队列 | 本地网络直连，更快 |
| **安全性** | 代码在 GitHub 基础设施上运行 | 代码不离开自有服务器 |
| **资源控制** | 2-7 CPU / 7-28 GB RAM（按类型） | 按需配置 |
| **Docker 支持** | 内置但有限制 | 完整 Docker 权限 |

### GlobalReach V2.0 使用 Self-hosted Runner 的理由

- **免费额度不足**: 当前 CI/CD 流水线有 7 个 Job（quality-gate, unit-tests, docker-build, deploy, notify, security-scan, backup-verification），每次完整运行约消耗 15-25 分钟
- **Docker 构建需求**: docker-build job 需要 Docker Buildx + GHCR 推送权限
- **安全合规**: 企业级项目要求代码不离开受控环境
- **预装依赖**: Node.js 24.x、Docker、Trivy 等工具可预装，减少 setup 时间

---

## 2. 前置条件

### 硬件要求

| 配置项 | 最低要求 | 推荐配置 |
|--------|---------|---------|
| **CPU** | 2 核心 | 4+ 核心 |
| **内存** | 4 GB RAM | 8+ GB RAM |
| **磁盘** | 20 GB 可用空间 | 50+ GB SSD |
| **网络** | 稳定的互联网连接 | 低延迟连接到 GitHub |

### 软件要求

```powershell
# Windows Server 2019 / 2022 或 Windows 10/11 Pro+
# PowerShell 5.1+ (推荐 PowerShell 7.x)
# .NET Framework 4.8+ (Runner 依赖)
# Docker Desktop for Windows (可选，用于 docker-build job)
```

### 权限要求

- GitHub 仓库的 **admin** 权限（用于创建和管理 Runner Token）
- 服务器的 **管理员** 权限（用于安装 Windows Service）

---

## 3. 注册 Runner (Windows 版)

### Step 1: 在 GitHub 上创建 Runner Token

1. 打开 GitHub 仓库页面
2. 进入 **Settings** → **Actions** → **Runners**
3. 点击 **New self-hosted runner**
4. 选择操作系统: **Windows**
5. 选择架构: **x64** 或 **arm64**
6. 复制生成的 **Token** 和下载命令

> ⚠️ Token 仅显示一次！请妥善保存。

### Step 2: 下载并配置 Runner

```powershell
# === 方法 A: 手动操作 ===

# 创建 Runner 安装目录
$RUNNER_HOME = "C:\actions-runner"
New-Item -ItemType Directory -Path $RUNNER_HOME -Force | Out-Null
Set-Location $RUNNER_HOME

# 下载最新版 Runner (从 GitHub Releases)
# 替换 <VERSION> 为最新版本号, 如: 2.321.0
$RUNNER_VERSION = "2.321.0"
Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-win-x64-${RUNNER_VERSION}.zip" -OutFile "actions-runner.zip"

# 解压
Expand-Archive -Path "actions-runner.zip" -DestinationPath "." -Force

# 配置并注册 Runner
# 替换以下变量:
#   <REPO_URL>   = https://github.com/<owner>/<repo>
#   <TOKEN>      = 从 GitHub Settings > Actions > Runners 获取的 Token
#   <NAME>       = 自定义 Runner 名称 (如: globalreach-win-prod-01)
#   <LABELS>     = 自定义标签 (如: globalreach-docker,windows,self-hosted)
.\config.cmd --url https://github.com/<owner>/<repo> `
             --token <TOKEN> `
             --name globalreach-win-prod-01 `
             --labels globalreach-docker,windows,self-hosted `
             --work _work `
             --unattended `
             --replace
```

### Step 3: 作为 Windows Service 安装

```powershell
# === 方法 A: 使用内置 Service 安装器 (推荐) ===
.\svc install

# 启动服务
.\svc start

# 验证服务状态
Get-Service actions.runner.*

# === 方法 B: 使用 NSSM (Non-Sucking Service Manager) ===
# 适用于需要更精细控制的场景

# 1. 下载 NSSM: https://nssm.cc/download
# 2. 安装为服务:
nssm install ActionsRunner "$RUNNER_HOME\run.cmd"
nssm set ActionsRunner AppDirectory "$RUNNER_HOME"
nssm set ActionsRunner DisplayName "GitHub Actions Runner - GlobalReach"
nssm set ActionsRunner Description "Self-hosted runner for GlobalReach V2.0 CI/CD"
nssm set ActionsRunner Start SERVICE_AUTO_START
nssm set ActionsRunner AppStdout "$RUNNER_HOME\logs\stdout.log"
nssm set ActionsRunner AppStderr "$RUNNER_HOME\logs\stderr.log"

# 启动
nssm start ActionsRunner
```

### Step 4: 验证 Runner 在线状态

```powershell
# 在 GitHub 仓库 Settings > Actions > Runners 页面查看
# 应该看到你的 Runner 显示为 "Idle" (空闲) 状态

# 或使用 API 查询:
curl -s -H "Authorization: token <YOUR_GITHUB_PAT>" \
     https://api.github.com/repos/<owner>/<repo>/actions/runners | ConvertFrom-Json | Select-Object -ExpandProperty runners | Format-Table name, status, labels
```

---

## 4. Runner 标签管理

### 推荐标签体系

| 标签名称 | 用途 | 适用场景 |
|----------|------|---------|
| `self-hosted` | 必须标签 | 所有 self-hosted runner 都需要 |
| `windows` | 操作系统标识 | Windows Server 环境 |
| `globalreach-docker` | 有 Docker 环境 | docker-build, security-scan jobs |
| `globalreach-build` | 仅用于构建 | quality-gate, unit-tests jobs |
| `globalreach-deploy` | 有 SSH 密钥访问 | deploy job |

### 标签在 Workflow 中的使用方式

```yaml
# 单个 Job 指定特定 Runner
jobs:
  build:
    # 使用有 Docker 环境的 Windows Runner
    runs-on: [self-hosted, windows, globalreach-docker]
    steps:
      ...

  test:
    # 使用轻量构建 Runner
    runs-on: [self-hosted, windows, globalreach-build]
    steps:
      ...
```

### 混合策略: GitHub-hosted + Self-hosted

```yaml
jobs:
  # 安全扫描仍用 GitHub-hosted (隔离环境更好)
  security-scan:
    runs-on: ubuntu-latest
    steps: ...

  # 构建和部署用 self-hosted (更快 + Docker)
  docker-build:
    runs-on: [self-hosted, windows, globalreach-docker]
    steps: ...
```

---

## 5. CI/CD Workflow 适配

### 如何修改 ci-cd.yml 使用 self-hosted runner

当前 `.github/workflows/ci-cd.yml` 中所有 Job 使用 `runs-on: ubuntu-latest`。切换步骤:

#### 5.1 逐 Job 切换 (推荐渐进式迁移)

```yaml
# === 原始配置 (GitHub-hosted) ===
# quality-gate:
#   runs-on: ubuntu-latest

# === 改为 self-hosted ===
quality-gate:
  name: Quality Gate
  # 取消下方注释以使用 self-hosted runner
  # runs-on: [self-hosted, windows, globalreach-build]
  # 当前仍使用 GitHub-hosted:
  runs-on: ubuntu-latest
  steps:
    ...
```

#### 5.2 全量切换 (一次性迁移所有 Jobs)

```yaml
# 将以下替换应用到每个 job 的 runs-on 字段:
#
# Job 映射表:
# ┌─────────────────────┬──────────────────────────────────────────┐
# │ Job                  │ 推荐的 self-hosted label 组合           │
# ├─────────────────────┼──────────────────────────────────────────┤
# │ quality-gate        │ [self-hosted, windows, globalreach-build] │
# │ unit-tests          │ [self-hosted, windows, globalreach-build] │
# │ docker-build        │ [self-hosted, windows, globalreach-docker]│
# │ deploy              │ [self-hosted, windows, globalreach-deploy]│
# │ notify              │ [self-hosted, windows, globalreach-build] │
# │ security-scan       │ ubuntu-latest (保持 GitHub-hosted)        │
# │ backup-verification │ [self-hosted, windows, globalreach-build] │
# └─────────────────────┴──────────────────────────────────────────┘
```

#### 5.3 Self-hosted Runner 上需要预装的软件

```powershell
# 在 Runner 服务器上执行以下预装:

# 1. Node.js 24.x LTS (Krypton)
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements

# 2. Docker Desktop for Windows
winget install Docker.DockerDesktop --accept-source-agreements --accept-package-agreements

# 3. Git (最新版)
winget install Git.Git --accept-source-agreements --accept-package-agreements

# 4. 验证安装
node --version    # v24.x.x
docker --version  # Docker version 27.x.x
git --version     # git version 2.x.x
```

---

## 6. Runner 安全最佳实践

### 6.1 最小权限原则

```powershell
# ❌ 错误: 以管理员身份运行 Runner 进程
# ✅ 正确: 使用专用低权限账户运行 Runner Service

# 创建专用运行账户
net user gr-runner "StrongP@ssw0rd!" /add /fullname:"GlobalReach Runner"
net localgroup "Performance Monitor Users" gr-runner /add

# 使用该账户运行服务
.\svc install --user ".\gr-runner" --password "StrongP@ssw0rd!"
```

### 6.2 Token 安全管理

| 类型 | 用途 | 有效期 |
|------|------|--------|
| **Runner Registration Token** | 注册时一次性使用 | 即时过期 |
| **GitHub PAT (Fine-grained)** | API 访问和认证 | 可设置到期时间 |
| **GITHUB_TOKEN** | Workflow 内置自动生成 | 每次 Job 运行时创建 |

```powershell
# ✅ 推荐: 使用环境变量存储敏感信息 (不硬编码)
# 在 Runner 服务器上设置系统环境变量:
[Environment]::SetEnvironmentVariable("GH_TOKEN", "<YOUR_PAT>", "User")

# 或使用 Windows Credential Manager
cmdkey /generic:github-runner /user:<username> /pass:<token>
```

### 6.3 网络隔离

```powershell
# Runner 服务器防火墙规则:
# - 仅允许出站 HTTPS (443) 到 github.com, api.github.com, ghcr.io
# - 如果使用 Docker Buildx, 允许出站到容器镜像仓库
# - 禁止入站非必要端口

# Windows Firewall 示例:
New-NetFirewallRule -DisplayName "GitHub Actions Runner - Outbound HTTPS" `
    -Direction Outbound -Action Allow -Protocol TCP -RemotePort 443 `
    -Enabled True
```

### 6.4 工作目录清理

```powershell
# Runner 默认保留工作目录 (_work/) 用于调试
# 但会占用大量磁盘空间, 建议定期清理或配置自动清理

# 方法 A: 在 config 时指定
.\config.cmd ... --work _work

# 方法 B: Workflow 中添加清理 step
# 在 ci-cd.yml 的每个 job 末尾添加:
# - name: Cleanup workspace
#   if: always()
#   run: rm -rf "${{ github.workspace }}/*"
```

### 6.5 定期更新 Runner

```bash
# Runner 版本更新包含安全修复, 建议每月检查一次
# 最新版本: https://github.com/actions/runner/releases

# 更新流程见 maintain-runner.ps1 的 update 子命令
```

---

## 7. 监控和维护

### 7.1 Runner 健康检查

```powershell
# 检查服务状态
Get-Service actions.runner.* | Format-Table Name, Status, StartType

# 检查进程是否运行
Get-Process -Name "*Runner*" -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, CPU, WorkingSet

# 检查最近日志
Get-Content "$RUNNER_HOME\diag\*.log" -Tail 50
```

### 7.2 日志位置

| 日志类型 | 路径 |
|----------|------|
| **Runner 主日志** | `$RUNNER_HOME\_diag\Runner_YYYYMMDD-HHmmSS-SSS.log` |
| **Worker 日志** | `$RUNNER_HOME\_diag\Worker_YYYYMMDD-HHmmSS-SSS.log` |
| **Windows Event Log** | `Applications and Services Logs\GithubActionsRunner` |
| **Job 输出** | `$RUNNER_HOME\_work\<job-name>\<run-id>\` |

### 7.3 自动维护计划

```powershell
# 使用 Windows Task Scheduler 定期执行维护脚本
# 创建每日凌晨 3 点执行的任务:

$action = New-ScheduledTaskAction -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\path\to\maintain-runner.ps1 clean"
$trigger = New-ScheduledTaskTrigger -Daily -At "03:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "GlobalReach-Runner-Cleanup" `
    -Action $action -Trigger $trigger -Settings $settings `
    -User "SYSTEM" -RunLevel Highest
```

### 7.4 性能监控指标

| 指标 | 正常范围 | 告警阈值 |
|------|---------|---------|
| **CPU 使用率** | < 60% | > 90% 持续 5 分钟 |
| **内存使用率** | < 70% | > 85% |
| **磁盘使用率** | < 80% | > 90% |
| **Job 队列等待时间** | < 30 秒 | > 5 分钟 |
| **Job 成功率** | > 95% | < 90% |

---

## 8. 故障排查

### 常见问题速查

| 问题现象 | 可能原因 | 解决方案 |
|----------|---------|---------|
| Runner 显示 Offline | 服务未启动或网络不通 | `.\svc start` + 检查防火墙 |
| Job 一直 Pending | 标签不匹配 | 检查 workflow 的 `runs-on` 与 Runner 标签 |
| Job 执行失败: permission denied | Runner 账户权限不足 | 提升账户权限或调整文件 ACL |
| Docker 构建失败 | Docker 未安装或未启动 | 安装 Docker Desktop 并登录 GHCR |
| 磁盘空间不足 | `_work/` 目录未清理 | 执行 `maintain-runner.ps1 clean` |
| Runner 版本过旧 | 未更新 | 执行 `maintain-runner.ps1 update` |

### 日志分析技巧

```powershell
# 查看 Runner 启动日志中的错误
Get-ChildItem "$RUNNER_HOME\_diag\" -Filter "*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 |
    ForEach-Object { Get-Content $_.FullName | Select-String "error|fail|exception" -CaseSensitive:$false }
```

### 快速恢复流程

```powershell
# 1. 停止服务
.\svc stop

# 2. 重新配置 (如果 Token 过期, 需要从 GitHub 重新获取)
.\config.sh remove --token <OLD_TOKEN>
.\config.cmd --url <URL> --token <NEW_TOKEN> --unattended --replace

# 3. 重启服务
.\svc start

# 4. 验证在线
Get-Service actions.runner.*
```

---

## 附录: 相关文件

| 文件 | 说明 |
|------|------|
| `docs/SELF_HOSTED_RUNNER_GUIDE.md` | 本文档 |
| `scripts/setup-runner.ps1` | 自动化注册脚本 |
| `scripts/maintain-runner.ps1` | 维护工具脚本 |
| `.github/workflows/ci-cd.yml` | CI/CD 流水线配置 (含 self-hosted 注释说明) |

---

*文档由 M-E01 任务生成 | GlobalReach V2.0 CI/CD 基础设施*
