<#
.SYNOPSIS
    GlobalReach V2.0 — Self-hosted GitHub Actions Runner 自动化注册脚本
.DESCRIPTION
    自动完成 Runner 部署的全流程:
    1. 系统要求检查 (OS/Docker/内存/磁盘)
    2. 下载最新 GitHub Actions Runner 包
    3. 交互式配置 (输入 repo URL + token)
    4. 注册到 GitHub
    5. 作为 Windows Service 安装
    6. 验证 Runner 在线状态
    7. 输出配置摘要
.NOTES
    任务编号: M-E01
    要求: PowerShell 5.1+ (管理员权限)
    参考: docs/SELF_HOSTED_RUNNER_GUIDE.md
.EXAMPLE
    .\setup-runner.ps1
    .\setup-runner.ps1 -RunnerHome "C:\actions-runner" -Labels "globalreach-docker,windows"
#>

[CmdletBinding()]
param(
    [string]$RunnerHome = "C:\actions-runner",
    [string]$Labels = "globalreach-docker,windows,self-hosted",
    [string]$RunnerName = "",
    [switch]$SkipSystemCheck,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "GlobalReach V2.0 — Runner Setup"

# ============================================================
# 工具函数
# ============================================================

function Write-Banner {
    param([string]$Title)
    $width = 60
    Write-Host ""
    Write-Host ("=" * $width) -ForegroundColor Cyan
    $padding = [Math]::Max(0, ($width - $Title.Length - 2) / 2)
    Write-Host ("{0} {1} {2}" -f (" " * [Math]::Floor($padding)), $Title, (" " * [Math]::Ceiling($padding))) -ForegroundColor Cyan
    Write-Host ("=" * $width) -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message, [int]$StepNum = 0)
    if ($StepNum -gt 0) {
        Write-Host "[步骤 $StepNum] " -NoNewline -ForegroundColor Yellow
    }
    Write-Host $Message -ForegroundColor White
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  ✗ $Message" -ForegroundColor Red
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  ⚠ $Message" -ForegroundColor Yellow
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# STEP 1: 系统要求检查
# ============================================================

function Invoke-SystemCheck {
    Write-Banner "STEP 1/7: 系统要求检查"
    $checksPassed = $true

    # 1.1 管理员权限
    Write-Step "检查管理员权限..." 1
    if (-not (Test-Admin)) {
        Write-Fail "需要管理员权限! 请以管理员身份运行 PowerShell。"
        $checksPassed = $false
    } else {
        Write-Success "管理员权限确认"
    }

    # 1.2 操作系统
    Write-Step "检查操作系统..." 1
    $osInfo = Get-CimInstance Win32_OperatingSystem
    $osName = $osInfo.Caption
    $osVersion = $osInfo.Version
    $buildNumber = $osInfo.BuildNumber

    Write-Host "  系统: $osName (Version: $osVersion, Build: $buildNumber)"

    # Windows Server 2019 (Build 17763+) / 2022 (Build 20348+) / Win10 1903+ (Build 18362+)
    if ($buildNumber -ge 17763) {
        Write-Success "OS 版本满足要求"
    } else {
        Write-Fail "OS 版本过低! 需要 Windows Server 2019+ 或 Windows 10 1903+"
        $checksPassed = $false
    }

    # 1.3 内存
    Write-Step "检查内存..." 1
    $totalMemoryGB = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    $availableMemoryGB = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)

    Write-Host "  总内存: ${totalMemoryGB} GB | 可用: ${availableMemoryGB} GB"

    if ($totalMemoryGB -ge 4) {
        Write-Success "内存满足最低要求 (≥4 GB)"
    } else {
        Write-Fail "内存不足! 最低要求 4 GB, 当前 ${totalMemoryGB} GB"
        $checksPassed = $false
    }

    # 1.4 磁盘空间
    Write-Step "检查磁盘空间..." 1
    $systemDrive = $env:SystemDrive
    $disk = Get-PSDrive $systemDrive.Substring(0, 1)
    $freeSpaceGB = [Math]::Round($disk.Free / 1GB, 2)
    $usedSpaceGB = [Math]::Round(($disk.Used + $disk.Free) / 1GB, 2)

    Write-Host "  磁盘 (${systemDrive}\): 已用 ${usedSpaceGB} GB / 可用 ${freeSpaceGB} GB"

    if ($freeSpaceGB -ge 20) {
        Write-Success "磁盘空间充足 (≥20 GB)"
    } else {
        Write-Fail "磁盘空间不足! 最低要求 20 GB, 当前可用 ${freeSpaceGB} GB"
        $checksPassed = $false
    }

    # 1.5 CPU 核心数
    Write-Step "检查 CPU..." 1
    $cpuCores = (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors
    Write-Host "  逻辑核心数: $cpuCores"

    if ($cpuCores -ge 2) {
        Write-Success "CPU 核心数满足要求 (≥2)"
    } else {
        Write-Fail "CPU 核心数不足! 最低要求 2, 当前 $cpuCores"
        $checksPassed = $false
    }

    # 1.6 .NET Framework
    Write-Step "检查 .NET Framework..." 1
    try {
        $netFramework = Get-ItemProperty "HKLM:SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" -ErrorAction Stop
        $netVersion = $netFramework.Release
        $netRelease = $netFramework.Version
        Write-Host "  .NET Framework: $netRelease (Release: $netVersion)"

        if ($netVersion -ge 4.8) {
            Write-Success ".NET Framework ≥ 4.8"
        } else {
            Write-Warn ".NET Framework 版本较低 ($netVersion), Runner 可能需要更高版本"
        }
    } catch {
        Write-Warn "无法检测 .NET Framework 版本"
    }

    # 1.7 Docker (可选)
    Write-Step "检查 Docker (可选)..." 1
    try {
        $dockerVersion = docker --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Docker 已安装: $dockerVersion"
            $script:DockerInstalled = $true
        } else {
            throw
        }
    } catch {
        Write-Warn "Docker 未安装 (docker-build job 需要 Docker)"
        $script:DockerInstalled = $false
    }

    # 1.8 网络连通性
    Write-Step "检查网络连通性..." 1
    $testUrls = @(
        @{ Name = "github.com"; Url = "https://github.com" },
        @{ Name = "api.github.com"; Url = "https://api.github.com" },
        @{ Name = "ghcr.io"; Url = "https://ghcr.io" }
    )

    foreach ($testUrl in $testUrls) {
        try {
            $response = Invoke-WebRequest -Uri $testUrl.Url -Method Head -TimeoutSec 10 -UseBasicParsing
            Write-Success "$($testUrl.Name): 可达 (HTTP $($response.StatusCode))"
        } catch {
            Write-Fail "$($testUrl.Name): 无法连接 ($($_.Exception.Message))"
            $checksPassed = $false
        }
    }

    Write-Host ""

    if (-not $checksPassed) {
        Write-Host ""
        Write-Fail "系统检查未通过! 请解决上述问题后重试。"
        Write-Host "  提示: 使用 -SkipSystemCheck 参数跳过此步骤 (不推荐)" -ForegroundColor Gray
        exit 1
    }

    Write-Success "全部系统检查通过!"
    Write-Host ""
}

# ============================================================
# STEP 2: 获取最新 Runner 版本
# ============================================================

function Get-LatestRunnerVersion {
    Write-Banner "STEP 2/7: 获取最新 Runner 版本"

    try {
        $releaseApiUrl = "https://api.github.com/repos/actions/runner/releases/latest"
        $headers = @{}
        if ($env:GITHUB_TOKEN) {
            $headers["Authorization"] = "token $env:GITHUB_TOKEN"
        }

        $response = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -TimeoutSec 30
        $script:LatestVersion = $response.tag_name -replace 'v', ''
        $downloadUrlBase = "https://github.com/actions/runner/releases/download/$($response.tag_name)/actions-runner-win-x64-$script:LatestVersion.zip"

        Write-Step "最新 Runner 版本: $script:LatestVersion" 2
        Write-Success "发布日期: $($response.published_at)"
        Write-Host "  下载地址: $downloadUrlBase"
        Write-Host ""

        return @{
            Version = $script:LatestVersion
            DownloadUrl = $downloadUrlBase
            ReleasePage = $response.html_url
        }
    } catch {
        Write-Fail "获取 Runner 版本失败: $($_.Exception.Message)"
        exit 1
    }
}

# ============================================================
# STEP 3: 下载 Runner 包
# ============================================================

function Download-RunnerPackage {
    param([hashtable]$ReleaseInfo)

    Write-Banner "STEP 3/7: 下载 Runner 包"

    # 检查目录是否已存在
    if ((Test-Path $RunnerHome) -and -not $Force) {
        $existingFiles = (Get-ChildItem $RunnerHome -Recurse -ErrorAction SilentlyContinue).Count
        if ($existingFiles -gt 5) {
            Write-Warn "目标目录已存在且非空: $RunnerHome (含 $existingFiles 个文件)"
            $confirm = Read-Host "  是否清空并重新下载? (y/N)"
            if ($confirm -ne 'y' -and $confirm -ne 'Y') {
                Write-Host "  已取消。" -ForegroundColor Gray
                exit 0
            }
            Remove-Item "$RunnerHome\*" -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # 创建目录
    New-Item -ItemType Directory -Path $RunnerHome -Force | Out-Null
    Set-Location $RunnerHome
    Write-Success "工作目录: $(Get-Location)"

    $zipPath = Join-Path $RunnerHome "actions-runner.zip"

    # 检查是否已有缓存
    if (Test-Path $zipPath) {
        Write-Warn "发现已有的 zip 文件, 检查版本..."
        # 简单校验: 文件大小应 > 100MB
        $zipSize = (Get-Item $zipPath).Length / 1MB
        if ($zipSize -gt 100) {
            Write-Success "本地文件有效 (${zipSize:N1} MB), 跳过下载"
            return
        } else {
            Remove-Item $zipPath -Force
        }
    }

    Write-Step "正在下载 Runner v$($ReleaseInfo.Version)..." 3
    Write-Host "  目标: $zipPath"
    Write-Host "  大小: ~200 MB, 请耐心等待..."

    try {
        # 使用 .NET WebClient 下载 (比 Invoke-WebRequest 更稳定处理大文件)
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($ReleaseInfo.DownloadUrl, $zipPath)

        $fileSize = [Math]::Round((Get-Item $zipPath).Length / 1MB, 1)
        Write-Success "下载完成: $zipPath ($fileSize MB)"
    } catch {
        Write-Fail "下载失败: $($_.Exception.Message)"
        Write-Host "  建议: 手动下载后放到 $zipPath" -ForegroundColor Gray
        exit 1
    }

    Write-Host ""
}

# ============================================================
# STEP 4: 解压与交互式配置
# ============================================================

function Expand-AndConfigure {
    Write-Banner "STEP 4/7: 解压与配置"

    $zipPath = Join-Path $RunnerHome "actions-runner.zip"

    # 解压
    Write-Step "解压 Runner 包..." 4
    try {
        Expand-Archive -Path $zipPath -DestinationPath $RunnerHome -Force
        $extractedFiles = (Get-ChildItem $RunnerHome -File -ErrorAction SilentlyContinue).Count
        Write-Success "解压完成 ($extractedFiles 个文件)"
    } catch {
        Write-Fail "解压失败: $($_.Exception.Message)"
        exit 1
    }

    # 交互式收集配置信息
    Write-Host ""
    Write-Step "请提供 Runner 配置信息:" 4
    Write-Host ""

    # Repo URL
    $defaultRepoUrl = ""
    if ($env:GH_REPO_URL) { $defaultRepoUrl = $env:GH_REPO_URL }
    $repoUrl = Read-Host "  GitHub 仓库 URL (如: https://github.com/org/repo) [$defaultRepoUrl]"
    if ([string]::IsNullOrWhiteSpace($repoUrl)) { $repoUrl = $defaultRepoUrl }
    while ([string]::IsNullOrWhiteSpace($repoUrl)) {
        Write-Fail "仓库 URL 不能为空!"
        $repoUrl = Read-Host "  GitHub 仓库 URL"
    }

    # Token
    $defaultToken = ""
    if ($env:GH_RUNNER_TOKEN) { $defaultToken = $env:GH_RUNNER_TOKEN }
    $token = Read-Host "  Runner Token (从 GitHub Settings > Actions > Runners 获取) [***隐藏***]"
    if ([string]::IsNullOrWhiteSpace($token)) { $token = $defaultToken }
    while ([string]::IsNullOrWhiteSpace($token)) {
        Write-Fail "Token 不能为空!"
        $token = Read-Host "  Runner Token"
    }

    # Runner Name
    if ([string]::IsNullOrWhiteSpace($RunnerName)) {
        $hostname = $env:COMPUTERNAME.ToLower()
        $defaultName = "globalreach-${hostname}-01"
        $runnerNameInput = Read-Host "  Runner 名称 [$defaultName]"
        if ([string]::IsNullOrWhiteSpace($runnerNameInput)) { $RunnerName = $defaultName }
        else { $RunnerName = $runnerNameInput.Trim() }
    }

    # Labels
    $labelsInput = Read-Host "  标签 (逗号分隔) [$Labels]"
    if (-not [string]::IsNullOrWhiteSpace($labelsInput)) { $Labels = $labelsInput.Trim() }

    # Work directory
    $workDir = "_work"

    # 摘要确认
    Write-Host ""
    Write-Host "  ┌─────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "  │          Runner 配置摘要                     │" -ForegroundColor Cyan
    Write-Host "  ├─────────────────────────────────────────────┤" -ForegroundColor Cyan
    Write-Host ("  │  仓库 URL : {0,-35} │" -f $repoUrl) -ForegroundColor Cyan
    Write-Host ("  │  Token    : {0,-35} │" -f "***" + ("*" * ($token.Length - 3))) -ForegroundColor Cyan
    Write-Host ("  │  名称     : {0,-35} │" -f $RunnerName) -ForegroundColor Cyan
    Write-Host ("  │  标签     : {0,-35} │" -f $Labels) -ForegroundColor Cyan
    Write-Host ("  │  工作目录 : {0,-35} │" -f $workDir) -ForegroundColor Cyan
    Write-Host ("  │  安装路径 : {0,-35} │" -f $RunnerName) -ForegroundColor Cyan
    Write-Host "  └─────────────────────────────────────────────┘" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "  确认以上配置? (Y/n)"
    if ($confirm -eq 'n' -or $confirm -eq 'N') {
        Write-Host "  已取消配置。" -ForegroundColor Gray
        exit 0
    }

    # 保存配置供后续步骤使用
    $script:Config = @{
        RepoUrl  = $repoUrl.Trim()
        Token    = $token.Trim()
        Name     = $RunnerName
        Labels   = $Labels
        WorkDir  = $workDir
    }

    Write-Host ""
}

# ============================================================
# STEP 5: 注册 Runner
# ============================================================

function Register-Runner {
    Write-Banner "STEP 5/7: 注册 Runner 到 GitHub"

    $cfg = $script:Config

    Write-Step "执行 config.cmd..." 5
    Write-Host "  URL:    $($cfg.RepoUrl)"
    Write-Host "  Name:   $($cfg.Name)"
    Write-Host "  Labels: $($cfg.Labels)"
    Write-Host ""

    $configArgs = @(
        "--url", $cfg.RepoUrl,
        "--token", $cfg.Token,
        "--name", $cfg.Name,
        "--labels", $cfg.Labels,
        "--work", $cfg.WorkDir,
        "--unattended",
        "--replace"
    )

    try {
        Push-Location $RunnerHome
        & .\config.cmd @configArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
        Pop-Location

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Runner 注册成功!"
        } else {
            throw "config.cmd 返回退出码: $LASTEXITCODE"
        }
    } catch {
        Write-Fail "注册失败: $($_.Exception.Message)"
        Write-Host "  常见原因:" -ForegroundColor Yellow
        Write-Host "    - Token 无效或已过期" -ForegroundColor Gray
        Write-Host "    - 网络无法连接到 github.com" -ForegroundColor Gray
        Write-Host "    - 仓库 URL 格式错误" -ForegroundColor Gray
        Write-Host "    - Runner 名称已被占用" -ForegroundColor Gray
        exit 1
    }

    Write-Host ""
}

# ============================================================
# STEP 6: 安装为 Windows Service
# ============================================================

function Install-RunnerService {
    Write-Banner "STEP 6/7: 安装为 Windows Service"

    Push-Location $RunnerHome

    Write-Step "安装 Runner Service..." 6
    try {
        & .\svc install 2>&1 | ForEach-Object { Write-Host "  $_" }

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Service 安装成功"
        } else {
            throw "svc install 返回退出码: $LASTEXITCODE"
        }
    } catch {
        Write-Fail "Service 安装失败: $($_.Exception.Message)"
        Write-Host "  回退方案: 尝试手动启动 ./run.cmd" -ForegroundColor Yellow
    }

    # 启动服务
    Write-Step "启动 Runner Service..." 6
    try {
        & .\svc start 2>&1 | ForEach-Object { Write-Host "  $_" }

        Start-Sleep -Seconds 3

        # 验证服务状态
        $service = Get-Service -Name "actions.runner.*" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*$($script:Config.Name)*" } |
            Select-Object -First 1

        if ($service -and $service.Status -eq 'Running') {
            Write-Success "Service 运行中: $($service.Name) ($($service.DisplayName))"
        } elseif ($service) {
            Write-Warn "Service 状态: $($service.Status) (可能需要几秒启动)"
        } else {
            Write-Warn "未找到匹配的 Service, 尝试通用查询..."
            Get-Service "actions.runner.*" -ErrorAction SilentlyContinue | Format-Table Name, Status, DisplayName -AutoSize
        }
    } catch {
        Write-Warn "Service 启动异常: $($_.Exception.Message)"
    }

    Pop-Location
    Write-Host ""
}

# ============================================================
# STEP 7: 验证与输出摘要
# ============================================================

function Show-Summary {
    Write-Banner "STEP 7/7: 验证与输出摘要"

    $cfg = $script:Config

    # 7.1 服务状态
    Write-Step "验证 Runner 状态..." 7
    $services = Get-Service "actions.runner.*" -ErrorAction SilentlyContinue
    if ($services) {
        foreach ($svc in $services) {
            $statusColor = if ($svc.Status -eq 'Running') { 'Green' } else { 'Yellow' }
            Write-Host "  Service: $($svc.Name)" -ForegroundColor White
            Write-Host "  Status : $($svc.Status)" -ForegroundColor $statusColor
            Write-Host "  Display: $($svc.DisplayName)" -ForegroundColor Gray
        }
    } else {
        Write-Warn "未找到 Runner Service"
    }

    # 7.2 进程状态
    Write-Host ""
    Write-Step "检查 Runner 进程..." 7
    $processes = Get-Process -Name "*Runner*" -ErrorAction SilentlyContinue
    if ($processes) {
        foreach ($proc in $processes) {
            $memMB = [Math]::Round($proc.WorkingSet64 / 1MB, 0)
            Write-Success "进程: $($proc.ProcessName) (PID: $($proc.Id), 内存: ${memMB} MB)"
        }
    } else {
        Write-Warn "未找到运行中的 Runner 进程"
    }

    # 7.3 最终配置摘要
    Write-Host ""
    Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║     🎉 GlobalReach V2.0 Runner 部署完成!          ║" -ForegroundColor Green
    Write-Host "  ╠═══════════════════════════════════════════════════╣" -ForegroundColor Green
    Write-Host ("  ║  Runner 名称 : {0,-40} ║" -f $cfg.Name) -ForegroundColor White
    Write-Host ("  ║  仓库地址   : {0,-40} ║" -f $cfg.RepoUrl) -ForegroundColor White
    Write-Host ("  ║  标签       : {0,-40} ║" -f $cfg.Labels) -ForegroundColor White
    Write-Host ("  ║  安装路径   : {0,-40} ║" -f $RunnerHome) -ForegroundColor White
    Write-Host ("  ║  Runner版本 : {0,-40} ║" -f $script:LatestVersion) -ForegroundColor White
    Write-Host ("  ║  Docker     : {0,-40} ║" -f $(if ($script:DockerInstalled) { "✅ 已安装" } else { "⚠️ 未安装" })) -ForegroundColor White
    Write-Host "  ╠═══════════════════════════════════════════════════╣" -ForegroundColor Green
    Write-Host "  ║  后续操作:                                        ║" -ForegroundColor Green
    Write-Host "  ║  1. 访问 GitHub > Settings > Actions > Runners     ║" -ForegroundColor Gray
    Write-Host "  ║  2. 确认 Runner 显示为 Idle (空闲)                ║" -ForegroundColor Gray
    Write-Host "  ║  3. 修改 ci-cd.yml 中的 runs-on 为:               ║" -ForegroundColor Gray
    Write-Host ("  ║     runs-on: [self-hosted, windows, $($cfg.Labels.Split(',')[0].Trim())] ║") -ForegroundColor Cyan
    Write-Host "  ║  4. 使用 maintain-runner.ps1 进行日常维护         ║" -ForegroundColor Gray
    Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""

    # 保存配置文件供后续参考
    $configFilePath = Join-Path $RunnerHome "runner-config.json"
    $configData = @{
        installedAt    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        version        = $script:LatestVersion
        runnerName     = $cfg.Name
        repoUrl        = $cfg.RepoUrl
        labels         = $cfg.Labels
        runnerHome     = $RunnerHome
        dockerInstalled = $script:DockerInstalled
    } | ConvertTo-Json -Depth 3

    Set-Content -Path $configFilePath -Value $configData -Encoding UTF8
    Write-Success "配置已保存到: $configFilePath"
}

# ============================================================
# 主流程
# ============================================================

try {
    Write-Host ""
    Write-Host "  ███████╗██╗   ██╗███████╗████████╗███████╗██████╗ ███╗   ██╗" -ForegroundColor Cyan
    Write-Host "  ██╔════╝██║   ██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗████╗  ██║" -ForegroundColor Cyan
    Write-Host "  ███████╗██║   ██║███████╗   ██║   █████╗  ██████╔╝██╔██╗ ██║" -ForegroundColor Cyan
    Write-Host "  ╚════██║██║   ██║╚════██║   ██║   ██╔══╝  ██╔══██╗██║╚██╗██║" -ForegroundColor Cyan
    Write-Host "  ███████║╚██████╔╝███████╝   ██║   ███████╗██║  ██║██║ ╚████║" -ForegroundColor Cyan
    Write-Host "  ╚══════╝ ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Self-hosted GitHub Actions Runner 自动化部署工具" -ForegroundColor White
    Write-Host "  任务编号: M-E01 | 版本: 1.0" -ForegroundColor Gray
    Write-Host ""

    # 执行各步骤
    if (-not $SkipSystemCheck) { Invoke-SystemCheck }

    $releaseInfo = Get-LatestRunnerVersion
    Download-RunnerPackage -ReleaseInfo $releaseInfo
    Expand-AndConfigure
    Register-Runner
    Install-RunnerService
    Show-Summary

    Write-Host ""
    Write-Success "全部步骤已完成! 请前往 GitHub 确认 Runner 状态。"
    Write-Host ""

} catch {
    Write-Host ""
    Write-Fail "发生未预期的错误: $($_.Exception.Message)"
    Write-Host "  位置: $($_.ScriptStackTrace)" -ForegroundColor Red
    Write-Host ""
    exit 1
}
