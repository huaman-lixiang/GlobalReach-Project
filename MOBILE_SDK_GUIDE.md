# GlobalReach Mobile SDK Integration Guide

> **Version**: 2.0.0 | **Platforms**: iOS, Android

---

## 1. Overview

The GlobalReach Mobile SDK provides easy integration with the GlobalReach API for mobile applications. This guide covers authentication, device registration, push notifications, and core API endpoints.

---

## 2. Getting Started

### 2.1 Prerequisites

- GlobalReach API URL: `https://api.yourdomain.com`
- API Version: `v1`
- Authentication: JWT tokens

### 2.2 Installation

#### iOS (Swift Package Manager)

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/globalreach/mobile-sdk-ios", from: "2.0.0")
]
```

#### Android (Gradle)

```gradle
// build.gradle (Module)
dependencies {
    implementation 'com.globalreach:mobile-sdk:2.0.0'
}
```

---

## 3. Authentication

### 3.1 Login

```swift
// iOS
let client = GlobalReachClient(baseURL: "https://api.yourdomain.com")
client.login(email: "user@example.com", password: "password") { result in
    switch result {
    case .success(let auth):
        print("Access Token: \(auth.accessToken)")
        print("Refresh Token: \(auth.refreshToken)")
    case .failure(let error):
        print("Login failed: \(error.localizedDescription)")
    }
}
```

```kotlin
// Android
val client = GlobalReachClient("https://api.yourdomain.com")
client.login("user@example.com", "password") { result ->
    when (result) {
        is Result.Success -> {
            val auth = result.data
            println("Access Token: ${auth.accessToken}")
        }
        is Result.Failure -> {
            println("Login failed: ${result.error.message}")
        }
    }
}
```

### 3.2 Refresh Token

```swift
// iOS
client.refreshToken(refreshToken: "refresh_token") { result in
    switch result {
    case .success(let auth):
        print("New Access Token: \(auth.accessToken)")
    case .failure(let error):
        print("Refresh failed: \(error.localizedDescription)")
    }
}
```

---

## 4. Device Registration

### 4.1 Register Device for Push Notifications

```swift
// iOS
let deviceToken = "your_apns_device_token"
client.registerDevice(
    deviceToken: deviceToken,
    platform: .iOS,
    deviceId: "unique_device_id"
) { result in
    switch result {
    case .success(let device):
        print("Device registered: \(device.id)")
    case .failure(let error):
        print("Registration failed: \(error.localizedDescription)")
    }
}
```

```kotlin
// Android
val deviceToken = "your_fcm_device_token"
client.registerDevice(deviceToken, Platform.Android, "unique_device_id") { result ->
    when (result) {
        is Result.Success -> println("Device registered: ${result.data.id}")
        is Result.Failure -> println("Registration failed: ${result.error.message}")
    }
}
```

### 4.2 Unregister Device

```swift
// iOS
client.unregisterDevice(deviceId: "unique_device_id") { result in
    if case .success = result {
        print("Device unregistered")
    }
}
```

---

## 5. Core API Endpoints

### 5.1 Dashboard Overview

```swift
// iOS
client.getDashboard { result in
    switch result {
    case .success(let dashboard):
        print("Campaigns: \(dashboard.overview.campaignCount)")
        print("Today Emails: \(dashboard.overview.todayEmails)")
        print("Open Rate: \(dashboard.overview.openRate)%")
    case .failure(let error):
        print("Failed: \(error.localizedDescription)")
    }
}
```

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "campaignCount": 15,
      "emailCount": 1250,
      "todayEmails": 42,
      "openRate": 38.5
    },
    "recentCampaigns": [
      {
        "id": 1,
        "name": "Summer Sale",
        "status": "completed",
        "emailCount": 500,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

### 5.2 Quick Stats

```swift
// iOS
client.getQuickStats { result in
    switch result {
    case .success(let stats):
        print("Total Emails: \(stats.totalEmails)")
        print("Delivery Rate: \(stats.deliveryRate)%")
    case .failure(let error):
        print("Failed: \(error.localizedDescription)")
    }
}
```

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "totalEmails": 1250,
    "deliveredEmails": 1180,
    "openedEmails": 450,
    "clickedEmails": 120,
    "campaignCount": 15,
    "deliveryRate": "94.4",
    "openRate": "38.1",
    "clickRate": "26.7"
  }
}
```

### 5.3 Campaigns List

```swift
// iOS
client.getCampaigns(page: 1, limit: 20) { result in
    switch result {
    case .success(let response):
        for campaign in response.items {
            print("\(campaign.name) - \(campaign.status)")
        }
    case .failure(let error):
        print("Failed: \(error.localizedDescription)")
    }
}
```

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "name": "Summer Sale",
        "type": "marketing",
        "status": "completed",
        "emailCount": 500,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 15,
      "pages": 1
    }
  }
}
```

### 5.4 Campaign Overview

```swift
// iOS
client.getCampaignOverview(campaignId: 1) { result in
    switch result {
    case .success(let overview):
        print("Name: \(overview.name)")
        print("Status: \(overview.status)")
        print("Open Rate: \(overview.statistics.openRate)%")
    case .failure(let error):
        print("Failed: \(error.localizedDescription)")
    }
}
```

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Summer Sale",
    "type": "marketing",
    "status": "completed",
    "createdAt": "2024-01-15T10:30:00Z",
    "statistics": {
      "total": 500,
      "delivered": 480,
      "opened": 180,
      "clicked": 45,
      "bounced": 20,
      "deliveryRate": "96.0",
      "openRate": "37.5",
      "clickRate": "25.0",
      "bounceRate": "4.0"
    }
  }
}
```

---

## 6. Push Notifications

### 6.1 Supported Events

| Event Type | Description | Notification Title |
|------------|-------------|-------------------|
| `email_delivered` | Email delivered successfully | "Email Delivered" |
| `email_opened` | Recipient opened email | "Email Opened" |
| `email_clicked` | Recipient clicked link | "Link Clicked" |
| `email_bounced` | Email bounced | "Email Bounced" |
| `email_converted` | Conversion occurred | "Conversion!" |
| `campaign_completed` | Campaign finished | "Campaign Completed" |

### 6.2 Notification Payload Structure

```json
{
  "aps": {
    "alert": {
      "title": "Email Opened",
      "body": "Email opened by john@example.com"
    },
    "badge": 1,
    "sound": "ping.aiff"
  },
  "data": {
    "eventType": "email_opened",
    "emailId": "12345",
    "timestamp": "1705315200000"
  }
}
```

---

## 7. API Reference

### Base URL

```
https://api.yourdomain.com/api/v1/mobile
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/devices/register` | POST | Register device for push notifications |
| `/devices/unregister` | POST | Unregister device |
| `/devices` | GET | Get user devices |
| `/dashboard` | GET | Get dashboard overview |
| `/campaigns` | GET | Get campaigns list |
| `/campaigns/:id/overview` | GET | Get campaign statistics |
| `/quick-stats` | GET | Get quick statistics |

---

## 8. Error Handling

### Common Error Codes

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `AUTHENTICATION_FAILED` | Invalid credentials | 401 |
| `TOKEN_EXPIRED` | Access token expired | 401 |
| `DEVICE_REGISTER_FAILED` | Device registration failed | 500 |
| `CAMPAIGN_NOT_FOUND` | Campaign does not exist | 404 |
| `DASHBOARD_FAILED` | Failed to fetch dashboard | 500 |

### Retry Strategy

```swift
// iOS - Automatic token refresh
client.onTokenExpired = { [weak self] in
    self?.client.refreshToken(refreshToken: storedRefreshToken) { result in
        if case .success(let auth) = result {
            self?.client.setAccessToken(auth.accessToken)
        }
    }
}
```

---

## 9. Security Best Practices

1. **Store tokens securely** - Use Keychain (iOS) or Keystore (Android)
2. **Use HTTPS** - Always use secure connections
3. **Validate inputs** - Sanitize all user inputs
4. **Handle token expiration** - Implement refresh token logic
5. **Encrypt sensitive data** - Encrypt sensitive data at rest

---

## 10. Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `API_URL` | Base API URL | Yes |
| `API_VERSION` | API version (default: v1) | No |
| `TIMEOUT` | Request timeout in seconds | No |

---

## 11. Changelog

### v2.0.0
- Added push notification support (APNs/FCM)
- Added dashboard endpoint
- Added quick stats endpoint
- Added campaign overview endpoint
- Improved error handling

### v1.0.0
- Initial release
- Basic authentication
- Device registration

---

*Documentation Generated: 2026-06-04*
*GlobalReach Mobile SDK v2.0.0*