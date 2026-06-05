const { test, expect } = require('@playwright/test');

test.describe('Accounts Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    await page.click('text=Accounts');
    await page.waitForNavigation();
  });

  test('should display accounts list', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Email Accounts');
    await page.waitForSelector('.ant-table');
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows).toHaveCountGreaterThan(0);
  });

  test('should open add account modal', async ({ page }) => {
    await page.click('button:has-text("Add Account")');
    await expect(page.locator('.ant-modal-title')).toContainText('Add Email Account');
  });

  test('should filter accounts by platform', async ({ page }) => {
    await page.selectOption('select', 'gmail');
    await page.waitForTimeout(500);
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows).toHaveCountGreaterThan(0);
  });

  test('should search accounts by email', async ({ page }) => {
    await page.fill('input[placeholder="Search accounts"]', 'test@gmail.com');
    await page.waitForTimeout(500);
  });

  test('should view account details', async ({ page }) => {
    const firstRow = page.locator('.ant-table-row').first();
    await firstRow.click();
    await page.waitForSelector('.ant-card');
    await expect(page.locator('h2')).toBeVisible();
  });
});