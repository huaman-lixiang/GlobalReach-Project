const { test, expect } = require('@playwright/test');

test.describe('Campaigns Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    await page.click('text=Campaigns');
    await page.waitForNavigation();
  });

  test('should display campaigns list', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Campaigns');
    await page.waitForSelector('.ant-table');
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows).toHaveCountGreaterThan(0);
  });

  test('should create a new campaign', async ({ page }) => {
    await page.click('button:has-text("Create Campaign")');
    
    await expect(page.locator('.ant-modal-title')).toContainText('Create Campaign');
    
    await page.fill('input[name="name"]', 'Test Campaign');
    await page.selectOption('select[name="type"]', 'cold_warm');
    await page.fill('textarea[name="subject_template"]', 'Hello {{first_name}}');
    await page.fill('textarea[name="body_template"]', 'Welcome to GlobalReach!');
    
    await page.click('button:has-text("Save")');
    await page.waitForNavigation();
    
    await expect(page.locator('.ant-message-success')).toBeVisible();
  });

  test('should filter campaigns by status', async ({ page }) => {
    await page.selectOption('select', 'draft');
    await page.waitForTimeout(500);
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows).toHaveCountGreaterThan(0);
  });

  test('should view campaign details', async ({ page }) => {
    const firstRow = page.locator('.ant-table-row').first();
    await firstRow.click();
    await page.waitForSelector('.ant-card');
    await expect(page.locator('h2')).toBeVisible();
  });

  test('should start a campaign', async ({ page }) => {
    const startButton = page.locator('button:has-text("Start")').first();
    if (startButton) {
      await startButton.click();
      await page.waitForSelector('.ant-modal-confirm');
      await page.click('button:has-text("OK")');
      await expect(page.locator('.ant-message-success')).toBeVisible();
    }
  });
});