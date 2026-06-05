const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ============================================
  // 1. Create Admin User
  // ============================================
  const hashedPassword = await bcrypt.hash('Admin123456', 10); // S084/G05: 12→10 (DEFECT-001)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@globalreach.com' },
    update: {},
    create: {
      email: 'admin@globalreach.com',
      passwordHash: hashedPassword,
      name: 'System Administrator',
      role: 'ADMIN',
      isEmailVerified: true,
    },
  });
  console.log(`✅ Admin user created: ${admin.email}`);

  // ============================================
  // 2. Create Demo User
  // ============================================
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@globalreach.com' },
    update: {},
    create: {
      email: 'demo@globalreach.com',
      passwordHash: await bcrypt.hash('Demo123456', 10), // S084/G05: 12→10 (DEFECT-001)
      name: 'Demo User',
      role: 'USER',
      isEmailVerified: true,
    },
  });
  console.log(`✅ Demo user created: ${demoUser.email}`);

  // ============================================
  // 3. Create Email Accounts (3 platforms)
  // ============================================
  const accounts = [
    {
      userId: admin.id,
      platform: 'GMAIL',
      email: 'globalreach.gmail@gmail.com',
      passwordEncrypted: 'encrypted-gmail-password-placeholder',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      encryptionType: 'SSL',
      status: 'ACTIVE',
      displayName: 'Gmail Primary Account',
      dailyLimit: 100,
      hourlyLimit: 20,
      healthScore: 100,
    },
    {
      userId: admin.id,
      platform: 'OUTLOOK',
      email: 'globalreach.outlook@outlook.com',
      passwordEncrypted: 'encrypted-outlook-password-placeholder',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      encryptionType: 'STARTTLS',
      status: 'ACTIVE',
      displayName: 'Outlook Business Account',
      dailyLimit: 50,
      hourlyLimit: 15,
      healthScore: 95,
    },
    {
      userId: admin.id,
      platform: 'QQ',
      email: 'globalreach@qq.com',
      passwordEncrypted: 'encrypted-qq-password-placeholder',
      imapHost: 'imap.qq.com',
      imapPort: 993,
      smtpHost: 'smtp.qq.com',
      smtpPort: 465,
      encryptionType: 'SSL',
      status: 'ACTIVE',
      displayName: 'QQ Mail Account',
      dailyLimit: 200,
      hourlyLimit: 50,
      healthScore: 90,
    },
  ];

  for (const acc of accounts) {
    const account = await prisma.emailAccount.upsert({
      where: { id: `seed-${acc.platform.toLowerCase()}` },
      update: {},
      create: { ...acc, id: undefined }, // Let DB generate UUID
    });
    console.log(`✅ Email account created: ${acc.email} (${acc.platform})`);
  }

  // ============================================
  // 4. Create Sample Clients (20 clients, multi-country)
  // ============================================
  const countries = [
    { country: 'United States', count: 5, industry: 'Technology' },
    { country: 'Germany', count: 3, industry: 'Manufacturing' },
    { country: 'United Kingdom', count: 2, industry: 'Finance' },
    { country: 'Japan', count: 2, industry: 'Automotive' },
    { country: 'France', count: 2, industry: 'Luxury' },
    { country: 'Australia', count: 2, industry: 'Mining' },
    { country: 'Canada', count: 2, industry: 'Energy' },
    { country: 'Singapore', count: 1, industry: 'Logistics' },
    { country: 'UAE', count: 1, industry: 'Construction' },
  ];

  let clientIndex = 0;
  for (const c of countries) {
    for (let i = 0; i < c.count; i++) {
      clientIndex++;
      const firstName = ['John', 'Jane', 'Michael', 'Sarah', 'Hans', 'Yuki', 'Pierre', 'Ahmed', 'Wei', 'Emma'][clientIndex % 10];
      const lastName = ['Smith', 'Johnson', 'Mueller', 'Tanaka', 'Dubois', 'Al-Rashid', 'Chen', 'Wilson', 'Brown', 'Davis'][clientIndex % 10];
      
      await prisma.client.create({
        data: {
          userId: admin.id,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${clientIndex}@example.com`,
          firstName,
          lastName,
          company: `${c.industry} Corp ${clientIndex}`,
          country: c.country,
          industry: c.industry,
          status: clientIndex <= 12 ? 'LEAD' : clientIndex <= 16 ? 'CUSTOMER' : 'PROSPECT',
          tags: [c.country, c.industry, clientIndex % 3 === 0 ? 'VIP' : 'Standard'],
          phone: `+1-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9000 + 1000)}`,
        },
      });
    }
  }
  console.log(`✅ Created ${clientIndex} sample clients across ${countries.length} countries`);

  // ============================================
  // 5. Create Sample Campaign
  // ============================================
  const campaign = await prisma.campaign.create({
    data: {
      userId: admin.id,
      name: 'Q2 Product Launch - International Outreach',
      type: 'COLD_WARM',
      status: 'DRAFT',
      subjectTemplate: 'Introducing {{product}} to {{company}}',
      bodyTemplate: `<html><body><h2>Dear {{first_name}},</h2><p>We are excited to introduce our new {{product}}...</p></body></html>`,
      targetSegment: { countries: ['United States', 'Germany', 'UK'], industries: ['Technology', 'Manufacturing'] },
      stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 },
    },
  });
  console.log(`✅ Sample campaign created: ${campaign.name}`);

  console.log('\n🎉 Seeding completed!');
  console.log('\n📧 Test Accounts:');
  console.log('   Admin:  admin@globalreach.com / Admin123456');
  console.log('   Demo:   demo@globalreach.com / Demo123456');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
