# GlobalReach V2.0 - 移动端响应式适配指南 (N08)

> **版本**: v2.1.0 | **日期**: 2026-06-09 | **任务编号**: S130/N08

## 1. 断点策略

### 参考标准
基于 Ant Design 5.x 断点体系，结合 GlobalReach 企业级需求定制：

| 断点代号 | 像素范围 | 设备类型 | 布局模式 |
|---------|---------|---------|---------|
| `xs`    | < 480px   | 小屏手机（SE）   | 单列堆叠 |
| `sm`    | ≥ 480px   | 手机横屏/大屏手机 | 双列网格 |
| `md`    | ≥ 768px   | 平板竖屏（iPad） | 折叠侧边栏 |
| `lg`    | ≥ 992px   | 平板横屏/小桌面   | 可展开侧边栏 |
| `xl`    | ≥ 1200px  | 标准桌面          | 完整布局 |
| `xxl`   | ≥ 1600px  | 大屏桌面          | 完整布局 |

### 关键断点判断逻辑
- **移动端** (`isMobile`): `width ≤ 768px` → 隐藏侧边栏，显示底部导航
- **平板端** (`isTablet`): `769px < width ≤ 1024px` → 默认折叠侧边栏
- **桌面端** (`isDesktop`): `width > 1024px` → 完整桌面布局

## 2. 组件适配清单

### 2.1 全局层
| 文件/组件 | 改动说明 |
|----------|---------|
| `src/styles/responsive.css` | 新建 - 移动端专用样式（断点变量、触摸优化、安全区域、底部导航、卡片列表、FAB） |
| `src/index.css` | 修改 - 导入 responsive.css，增强移动端媒体查询规则 |

### 2.2 工具层
| 文件/组件 | 改动说明 |
|----------|---------|
| `src/hooks/useMobile.ts` | 新建 - 移动端检测 Hook，返回 `{ isMobile, isTablet, breakpoint, width, height }`，支持 matchMedia + 防抖 |

### 2.3 布局组件
| 文件/组件 | 改动说明 |
|----------|---------|
| `src/components/MainLayout.tsx` | 重构 - 使用 useMobile() 检测设备；移动端隐藏 Sider 显示 MobileNav；Header 简化；Content 区域 padding 自适应 |
| `src/components/MobileNav.tsx` | 新建 - 底部 Tab 导航（首页/营销/邮件/报表/设置），固定定位，活跃指示器动画 |

### 2.4 页面组件
| 页面 | 移动端改动 |
|------|-----------|
| **Dashboard.tsx** | 统计卡片响应式列数（xs=24/sm=12/md=12/lg=6）；图表高度自适应（mobile: 250px vs desktop: 350px）；Row gutter 缩小 |
| **Campaigns.tsx** | 表格→卡片列表视图（CampaignCardItem）；筛选器→底部 Drawer；创建按钮→FAB 浮动按钮；分页简化为文字提示 |
| **Emails.tsx** | 同 Campaigns 卡片列表改造；详情 Modal 宽度自适应（95% on mobile）；刷新按钮→FAB |
| **Login.tsx** | 左侧品牌区隐藏；表单卡片全宽居中（max-width:400px, width:90%）；渐变背景 + 居中 Logo |
| **Register.tsx** | 同 Login 适配策略；移动端顶部 Logo 区 |
| **Settings.tsx** | 独立 Card → Collapse 折叠面板（3组：个人信息/安全设置/系统信息）；按钮 block 化 |
| **Accounts.tsx** | 筛选区→抽屉触发器；健康摘要 Grid 布局（2列）；表格保留但筛选区适配 |
| **Reports.tsx** | KPI 卡片 xs=24/sm=12/md=12/lg=6；图表高度递减（240~400px）；导出按钮 flex-wrap |

## 3. 测试设备矩阵

### iOS
| 设备 | 分辨率 | 测试重点 |
|------|-------|---------|
| iPhone SE (3rd) | 375×667 | 超小屏幕极限测试 |
| iPhone 12/13 | 390×844 | 标准手机体验 |
| iPhone 14 Pro Max | 430×932 | 大屏手机体验 |
| iPad Air | 820×1180 | 平板竖屏/横屏切换 |
| iPad Pro 12.9" | 1366×1024 | 平板横屏桌面模式 |

### Android
| 设备 | 分辨率 | 测试重点 |
|------|-------|---------|
| Samsung Galaxy S23 | 360×780 | 标准安卓手机 |
| Google Pixel 7 | 412×915 | 近方屏手机 |
| Samsung Galaxy Tab S8 | 800×1280 | 平板模式 |
| 各厂商小屏机 | 320×568 | 极限窄屏兼容 |

### 浏览器
- Chrome DevTools (Mobile Emulation)
- Safari (iOS Simulator)
- Firefox Responsive Design Mode

## 4. 关键设计决策

### 4.1 为什么选择底部导航而非汉堡菜单？
- 底部导航提供 **单触达** 的页面切换能力（5个核心页面）
- 符合 Material Design 和 Apple HIG 的移动端导航规范
- 汉堡菜单需要 **两次交互**（打开→选择），效率较低

### 4.2 为什么表格改为卡片列表？
- 手机端表格横向滚动体验差（用户容易迷失）
- 卡片列表提供 **垂直扫描** 的自然阅读流
- 每张卡片展示关键信息 + 操作入口，符合移动端 F 型阅读习惯

### 4.3 安全区域处理
- CSS `env(safe-area-inset-*)` 适配 iPhone 刘海/底部横条
- 底部导航高度 = 64px + safe-area-inset-bottom
- 内容区额外 padding-bottom 避免被导航遮挡

## 5. 已知限制与后续优化方向

### 当前限制
1. **Drawer 式导航未实现** - MainLayout 中移动端 MenuOutlined 按钮预留了扩展点，可后续接入 Drawer 全屏导航
2. **Swipe Action 未实现** - 卡片列表项的滑动操作（左滑删除/右滑编辑）需引入 react-swipeable-list 或类似库
3. **Pull to Refresh 未实现** - 列表页面的下拉刷新功能
4. **虚拟滚动未实现** - 大数据量场景下的长列表性能优化
5. **离线支持未实现** - Service Worker / PWA 基础设施

### 后续优化方向
- [ ] PWA 支持（manifest.json / Service Worker / 离线缓存）
- [ ] 触觉反馈（Vibration API）
- [ ] 手势导航（Swipe back / Edge gesture）
- [ ] 骨架屏加载状态（Skeleton for mobile）
- [ ] 图片懒加载 + WebP / AVIF 格式适配
- [ ] 性能监控（Mobile LCP / FID / CLS 指标）

## 6. 文件变更清单

```
新增文件:
  frontend/src/styles/responsive.css      # 移动端全局样式
  frontend/src/hooks/useMobile.ts           # 移动端检测 Hook
  frontend/src/components/MobileNav.tsx     # 底部导航组件
  docs/MOBILE_RESPONSIVE_GUIDE.md            # 本文档

修改文件:
  frontend/src/index.css                    # 导入 responsive.css
  frontend/src/components/MainLayout.tsx     # 响应式布局切换
  frontend/src/pages/Dashboard.tsx          # 图表/卡片响应式
  frontend/src/pages/Campaigns.tsx          # 卡片列表 + FAB + Drawer
  frontend/src/pages/Emails.tsx             # 卡片列表 + 详情 Modal
  frontend/src/pages/Login.tsx              # 移动端全宽表单
  frontend/src/pages/Register.tsx           # 移动端全宽表单
  frontend/src/pages/Settings.tsx           # Collapse 折叠面板
  frontend/src/pages/Accounts.tsx           # 筛选器适配
  frontend/src/pages/Reports.tsx            # 图表高度自适应
```

## 7. 暗色模式兼容性

所有新增样式均通过 CSS 变量或 `[data-theme='dark']` 选择器支持暗色模式：
- `.mobile-nav-bar` → `[data-theme='dark'] .mobile-nav-bar`
- `.mobile-card-item` → `[data-theme='dark'] .mobile-card-item`
- `.mobile-filter-trigger` → `[data-theme='dark'] .mobile-filter-trigger`
- `.fab-button` → 使用 `var(--gr-primary)` 主色调变量

## 8. i18n 兼容性

MobileNav 组件使用 fallback 中文标签，后续可通过 props.labels 或 i18n t() 函数扩展多语言支持。
