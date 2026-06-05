class PerformanceAnalyzer {
  constructor(accountPoolManager) {
    this.poolManager = accountPoolManager;
    this.metrics = new Map();
    this.dailyStats = new Map();
    this.monthlyReports = new Map();
  }

  recordSendMetric(accountId, platform, metric) {
    const key = `${accountId}-${platform}`;
    const today = new Date().toISOString().split('T')[0];

    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        accountId,
        platform,
        totalSent: 0,
        totalDelivered: 0,
        totalOpened: 0,
        totalReplied: 0,
        totalBounced: 0,
        totalFailed: 0,
        avgDeliveryTime: 0,
        deliveryTimes: [],
        lastSendTime: null,
        firstSendTime: null
      });
    }

    const accountMetrics = this.metrics.get(key);
    
    accountMetrics.totalSent++;
    accountMetrics.lastSendTime = new Date();
    if (!accountMetrics.firstSendTime) {
      accountMetrics.firstSendTime = new Date();
    }

    if (metric.delivered) {
      accountMetrics.totalDelivered++;
      if (metric.deliveryTime) {
        accountMetrics.deliveryTimes.push(metric.deliveryTime);
        accountMetrics.avgDeliveryTime = this._calculateAverage(accountMetrics.deliveryTimes);
      }
    }

    if (metric.opened) accountMetrics.totalOpened++;
    if (metric.replied) accountMetrics.totalReplied++;
    if (metric.bounced) accountMetrics.totalBounced++;
    if (metric.failed) accountMetrics.totalFailed++;

    this._updateDailyStats(today, platform, metric);
  }

  _updateDailyStats(date, platform, metric) {
    const key = `${date}-${platform}`;
    
    if (!this.dailyStats.has(key)) {
      this.dailyStats.set(key, {
        date,
        platform,
        sent: 0,
        delivered: 0,
        opened: 0,
        replied: 0,
        bounced: 0,
        failed: 0
      });
    }

    const stats = this.dailyStats.get(key);
    stats.sent++;
    if (metric.delivered) stats.delivered++;
    if (metric.opened) stats.opened++;
    if (metric.replied) stats.replied++;
    if (metric.bounced) stats.bounced++;
    if (metric.failed) stats.failed++;
  }

  getAccountPerformance(accountId, platform) {
    const key = `${accountId}-${platform}`;
    return this.metrics.get(key) || null;
  }

  getPlatformComparison(days = 7) {
    const platforms = ['gmail', 'outlook', 'qq', '163', 'custom'];
    const comparison = {};
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    for (const platform of platforms) {
      const platformData = Array.from(this.dailyStats.values())
        .filter(s => s.platform === platform && new Date(s.date) >= cutoffDate);

      if (platformData.length > 0) {
        const totals = platformData.reduce((acc, curr) => ({
          sent: acc.sent + curr.sent,
          delivered: acc.delivered + curr.delivered,
          opened: acc.opened + curr.opened,
          replied: acc.replied + curr.replied,
          bounced: acc.bounced + curr.bounced,
          failed: acc.failed + curr.failed
        }), { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, failed: 0 });

        comparison[platform] = {
          ...totals,
          deliveryRate: totals.sent > 0 ? (totals.delivered / totals.sent * 100).toFixed(2) : 0,
          openRate: totals.delivered > 0 ? (totals.opened / totals.delivered * 100).toFixed(2) : 0,
          replyRate: totals.opened > 0 ? (totals.replied / totals.opened * 100).toFixed(2) : 0,
          bounceRate: totals.sent > 0 ? (totals.bounced / totals.sent * 100).toFixed(2) : 0,
          failureRate: totals.sent > 0 ? (totals.failed / totals.sent * 100).toFixed(2) : 0
        };
      }
    }

    return comparison;
  }

  getTopPerformers(metric = 'deliveryRate', limit = 10) {
    const comparison = this.getPlatformComparison(30);
    
    return Object.entries(comparison)
      .map(([platform, data]) => ({
        platform,
        ...data,
        score: parseFloat(data[metric]) || 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  generateMonthlyReport(year, month) {
    const key = `${year}-${month.toString().padStart(2, '0')}`;
    
    if (this.monthlyReports.has(key)) {
      return this.monthlyReports.get(key);
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const monthlyData = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      
      for (const [statsKey, stats] of this.dailyStats) {
        if (statsKey.startsWith(date)) {
          monthlyData.push(stats);
        }
      }
    }

    const report = this._aggregateMonthlyData(monthlyData);
    this.monthlyReports.set(key, report);
    
    return report;
  }

  _aggregateMonthlyData(data) {
    const byPlatform = {};

    data.forEach(stats => {
      if (!byPlatform[stats.platform]) {
        byPlatform[stats.platform] = {
          sent: 0,
          delivered: 0,
          opened: 0,
          replied: 0,
          bounced: 0,
          failed: 0,
          days: new Set()
        };
      }

      const p = byPlatform[stats.platform];
      p.sent += stats.sent;
      p.delivered += stats.delivered;
      p.opened += stats.opened;
      p.replied += stats.replied;
      p.bounced += stats.bounced;
      p.failed += stats.failed;
      p.days.add(stats.date);
    });

    const result = {
      period: `${data[0]?.date || 'N/A'} to ${data[data.length - 1]?.date || 'N/A'}`,
      platforms: {},
      summary: { totalSent: 0, totalDelivered: 0, avgDeliveryRate: 0 }
    };

    for (const [platform, data] of Object.entries(byPlatform)) {
      result.platforms[platform] = {
        ...data,
        activeDays: data.days.size,
        dailyAvg: Math.round(data.sent / data.days.size),
        deliveryRate: data.sent > 0 ? (data.delivered / data.sent * 100).toFixed(2) : 0,
        openRate: data.delivered > 0 ? (data.opened / data.delivered * 100).toFixed(2) : 0,
        replyRate: data.opened > 0 ? (data.replied / data.opened * 100).toFixed(2) : 0
      };

      result.summary.totalSent += data.sent;
      result.summary.totalDelivered += data.delivered;
    }

    result.summary.avgDeliveryRate = result.summary.totalSent > 0 
      ? (result.summary.totalDelivered / result.summary.totalSent * 100).toFixed(2)
      : 0;

    return result;
  }

  getPerformanceTrend(platform, days = 30) {
    const trend = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    for (let i = 0; i < days; i++) {
      const date = new Date(cutoffDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = this.dailyStats.get(`${dateStr}-${platform}`);
      trend.push({
        date: dateStr,
        sent: dayData?.sent || 0,
        delivered: dayData?.delivered || 0,
        opened: dayData?.opened || 0,
        replied: dayData?.replied || 0,
        deliveryRate: dayData && dayData.sent > 0 
          ? (dayData.delivered / dayData.sent * 100).toFixed(2) 
          : 0
      });
    }

    return trend;
  }

  exportToCSV(options = {}) {
    const { type = 'platform', days = 30 } = options;
    
    let data = [];
    let headers = [];

    if (type === 'platform') {
      const comparison = this.getPlatformComparison(days);
      headers = ['Platform', 'Sent', 'Delivered', 'Opened', 'Replied', 'Bounced', 'Failed', 'Delivery Rate %', 'Open Rate %', 'Reply Rate %'];
      
      data = Object.entries(comparison).map(([platform, stats]) => [
        platform,
        stats.sent,
        stats.delivered,
        stats.opened,
        stats.replied,
        stats.bounced,
        stats.failed,
        stats.deliveryRate,
        stats.openRate,
        stats.replyRate
      ]);
    } else if (type === 'trend') {
      headers = ['Date', 'Gmail Sent', 'Outlook Sent', 'QQ Sent', '163 Sent'];
      const gmailTrend = this.getPerformanceTrend('gmail', days);
      const outlookTrend = this.getPerformanceTrend('outlook', days);
      
      data = gmailTrend.map((g, i) => [
        g.date,
        g.sent,
        outlookTrend[i]?.sent || 0,
        0,
        0
      ]);
    }

    const csvContent = [headers.join(','), ...data.map(row => row.join(','))].join('\n');
    return csvContent;
  }

  clearOlderThan(days = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    for (const [key, metrics] of this.metrics) {
      if (metrics.lastSendTime && metrics.lastSendTime < cutoffDate) {
        this.metrics.delete(key);
      }
    }

    for (const [key, stats] of this.dailyStats) {
      const datePart = key.split('-').slice(0, 3).join('-');
      if (new Date(datePart) < cutoffDate) {
        this.dailyStats.delete(key);
      }
    }
  }

  _calculateAverage(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }
}

module.exports = PerformanceAnalyzer;
