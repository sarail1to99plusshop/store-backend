require('dotenv').config();
const nodemailer = require('nodemailer');

async function testConnection() {
  const user = (process.env.EMAIL_USER || '').trim();
  const rawPass = (process.env.EMAIL_PASS || '').trim();
  const pass = rawPass.replace(/\s+/g, '');

  console.log('Testing Gmail SMTP Authentication...');
  console.log(`- Host: ${process.env.EMAIL_HOST || 'smtp.gmail.com'}`);
  console.log(`- Port: ${process.env.EMAIL_PORT || 465}`);
  console.log(`- User: ${user}`);
  console.log(`- Pass length: ${pass.length} chars (hidden: ${pass.slice(0, 2)}****${pass.slice(-2)})`);

  if (!user || !pass) {
    console.error('ERROR: EMAIL_USER or EMAIL_PASS is empty in .env');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  try {
    await transporter.verify();
    console.log('\n SUCCESS! Gmail SMTP credentials are valid and ready to send emails.');
  } catch (error) {
    console.error('\n AUTHENTICATION FAILED:');
    console.error(error.message);
    console.log('\nHow to fix:');
    console.log('1. Go to https://myaccount.google.com/apppasswords');
    console.log(`2. Verify the profile in the top-right corner is EXACTLY: ${user}`);
    console.log('3. Delete the old app password and generate a new one named "Shop".');
    console.log('4. Paste the new 16-letter code into EMAIL_PASS in backend/.env');
  }
}

testConnection();

