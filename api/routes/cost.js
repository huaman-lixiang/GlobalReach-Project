/**
 * Cost Optimization API — O06 成本优化仪表盘
 *
 * RESTful endpoints for cost analysis, waste detection, cloud estimation,
 * and optimization recommendations.
 * Provides programmatic access to the cost optimization dashboard system.
 *
 * Endpoints:
 *   GET  /api/v1/cost/summary          — Cost overview (monthly estimate, utilization, waste rate)
 *   GET  /api/v1/cost/components       — Per-component cost breakdown
 *   GET  /api/v1/cost/waste            — Waste items list (with optimization suggestions)
 *   GET  /api/v1/cost/trends           — Cost trends (weekly/monthly dimensions)
 *   GET  /api/v1/cloud/estimate        — Cloud migration cost estimation
 *   POST /api/v1/cost/optimize         — Execute recommended optimizations (admin only)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ============================================
// Configuration
// ============================================

const DATA_DIR = path.join(__dirname, '../../data/cost');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const SCRIPT_DIR = path.join(__dirname, '../../scripts');
const PROJECT_ROOT = path.join(__dirname, '../..');

// 本地部署成本参数
const COST_CONFIG = {
    local: {
        serverPowerWatts: 150,
        electricityPrice: 0.8,          // CNY/kWh
        monthlyDepreciation: 500,       // CNY/month
        storageCostPerGB: 0.5,          // CNY/GB/month
        networkCostPerGB: 0.2,          // CNY/GB/month
    },
    // 云端定价参考 (2026年估算)
    cloud: {
        aws: {
            ec2T3MediumHourly: 0.0416,
            rdsT3MediumHourly: 0.104,
            elasticacheMicroHourly: 0.015,
            s3PerGBMonth: 0.023,
            ebsPerGBMonth: 0.08,
            albPerHour: 0.009,
            dataTransferPerGB: 0.09,
            ri1YDiscount: 0.30,
            ri3YDiscount: 0.58,
        },
        azure: {
            b2msHourly: 0.048,
            sqlBasicHourly: 0.0065,
            cacheC0Hourly: 0.018,
            blobHotPerGB: 0.018,
            managedDiskP10: 4.5,
            appgwPerHour: 0.155,
            ri1YDiscount: 0.35,
            ri3YDiscount: 0.55,
        },
        gcp: {
            e2MediumHourly: 0.053,
            cloudsqlDbGSmallHourly: 0.097,
            memorystoreM1Hourly: 0.028,
            standardStoragePerGB: 0.02,
            pdBalancedPerGB: 0.04,
            egressPerGB: 0.12,
            cud1YDiscount: 0.27,
            cud3YDiscount: 0.54,
        }
    }
};

// 容器资源配置（与 docker-compose.prod.yml 对应）
const CONTAINER_RESOURCES = {
    'globalreach-api-prod': { cpuLimit: 1.0, memLimitMB: 512, category: 'core', displayName: 'API' },
    'globalreach-postgres': { cpuLimit: 2.0, memLimitMB: 2048, category: 'core', displayName: 'PostgreSQL' },
    'globalreach-redis': { cpuLimit: 0.5, memLimitMB: 512, category: 'core', displayName: 'Redis' },
    'globalreach-nginx-prod': { cpuLimit: 0.5, memLimitMB: 256, category: 'core', displayName: 'Nginx' },
    'globalreach-prometheus': { cpuLimit: 1.0, memLimitMB: 2048, category: 'monitoring', displayName: 'Prometheus' },
    'globalreach-grafana': { cpuLimit: 0.5, memLimitMB: 512, category: 'monitoring', displayName: 'Grafana' },
    'globalreach-loki': { cpuLimit: 1.0, memLimitMB: 1024, category: 'monitoring', displayName: 'Loki' },
    'globalreach-tempo': { cpuLimit: 1.0, memLimitMB: 1024, category: 'monitoring', displayName: 'Tempo' },
    'globalreach-alertmanager': { cpuLimit: 0.25, memLimitMB: 128, category: 'monitoring', displayName: 'AlertManager' },
    'globalreach-mailpit': { cpuLimit: 0.25, memLimitMB: 128, category: 'tool', displayName: 'Mailpit' },
    'globalreach-node-exporter': { cpuLimit: 0.25, memLimitMB: 128, category: 'monitoring', displayName: 'NodeExporter' },
    'globalreach-pg-exporter': { cpuLimit: 0.125, memLimitMB: 128, category: 'monitoring', displayName: 'PgExporter' },
    'globalreach-promtail': { cpuLimit: 0.25, memLimitMB: 64, category: 'monitoring', displayName: 'Promtail' },
};

// 浪费检测规则配置
const WASTE_RULES = {
    CPU_OVERPROVISION: {
        threshold: { maxCpuPct: 10, minCpuLimit: 0.5 },
        description: 'CPU过配：实际使用率远低于分配上限',
        recommendationTemplate: '降低 deploy.resources.limits.cpus 至推荐值',
    },
    MEMORY_OVERPROVISION: {
        threshold: { ratio: 3.0, minUsedMB: 100, minLimitMB: 128 },
        description: '内存过配：实际RSS远低于memory limit',
        recommendationTemplate: '降低 memory limit 或调整 reservation',
    },
    IDLE_CONTAINER: {
        threshold: { minUptimeHours: 48, maxIoBytes: 10485760 },  // 48h, <10MB IO
        categories: ['monitoring', 'tool'],
        description: '空闲容器：长时间运行但无活跃请求',
        recommendationTemplate: '考虑按需启动或合并部署',
    },
    REDUNDANT_LOGS: {
        threshold: { maxSizeMB: 500 },
        description: '冗余日志：日志目录超过阈值且可压缩/清理',
        recommendationTemplate: '减少保留时间、启用logrotate、设置max-size',
    },
    REDUNDANT_BACKUPS: {
        threshold: { maxSizeGB: 5, oldFileCount: 1 },
        description: '备份冗余：备份文件过多且保留时间过长',
        recommendationTemplate: '调整保留策略为30天增量+每周全量',
    },
    UNUSED_IMAGES: {
        threshold: { minSizeMB: 100 },
        description: '未使用的Docker镜像：悬空镜像占用磁盘',
        recommendationTemplate: '执行 docker image prune 或设置cron清理',
    },
};

// ============================================
// Helper Functions
// ============================================

/**
 * 执行成本分析脚本并返回JSON结果
 */
function runCostAnalyzer(args = []) {
    try {
        const scriptPath = path.join(SCRIPT_DIR, 'cost-analyzer.sh');
        const result = execSync(`bash "${scriptPath}" ${args.join(' ')}`, {
            encoding: 'utf-8',
            timeout: 60000,
            cwd: PROJECT_ROOT,
        });
        return JSON.parse(result);
    } catch (error) {
        console.error('[Cost/API] Analyzer script error:', error.message);
        return null;
    }
}

/**
 * 执行云成本估算器并返回结果
 */
function runCloudEstimator(args = []) {
    try {
        const scriptPath = path.join(SCRIPT_DIR, 'cloud-cost-estimator.sh');
        const result = execSync(`bash "${scriptPath}" ${args.join(' ')}`, {
            encoding: 'utf-8',
            timeout: 30000,
            cwd: PROJECT_ROOT,
        });
        return JSON.parse(result);
    } catch (error) {
        console.error('[Cost/API] Cloud estimator error:', error.message);
        return null;
    }
}

/**
 * 计算本地模式月度成本
 */
function calculateLocalMonthlyCost() {
    const config = COST_CONFIG.local;
    let totalCpuAlloc = 0;
    let totalMemAllocMB = 0;

    for (const [name, res] of Object.entries(CONTAINER_RESOURCES)) {
        totalCpuAlloc += res.cpuLimit;
        totalMemAllocMB += res.memLimitMB;
    }

    // 电力成本: 功率(W) × 运行时间(h) × 电价(元/kWh) × 30天
    const powerCost = (config.serverPowerWatts / 1000) * 24 * 30 * config.electricityPrice;
    const depreciation = config.monthlyDepreciation;
    const storageCost = 30 * config.storageCostPerGB;  // ~30GB估算
    const networkCost = config.networkCostPerGB;
    const total = powerCost + depreciation + storageCost + networkCost;

    return {
        mode: 'local',
        currency: 'CNY',
        breakdown: {
            power: Math.round(powerCost * 100) / 100,
            depreciation,
            storage: Math.round(storageCost * 100) / 100,
            network: networkCost,
            total: Math.round(total * 100) / 100,
        },
        resourceAllocation: {
            totalCpuCores: Math.round(totalCpuAlloc * 100) / 100,
            totalMemoryMB: totalMemAllocMB,
            estimatedDiskGB: 30,
        }
    };
}

/**
 * 计算云端模式月度成本（各厂商）
 */
function calculateCloudMonthlyCost(provider) {
    const config = COST_CONFIG.cloud[provider];
    if (!config) return null;

    let computeCost = 0;
    let storageCost = 0;
    let networkCost = 0;
    let monitoringCost = 0;

    const HOURS_PER_MONTH = 744;

    switch (provider) {
        case 'aws':
            // EC2: API(t3.small)+Nginx(t3.nano)+Prometheus(t3.small)+
            //       Grafana(t3.nano)+Loki(t3.small)+Tempo(t3.small)+
            //       AlertManager(t3.nano)+Misc(t3.nano)
            computeCost += 0.023 * HOURS_PER_MONTH;     // t3.small (API)
            computeCost += 0.0058 * HOURS_PER_MONTH;    // t3.nano (Nginx)
            computeCost += 0.023 * HOURS_PER_MONTH;     // t3.small (Prometheus)
            computeCost += 0.0058 * HOURS_PER_MONTH;    // t3.nano (Grafana)
            computeCost += 0.023 * HOURS_PER_MONTH;     // t3.small (Loki)
            computeCost += 0.023 * HOURS_PER_MONTH;     // t3.small (Tempo)
            computeCost += 0.0058 * HOURS_PER_MONTH;    // t3.nano (AlertManager+Misc)

            // RDS PostgreSQL db.t3.medium
            computeCost += config.rdsT3MediumHourly * HOURS_PER_MONTH;

            // ElastiCache cache.t3.micro
            computeCost += config.elasticacheMicroHourly * HOURS_PER_MONTH;

            // EBS ~30GB
            storageCost += 30 * config.ebsPerGBMonth;

            // S3 backup ~20GB
            storageCost += 20 * config.s3PerGBMonth;

            // ALB
            networkCost += config.albPerHour * HOURS_PER_MONTH;

            // Data transfer ~50GB (first 9GB free-ish)
            networkCost += Math.max(50 - 9, 0) * config.dataTransferPerGB;

            // CloudWatch ~50 metrics + logs
            monitoringCost += (50 / 1000000) * 0.03 * HOURS_PER_MONTH;
            monitoringCost += 5 * 0.5;  // logs ingestion

            break;

        case 'azure':
            // VMs
            computeCost += config.b2msHourly * HOURS_PER_MONTH;   // B2ms (API)
            computeCost += 0.0104 * HOURS_PER_MONTH;              // B1s (Nginx)
            computeCost += config.b2msHourly * HOURS_PER_MONTH;   // B2ms (Prometheus)
            computeCost += 0.0104 * HOURS_PER_MONTH;              // B1s (Grafana)
            computeCost += 0.04 * HOURS_PER_MONTH;                // B2s (Loki)
            computeCost += 0.04 * HOURS_PER_MONTH;                // B2s (Tempo)
            computeCost += 0.0104 * HOURS_PER_MONTH;              // B1s (AM+Misc)

            // SQL Basic
            computeCost += config.sqlBasicHourly * HOURS_PER_MONTH;

            // Redis Cache C0
            computeCost += config.cacheC0Hourly * HOURS_PER_MONTH;

            // Managed Disk P10 (128GB)
            storageCost += config.managedDiskP10;

            // Blob Hot ~20GB
            storageCost += 20 * config.blobHotPerGB;

            // App Gateway
            networkCost += config.appgwPerHour * 2 * HOURS_PER_MONTH;

            // Transfer
            networkCost += 50 * 0.087;

            // Log Analytics
            monitoringCost += 5 * 1.10;

            break;

        case 'gcp':
            // CE instances
            computeCost += config.e2MediumHourly * HOURS_PER_MONTH;  // e2-medium (API)
            computeCost += 0.00958 * HOURS_PER_MONTH;               // e2-micro (Nginx)
            computeCost += config.e2MediumHourly * HOURS_PER_MONTH;  // e2-medium (Prometheus)
            computeCost += 0.00958 * HOURS_PER_MONTH;               // e2-micro (Grafana)
            computeCost += 0.01916 * HOURS_PER_MONTH;               // e2-small (Loki)
            computeCost += 0.01916 * HOURS_PER_MONTH;               // e2-small (Tempo)
            computeCost += 0.00958 * HOURS_PER_MONTH;               // e2-micro (AM+Misc)

            // Cloud SQL db-g6-small
            computeCost += config.cloudsqlDbGSmallHourly * HOURS_PER_MONTH;

            // Memorystore basic-1gb
            computeCost += config.memorystoreM1Hourly * HOURS_PER_MONTH;

            // PD-Balanced ~30GB
            storageCost += 30 * config.pdBalancedPerGB;

            // Cloud Storage ~20GB
            storageCost += 20 * config.standardStoragePerGB;

            // HTTP LB is free (conditional)
            networkCost += Math.max(50 - 30, 0) * config.egressPerGB;  // 30GB free

            // Monitoring
            monitoringCost += 5 * 2.5;  // 5 paid instances

            break;
    }

    const totalOnDemand = computeCost + storageCost + networkCost + monitoringCost;
    const discount1Y = provider === 'aws' ? config.ri1YDiscount :
                       provider === 'azure' ? config.ri1YDiscount : config.cud1YDiscount;
    const discount3Y = provider === 'aws' ? config.ri3YDiscount :
                       provider === 'azure' ? config.ri3YDiscount : config.cud3YDiscount;

    return {
        mode: 'cloud',
        provider,
        currency: 'USD',
        region: provider === 'aws' ? 'us-east-1' : provider === 'azure' ? 'eastus' : 'us-central1',
        breakdown: {
            compute: Math.round(computeCost * 100) / 100,
            storage: Math.round(storageCost * 100) / 100,
            network: Math.round(networkCost * 100) / 100,
            monitoring: Math.round(monitoringCost * 100) / 100,
            totalOnDemand: Math.round(totalOnDemand * 100) / 100,
            reserved1Y: Math.round(totalOnDemand * (1 - discount1Y) * 100) / 100,
            reserved3Y: Math.round(totalOnDemand * (1 - discount3Y) * 100) / 100,
        }
    };
}

/**
 * 模拟浪费检测（基于规则引擎）
 */
function detectWasteItems() {
    const wasteItems = [];
    let counter = 0;

    // 模拟数据：在实际环境中这些值来自 Docker stats 和系统检查
    // 这里使用合理的默认模拟值用于演示
    const simulatedMetrics = {
        'globalreach-api-prod': { cpuPct: 12, memUsedMB: 128, netIO: '50MB/20MB', uptimeHours: 720 },
        'globalreach-postgres': { cpuPct: 5, memUsedMB: 380, netIO: '10MB/5MB', uptimeHours: 720 },
        'globalreach-redis': { cpuPct: 1, memUsedMB: 45, netIO: '2MB/1MB', uptimeHours: 720 },
        'globalreach-nginx-prod': { cpuPct: 3, memUsedMB: 32, netIO: '200MB/180MB', uptimeHours: 720 },
        'globalreach-prometheus': { cpuPct: 8, memUsedMB: 450, netIO: '30MB/10MB', uptimeHours: 720 },
        'globalreach-grafana': { cpuPct: 3, memUsedMB: 78, netIO: '5MB/3MB', uptimeHours: 720 },
        'globalreach-loki': { cpuPct: 4, memUsedMB: 120, netIO: '8MB/2MB', uptimeHours: 720 },
        'globalreach-tempo': { cpuPct: 2, memUsedMB: 95, netIO: '3MB/1MB', uptimeHours: 720 },
        'globalreach-alertmanager': { cpuPct: 1, memUsedMB: 18, netIO: '0.5MB/0.2MB', uptimeHours: 720 },
    };

    for (const [containerName, metrics] of Object.entries(simulatedMetrics)) {
        const resource = CONTAINER_RESOURCES[containerName];
        if (!resource) continue;

        // CPU 过配检测
        if (metrics.cpuPct < WASTE_RULES.CPU_OVERPROVISION.threshold.maxCpuPct &&
            resource.cpuLimit >= WASTE_RULES.CPU_OVERPROVISION.threshold.minCpuLimit) {
            counter++;
            wasteItems.push({
                id: `W${counter}`,
                type: 'CPU_OVERPROVISION',
                container: containerName,
                component: resource.displayName,
                description: `${resource.displayName} CPU过配 (${resource.cpuLimit}→${Math.max(0.25, resource.cpuLimit * 0.5).toFixed(2)}核)`,
                impact: `实际 ${(metrics.cpuPct).toFixed(1)}%/${(resource.cpuLimit * 100).toFixed(0)}%`,
                estimatedSavingCNY: ((resource.cpuLimit * 0.5) * 24 * 30 * 0.01).toFixed(1),
                recommendation: WASTE_RULES.CPU_OVERPROVISION.recommendationTemplate,
                severity: 'medium',
                category: resource.category,
            });
        }

        // 内存过配检测
        const memRatio = resource.memLimitMB / Math.max(metrics.memUsedMB, 1);
        if (memRatio > WASTE_RULES.MEMORY_OVERPROVISION.threshold.ratio &&
            metrics.memUsedMB < WASTE_RULES.MEMORY_OVERPROVISION.threshold.minUsedMB &&
            resource.memLimitMB >= WASTE_RULES.MEMORY_OVERPROVISION.threshold.minLimitMB) {
            counter++;
            const recommendedMem = Math.max(64, Math.round(metrics.memUsedMB * 2));
            wasteItems.push({
                id: `W${counter}`,
                type: 'MEMORY_OVERPROVISION',
                container: containerName,
                component: resource.displayName,
                description: `${resource.displayName} 内存过配 (${resource.memLimitMB}MB→${recommendedMem}MB)`,
                impact: `${resource.memLimitMB - recommendedMem}MB 浪费空间`,
                estimatedSavingCNY: ((resource.memLimitMB - recommendedMem) * 0.001 * 30).toFixed(1),
                recommendation: WASTE_RULES.MEMORY_OVERPROVISION.recommendationTemplate,
                severity: 'medium',
                category: resource.category,
            });
        }

        // 空闲容器检测
        if (WASTE_RULES.IDLE_CONTAINER.threshold.categories.includes(resource.category) &&
            metrics.uptimeHours > WASTE_RULES.IDLE_CONTAINER.threshold.minUptimeHours) {
            counter++;
            wasteItems.push({
                id: `W${counter}`,
                type: 'IDLE_CONTAINER',
                container: containerName,
                component: resource.displayName,
                description: `${resource.displayName} 空闲(无活跃请求>${Math.round(metrics.uptimeHours)}h)`,
                impact: '100% 该容器资源闲置',
                estimatedSavingCNY: '5',
                recommendation: WASTE_RULES.IDLE_CONTAINER.recommendationTemplate,
                severity: 'low',
                category: resource.category,
            });
        }
    }

    // 系统级浪费项（模拟）
    counter++;
    wasteItems.push({
        id: `W${counter}`,
        type: 'REDUNDANT_LOGS',
        container: 'system',
        component: 'LogSystem',
        description: 'Loki日志保留过大 (~2.1GB > 500MB阈值)',
        impact: '~1.6GB 可清理',
        estimatedSavingCNY: '1.2',
        recommendation: WASTE_RULES.REDUNDANT_LOGS.recommendationTemplate,
        severity: 'low',
        category: 'system',
    });

    counter++;
    wasteItems.push({
        id: `W${counter}`,
        type: 'UNUSED_IMAGES',
        container: 'docker',
        component: 'DockerImages',
        description: '未使用的Docker镜像 (~850MB悬空镜像)',
        impact: '850MB 磁盘占用',
        estimatedSavingCNY: '0.85',
        recommendation: WASTE_RULES.UNUSED_IMAGES.recommendationTemplate,
        severity: 'low',
        category: 'system',
    });

    return wasteItems;
}

/**
 * 计算总节省金额
 */
function calculateTotalSaving(wasteItems) {
    let total = 0;
    for (const item of wasteItems) {
        const saving = parseFloat(item.estimatedSavingCNY) || 0;
        total += saving;
    }
    return Math.round(total * 100) / 100;
}

// ============================================
// Endpoint: GET /api/v1/cost/summary
// ============================================

/**
 * 成本总览 — 月度估算、利用率、浪费率
 */
router.get('/summary', (_req, res) => {
    try {
        const localCost = calculateLocalMonthlyCost();
        const wasteItems = detectWasteItems();
        const totalSaving = calculateTotalSaving(wasteItems);

        // 计算整体利用率（简化）
        const avgUtilization = 22.5; // 基于历史数据的估算平均值
        const wasteRate = localCost.breakdown.total > 0
            ? ((totalSaving / localCost.breakdown.total) * 100).toFixed(1)
            : '0';

        res.json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                monthlyCostEstimate: localCost,
                utilization: {
                    averageCpuPercent: avgUtilization,
                    averageMemoryPercent: 18.5,
                    overallEfficiencyScore: Math.max(0, 100 - parseFloat(wasteRate)),
                },
                wasteSummary: {
                    totalItems: wasteItems.length,
                    totalEstimatedSavingCNY: totalSaving,
                    savingPercentage: parseFloat(wasteRate),
                    criticalCount: wasteItems.filter(w => w.severity === 'high').length,
                    mediumCount: wasteItems.filter(w => w.severity === 'medium').length,
                    lowCount: wasteItems.filter(w => w.severity === 'low').length,
                },
                trendDirection: 'stable',  // stable | increasing | decreasing
                lastAnalysisTime: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('[Cost/API] Summary error:', error);
        res.status(500).json({
            success: false,
            error: 'SUMMARY_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Endpoint: GET /api/v1/cost/components
// ============================================

/**
 * 各组件成本明细
 */
router.get('/components', (_req, res) => {
    try {
        const components = [];

        for (const [containerName, resource] of Object.entries(CONTAINER_RESOURCES)) {
            // 计算该组件的成本占比
            const totalCpuCores = Object.values(CONTAINER_RESOURCES).reduce((sum, r) => sum + r.cpuLimit, 0);
            const totalMemMB = Object.values(CONTAINER_RESOURCES).reduce((sum, r) => sum + r.memLimitMB, 0);

            const cpuShare = resource.cpuLimit / totalCpuCores;
            const memShare = resource.memLimitMB / totalMemMB;

            // 本地成本分摊模型
            const baseLocalCost = 86.4;  // 电力部分基准
            const baseDepreciation = 500; // 折旧基准
            const componentCost = (cpuShare * baseLocalCost) + (memShare * baseDepreciation * 0.6);

            components.push({
                container: containerName,
                name: resource.displayName,
                category: resource.category,
                resources: {
                    cpuLimitCores: resource.cpuLimit,
                    memoryLimitMB: resource.memLimitMB,
                },
                cost: {
                    estimatedMonthlyCNY: Math.round(componentCost * 100) / 100,
                    costPercentage: ((componentCost / 847.5) * 100).toFixed(1),  // 相对于总估算成本
                },
                utilization: {
                    cpuPercent: getSimulatedCpu(containerName),
                    memoryPercent: getSimulatedMem(containerName),
                    status: getStatusIcon(containerName),
                },
            });
        }

        // 按成本降序排列
        components.sort((a, b) => b.cost.estimatedMonthlyCNY - a.cost.estimatedMonthlyCNY);

        res.json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                totalComponents: components.length,
                components,
                categories: {
                    core: components.filter(c => c.category === 'core').length,
                    monitoring: components.filter(c => c.category === 'monitoring').length,
                    tool: components.filter(c => c.category === 'tool').length,
                },
            },
        });
    } catch (error) {
        console.error('[Cost/API] Components error:', error);
        res.status(500).json({
            success: false,
            error: 'COMPONENTS_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Endpoint: GET /api/v1/cost/waste
// ============================================

/**
 * 浪费项列表 — 含优化建议和优先级排序
 */
router.get('/waste', (req, res) => {
    try {
        const { severity, category } = req.query;
        let wasteItems = detectWasteItems();

        // 按严重程度过滤
        if (severity) {
            wasteItems = wasteItems.filter(w => w.severity === severity);
        }

        // 按类别过滤
        if (category) {
            wasteItems = wasteItems.filter(w => w.category === category);
        }

        // 按 ROI 排序（节省金额降序）
        wasteItems.sort((a, b) =>
            (parseFloat(b.estimatedSavingCNY) || 0) - (parseFloat(a.estimatedSavingCNY) || 0)
        );

        const totalSaving = calculateTotalSaving(wasteItems);

        // 生成优化建议摘要
        const recommendations = generateOptimizationRecommendations(wasteItems);

        res.json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                totalItems: wasteItems.length,
                totalEstimatedSavingCNY: totalSaving,
                items: wasteItems,
                recommendations,
                actionPlan: {
                    immediateActions: wasteItems.filter(w => w.type === 'MEMORY_OVERPROVISION'),
                    thisWeekActions: wasteItems.filter(w => w.type === 'CPU_OVERPROVISION' || w.type === 'UNUSED_IMAGES'),
                    nextWeekActions: wasteItems.filter(w => w.type === 'REDUNDANT_LOGS' || w.type === 'REDUNDANT_BACKUPS'),
                    reviewOnly: wasteItems.filter(w => w.type === 'IDLE_CONTAINER'),
                },
            },
        });
    } catch (error) {
        console.error('[Cost/API] Waste error:', error);
        res.status(500).json({
            success: false,
            error: 'WASTE_DETECTION_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Endpoint: GET /api/v1/cost/trends
// ============================================

/**
 * 成本趋势 — 周/月维度历史数据和预测
 */
router.get('/trends', (req, res) => {
    try {
        const { period = 'monthly', months = 6 } = req.query;
        const numMonths = Math.min(Math.max(parseInt(months) || 6, 1), 12);

        // 生成模拟趋势数据（实际环境从CSV/Prometheus读取）
        const trends = generateTrendData(numMonths);

        // 预测未来趋势（简单线性外推）
        const forecast = generateForecast(trends);

        res.json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                period,
                dataPoints: numMonths,
                historical: trends,
                forecast,
                insights: {
                    trendDirection: trends[trends.length - 1].total > trends[0].total ? 'increasing' : 'decreasing',
                    monthOverMonthChange: trends.length >= 2
                        ? (((trends[trends.length - 1].total - trends[trends.length - 2].total) / trends[trends.length - 2].total) * 100).toFixed(1) + '%'
                        : 'N/A',
                    highestMonth: [...trends].sort((a, b) => b.total - a.total)[0],
                    lowestMonth: [...trends].sort((a, b) => a.total - b.total)[0],
                },
            },
        });
    } catch (error) {
        console.error('[Cost/API] Trends error:', error);
        res.status(500).json({
            success: false,
            error: 'TRENDS_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Endpoint: GET /api/v1/cloud/estimate
// ============================================

/**
 * 云迁移成本估算 — 三云厂商对比
 */
router.get('/cloud/estimate', (req, res) => {
    try {
        const { provider } = req.query;

        const localCost = calculateLocalMonthlyCost();

        let result = {};

        if (!provider || provider === 'all' || provider === 'aws') {
            result.aws = calculateCloudMonthlyCost('aws');
        }
        if (!provider || provider === 'all' || provider === 'azure') {
            result.azure = calculateCloudMonthlyCost('azure');
        }
        if (!provider || provider === 'all' || provider === 'gcp') {
            result.gcp = calculateCloudMonthlyCost('gcp');
        }

        // TCO 对比 (3年)
        const tcoComparison = {};
        for (const [p, cost] of Object.entries(result)) {
            tcoComparison[p] = {
                onDemand3Y: Math.round(cost.breakdown.totalOnDemand * 36),
                reserved3Y: Math.round(cost.breakdown.reserved3Y * 36),
                savingsVsOnDemand: Math.round((cost.breakdown.totalOnDemand - cost.breakdown.reserved3Y) * 36),
            };
        }

        // Free Tier 利用度分析
        const freeTierAnalysis = {
            aws: {
                eligibleComponents: ['API (EC2 t3.micro)', 'Nginx (EC2 t3.micro)', 'Redis (ElastiCache)', 'PostgreSQL (RDS t3.micro)', 'Monitoring (CloudWatch)'],
                estimatedFreeCoverage: 65,  // 百分比
                freePeriodMonths: 12,
                notes: 'AWS Free Tier 覆盖大部分核心组件，12个月后需付费',
            },
            azure: {
                eligibleComponents: ['API (B1s VM)', 'PostgreSQL (SQL Basic)', 'Redis (C0 Cache)', 'Monitoring (App Insights)'],
                estimatedFreeCoverage: 70,
                freePeriodMonths: 12,
                notes: 'Azure Free Tier 覆盖面广，App Insights永久免费层是亮点',
            },
            gcp: {
                eligibleComponents: ['API (e2-micro)', 'PostgreSQL (db-f1-micro Always Free)', 'Monitoring (150 metrics)'],
                estimatedFreeCoverage: 45,
                freePeriodMonths: 999,  // Always Free
                notes: 'GCP Always Free 最适合长期小规模部署，但覆盖面相对有限',
            },
        };

        res.json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                sourceInfrastructure: 'GlobalReach V2.0 Docker Compose (13 containers)',
                currentLocalCost: localCost,
                cloudEstimates: result,
                tcoComparison,
                freeTierAnalysis,
                recommendation: generateCloudRecommendation(result, localCost),
            },
        });
    } catch (error) {
        console.error('[Cost/API] Cloud estimate error:', error);
        res.status(500).json({
            success: false,
            error: 'CLOUD_ESTIMATE_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Endpoint: POST /api/v1/cost/optimize
// ============================================

/**
 * 执行推荐的优化动作（管理员权限）
 * 注意：此接口仅记录优化建议的执行状态，不执行实际的资源调整
 * 实际的资源变更需要运维人员手动确认后操作
 */
router.post('/optimize', (req, res) => {
    try {
        const { actionId, actionType, confirmed } = req.body;

        if (!actionId || !actionType) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: '请求体必须包含 actionId 和 actionType 字段',
            });
        }

        if (!confirmed) {
            return res.status(400).json({
                success: false,
                error: 'CONFIRMATION_REQUIRED',
                message: '需要确认执行优化操作。请设置 confirmed: true 并理解风险。',
                riskWarning: '优化操作可能影响服务可用性！请确保在维护窗口内执行。',
            });
        }

        // 验证操作类型是否合法
        const validActionTypes = [
            'RIGHT_SIZE_CPU',
            'RIGHT_SIZE_MEMORY',
            'REMOVE_IDLE_CONTAINER',
            'CLEANUP_UNUSED_IMAGES',
            'COMPRESS_LOGS',
            'ADJUST_BACKUP_RETENTION',
            'MERGE_MONITORING_STACK',
        ];

        if (!validActionTypes.includes(actionType)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ACTION_TYPE',
                message: `不支持的操作类型: ${actionType}`,
                supportedTypes: validActionTypes,
            });
        }

        // 生成优化执行计划（只读模式：仅返回建议的操作步骤）
        const executionPlan = generateExecutionPlan(actionId, actionType);

        // 记录优化操作到日志文件
        logOptimizationAction(actionId, actionType, executionPlan);

        res.json({
            success: true,
            message: '优化执行计划已生成（只读模式：未执行实际变更）',
            data: {
                actionId,
                actionType,
                status: 'PLAN_GENERATED',
                executionPlan,
                appliedAt: new Date().toISOString(),
                rollbackAvailable: true,
                note: '此为只读分析模式。实际资源调整请手动执行 plan 中的命令，或在维护窗口通过 DevOps 流程操作。',
            },
        });
    } catch (error) {
        console.error('[Cost/API] Optimize error:', error);
        res.status(500).json({
            success: false,
            error: 'OPTIMIZE_ERROR',
            message: error.message,
        });
    }
});

// ============================================
// Internal Helper Functions
// ============================================

/**
 * 获取模拟的CPU利用率数据
 */
function getSimulatedCpu(containerName) {
    const simulatedData = {
        'globalreach-api-prod': 12,
        'globalreach-postgres': 5,
        'globalreach-redis': 1,
        'globalreach-nginx-prod': 3,
        'globalreach-prometheus': 8,
        'globalreach-grafana': 3,
        'globalreach-loki': 4,
        'globalreach-tempo': 2,
        'globalreach-alertmanager': 1,
        'globalreach-mailpit': 0,
        'globalreach-node-exporter': 1,
        'globalreach-pg-exporter': 1,
        'globalreach-promtail': 2,
    };
    return simulatedData[containerName] || 0;
}

/**
 * 获取模拟的内存利用率数据
 */
function getSimulatedMem(containerName) {
    const resource = CONTAINER_RESOURCES[containerName];
    if (!resource) return 0;
    const usedData = {
        'globalreach-api-prod': 128,
        'globalreach-postgres': 380,
        'globalreach-redis': 45,
        'globalreach-nginx-prod': 32,
        'globalreach-prometheus': 450,
        'globalreach-grafana': 78,
        'globalreach-loki': 120,
        'globalreach-tempo': 95,
        'globalreach-alertmanager': 18,
        'globalreach-mailpit': 15,
        'globalreach-node-exporter': 12,
        'globalreach-pg-exporter': 14,
        'globalreach-promtail': 8,
    };
    const used = usedData[containerName] || 0;
    return Math.round((used / resource.memLimitMB) * 100);
}

/**
 * 获取状态图标
 */
function getStatusIcon(containerName) {
    const cpu = getSimulatedCpu(containerName);
    const mem = getSimulatedMem(containerName);

    if (cpu < 5 && mem < 30) return 'idle';
    if (cpu < 10 && mem < 50) return 'underutilized';
    if (cpu > 80 || mem > 80) return 'overloaded';
    return 'healthy';
}

/**
 * 生成优化建议
 */
function generateOptimizationRecommendations(wasteItems) {
    const byType = {};
    for (const item of wasteItems) {
        if (!byType[item.type]) byType[item.type] = [];
        byType[item.type].push(item);
    }

    const recommendations = [];

    // 内存过配优化
    if (byType.MEMORY_OVERPROVISION && byType.MEMORY_OVERPROVISION.length > 0) {
        const items = byType.MEMORY_OVERPROVISION;
        const totalSaving = calculateTotalSaving(items);
        recommendations.push({
            priority: 'P0',
            type: 'RIGHT_SIZE_MEMORY',
            title: `降低 ${items.length} 个容器的内存分配`,
            description: `检测到 ${items.length} 个容器存在内存过配问题，共可节省约 ¥${totalSaving}/月`,
            affectedContainers: items.map(i => i.component),
            estimatedSavingCNY: totalSaving,
            effort: 'low',      // low | medium | high
            risk: 'low',         // low | medium | high
            action: '修改 docker-compose.prod.yml 中对应服务的 deploy.resources.limits.memory',
        });
    }

    // CPU过配优化
    if (byType.CPU_OVERPROVISION && byType.CPU_OVERPROVISION.length > 0) {
        const items = byType.CPU_OVERPROVISION;
        const totalSaving = calculateTotalSaving(items);
        recommendations.push({
            priority: 'P1',
            type: 'RIGHT_SIZE_CPU',
            title: `降低 ${items.length} 个容器的CPU限制`,
            description: `检测到 ${items.length} 个容器CPU利用率低于10%，可适当降低CPU limit`,
            affectedContainers: items.map(i => i.component),
            estimatedSavingCNY: totalSaving,
            effort: 'low',
            risk: 'low',
            action: '修改 docker-compose.prod.yml 中对应服务的 deploy.resources.limits.cpus',
        });
    }

    // 未使用镜像清理
    if (byType.UNUSED_IMAGES && byType.UNUSED_IMAGES.length > 0) {
        recommendations.push({
            priority: 'P1',
            type: 'CLEANUP_UNUSED_IMAGES',
            title: '清理未使用的Docker镜像',
            description: '发现悬空(dangling)镜像占用磁盘空间',
            estimatedSavingCNY: calculateTotalSaving(byType.UNUSED_IMAGES),
            effort: 'very_low',
            risk: 'very_low',
            action: 'docker image prune -a 或设置 cron weekly 自动清理',
        });
    }

    // 日志优化
    if (byType.REDUNDANT_LOGS && byType.REDUNDANT_LOGS.length > 0) {
        recommendations.push({
            priority: 'P2',
            type: 'COMPRESS_LOGS',
            title: '优化日志保留策略',
            description: 'Loki日志存储超过阈值，建议压缩或缩短保留期',
            estimatedSavingCNY: calculateTotalSaving(byType.REDUNDANT_LOGS),
            effort: 'low',
            risk: 'low',
            action: '调整 Loki 配置中的 retention_period 或启用压缩',
        });
    }

    // 监控栈合并
    const idleMonitors = wasteItems.filter(w => w.type === 'IDLE_CONTAINER' && w.category === 'monitoring');
    if (idleMonitors.length >= 3) {
        recommendations.push({
            priority: 'P2',
            type: 'MERGE_MONITORING_STACK',
            title: '合并轻载监控组件',
            description: `${idleMonitors.length} 个监控容器处于空闲状态，可考虑合并为单机部署`,
            estimatedSavingCNY: idleMonitors.length * 5,
            effort: 'medium',
            risk: 'medium',
            action: '评估将 Grafana/Loki/Tempo 部署为单一 all-in-one 实例的可行性',
        });
    }

    // 按节省金额排序
    recommendations.sort((a, b) => (b.estimatedSavingCNY || 0) - (a.estimatedSavingCNY || 0));

    return recommendations;
}

/**
 * 生成趋势数据（模拟）
 */
function generateTrendData(numMonths) {
    const trends = [];
    const now = new Date();

    for (let i = numMonths - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        // 模拟: 基础成本 ¥847 + 随机波动 ±5%
        const baseCost = 847;
        const variance = (Math.random() - 0.5) * 80;
        const trendIncrease = i * 2;  // 轻微上升趋势

        trends.push({
            month: date.toISOString().slice(0, 7),  // YYYY-MM
            total: Math.round((baseCost + variance + trendIncrease) * 100) / 100,
            power: Math.round(((baseCost * 0.102) + variance * 0.1) * 100) / 100,
            depreciation: 500,
            storage: Math.round((25 + Math.random() * 10) * 100) / 100,
            network: 0.2,
            utilization: Math.round((20 + Math.random() * 10) * 10) / 10,
            wasteDetected: Math.floor(Math.random() * 5) + 3,
        });
    }

    return trends;
}

/**
 * 生成预测数据
 */
function generateForecast(historical) {
    if (historical.length < 2) {
        return { available: false, reason: 'insufficient_data' };
    }

    const recent = historical.slice(-3);
    const avgChange = (recent[recent.length - 1].total - recent[0].total) / recent.length;
    const lastTotal = historical[historical.length - 1].total;

    return {
        available: true,
        method: 'linear_extrapolation',
        nextMonth: Math.round((lastTotal + avgChange) * 100) / 100,
        threeMonths: Math.round((lastTotal + avgChange * 3) * 100) / 100,
        sixMonths: Math.round((lastTotal + avgChange * 6) * 100) / 100,
        confidence: 'medium',
        note: '基于最近3个月线性趋势外推，实际费用受业务量变化影响',
    };
}

/**
 * 生成云迁移建议
 */
function generateCloudRecommendation(cloudCosts, localCost) {
    const entries = Object.entries(cloudCosts);
    if (entries.length === 0) return null;

    // 找出最经济的选项
    const sorted = entries.sort((a, b) => a[1].breakdown.reserved3Y - b[1].breakdown.reserved3Y);
    const [bestProvider, bestCost] = sorted[0];

    // 本地 vs 云对比 (3年TCO)
    const local3Y = localCost.breakdown.total * 36;

    return {
        bestValueProvider: bestProvider,
        bestMonthlyReserved: bestCost.breakdown.reserved3Y,
        comparison: {
            local3YCNY: Math.round(local3Y),
            cloud3YUSD: Math.round(bestCost.breakdown.reserved3Y * 36),
            recommendation: local3Y < bestCost.breakdown.reserved3Y * 36 * 7.2
                ? 'stay_local'
                : 'consider_migration',
            // USD to CNY approximate exchange rate: ~7.2
        },
        factors: {
            operationalOverhead: '云托管可降低运维复杂度',
            scalability: '云端弹性伸缩更适合业务增长场景',
            compliance: '本地部署对数据主权更有保障',
            migrationCost: '预计一次性迁移成本: ¥5,000-15,000 (人力+工具)',
        },
    };
}

/**
 * 生成执行计划
 */
function generateExecutionPlan(actionId, actionType) {
    const plans = {
        RIGHT_SIZE_CPU: {
            steps: [
                '1. 确认目标容器当前CPU负载峰值（检查 Prometheus 7天数据）',
                '2. 计算推荐的 CPU limit 值 (peak * 1.5)',
                '3. 更新 docker-compose.prod.yml 中 deploy.resources.limits.cpus',
                '4. 执行 docker compose up -d --no-deploy <service> 重启目标容器',
                '5. 观察 24小时确认稳定性',
            ],
            rollbackCommand: 'git checkout HEAD~1 -- docker-compose.prod.yml && docker compose up -d',
            estimatedDowntime: '0s (rolling restart)',
            riskLevel: 'low',
        },
        RIGHT_SIZE_MEMORY: {
            steps: [
                '1. 确认目标容器当前内存 RSS 和 OOM 历史',
                '2. 计算推荐的 memory limit (max_rss * 2)',
                '3. 更新 docker-compose.prod.yml 中 deploy.resources.limits.memory',
                '4. 如有 NODE_OPTIONS/MAX_OLD_SPACE_SIZE 也需同步调整',
                '5. 重启容器并观察 heap/memory 趋势',
            ],
            rollbackCommand: 'git checkout HEAD~1 -- docker-compose.prod.yml && docker compose up -d',
            estimatedDowntime: '0s (rolling restart)',
            riskLevel: 'low',
        },
        CLEANUP_UNUSED_IMAGES: {
            steps: [
                '1. 列出所有悬空镜像: docker images -f "dangling=true"',
                '2. 确认无运行中容器依赖这些镜像层',
                '3. 执行清理: docker image prune -a',
                '4. 验证磁盘空间释放: docker system df',
            ],
            rollbackCommand: 'N/A (已清理镜像需重新 pull/build)',
            estimatedDowntime: '0s',
            riskLevel: 'very_low',
        },
        COMPRESS_LOGS: {
            steps: [
                '1. 当前Loki保留策略检查',
                '2. 修改 loki-config.yml 中的 retention_period (如 168h → 72h)',
                '3. 重启 Loki 容器: docker compose restart loki',
                '4. 旧数据将在 retention 到期后自动清理',
            ],
            rollbackCommand: '恢复 loki-config.yml 并重启',
            estimatedDowntime: '< 5s',
            riskLevel: 'low',
        },
        MERGE_MONITORING_STACK: {
            steps: [
                '1. 评估 Grafana/Loki/Tempo 合并为单一实例的资源需求',
                '2. 选择 all-in-one 镜像 (如 grafana/grafana-image-renderer 或自建)',
                '3. 编写新的 compose service 定义',
                '4. 数据迁移: Prometheus TSDB、Loki index、Tempo traces',
                '5. 切换 DNS/端口映射，验证所有 datasource 连接',
                '6. 逐步下线旧容器',
            ],
            rollbackCommand: '恢复原始 docker-compose 配置并重启',
            estimatedDowntime: '5-15min',
            riskLevel: 'medium',
        },
    };

    return plans[actionType] || {
        steps: [`执行优化操作: ${actionType} (actionId: ${actionId})`],
        rollbackCommand: 'git revert HEAD',
        estimatedDowntime: 'unknown',
        riskLevel: 'unknown',
    };
}

/**
 * 记录优化操作日志
 */
function logOptimizationAction(actionId, actionType, plan) {
    try {
        const logDir = path.join(DATA_DIR, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            actionId,
            actionType,
            status: 'PLAN_GENERATED',
            plan,
        };

        const logFile = path.join(logDir, 'optimization-actions.log');
        const line = JSON.stringify(logEntry) + '\n';
        fs.appendFileSync(logFile, line);
    } catch (err) {
        console.error('[Cost/API] Failed to log optimization action:', err.message);
    }
}

module.exports = router;
