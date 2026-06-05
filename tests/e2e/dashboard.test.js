const { test, expect } = require('@playwright/test');

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
  });

  test('should display dashboard with stats cards', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Dashboard');
    
    const statsCards = page.locator('.ant-card');
    await expect(statsCards).toHaveCount(4);
    
    await expect(page.locator('text=Today Sent')).toBeVisible();
    await expect(page.locator('text=Open Rate')).toBeVisible();
    await expect(page.locator('text=Click Rate')).toBeVisible();
    await expect(page.locator('text=Accounts Health')).toBeVisible();
  });

  test('should show recent campaigns list', async ({ page }) => {
    await expect(page.locator('text=Recent Campaigns')).toBeVisible();
    await page.waitForSelector('.ant-table');
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows).toHaveCountGreaterThan(0);
  });

  test('should navigate to accounts page from sidebar', async ({ page }) => {
    await page.click('text=Accounts');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/accounts');
  });

  test('should navigate to campaigns page from sidebar', async ({ page }) => {
    await page.click('text=Campaigns');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/campaigns');
  });

  test('should navigate to reports page from sidebar', async ({ page }) => {
    await page.click('text=Reports');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/reports');
  });
});