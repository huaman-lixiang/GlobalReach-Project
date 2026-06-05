const { test, expect } = require('@playwright/test');

test.describe('Full User Journey', () => {
  test('complete user journey: login → dashboard → accounts → create campaign → view reports', async ({ page }) => {
    await page.goto('/');
    
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');

    await page.click('text=Accounts');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/accounts');
    await expect(page.locator('h1')).toContainText('Email Accounts');

    await page.click('text=Campaigns');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/campaigns');
    await expect(page.locator('h1')).toContainText('Campaigns');

    await page.click('button:has-text("Create Campaign")');
    await expect(page.locator('.ant-modal-title')).toContainText('Create Campaign');
    await page.fill('input[name="name"]', 'E2E Test Campaign');
    await page.selectOption('select[name="type"]', 'newsletter');
    await page.fill('textarea[name="subject_template"]', 'Test Subject');
    await page.fill('textarea[name="body_template"]', 'Test Body Content');
    await page.click('button:has-text("Cancel")');

    await page.click('text=Reports');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/reports');
    await expect(page.locator('h1')).toContainText('Reports');

    await page.click('text=Settings');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/settings');

    await page.click('text=Logout');
    await page.waitForNavigation();
    await expect(page).toHaveURL('/');
  });
});