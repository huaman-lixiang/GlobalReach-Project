(function() {
    'use strict';

    var state = {
        lang: localStorage.getItem('preferredLanguage') || 'zh',
        theme: localStorage.getItem('preferredTheme') || 'light',
        visitCount: parseInt(localStorage.getItem('gr_visitCount') || '0') + 1,
        healthData: null,
        toastId: 0
    };

    localStorage.setItem('gr_visitCount', state.visitCount);

    var i18n = {
        zh: {
            title: '\uD83D\uDE80 GlobalReach V2.0',
            subtitle: '\u4F01\u4E1A\u7EA7\u90AE\u4EF6\u8425\u9500\u5E73\u53F0 - \u751F\u4EA7\u5C31\u7EEA',
            navServices: '\u670D\u52A1',
            navHealth: '\u5065\u5EB7\u72B6\u6001',
            navDocs: '\u7CFB\u7EDF\u4FE1\u606F',
            apiTitle: 'API \u7F51\u5173',
            apiDesc: 'RESTful API \u7F51\u5173\uFF0C\u63D0\u4F9B\u6240\u6709\u90AE\u4EF6\u8425\u9500\u7AEF\u70B9',
            apiBtn: '\u67E5\u770B\u7AEF\u70B9',
            docsTitle: 'API \u6587\u6863',
            docsDesc: '\u4EA4\u4E92\u5F0F Swagger UI\uFF0C\u5305\u542B\u5B8C\u6574 OpenAPI 3.0 \u89C4\u8303',
            docsBtn: '\u6253\u5F00\u6587\u6863',
            healthTitle: '\u5065\u5EB7\u76D1\u63A7',
            healthDesc: '\u5B9E\u65F6\u7CFB\u7EDF\u5065\u5EB7\u76D1\u63A7\uFF0C\u8986\u76D6 5 \u4E2A\u5B50\u7CFB\u7EDF',
            healthBtn: '\u68C0\u67E5\u72B6\u6001',
            monitorTitle: '\u76D1\u63A7\u4F53\u7CFB',
            monitorDesc: 'Prometheus \u6307\u6807\u91C7\u96C6\u548C Grafana \u4EEA\u8868\u76D8',
            monitorBtn: '\u914D\u7F6E Docker',
            healthPanelTitle: '\uD83D\uDD0D \u5B9E\u65F6\u7CFB\u7EDF\u5065\u5EB7',
            labelScore: '\u5065\u5EB7\u8BC4\u5206',
            labelUptime: '\u8FD0\u884C\u65F6\u95F4',
            labelResponse: '\u54CD\u5E94\u65F6\u95F4',
            labelStatus: '\u7CFB\u7EDF\u72B6\u6001',
            copyright: '&copy; 2026 GlobalReach Enterprise. \u4FDD\u7559\u6240\u6709\u6743\u5229\u3002',
            modalApiTitle: '\uD83D\uDCEC API \u7AEF\u70B9\u5217\u8868',
            modalHealthTitle: '\uD83D\uDD0D \u7CFB\u7EDF\u5065\u5EB7\u8BE6\u60C5',
            apiEndpoints: 'API \u7AEF\u70B9',
            healthChecks: '\u5065\u5EB7\u68C0\u67E5\u9879',
            loading: '\u52A0\u8F7D\u4E2D...',
            healthy: '\u5065\u5EB7',
            degraded: '\u964D\u7EA7',
            unhealthy: '\u5F02\u5E38',
            latency: '\u5EF6\u8FDF',
            details: '\u8BE6\u60C5',
            database: '\u6570\u636E\u5E93',
            redis: 'Redis \u7F13\u5B58',
            engine: '\u4E1A\u52A1\u5F15\u64CE',
            emailQueue: '\u90AE\u4EF6\u961F\u5217',
            systemResources: '\u7CFB\u7EDF\u8D44\u6E90',
            sysInfoTitle: '\uD83D\uDCBB \u7CFB\u7EDF\u4FE1\u606F',
            labelVersion: '\u7248\u672C\u53F7',
            labelEnvironment: '\u8FD0\u884C\u73AF\u5883',
            labelBuildTime: '\u6784\u5EFA\u65F6\u95F4',
            labelEndpoints: 'API \u6570\u91CF',
            labelTests: '\u6D4B\u8BD5\u7ED3\u679C',
            labelCoverage: '\u4EE3\u7801\u8986\u76D6\u7387',
            labelSession: '\u5F53\u524D\u4F1A\u8BDD',
            labelVisits: '\u9875\u9762\u8BBF\u95EE',
            refreshLabel: '\u81EA\u52A8\u5237\u65B0 5\u79D2',
            copyUrlBtn: '\u590D\u5236 API \u5730\u5740',
            refreshBtn: '\u5237\u65B0\u6570\u636E',
            quickHealthBtn: '\u5065\u5EB7\u8BE6\u60C5',
            online: '\u5728\u7EBF',
            pending: '\u5F85\u542F\u52A8',
            offline: '\u79BB\u7EBF',
            copied: '\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F!',
            refreshed: '\u6570\u636E\u5DF2\u5237\u65B0!',
            toastSuccess: '\u64CD\u4F5C\u6210\u529F',
            toastError: '\u64CD\u4F5C\u5931\u8D25'
        },
        en: {
            title: '\uD83D\uDE80 GlobalReach V2.0',
            subtitle: 'Enterprise Email Marketing Platform - Production Ready',
            navServices: 'Services',
            navHealth: 'Health Status',
            navDocs: 'System Info',
            apiTitle: 'API Gateway',
            apiDesc: 'RESTful API gateway serving all email marketing endpoints with JWT auth and rate limiting.',
            apiBtn: 'View Endpoints',
            docsTitle: 'API Documentation',
            docsDesc: 'Interactive Swagger UI with complete OpenAPI 3.0 spec (118 endpoints).',
            docsBtn: 'Open Docs',
            healthTitle: 'Health Monitor',
            healthDesc: 'Real-time system health monitoring across 5 subsystems with auto-detection.',
            healthBtn: 'Check Status',
            monitorTitle: 'Monitoring Stack',
            monitorDesc: 'Prometheus metrics collection and Grafana dashboards (Docker required).',
            monitorBtn: 'Configure Docker',
            healthPanelTitle: '\uD83D\uDD0D Real-time System Health',
            labelScore: 'Health Score',
            labelUptime: 'Uptime',
            labelResponse: 'Response Time',
            labelStatus: 'System Status',
            copyright: '&copy; 2026 GlobalReach Enterprise. All rights reserved.',
            modalApiTitle: '\uD83D\uDCEC API Endpoints',
            modalHealthTitle: '\uD83D\uDD0D System Health Details',
            apiEndpoints: 'API Endpoints',
            healthChecks: 'Health Checks',
            loading: 'Loading...',
            healthy: 'Healthy',
            degraded: 'Degraded',
            unhealthy: 'Unhealthy',
            latency: 'Latency',
            details: 'Details',
            database: 'Database',
            redis: 'Redis Cache',
            engine: 'Engine',
            emailQueue: 'Email Queue',
            systemResources: 'System Resources',
            sysInfoTitle: '\uD83D\uDCBB System Information',
            labelVersion: 'Version',
            labelEnvironment: 'Environment',
            labelBuildTime: 'Build Time',
            labelEndpoints: 'Endpoints',
            labelTests: 'Tests',
            labelCoverage: 'Coverage',
            labelSession: 'Session',
            labelVisits: 'Page Visits',
            refreshLabel: 'Auto-refresh 5s',
            copyUrlBtn: 'Copy API URL',
            refreshBtn: 'Refresh Data',
            quickHealthBtn: 'Health Details',
            online: 'ONLINE',
            pending: 'PENDING',
            offline: 'OFFLINE',
            copied: 'Copied to clipboard!',
            refreshed: 'Data refreshed!',
            toastSuccess: 'Success',
            toastError: 'Error'
        }
    };

    var apiEndpoints = [
        { method: 'GET', path: '/api/v1/health', descZh: '\u7CFB\u7EDF\u5065\u5EB7\u68C0\u67E5', descEn: 'System health check' },
        { method: 'POST', path: '/api/v1/auth/login', descZh: '\u7528\u6237\u767B\u5F55\u8BA4\u8BC1', descEn: 'User authentication' },
        { method: 'POST', path: '/api/v1/auth/register', descZh: '\u65B0\u7528\u6237\u6CE8\u518C', descEn: 'User registration' },
        { method: 'GET', path: '/api/v1/accounts', descZh: '\u83B7\u53D6\u8D26\u6237\u5217\u8868', descEn: 'List accounts' },
        { method: 'POST', path: '/api/v1/accounts', descZh: '\u521B\u5EFA\u65B0\u8D26\u6237', descEn: 'Create account' },
        { method: 'GET', path: '/api/v1/accounts/:id', descZh: '\u83B7\u53D6\u8D26\u6237\u8BE6\u60C5', descEn: 'Get account details' },
        { method: 'PUT', path: '/api/v1/accounts/:id', descZh: '\u66F4\u65B0\u8D26\u6237\u4FE1\u606F', descEn: 'Update account' },
        { method: 'DELETE', path: '/api/v1/accounts/:id', descZh: '\u5220\u9664\u8D26\u6237', descEn: 'Delete account' },
        { method: 'GET', path: '/api/v1/campaigns', descZh: '\u8425\u9500\u6D3B\u52A8\u5217\u8868', descEn: 'List campaigns' },
        { method: 'POST', path: '/api/v1/campaigns', descZh: '\u521B\u5EFA\u8425\u9500\u6D3B\u52A8', descEn: 'Create campaign' },
        { method: 'GET', path: '/api/v1/campaigns/:id', descZh: '\u6D3B\u52A8\u8BE6\u60C5', descEn: 'Campaign details' },
        { method: 'GET', path: '/api/v1/emails', descZh: '\u90AE\u4EF6\u5217\u8868', descEn: 'List emails' },
        { method: 'POST', path: '/api/v1/emails/send', descZh: '\u53D1\u9001\u90AE\u4EF6', descEn: 'Send email' },
        { method: 'GET', path: '/api/v1/stats', descZh: '\u7EDF\u8BA1\u6570\u636E', descEn: 'Statistics' },
        { method: 'GET', path: '/api/v1/platforms', descZh: '\u652F\u6301\u7684\u5E73\u53F0', descEn: 'Supported platforms' },
        { method: 'GET', path: '/api/v1/tenants', descZh: '\u79DF\u6237\u5217\u8868', descEn: 'List tenants' },
        { method: 'GET', path: '/api/v1/docs', descZh: 'Swagger \u6587\u6863', descEn: 'Swagger docs' },
        { method: 'GET', path: '/api/v1/metrics', descZh: 'Prometheus \u6307\u6807', descEn: 'Prometheus metrics' }
    ];

    document.addEventListener('DOMContentLoaded', initApp);

    function initApp() {
        applyTheme(state.theme);
        setLanguage(state.lang);
        bindEvents();
        fetchHealth();
        setInterval(fetchHealth, 5000);

        setTimeout(function() {
            var loader = document.getElementById('loadingScreen');
            if (loader) loader.classList.add('hidden');
        }, 600);

        var visitsEl = document.getElementById('sysVisits');
        if (visitsEl) visitsEl.textContent = state.visitCount;

        console.log('[GlobalReach] S061 Enterprise Frontend Initialized OK');
        console.log('[GlobalReach] Visit #' + state.visitCount + ' | Theme: ' + state.theme + ' | Lang: ' + state.lang);
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var btn = document.getElementById('themeToggle');
        if (btn) {
            btn.textContent = theme === 'dark' ? '\u263E' : '\u2609';
            btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }
        localStorage.setItem('preferredTheme', theme);
    }

    function toggleTheme() {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(state.theme);
        showToast('info', state.theme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
    }

    function setLanguage(lang) {
        state.lang = lang;
        var t = i18n[lang];
        var map = {
            'title': t.title, 'subtitle': t.subtitle,
            'navServices': t.navServices, 'navHealth': t.navHealth, 'navDocs': t.navDocs,
            'apiTitle': t.apiTitle, 'apiDesc': t.apiDesc, 'apiBtn': t.apiBtn,
            'docsTitle': t.docsTitle, 'docsDesc': t.docsDesc, 'docsBtn': t.docsBtn,
            'healthTitle': t.healthTitle, 'healthDesc': t.healthDesc, 'healthBtn': t.healthBtn,
            'monitorTitle': t.monitorTitle, 'monitorDesc': t.monitorDesc, 'monitorBtn': t.monitorBtn,
            'healthPanelTitle': t.healthPanelTitle,
            'labelScore': t.labelScore, 'labelUptime': t.labelUptime,
            'labelResponse': t.labelResponse, 'labelStatus': t.labelStatus,
            'copyright': t.copyright,
            'modalApiTitle': t.modalApiTitle, 'modalHealthTitle': t.modalHealthTitle,
            'sysInfoTitle': t.sysInfoTitle,
            'labelVersion': t.labelVersion, 'labelEnvironment': t.labelEnvironment,
            'labelBuildTime': t.labelBuildTime, 'labelEndpoints': t.labelEndpoints,
            'labelTests': t.labelTests, 'labelCoverage': t.labelCoverage,
            'labelSession': t.labelSession, 'labelVisits': t.labelVisits,
            'refreshLabel': t.refreshLabel,
            'copyUrlBtn': t.copyUrlBtn, 'refreshBtn': t.refreshBtn, 'quickHealthBtn': t.quickHealthBtn,
            'apiStatus': t.online, 'docsStatus': t.online, 'healthCardStatus': t.online,
            'monitorStatus': t.pending
        };
        Object.keys(map).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = map[id];
        });

        document.getElementById('btnZh').classList.toggle('active', lang === 'zh');
        document.getElementById('btnEn').classList.toggle('active', lang === 'en');
        document.documentElement.lang = lang;
        localStorage.setItem('preferredLanguage', lang);
    }

    function bindEvents() {
        document.getElementById('btnZh').addEventListener('click', function() { setLanguage('zh'); });
        document.getElementById('btnEn').addEventListener('click', function() { setLanguage('en'); });
        document.getElementById('themeToggle').addEventListener('click', toggleTheme);

        document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) closeModal(overlay.id);
            });
        });

        document.addEventListener('keydown', handleKeyboard);

        document.querySelectorAll('.nav-links a').forEach(function(a) {
            a.addEventListener('click', function(e) {
                e.preventDefault();
                var target = document.querySelector(a.getAttribute('href'));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    var kbdHint = document.getElementById('kbdHint');
    var kbdTimer = null;

    function handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        var key = e.key.toLowerCase();

        if (key === '?') {
            e.preventDefault();
            kbdHint.classList.add('show');
            clearTimeout(kbdTimer);
            kbdTimer = setTimeout(function() { kbdHint.classList.remove('show'); }, 3000);
        } else if (key === 'd') {
            e.preventDefault();
            toggleTheme();
        } else if (key === 'r') {
            e.preventDefault();
            forceRefresh();
        } else if (key === 'h') {
            e.preventDefault();
            showHealthModal();
        } else if (key === 'a') {
            e.preventDefault();
            showApiModal();
        } else if (key === 'escape') {
            closeModal('apiModal');
            closeModal('healthModal');
        }
    }

    function fetchHealth() {
        fetch('/api/v1/health')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                state.healthData = data;

                var scoreEl = document.getElementById('healthScore');
                var uptimeEl = document.getElementById('uptime');
                var rtEl = document.getElementById('responseTime');
                var statusEl = document.getElementById('overallStatus');

                if (scoreEl) scoreEl.textContent = ((data.healthScore && data.healthScore.score) || '--') + '%';
                if (uptimeEl) uptimeEl.textContent = (data.uptime && data.uptime.human) || '--';
                if (rtEl) rtEl.textContent = (data.responseTimeMs || '--') + 'ms';

                var status = data.status || 'unknown';
                var statusText = status.toUpperCase();
                if (statusEl) statusEl.textContent = statusText;

                var items = document.querySelectorAll('.health-item');
                items.forEach(function(item) {
                    item.classList.remove('status-healthy', 'status-degraded', 'status-unhealthy');
                });

                var lastItem = document.querySelector('.health-item:last-child');
                if (lastItem) {
                    var cls = status === 'healthy' ? 'status-healthy' :
                                status === 'degraded' ? 'status-degraded' : 'status-unhealthy';
                    lastItem.classList.add(cls);
                }
            })
            .catch(function(err) {
                console.error('[GlobalReach] Health fetch error:', err.message);
            });
    }

    function forceRefresh() {
        fetchHealth();
        showToast('success', i18n[state.lang].refreshed);
    }

    function showApiModal() {
        var modal = document.getElementById('apiModal');
        modal.classList.add('show');

        var t = i18n[state.lang];
        var html = '<h4>' + t.apiEndpoints + ' <small style="color:var(--text-muted);font-weight:400;">(' + apiEndpoints.length + ')</small></h4><ul class="api-list">';
        apiEndpoints.forEach(function(api) {
            html += '<li class="api-item">' +
                '<span class="api-method ' + api.method.toLowerCase() + '">' + api.method + '</span>' +
                '<span class="api-path">' + api.path + '</span>' +
                '<div class="api-description">' + (state.lang === 'zh' ? api.descZh : api.descEn) + '</div>' +
                '</li>';
        });
        html += '</ul>';
        document.getElementById('apiContent').innerHTML = html;
    }

    function showHealthModal() {
        var modal = document.getElementById('healthModal');
        modal.classList.add('show');

        var t = i18n[state.lang];

        fetch('/api/v1/health')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var checkNames = {
                    database: state.lang === 'zh' ? t.database : 'Database',
                    redis: state.lang === 'zh' ? t.redis : 'Redis Cache',
                    engine: state.lang === 'zh' ? t.engine : 'Engine',
                    email_queue: state.lang === 'zh' ? t.emailQueue : 'Email Queue',
                    system_resources: state.lang === 'zh' ? t.systemResources : 'System Resources'
                };

                var html = '<div class="health-detail"><h4>' + t.healthChecks + '</h4>';
                Object.keys(data.checks || {}).forEach(function(key) {
                    var check = data.checks[key];
                    var sText = check.status.toUpperCase();

                    html += '<div class="health-check">' +
                        '<div class="health-check-header">' +
                        '<span class="health-check-name">' + (checkNames[key] || key) + '</span>' +
                        '<span class="health-status ' + check.status + '">' + sText + '</span>' +
                        '</div>' +
                        '<div class="health-meta">' + t.latency + ': ' + (check.latencyMs || 0) + 'ms</div>' +
                        '<div class="health-details"><pre>' + JSON.stringify(check.details || {}, null, 2) + '</pre></div>' +
                        '</div>';
                });
                html += '</div>';

                html += '<div style="margin-top:20px;padding:16px;background:var(--code-bg);border-radius:12px;border:1px solid var(--border-color);">';
                html += '<strong>Overall Score</strong>: ';
                html += '<span style="color:var(--primary);font-size:1.2rem;font-weight:800;">' + ((data.healthScore && data.healthScore.score) || '--') + '%</span>';
                html += ' | <strong>Status</strong>: <span style="font-weight:700;">' + (data.status || '--').toUpperCase() + '</span>';
                html += '</div>';

                document.getElementById('healthContent').innerHTML = html;
            })
            .catch(function(err) {
                document.getElementById('healthContent').innerHTML =
                    '<div class="empty-state">' + t.loading + ' failed: ' + err.message + '</div>';
            });
    }

    function closeModal(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('show');
    }

    function copyApiUrl() {
        var url = window.location.origin + '/api/v1';
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function() {
                showToast('success', i18n[state.lang].copied + ': ' + url);
            }).catch(function() {
                fallbackCopy(url);
            });
        } else {
            fallbackCopy(url);
        }
    }

    function fallbackCopy(url) {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('success', i18n[state.lang].copied);
    }

    function showToast(type, message, duration) {
        duration = duration || 3000;
        var container = document.getElementById('toastContainer');
        var icons = { success: '&#9989;', error: '&#10060;', info: '&#8505;', warning: '&#9888;' };

        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML =
            '<span class="toast-icon">' + (icons[type] || '') + '</span>' +
            '<span class="toast-message">' + message + '</span>' +
            '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

        container.appendChild(toast);

        requestAnimationFrame(function() { toast.classList.add('show'); });

        setTimeout(function() {
            toast.classList.remove('show');
            setTimeout(function() { toast.remove(); }, 400);
        }, duration);
    }

    window.closeModal = closeModal;
    window.showApiModal = showApiModal;
    window.showHealthModal = showHealthModal;
    window.copyApiUrl = copyApiUrl;
    window.forceRefresh = forceRefresh;

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    }
})();
