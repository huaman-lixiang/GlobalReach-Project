const { test, expect } = require('@playwright/test');

test.describe('Authentication Flow', () => {
  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    
    await page.fill('input[type="email"]', 'admin@globalreach.com');
    await page.fill('input[type="password"]', 'Admin123456');
    await page.click('button[type="submit"]');
    
    await page.waitForNavigation();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    
    await page.fill('input[type="email"]', 'invalid@test.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.ant-form-item-explain-error')).toBeVisible();
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Register');
    
    await page.waitForNavigation();
    await expect(page).toHaveURL('/register');
    await expect(page.locator('h1')).toContainText('Register');
  });
});