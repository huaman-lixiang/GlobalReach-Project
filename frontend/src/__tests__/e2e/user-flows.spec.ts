import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login')
    
    await expect(page.locator('text=GlobalReach V2.0')).toBeVisible()
    await expect(page.locator('text=企业级邮件营销平台')).toBeVisible()
    await expect(page.getByPlaceholderText('邮箱地址')).toBeVisible()
    await expect(page.getByPlaceholderText('密码')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  })

  test('should show validation error for empty email', async ({ page }) => {
    await page.goto('/login')
    
    await page.click('button[type="submit"]')
    
    await expect(page.locator('text=请输入邮箱地址')).toBeVisible()
  })

  test('should show validation error for invalid email format', async ({ page }) => {
    await page.goto('/login')
    
    await page.fill('[placeholder="邮箱地址"]', 'invalid-email')
    await page.click('button[type="submit"]')
    
    await expect(page.locator('text=请输入有效的邮箱地址')).toBeVisible()
  })

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/login')
    
    await page.click('text=立即注册')
    
    await expect(page).toHaveURL(/\/register/)
  })
})

test.describe('Dashboard Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="邮箱地址"]', 'admin@globalreach.com')
    await page.fill('[placeholder="密码"]', 'admin123456')
    await page.click('button[type="submit"]')
    await page.waitForURL('/dashboard')
  })

  test('should display dashboard after login', async ({ page }) => {
    await expect(page.locator('text=仪表盘概览')).toBeVisible()
    await expect(page.locator('text=已发送邮件')).toBeVisible()
    await expect(page.locator('text=活跃账号')).toBeVisible()
  })

  test('should show statistics cards', async ({ page }) => {
    await expect(page.locator('text=进行中活动')).toBeVisible()
    await expect(page.locator('text=打开率')).toBeVisible()
  })

  test('should display charts section', async ({ page }) => {
    await expect(page.locator('text=每日发送趋势')).toBeVisible()
    await expect(page.locator('text=平台分布')).toBeVisible()
    await expect(page.locator('text=各平台发送量对比')).toBeVisible()
  })
})

test.describe('Account Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="邮箱地址"]', 'admin@globalreach.com')
    await page.fill('[placeholder="密码"]', 'admin123456')
    await page.click('button[type="submit"]')
    await page.waitForURL('/dashboard')
    await page.click('text=账号管理')
    await page.waitForURL('/accounts')
  })

  test('should display accounts page', async ({ page }) => {
    await expect(page.locator('text=账号管理中心')).toBeVisible()
    await expect(page.getByRole('button', { name: '新增账号' })).toBeVisible()
  })

  test('should open create account modal', async ({ page }) => {
    await page.click('button:has-text("新增账号")')
    
    await expect(page.locator('text=创建账号').toBeVisible())
    await expect(page.locator('[placeholder="example@gmail.com"]')).toBeVisible()
  })

  test('should fill account form and submit', async ({ page }) => {
    await page.click('button:has-text("新增账号")')
    
    await page.fill('[placeholder="example@gmail.com"]', 'test@example.com')
    await page.selectOption('select:above(:text("状态"))', 'gmail')
    await page.click('button:has-text("保存")')
  })

  test('should filter accounts by platform', async ({ page }) => {
    const platformSelect = page.locator('select').first()
    await platformSelect.selectOption({ label: 'Gmail' })
    
    await page.click('button:has-text("搜索")')
  })
})

test.describe('Campaign Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="邮箱地址"]', 'admin@globalreach.com')
    await page.fill('[placeholder="密码"]', 'admin123456')
    await page.click('button[type="submit"]')
    await page.waitForURL('/dashboard')
    await page.click('text=营销活动')
    await page.waitForURL('/campaigns')
  })

  test('should display campaigns page', async ({ page }) => {
    await expect(page.locator('text=营销活动管理')).toBeVisible()
    await expect(page.getByRole('button', { name: '创建活动' })).toBeVisible()
  })

  test('should open campaign creation modal', async ({ page }) => {
    await page.click('button:has-text("创建活动")')
    
    await expect(page.locator('text=创建营销活动')).toBeVisible()
    await expect(page.locator('[placeholder="例如：6月促销活动"]')).toBeVisible()
  })

  test('should fill campaign form with required fields', async ({ page }) => {
    await page.click('button:has-text("创建活动")')
    
    await page.fill('[placeholder="例如：6月促销活动"]', 'Test Campaign')
    await page.fill('[placeholder*="邮件标题"]', 'Test Subject')
    await page.selectOption('select:above(:text("发送平台"))', ['gmail'])
  })
})

test.describe('Reports & Analytics Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="邮箱地址"]', 'admin@globalreach.com')
    await page.fill('[placeholder="密码"]', 'admin123456')
    await page.click('button[type="submit"]')
    await page.waitForURL('/dashboard')
    await page.click('text=数据报表')
    await page.waitForURL('/reports')
  })

  test('should display reports page', async ({ page }) => {
    await expect(page.locator('text=数据报表分析')).toBeVisible()
  })

  test('should show KPI cards', async ({ page }) => {
    await expect(page.locator('text=打开率')).toBeVisible()
    await expect(page.locator('text=点击率')).toBeVisible()
    await expect(page.locator('text=退信率')).toBeVisible()
  })

  test('should display charts', async ({ page }) => {
    await expect(page.locator('text=30天发送趋势')).toBeVisible()
    await expect(page.locator('text=各平台性能对比')).toBeVisible()
  })
})

test.describe('Navigation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="邮箱地址"]', 'admin@globalreach.com')
    await page.fill('[placeholder="密码"]', 'admin123456')
    await page.click('button[type="submit"]')
    await page.waitForURL('/dashboard')
  })

  test('should navigate between pages using sidebar', async ({ page }) => {
    await page.click('text=仪表盘')
    await expect(page).toHaveURL('/dashboard')

    await page.click('text=账号管理')
    await expect(page).toHaveURL('/accounts')

    await page.click('text=营销活动')
    await expect(page).toHaveURL('/campaigns')

    await page.click('text=数据报表')
    await expect(page).toHaveURL('/reports')

    await page.click('text=系统设置')
    await expect(page).toHaveURL('/settings')
  })

  test('should toggle sidebar collapse', async ({ page }) => {
    const collapseButton = page.locator('.trigger').first()
    await collapseButton.click()
    
    await expect(page.locator('text=GR')).toBeVisible()
  })

  test('should logout successfully', async ({ page }) => {
    await page.click('[data-testid="user-menu"]')
    await page.click('text=退出登录')
    
    await expect(page).toHaveURL('/login')
  })
})
