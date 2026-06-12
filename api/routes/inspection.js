/**
 * Inspection Routes — O03 Automated Inspection Engine REST API
 *
 * Provides RESTful endpoints for the automated health inspection system:
 *   GET  /api/v1/inspection/last      — Get latest inspection result
 *   GET  /api/v1/inspection/history   — List historical inspection records
 *   POST /api/v1/inspection/trigger   — Manually trigger a new inspection
 *   GET  /api/v1/inspection/trends    — Get inspection trend data (dimension scores over time)
 *
 * Data Storage:
 *   - Inspection results are stored as JSON files in reports/inspection/YYYY/MM/DD/
 *   - This API reads from those JSON files and provides structured access
 *   - Trigger endpoint executes health-inspection.sh via child_process
 *
 * Integration Points:
 *   - Grafana: Can query trends for dashboard widgets
 *   - Frontend: React/Vue dashboard can consume these APIs
 *   - AlertManager: Webhook notifications can trigger on failures
 *   - CI/CD: Pipeline can check inspection status before deployment
 *
 * Security:
 *   - All endpoints require authentication (via parent middleware)
 *   - Trigger endpoint has additional rate limiting
 *   - File system access is restricted to reports directory
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('utils');
const { asyncHandler } = require('../middleware/errorHandler');

const execAsync = promisify(exec);

// ── Configuration ───────────────────────────────────────────────────────────

// Base directory for inspection reports (relative to project root)
const REPORTS_BASE_DIR = path.join(
    path.dirname(path.dirname(__dirname)),
    'reports',
    'inspection'
);

// Maximum number of history records to return
const MAX_HISTORY_RECORDS = 100;

// Maximum trend data points (for performance)
const MAX_TREND_POINTS = 30;

// Inspection script path
const INSPECTION_SCRIPT = path.join(
    path.dirname(path.dirname(__dirname)),
    'scripts',
    'health-inspection.sh'
);

// Rate limiting configuration for trigger endpoint
const TRIGGER_COOLDOWN_MS = 60_000; // 1 minute between triggers
let lastTriggerTime = 0;

// ── Helper Functions ───────────────────────────────────────────────────────

/**
 * Ensure reports directory exists, create if not.
 */
function ensureReportsDir() {
    if (!fs.existsSync(REPORTS_BASE_DIR)) {
        fs.mkdirSync(REPORTS_BASE_DIR, { recursive: true });
    }
}

/**
 * Scan all inspection result JSON files, sorted by modification time (newest first).
 * @returns {Array<{path: string, mtime: Date, stat: fs.Stats}>}
 */
function scanInspectionFiles() {
    ensureReportsDir();

    const results = [];

    function scanDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively scan subdirectories (YYYY/MM/DD structure)
                    scanDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                    try {
                        const stat = fs.statSync(fullPath);
                        results.push({
                            path: fullPath,
                            name: entry.name,
                            mtime: stat.mtime,
                            size: stat.size,
                        });
                    } catch (_) {
                        // Skip files that can't be read
                    }
                }
            }
        } catch (_) {
            // Directory might not exist yet
        }
    }

    scanDir(REPORTS_BASE_DIR);

    // Sort by modification time, newest first
    results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return results;
}

/**
 * Safely parse a JSON file with error handling.
 * @param {string} filePath Absolute path to JSON file
 * @returns {object|null} Parsed object or null on error
 */
function parseInspectionFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error(`[Inspection] Failed to parse ${filePath}: ${error.message}`);
        return null;
    }
}

/**
 * Extract summary metadata from an inspection result (without full details).
 * Reduces payload size for list endpoints.
 * @param {object} data Full inspection data
 * @returns {object} Summary object
 */
function extractSummary(data) {
    if (!data || typeof data !== 'object') return null;

    return {
        inspectionId: data.inspectionId || null,
        timestamp: data.timestamp || null,
        mode: data.mode || 'unknown',
        gitHead: data.gitHead || null,
        overall: data.overall || { score: 0, total: 0, pass: 0, warn: 0, fail: 0 },
        dimensions: data.dimensions || {},
        failureCount: (data.failures && Array.isArray(data.failures)) ? data.failures.length : 0,
        warningCount: (data.warnings && Array.isArray(data.warnings)) ? data.warnings.length : 0,
        filePath: null, // Will be set by caller
    };
}

/**
 * Validate that a path is within the allowed base directory (security measure).
 * Prevents directory traversal attacks.
 * @param {string} targetPath Path to validate
 * @returns {boolean} True if safe
 */
function isPathSafe(targetPath) {
    const resolved = path.resolve(targetPath);
    const resolvedBase = path.resolve(REPORTS_BASE_DIR);
    return resolved.startsWith(resolvedBase);
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/inspection/last
 *
 * Returns the most recent inspection result (full details).
 * Used by dashboards, monitoring systems, and status pages.
 */
router.get('/last', asyncHandler(async (req, res) => {
    const files = scanInspectionFiles();

    if (files.length === 0) {
        return res.status(404).json({
            success: false,
            error: 'No inspection results found. Run: bash scripts/health-inspection.sh --report',
            hint: 'Execute the inspection script first to generate report data.',
        });
    }

    const latestFile = files[0];
    const data = parseInspectionFile(latestFile.path);

    if (!data) {
        return res.status(500).json({
            success: false,
            error: 'Failed to parse the latest inspection result',
        });
    }

    // Calculate file age
    const now = new Date();
    const ageMs = now.getTime() - latestFile.mtime.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);
    const isRecent = ageMs < 3600000; // Within 1 hour

    let responseData = data;
    const isCompact = req.query.compact === 'true';

    if (isCompact) {
        responseData = extractSummary(data);
        responseData.filePath = latestFile.path;
    }

    res.json({
        success: true,
        data: responseData,
        meta: {
            fileName: latestFile.name,
            fileAge: `${ageMinutes} minutes ago`,
            isRecent,
            totalRecordsAvailable: files.length,
        },
    });
}));

/**
 * GET /api/v1/inspection/history
 *
 * Returns paginated list of historical inspection records.
 * Supports filtering by date range and status.
 */
router.get('/history', asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const since = req.query.since ? new Date(req.query.since) : null;
    const until = req.query.until ? new Date(req.query.until) : null;
    const statusFilter = req.query.status; // 'fail' | 'warn'

    let files = scanInspectionFiles();

    // Apply date filters
    if (since) {
        files = files.filter((f) => f.mtime >= since);
    }
    if (until) {
        files = files.filter((f) => f.mtime <= until);
    }

    // Parse and filter by status
    let records = [];
    for (const file of files.slice(0, MAX_HISTORY_RECORDS)) {
        const data = parseInspectionFile(file.path);
        if (!data) continue;

        const summary = extractSummary(data);
        summary.filePath = file.path;
        summary.fileSize = file.size;

        // Apply status filter
        if (statusFilter === 'fail' && (summary.overall.fail || 0) === 0) continue;
        if (statusFilter === 'warn' && (summary.overall.warn || 0) === 0 && (summary.overall.fail || 0) === 0) continue;

        records.push(summary);
    }

    const totalCount = records.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const paginatedRecords = records.slice(startIndex, startIndex + limit);

    res.json({
        success: true,
        data: paginatedRecords,
        pagination: {
            page,
            limit,
            totalCount,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        },
        filters: {
            since: since?.toISOString() || null,
            until: until?.toISOString() || null,
            status: statusFilter || null,
        },
    });
}));

/**
 * POST /api/v1/inspection/trigger
 *
 * Manually triggers a new inspection run.
 * Executes health-inspection.sh as a child process and returns the result.
 */
router.post('/trigger', async (req, res) => {
    // Rate limiting check
    const now = Date.now();
    if (now - lastTriggerTime < TRIGGER_COOLDOWN_MS) {
        const retryAfter = Math.ceil((TRIGGER_COOLDOWN_MS - (now - lastTriggerTime)) / 1000);
        return res.status(429).json({
            success: false,
            error: 'Rate limited: Too frequent trigger requests',
            retryAfterSeconds: retryAfter,
            hint: `Wait ${retryAfter}s before triggering again`,
        });
    }

    lastTriggerTime = now;

    // Check if inspection script exists
    if (!fs.existsSync(INSPECTION_SCRIPT)) {
        return res.status(503).json({
            success: false,
            error: 'Inspection script not found',
            expectedPath: INSPECTION_SCRIPT,
            hint: 'Ensure scripts/health-inspection.sh exists in the project root.',
        });
    }

    try {
        const startTime = Date.now();

        // Build command arguments
        const mode = req.body.mode || 'full';
        const dimension = req.body.dimension || '';
        const outputReport = req.body.saveReport !== false; // Default: save report

        let args = '--json'; // Always use JSON output for API consumption

        if (mode === 'quick') {
            args += ' --quick';
        }
        if (dimension) {
            args += ` --dimension ${dimension}`;
        }
        if (outputReport) {
            args += ` --report --output "${REPORTS_BASE_DIR}"`;
        }

        // Execute inspection script
        const command = `bash "${INSPECTION_SCRIPT}" ${args}`;

        console.log(`[Inspection] Triggering: ${command}`);

        const { stdout, stderr } = await execAsync(command, {
            timeout: 120_000, // 2 minute timeout
            cwd: path.dirname(path.dirname(__dirname)),
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || 'production',
            },
            maxBuffer: 1024 * 1024, // 1MB buffer for large JSON output
        });

        const executionTimeMs = Date.now() - startTime;

        // Parse the JSON output
        let result;
        try {
            const jsonMatch = stdout.match(/\{[\s\S]*\}$/); // Find JSON at end
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No valid JSON in script output');
            }
        } catch (parseError) {
            console.error('[Inspection] Failed to parse script output:', parseError.message);
            console.error('[Inspection] Raw stdout:', stdout.substring(0, 500));
            return res.status(500).json({
                success: false,
                error: 'Failed to parse inspection result',
                rawOutput: stdout.substring(0, 1000),
                stderr: stderr?.substring(0, 500),
            });
        }

        res.json({
            success: true,
            message: 'Inspection completed successfully',
            result,
            execution: {
                timeMs: executionTimeMs,
                mode,
                dimension: dimension || 'all',
                triggeredAt: new Date().toISOString(),
                triggeredBy: req.user?.id || 'anonymous',
            },
        });

        // Log completion
        const score = result.overall?.score || 0;
        const failCount = result.overall?.fail || 0;
        console.log(
            `[Inspection] Completed in ${executionTimeMs}ms | Score: ${score}% | Fails: ${failCount}`
        );
    } catch (error) {
        console.error('[Inspection] Trigger execution failed:', error);

        // Determine appropriate error status
        let statusCode = 500;
        let errorMessage = error.message;

        if (error.killed) {
            statusCode = 504;
            errorMessage = 'Inspection timed out (exceeded 120s limit)';
        } else if (error.code === 'ENOENT') {
            statusCode = 503;
            errorMessage = 'Bash interpreter not found';
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            code: error.code,
            hint: 'Check server logs for details',
        });
    }
});

/**
 * GET /api/v1/inspection/trends
 *
 * Returns historical trend data for each dimension's scores over time.
 * Used by Grafana dashboards and frontend charts (Chart.js/ECharts).
 */
router.get('/trends', asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const dimensionsParam = req.query.dimensions || 'all';
    const format = req.query.format || 'object';

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Scan files within the date range
    const allFiles = scanInspectionFiles();
    const recentFiles = allFiles.filter((f) => f.mtime >= cutoffDate);

    // Parse records
    const records = recentFiles
        .map((file) => ({
            ...parseInspectionFile(file.path),
            _fileMtime: file.mtime.toISOString(),
        }))
        .filter((r) => r && r.inspectionId);

    // Determine which dimensions to include
    const allDimensions = ['infrastructure', 'application', 'security', 'data', 'monitoring'];
    const requestedDimensions =
        dimensionsParam === 'all' ? allDimensions : dimensionsParam.split(',');

    // Build trend data structure
    const trends = {};
    const sums = {};
    const counts = {};

    for (const dim of requestedDimensions) {
        trends[dim] = [];
        sums[dim] = 0;
        counts[dim] = 0;
    }

    for (const record of records) {
        if (!record.dimensions) continue;

        const point = {
            timestamp: record.timestamp || record._fileMtime,
            inspectionId: record.inspectionId,
        };

        for (const dim of requestedDimensions) {
            const dimData = record.dimensions[dim];
            if (dimData) {
                trends[dim].push({
                    ...point,
                    score: dimData.score || 0,
                    total: dimData.total || 0,
                    pass: dimData.pass || 0,
                    warn: dimData.warn || 0,
                    fail: dimData.fail || 0,
                });

                sums[dim] += dimData.score || 0;
                counts[dim]++;
            }
        }
    }

    // Calculate averages
    const averages = {};
    for (const dim of requestedDimensions) {
        averages[dim] = counts[dim] > 0 ? Math.round((sums[dim] / counts[dim]) * 10) / 10 : 0;
    }

    // Format response based on format parameter
    let formattedTrends = trends;
    if (format === 'array') {
        // Chart.js friendly format: labels + datasets
        const labels = [
            ...new Set(
                Object.values(trends)
                    .flat()
                    .map((p) => p.timestamp)
                    .sort()
            ),
        ].slice(-MAX_TREND_POINTS);

        formattedTrends = {
            labels,
            datasets: requestedDimensions.map((dim) => ({
                label: dim.charAt(0).toUpperCase() + dim.slice(1),
                data: labels.map((label) => {
                    const point = trends[dim]?.find((p) => p.timestamp === label);
                    return point?.score || null;
                }),
                borderColor: getDimensionColor(dim),
                backgroundColor: getDimensionColor(dim, 0.2),
                tension: 0.3,
                fill: false,
            })),
        };
    }

    res.json({
        success: true,
        period: {
            start: cutoffDate.toISOString(),
            end: new Date().toISOString(),
            days,
            dataPoints: records.length,
        },
        trends: formattedTrends,
        averages,
        dimensions: requestedDimensions,
    });
}));

/**
 * GET /api/v1/inspection/stats
 *
 * Returns aggregated statistics about inspections over time.
 * Useful for executive dashboards and SLA reporting.
 */
router.get('/stats', asyncHandler(async (req, res) => {
    const files = scanInspectionFiles();

    if (files.length === 0) {
        return res.json({
            success: true,
            stats: {
                totalInspections: 0,
                message: 'No inspection data available yet',
            },
        });
    }

    // Parse all records for statistics
    const records = files
        .slice(0, 200) // Limit processing
        .map((f) => parseInspectionFile(f.path))
        .filter(Boolean);

    let totalScore = 0;
    let bestScore = 0;
    let worstScore = 100;
    let perfectRuns = 0;
    let failedRuns = 0;

    const dimTotals = {
        infrastructure: { sum: 0, count: 0 },
        application: { sum: 0, count: 0 },
        security: { sum: 0, count: 0 },
        data: { sum: 0, count: 0 },
        monitoring: { sum: 0, count: 0 },
    };

    for (const record of records) {
        const score = record.overall?.score || 0;
        totalScore += score;
        bestScore = Math.max(bestScore, score);
        worstScore = Math.min(worstScore, score);

        if (score >= 90) perfectRuns++;
        if ((record.overall?.fail || 0) > 0) failedRuns++;

        // Accumulate dimension scores
        if (record.dimensions) {
            for (const [dim, data] of Object.entries(record.dimensions)) {
                if (dimTotals[dim] && data.score !== undefined) {
                    dimTotals[dim].sum += data.score;
                    dimTotals[dim].count++;
                }
            }
        }
    }

    const avgScore = records.length > 0 ? Math.round((totalScore / records.length) * 10) / 10 : 0;
    const uptimePercentage =
        records.length > 0 ? Math.round(((records.length - failedRuns) / records.length) * 1000) / 10 : 0;

    const dimensionReliability = {};
    for (const [dim, totals] of Object.entries(dimTotals)) {
        dimensionReliability[dim] =
            totals.count > 0 ? Math.round((totals.sum / totals.count) * 10) / 10 : null;
    }

    res.json({
        success: true,
        stats: {
            totalInspections: records.length,
            avgScore,
            bestScore,
            worstScore,
            perfectRuns,
            failedRuns,
            uptimePercentage,
            lastInspection: files[0]?.mtime?.toISOString() || null,
            firstInspection: files[files.length - 1]?.mtime?.toISOString() || null,
            dataRangeDays: files.length > 1
                ? Math.ceil((files[0].mtime - files[files.length - 1].mtime) / (1000 * 60 * 60 * 24))
                : 0,
            dimensionReliability,
        },
    });
}));

// ── Utility Functions ──────────────────────────────────────────────────────

/**
 * Get a consistent color for each dimension (for charts).
 * @param {string} dimension Dimension key
 * @param {number} alpha Alpha value (0-1)
 * @returns {string} CSS color string
 */
function getDimensionColor(dimension, alpha = 1) {
    const colors = {
        infrastructure: `rgba(37, 99, 235, ${alpha})`,   // Blue
        application: `rgba(22, 163, 74, ${alpha})`,      // Green
        security: `rgba(202, 138, 4, ${alpha})`,          // Yellow/Amber
        data: `rgba(147, 51, 234, ${alpha})`,            // Purple
        monitoring: `rgba(236, 72, 153, ${alpha})`,       // Pink
    };
    return colors[dimension] || `rgba(107, 114, 128, ${alpha})`; // Gray fallback
}

module.exports = router;
