const { test, expect } = require('@playwright/test');

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    await page.click('text=Reports');
    await page.waitForNavigation();
  });

  test('should display reports dashboard', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Reports');
    await expect(page.locator('text=Send Report')).toBeVisible();
    await expect(page.locator('text=Open Rate')).toBeVisible();
    await expect(page.locator('text=Click Rate')).toBeVisible();
  });

  test('should show trend charts', async ({ page }) => {
    await expect(page.locator('.ant-card')).toHaveCountGreaterThan(2);
  });

  test('should filter reports by date range', async ({ page }) => {
    await page.click('input[placeholder="Select Date Range"]');
    await page.waitForSelector('.ant-picker');
    await page.click('.ant-picker-ok');
    await page.waitForTimeout(500);
  });

  test('should export report as CSV', async ({ page }) => {
    await page.click('button:has-text("Export CSV")');
    await page.waitForTimeout(1000);
  });

  test('should export report as PDF', async ({ page }) => {
    await page.click('button:has-text("Export PDF")');
    await page.waitForTimeout(1000);
  });
});