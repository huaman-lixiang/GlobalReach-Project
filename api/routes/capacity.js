/**
 * Capacity Planning API — O04 容量规划自动化
 *
 * RESTful endpoints for capacity analysis, forecasting, and recommendations.
 * Provides programmatic access to the capacity planning system.
 *
 * Endpoints:
 *   GET  /api/v1/capacity/summary          — Current capacity overview (all components)
 *   GET  /api/v1/capacity/:component       — Detailed component analysis
 *   GET  /api/v1/capacity/forecast/:days   — N-day forecast
 *   GET  /api/v1/capacity/history          — Historical capacity data
 *   GET  /api/v1/capacity/recommendations  — Scaling recommendations list
 *   POST /api/v1/capacity/thresholds       — Update threshold configuration (admin)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ============================================
# Configuration
# ============================================

const DATA_DIR = path.join(__dirname, '../../data/capacity');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const AGGREGATED_DIR = path.join(DATA_DIR, 'aggregated/hourly');
const SCRIPT_DIR = path.join(__dirname, '../../scripts');

// 支持分析的组件列表
const SUPPORTED_COMPONENTS = ['api', 'postgresql', 'redis', 'nginx', 'monitoring', 'disk'];

// 默认阈值配置（可动态更新）
let thresholds = {
    api: {
        cpu: { warning: 60, critical: 80 },
        memory_mb: { value: 512, warning: 70, critical: 90 },
        connections: { value: 100, warning: 50, critical: 80 },
        heap_percent: { value: 85, warning: 60, critical: 85 },
        event_loop_lag_ms: { value: 50, warning: 30, critical: 50 },
    },
    postgresql: {
        cpu: { warning: 60, critical: 80 },
        memory_mb: { value: 1024, warning: 70, critical: 90 },
        connections: { value: 100, warning: 50, critical: 80 },
        disk_gb: { value: 50, warning: 60, critical: 85 },
    },
    redis: {
        cpu: { warning: 60, critical: 80 },
        memory_mb: { value: 64, warning: 60, critical: 85 },
        keys: { value: 10000, warning: 50, critical: 80 },
        clients: { value: 100, warning: 50, critical: 80 },
        fragmentation_ratio: { value: 3.0, warning: 1.5, critical: 3.0 },
    },
    nginx: {
        cpu: { warning: 60, critical: 80 },
        memory_mb: { value: 128, warning: 70, critical: 90 },
        connections: { value: 10000, warning: 50, critical: 80 },
    },
    monitoring: {
        total_memory_mb: { value: 512, warning: 65, critical: 85 },
    },
    disk: {
        usage_percent: { value: 80, warning: 65, critical: 85 },
        inode_percent: { value: 85, warning: 70, critical: 90 },
    },
};

// ============================================
# Helper Functions
# ============================================

/**
 * 读取CSV文件并解析为JSON数组
 */
function parseCsvFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, i) => {
            obj[header.trim()] = (values[i] || '').trim();
        });
        return obj;
    });
}

/**
 * 从CSV文件获取最新的一条记录
 */
function getLatestRecord(component) {
    const csvFile = path.join(RAW_DIR, `${component}_metrics.csv`);
    const records = parseCsvFile(csvFile);
    return records.length > 0 ? records[records.length - 1] : null;
}

/**
 * 获取历史记录（支持分页和时间范围）
 */
function getHistoryRecords(component, options = {}) {
    const csvFile = path.join(RAW_DIR, `${component}_metrics.csv`);
    let records = parseCsvFile(csvFile);
    
    // 按时间过滤
    if (options.since) {
        const sinceTime = new Date(options.since).getTime();
        records = records.filter(r => new Date(r.timestamp).getTime() >= sinceTime);
    }
    if (options.until) {
        const untilTime = new Date(options.until).getTime();
        records = records.filter(r => new Date(r.timestamp).getTime() <= untilTime);
    }
    
    // 分页
    const limit = parseInt(options.limit) || 100;
    const offset = parseInt(options.offset) || 0;
    
    return {
        total: records.length,
        records: records.slice(offset, offset + limit),
        limit,
        offset,
    };
}

/**
 * 计算利用率百分比
 */
function calcUtilization(current, threshold) {
    if (!current || !threshold || threshold === 0) return 0;
    return Math.min(100, Math.max(0, (parseFloat(current) / parseFloat(threshold)) * 100));
}

/**
 * 确定状态等级
 */
function getStatusLevel(utilization) {
    if (utilization >= 90) return 'RED';
    if (utilization >= 75) return 'ORANGE';
    if (utilization >= 50) return 'YELLOW';
    return 'GREEN';
}

/**
 * 获取下次评估间隔（天）
 */
function getNextReviewDays(status) {
    switch (status) {
        case 'RED': return 1;
        case 'ORANGE': return 7;
        case 'YELLOW': return 14;
        case 'GREEN':
        default: return 30;
    }
}

/**
 * 简化的线性预测：基于最近N个数据点的趋势外推
 */
function simpleForecast(currentValue, historicalRecords, days, field) {
    if (!historicalRecords || historicalRecords.length < 2) {
        return { predicted: currentValue, growthRate: 0, daysToThreshold: -1 };
    }
    
    // 取最近的数据点计算日均变化
    const recentRecords = historicalRecords.slice(-Math.min(historicalRecords.length, 24)); // 最近24个采样点
    let sumDiff = 0;
    let validPairs = 0;
    
    for (let i = 1; i < recentRecords.length; i++) {
        const prev = parseFloat(recentRecords[i - 1][field]);
        const curr = parseFloat(recentRecords[i][field]);
        if (!isNaN(prev) && !isNaN(curr)) {
            sumDiff += (curr - prev);
            validPairs++;
        }
    }
    
    const avgDailyChange = validPairs > 0 ? sumDiff / validPairs : 0;
    const growthRate = currentValue > 0 ? (avgDailyChange / Math.abs(currentValue)) * 100 : 0;
    
    // 复合增长预测
    let predicted;
    if (currentValue > 0 && growthRate !== 0) {
        predicted = currentValue * Math.pow(1 + growthRate / 100, days);
    } else {
        predicted = currentValue;
    }
    
    return {
        predicted: Math.round(predicted * 100) / 100,
        growthRate: Math.round(growthRate * 1000) / 1000,
        daysToThreshold: -1, // 由调用方根据具体阈值计算
    };
}

/**
 * 执行外部shell脚本并返回结果
 */
function runAnalyzerScript(args = []) {
    try {
        const scriptPath = path.join(SCRIPT_DIR, 'capacity-analyzer.sh');
        const result = execSync(`bash "${scriptPath}" ${args.join(' ')}`, {
            encoding: 'utf-8',
            timeout: 30000, // 30秒超时
            cwd: path.join(__dirname, '../..'),
        });
        return result;
    } catch (error) {
        console.error('[Capacity/API] Analyzer script error:', error.message);
        return null;
    }
}

// ============================================
# Endpoint: GET /api/v1/capacity/summary
// ============================================

/**
 * 当前容量总览 — 所有组件一行摘要
 * 返回每个组件的关键指标和整体状态
 */
router.get('/summary', (_req, res) => {
    try {
        const summary = {
            timestamp: new Date().toISOString(),
            overallStatus: 'GREEN',
            bottleneckComponent: null,
            bottleneckUtilization: 0,
            components: {},
            nextReviewDate: null,
        };
        
        let maxUtil = 0;
        
        for (const component of SUPPORTED_COMPONENTS) {
            const record = getLatestRecord(component);
            const thresh = thresholds[component];
            
            if (!record || !thresh) continue;
            
            const compData = {
                status: 'UNKNOWN',
                keyMetric: '',
                utilization: 0,
                lastUpdate: record.timestamp || null,
            };
            
            // 根据不同组件提取关键指标
            switch (component) {
                case 'api': {
                    const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                    compData.keyMetric = 'memory_utilization';
                    compData.utilization = memUtil;
                    compData.metrics = {
                        cpu_percent: parseFloat(record.cpu_percent) || 0,
                        memory_mb: parseFloat(record.memory_mb) || 0,
                        active_connections: parseFloat(record.active_connections) || 0,
                        heap_usage_percent: parseFloat(record.heap_usage_percent) || 0,
                        p95_latency_ms: parseFloat(record.p95_latency_ms) || 0,
                    };
                    break;
                }
                case 'postgresql': {
                    const diskUtil = calcUtilization(record.disk_used_percent, thresh.disk_gb.critical);
                    compData.keyMetric = 'disk_utilization';
                    compData.utilization = diskUtil;
                    compData.metrics = {
                        cpu_percent: parseFloat(record.cpu_percent) || 0,
                        memory_mb: parseFloat(record.memory_mb) || 0,
                        active_connections: parseFloat(record.active_connections) || 0,
                        disk_used_percent: parseFloat(record.disk_used_percent) || 0,
                    };
                    break;
                }
                case 'redis': {
                    const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                    compData.keyMetric = 'memory_utilization';
                    compData.utilization = memUtil;
                    compData.metrics = {
                        cpu_percent: parseFloat(record.cpu_percent) || 0,
                        memory_mb: parseFloat(record.memory_mb) || 0,
                        key_count: parseFloat(record.key_count) || 0,
                        connected_clients: parseFloat(record.connected_clients) || 0,
                        ops_per_sec: parseFloat(record.ops_per_sec) || 0,
                    };
                    break;
                }
                case 'nginx': {
                    const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                    compData.keyMetric = 'memory_utilization';
                    compData.utilization = memUtil;
                    compData.metrics = {
                        cpu_percent: parseFloat(record.cpu_percent) || 0,
                        memory_mb: parseFloat(record.memory_mb) || 0,
                        active_connections: parseFloat(record.active_connections) || 0,
                    };
                    break;
                }
                case 'monitoring': {
                    const memUtil = calcUtilization(record.total_memory_mb, thresh.total_memory_mb.value);
                    compData.keyMetric = 'total_memory_utilization';
                    compData.utilization = memUtil;
                    compData.metrics = {
                        total_cpu_percent: parseFloat(record.total_cpu_percent) || 0,
                        total_memory_mb: parseFloat(record.total_memory_mb) || 0,
                        container_count: parseInt(record.container_count) || 0,
                    };
                    break;
                }
                case 'disk': {
                    const diskUtil = parseFloat(record.used_percent) || 0;
                    compData.keyMetric = 'disk_usage_percent';
                    compData.utilization = diskUtil;
                    compData.metrics = {
                        used_gb: parseFloat(record.used_gb) || 0,
                        total_gb: parseFloat(record.size_gb) || 0,
                        used_percent: diskUtil,
                        inodes_used_percent: parseFloat(record.inodes_used_percent) || 0,
                    };
                    break;
                }
            }
            
            compData.status = getStatusLevel(compData.utilization);
            summary.components[component] = compData;
            
            // 追踪最大利用率
            if (compData.utilization > maxUtil) {
                maxUtil = compData.utilization;
                summary.bottleneckComponent = component;
                summary.bottleneckUtilization = compData.utilization;
            }
        }
        
        // 确定整体状态
        summary.overallStatus = getStatusLevel(maxUtil);
        
        // 计算下次评估日期
        const nextReviewDays = getNextReviewDays(summary.overallStatus);
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + nextReviewDays);
        summary.nextReviewDate = nextReview.toISOString();
        summary.nextReviewDays = nextReviewDays;
        
        res.json({
            success: true,
            data: summary,
        });
    } catch (error) {
        console.error('[Capacity/API] Summary error:', error);
        res.status(500).json({
            success: false,
            error: 'SUMMARY_ERROR',
            message: error.message,
        });
    }
});

// ============================================
# Endpoint: GET /api/v1/capacity/:component
// ============================================

/**
 * 指定组件详细分析
 * 返回该组件的所有指标、趋势、预测和状态判定
 */
router.get('/:component', (req, res) => {
    try {
        const { component } = req.params;
        
        if (!SUPPORTED_COMPONENTS.includes(component)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_COMPONENT',
                message: `不支持的组件: ${component}. 支持: ${SUPPORTED_COMPONENTS.join(', ')}`,
            });
        }
        
        const record = getLatestRecord(component);
        const history = parseCsvFile(path.join(RAW_DIR, `${component}_metrics.csv`));
        const thresh = thresholds[component];
        
        if (!record) {
            return res.json({
                success: true,
                data: {
                    component,
                    status: 'NO_DATA',
                    message: '暂无历史数据。请确保 capacity-collector.sh 正在运行。',
                    metrics: {},
                    trend: {},
                    forecast: {},
                },
            });
        }
        
        // 构建详细分析结果
        const analysis = {
            component,
            timestamp: new Date().toISOString(),
            collectedAt: record.timestamp,
            metrics: {},
            trend: {},
            forecast: {},
            status: 'GREEN',
            nextReviewDays: 30,
            thresholdConfig: thresh,
        };
        
        // 根据组件类型填充指标和分析
        let maxUtil = 0;
        
        switch (component) {
            case 'api': {
                const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                const connUtil = calcUtilization(record.active_connections, thresh.connections.value);
                const heapUtil = calcUtilization(record.heap_usage_percent, thresh.heap_percent.value);
                
                analysis.metrics = {
                    cpu: { current: parseFloat(record.cpu_percent) || 0, threshold: 80, unit: '%', utilization: parseFloat(record.cpu_percent) || 0 },
                    memory: { current: parseFloat(record.memory_mb) || 0, threshold: thresh.memory_mb.value, unit: 'MB', utilization: memUtil },
                    connections: { current: parseFloat(record.active_connections) || 0, threshold: thresh.connections.value, unit: '', utilization: connUtil },
                    heapUsage: { current: parseFloat(record.heap_usage_percent) || 0, threshold: thresh.heap_percent.value, unit: '%', utilization: heapUtil },
                    p95Latency: { current: parseFloat(record.p95_latency_ms) || 0, threshold: 100, unit: 'ms', utilization: ((parseFloat(record.p95_latency_ms) || 0) / 100) * 100 },
                    qps: { current: parseFloat(record.qps) || 0, threshold: 1000, unit: '', utilization: ((parseFloat(record.qps) || 0) / 1000) * 100 },
                };
                
                // 趋势分析
                const memForecast = simpleForecast(memUtil, history, 30, 'memory_mb');
                analysis.trend = {
                    dailyMemoryGrowthRate: memForecast.growthRate,
                    sampleCount: history.length,
                };
                analysis.forecast = {
                    days: 30,
                    predictedMemoryUtilization: memForecast.predicted,
                };
                
                maxUtil = Math.max(memUtil, connUtil, heapUtil);
                break;
            }
            
            case 'postgresql': {
                const connUtil = calcUtilization(record.active_connections, thresh.connections.value);
                const diskUtil = parseFloat(record.disk_used_percent) || 0;
                
                analysis.metrics = {
                    cpu: { current: parseFloat(record.cpu_percent) || 0, threshold: 80, unit: '%', utilization: parseFloat(record.cpu_percent) || 0 },
                    memory: { current: parseFloat(record.memory_mb) || 0, threshold: thresh.memory_mb.value, unit: 'MB', utilization: calcUtilization(record.memory_mb, thresh.memory_mb.value) },
                    connections: { current: parseFloat(record.active_connections) || 0, threshold: thresh.connections.value, unit: '', utilization: connUtil },
                    diskUsage: { current: parseFloat(record.disk_used_gb) || 0, threshold: thresh.disk_gb.value, unit: 'GB', utilization: diskUtil },
                    databaseSizeBytes: parseFloat(record.database_size_bytes) || 0,
                };
                
                const diskForecast = simpleForecast(diskUtil, history, 30, 'disk_used_percent');
                analysis.trend = { dailyDiskGrowthRate: diskForecast.growthRate, sampleCount: history.length };
                analysis.forecast = { days: 30, predictedDiskUtilization: diskForecast.predicted };
                
                maxUtil = Math.max(connUtil, diskUtil);
                break;
            }
            
            case 'redis': {
                const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                const keysUtil = calcUtilization(record.key_count, thresh.keys.value);
                const clientsUtil = calcUtilization(record.connected_clients, thresh.clients.value);
                
                analysis.metrics = {
                    cpu: { current: parseFloat(record.cpu_percent) || 0, threshold: 80, unit: '%', utilization: parseFloat(record.cpu_percent) || 0 },
                    memory: { current: parseFloat(record.memory_mb) || 0, threshold: thresh.memory_mb.value, unit: 'MB', utilization: memUtil, humanReadable: record.used_memory_human },
                    keyCount: { current: parseFloat(record.key_count) || 0, threshold: thresh.keys.value, unit: '', utilization: keysUtil },
                    connectedClients: { current: parseFloat(record.connected_clients) || 0, threshold: thresh.clients.value, unit: '', utilization: clientsUtil },
                    opsPerSec: { current: parseFloat(record.ops_per_sec) || 0, threshold: 100000, unit: '' },
                    fragmentationRatio: { current: parseFloat(record.fragmentation_ratio) || 0, threshold: thresh.fragmentation_ratio.value },
                    evictedKeys: { current: parseFloat(record.evicted_keys) || 0 },
                    expiredKeys: { current: parseFloat(record.expired_keys) || 0 },
                };
                
                const keysForecast = simpleForecast(keysUtil, history, 30, 'key_count');
                analysis.trend = { dailyKeyGrowthRate: keysForecast.growthRate, sampleCount: history.length };
                analysis.forecast = { days: 30, predictedKeyUtilization: keysForecast.predicted };
                
                maxUtil = Math.max(memUtil, keysUtil, clientsUtil);
                break;
            }
            
            case 'nginx': {
                const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                const connUtil = calcUtilization(record.active_connections, thresh.connections.value);
                
                analysis.metrics = {
                    cpu: { current: parseFloat(record.cpu_percent) || 0, threshold: 80, unit: '%', utilization: parseFloat(record.cpu_percent) || 0 },
                    memory: { current: parseFloat(record.memory_mb) || 0, threshold: thresh.memory_mb.value, unit: 'MB', utilization: memUtil },
                    activeConnections: { current: parseFloat(record.active_connections) || 0, threshold: thresh.connections.value, unit: '', utilization: connUtil },
                    requests: { current: parseFloat(record.requests) || 0 },
                    accepts: { current: parseFloat(record.accepts) || 0 },
                    handled: { current: parseFloat(record.handled) || 0 },
                };
                
                analysis.trend = { sampleCount: history.length };
                analysis.forecast = { days: 30, note: 'Nginx容量主要取决于上游流量模式' };
                
                maxUtil = Math.max(memUtil, connUtil);
                break;
            }
            
            case 'monitoring': {
                const memUtil = calcUtilization(record.total_memory_mb, thresh.total_memory_mb.value);
                
                analysis.metrics = {
                    totalCpu: { current: parseFloat(record.total_cpu_percent) || 0, threshold: 200, unit: '%' },
                    totalMemory: { current: parseFloat(record.total_memory_mb) || 0, threshold: thresh.total_memory_mb.value, unit: 'MB', utilization: memUtil },
                    containerCount: { current: parseInt(record.container_count) || 0 },
                    tsdbSizeBytes: { current: parseFloat(record.tsdb_size_bytes) || 0 },
                };
                
                analysis.trend = { sampleCount: history.length };
                analysis.forecast = { days: 30, note: '监控栈容量随数据积累缓慢增长' };
                
                maxUtil = memUtil;
                break;
            }
            
            case 'disk': {
                const diskUtil = parseFloat(record.used_percent) || 0;
                const inodeUtil = parseFloat(record.inodes_used_percent) || 0;
                
                analysis.metrics = {
                    filesystem: record.filesystem || 'unknown',
                    totalGb: { current: parseFloat(record.size_gb) || 0, unit: 'GB' },
                    usedGb: { current: parseFloat(record.used_gb) || 0, unit: 'GB' },
                    availableGb: { current: parseFloat(record.avail_gb) || 0, unit: 'GB' },
                    usagePercent: { current: diskUtil, threshold: thresh.usage_percent.value, unit: '%', utilization: diskUtil },
                    inodesPercent: { current: inodeUtil, threshold: thresh.inode_percent.value, unit: '%', utilization: inodeUtil },
                    dockerImages: record.docker_images || 'N/A',
                    dockerContainers: record.docker_containers || 'N/A',
                    dockerVolumes: record.docker_volumes || 'N/A',
                    dockerCache: record.docker_cache || 'N/A',
                };
                
                const diskForecast = simpleForecast(diskUtil, history, 30, 'used_percent');
                analysis.trend = { dailyGrowthRate: diskForecast.growthRate, sampleCount: history.length };
                analysis.forecast = {
                    days: 30,
                    predictedUtilization: diskForecast.predicted,
                };
                
                maxUtil = Math.max(diskUtil, inodeUtil);
                break;
            }
        }
        
        // 确定状态
        analysis.status = getStatusLevel(maxUtil);
        analysis.nextReviewDays = getNextReviewDays(analysis.status);
        analysis.bottleneckUtilization = Math.round(maxUtil * 100) / 100;
        
        res.json({ success: true, data: analysis });
    } catch (error) {
        console.error(`[Capacity/API] Component ${req.params.component} error:`, error);
        res.status(500).json({
            success: false,
            error: 'COMPONENT_ANALYSIS_ERROR',
            message: error.message,
        });
    }
});

// ============================================
# Endpoint: GET /api/v1/capacity/forecast/:days
// ============================================

/**
 * N天预测 — 所有组件的未来容量预测
 */
router.get('/forecast/:days', (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.params.days) || 30, 1), 365); // 限制在1-365天
        
        const forecast = {
            timestamp: new Date().toISOString(),
            forecastDays: days,
            components: {},
            warnings: [],
            alerts: [],
        };
        
        for (const component of SUPPORTED_COMPONENTS) {
            const record = getLatestRecord(component);
            const history = parseCsvFile(path.join(RAW_DIR, `${component}_metrics.csv`));
            const thresh = thresholds[component];
            
            if (!record || !thresh) continue;
            
            const compForecast = { component, predictions: {}, status: 'GREEN' };
            
            // 对每个关键指标进行预测
            switch (component) {
                case 'api': {
                    const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                    const memPred = simpleForecast(memUtil, history, days, 'memory_mb');
                    compForecast.predictions.memoryUtilization = {
                        current: Math.round(memUtil * 100) / 100,
                        predicted: Math.round(memPred.predicted * 100) / 100,
                        dailyGrowthRate: memPred.growthRate,
                    };
                    
                    if (memPred.predicted > 90) {
                        compForecast.status = 'RED';
                        forecast.alerts.push(`${component}: 内存预计将在 ${days} 天内达到 ${Math.round(memPred.predicted)}%`);
                    } else if (memPred.predicted > 75) {
                        compForecast.status = 'ORANGE';
                        forecast.warnings.push(`${component}: 内存预计将在 ${days} 天内达到 ${Math.round(memPred.predicted)}%`);
                    } else if (memPred.predicted > 50) {
                        compForecast.status = 'YELLOW';
                    }
                    break;
                }
                case 'postgresql': {
                    const diskUtil = parseFloat(record.disk_used_percent) || 0;
                    const diskPred = simpleForecast(diskUtil, history, days, 'disk_used_percent');
                    compForecast.predictions.diskUtilization = {
                        current: diskUtil,
                        predicted: Math.round(diskPred.predicted * 100) / 100,
                        dailyGrowthRate: diskPred.growthRate,
                    };
                    
                    if (diskPred.predicted > 85) {
                        compForecast.status = 'RED';
                        forecast.alerts.push(`${component}: 磁盘预计将在 ${days} 天内达到 ${Math.round(diskPred.predicted)}%`);
                    } else if (diskPred.predicted > 60) {
                        compForecast.status = diskPred.predicted > 75 ? 'ORANGE' : 'YELLOW';
                        forecast.warnings.push(`${component}: 磁盘预计将在 ${days} 天内达到 ${Math.round(diskPred.predicted)}%`);
                    }
                    break;
                }
                case 'redis': {
                    const keysUtil = calcUtilization(record.key_count, thresh.keys.value);
                    const keysPred = simpleForecast(keysUtil, history, days, 'key_count');
                    compForecast.predictions.keyUtilization = {
                        current: Math.round(keysUtil * 100) / 100,
                        predicted: Math.round(keysPred.predicted * 100) / 100,
                        dailyGrowthRate: keysPred.growthRate,
                    };
                    
                    if (keysPred.predicted > 80) {
                        compForecast.status = 'RED';
                        forecast.alerts.push(`${component}: Key数量预计将在 ${days} 天内达到 ${Math.round(keysPred.predicted)}%`);
                    } else if (keysPred.predicted > 50) {
                        compForecast.status = keysPred.predicted > 75 ? 'ORANGE' : 'YELLOW';
                    }
                    break;
                }
                case 'disk': {
                    const diskUtil = parseFloat(record.used_percent) || 0;
                    const diskPred = simpleForecast(diskUtil, history, days, 'used_percent');
                    compForecast.predictions.overallUtilization = {
                        current: diskUtil,
                        predicted: Math.round(diskPred.predicted * 100) / 100,
                        dailyGrowthRate: diskPred.growthRate,
                    };
                    
                    if (diskPred.predicted > 85) {
                        compForecast.status = 'RED';
                        forecast.alerts.push(`${component}: 磁盘使用率预计将在 ${days} 天内达到 ${Math.round(diskPred.predicted)}%`);
                    } else if (diskPred.predicted > 65) {
                        compForecast.status = diskPred.predicted > 80 ? 'ORANGE' : 'YELLOW';
                        forecast.warnings.push(`${component}: 磁盘使用率预计将在 ${days} 天内达到 ${Math.round(diskPred.predicted)}%`);
                    }
                    break;
                }
                default: {
                    // 其他组件保持基本预测
                    compForecast.note = `${component} 的预测基于当前趋势外推`;
                    break;
                }
            }
            
            forecast.components[component] = compForecast;
        }
        
        res.json({ success: true, data: forecast });
    } catch (error) {
        console.error('[Capacity/API] Forecast error:', error);
        res.status(500).json({
            success: false,
            error: 'FORECAST_ERROR',
            message: error.message,
        });
    }
});

// ============================================
# Endpoint: GET /api/v1/capacity/history
// ============================================

/**
 * 历史容量数据查询
 * 支持按组件、时间范围、分页筛选
 */
router.get('/history', (req, res) => {
    try {
        const { component, since, until, limit, offset } = req.query;
        
        let result = {};
        
        if (component && SUPPORTED_COMPONENTS.includes(component)) {
            // 单组件历史
            const history = getHistoryRecords(component, { since, until, limit, offset });
            result = {
                component,
                ...history,
                records: history.records.map(r => ({
                    timestamp: r.timestamp,
                    unixTimestamp: r.unix_timestamp,
                    ...r,
                })),
            };
        } else {
            // 所有组件的最新记录汇总
            result = { components: {} };
            for (const comp of SUPPORTED_COMPONENTS) {
                const latest = getLatestRecord(comp);
                if (latest) {
                    result.components[comp] = {
                        latestRecord: latest,
                        recordCount: parseCsvFile(path.join(RAW_DIR, `${comp}_metrics.csv`)).length,
                    };
                }
            }
        }
        
        res.json({
            success: true,
            data: result,
            query: { component, since, until, limit, offset },
        });
    } catch (error) {
        console.error('[Capacity/API] History error:', error);
        res.status(500).json({
            success: false,
            error: 'HISTORY_ERROR',
            message: error.message,
        });
    }
});

// ============================================
# Endpoint: GET /api/v1/capacity/recommendations
// ============================================

/**
 * 扩容建议列表
 * 基于当前容量数据和预测结果，生成结构化的扩容建议
 */
router.get('/recommendations', (req, res) => {
    try {
        const recommendations = {
            timestamp: new Date().toISOString(),
            urgentActions: [],      // 需要立即采取的行动
            plannedActions: [],     // 计划内的优化
            monitoringAdvisories: [], // 监控建议
            costOptimizations: [],  // 成本优化建议
            summary: {
                totalRecommendations: 0,
                urgencyLevel: 'LOW',
                estimatedCostImpact: '$0/month',
            },
        };
        
        for (const component of SUPPORTED_COMPONENTS) {
            const record = getLatestRecord(component);
            const history = parseCsvFile(path.join(RAW_DIR, `${component}_metrics.csv`));
            const thresh = thresholds[component];
            
            if (!record || !thresh) continue;
            
            // 分析各指标并生成建议
            switch (component) {
                case 'api': {
                    const memUtil = calcUtilization(record.memory_mb, thresh.memory_mb.value);
                    const heapUtil = parseFloat(record.heap_usage_percent) || 0;
                    
                    if (heapUtil > 75) {
                        recommendations.urgentActions.push({
                            component,
                            priority: 'HIGH',
                            type: 'SCALE_UP',
                            title: 'API堆内存接近上限',
                            description: `当前堆利用率 ${heapUtil}%，建议将 --max-old-space-size 从 384MB 提升至 768MB`,
                            action: '修改 docker-compose.prod.yml 中 NODE_OPTIONS 环境变量',
                            estimatedDowntime: '0s (滚动重启)',
                            costImpact: '$0',
                        });
                    } else if (heapUtil > 55) {
                        recommendations.plannedActions.push({
                            component,
                            priority: 'MEDIUM',
                            type: 'PLAN_AHEAD',
                            title: 'API堆内存持续增长中',
                            description: `当前堆利用率 ${heapUtil}%，建议关注未来2周的趋势`,
                            action: '增加堆内存监控告警阈值至 60%',
                            estimatedDowntime: 'N/A',
                            costImpact: '$0',
                        });
                    }
                    
                    // 成本优化：如果内存利用率很低
                    if (memUtil < 20) {
                        recommendations.costOptimizations.push({
                            component,
                            type: 'RIGHT_SIZE',
                            title: 'API内存可能过度分配',
                            description: `当前内存利用率仅 ${memUtil}%，可考虑降低 reservation 至 128MB`,
                            potentialSaving: '~$2-5/月',
                        });
                    }
                    break;
                }
                
                case 'postgresql': {
                    const diskUtil = parseFloat(record.disk_used_percent) || 0;
                    const connUtil = calcUtilization(record.active_connections, thresh.connections.value);
                    
                    if (diskUtil > 75) {
                        recommendations.urgentActions.push({
                            component,
                            priority: 'HIGH',
                            type: 'SCALE_UP',
                            title: 'PostgreSQL磁盘空间不足',
                            description: `磁盘使用率 ${diskUtil}%，需要扩容或清理`,
                            action: '考虑卷扩展或执行 VACUUM FULL 清理死元组',
                            estimatedDowntime: '~1-5min',
                            costImpact: 'varies',
                        });
                    } else if (connUtil > 60) {
                        recommendations.plannedActions.push({
                            component,
                            priority: 'MEDIUM',
                            type: 'OPTIMIZE',
                            title: '数据库连接池使用率高',
                            description: `连接池利用率 ${connUtil}%，建议引入 pgBouncer 或优化连接复用`,
                            action: '部署 pgBouncer 作为连接池中间件',
                            estimatedDowntime: '~30s',
                            costImpact: '$0',
                        });
                    }
                    break;
                }
                
                case 'redis': {
                    const fragRatio = parseFloat(record.fragmentation_ratio) || 0;
                    if (fragRatio > 1.5) {
                        recommendations.monitoringAdvisories.push({
                            component,
                            type: 'MAINTENANCE',
                            title: 'Redis内存碎片率偏高',
                            description: `当前碎片率 ${fragRatio}，建议在低峰期执行 MEMORY PURGE`,
                            action: 'redis-cli MEMORY PURGE',
                            suggestedSchedule: '低峰时段 (如凌晨)',
                        });
                    }
                    break;
                }
                
                case 'disk': {
                    const diskUtil = parseFloat(record.used_percent) || 0;
                    const inodeUtil = parseFloat(record.inodes_used_percent) || 0;
                    
                    if (diskUtil > 70) {
                        recommendations.plannedActions.push({
                            component,
                            priority: 'MEDIUM',
                            type: 'CLEANUP',
                            title: '全局磁盘使用率偏高',
                            description: `磁盘使用率 ${diskUtil}%，建议执行 Docker 清理`,
                            action: 'docker system prune -a --volumes (谨慎操作)',
                            estimatedDowntime: '0s',
                            costImpact: '$0',
                        });
                    }
                    
                    if (inodeUtil > 70) {
                        recommendations.monitoringAdvisories.push({
                            component,
                            type: 'MONITOR',
                            title: 'Inode使用率偏高',
                            description: `Inode使用率 ${inodeUtil}%，检查是否存在大量小文件`,
                            action: 'find /var/lib/docker -type f | wc -l 排查文件数量',
                        });
                    }
                    break;
                }
            }
        }
        
        // 汇总统计
        recommendations.summary.totalRecommendations =
            recommendations.urgentActions.length +
            recommendations.plannedActions.length +
            recommendations.monitoringAdvisories.length +
            recommendations.costOptimizations.length;
        
        if (recommendations.urgentActions.length > 0) {
            recommendations.summary.urgencyLevel = 'CRITICAL';
        } else if (recommendations.plannedActions.length > 0) {
            recommendations.summary.urgencyLevel = 'MODERATE';
        }
        
        res.json({ success: true, data: recommendations });
    } catch (error) {
        console.error('[Capacity/API] Recommendations error:', error);
        res.status(500).json({
            success: false,
            error: 'RECOMMENDATIONS_ERROR',
            message: error.message,
        });
    }
});

// ============================================
# Endpoint: POST /api/v1/capacity/thresholds
// ============================================

/**
 * 更新阈值配置（管理员接口）
 * 允许动态调整各组件的警告和严重阈值
 */
router.post('/thresholds', (req, res) => {
    try {
        const { component, metricUpdates } = req.body;
        
        if (!component || !metricUpdates) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: '请求体必须包含 component 和 metricUpdates 字段',
            });
        }
        
        if (!SUPPORTED_COMPONENTS.includes(component)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_COMPONENT',
                message: `不支持的组件: ${component}`,
            });
        }
        
        if (!thresholds[component]) {
            return res.status(400).json({
                success: false,
                error: 'NO_THRESHOLDS_FOR_COMPONENT',
                message: `组件 ${component} 没有可配置的阈值`,
            });
        }
        
        // 应用更新
        const updatedMetrics = [];
        for (const [metricName, newValue] of Object.entries(metricUpdates)) {
            if (thresholds[component][metricName]) {
                const oldValue = { ...thresholds[component][metricName] };
                Object.assign(thresholds[component][metricName], newValue);
                updatedMetrics.push({
                    metric: metricName,
                    oldValue,
                    newValue: { ...thresholds[component][metricName] },
                });
            }
        }
        
        // TODO: 在生产环境中，这里应该持久化到数据库或配置文件
        // 当前实现仅在内存中更新，重启后会恢复默认值
        
        res.json({
            success: true,
            message: `已更新 ${component} 的 ${updatedMetrics.length} 个阈值`,
            data: {
                component,
                updatedMetrics,
                currentThresholds: thresholds[component],
                note: '⚠️ 阈值更改仅在内存中生效，重启后将恢复为默认值',
            },
        });
    } catch (error) {
        console.error('[Capacity/API] Thresholds update error:', error);
        res.status(500).json({
            success: false,
            error: 'THRESHOLD_UPDATE_ERROR',
            message: error.message,
        });
    }
});

/**
 * 获取当前阈值配置（只读）
 */
router.get('/thresholds', (_req, res) => {
    res.json({
        success: true,
        data: {
            thresholds,
            supportedComponents: SUPPORTED_COMPONENTS,
            note: '使用 POST /api/v1/capacity/thresholds 更新阈值（需管理员权限）',
        },
    });
});

module.exports = router;
