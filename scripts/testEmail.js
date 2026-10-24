const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { getTransporter } = require('../services/emailService');

async function testConnection() {
  const host = (process.env.EMAIL_HOST || 'orion.snowyserver.com').trim();
  const port = Number(process.env.EMAIL_PORT) || 465;
  const user = (process.env.EMAIL_USER || 'support@sarail1to99plus-shop.com').trim();
  const pass = (process.env.EMAIL_PASS || '').trim();

  console.log('Testing cPanel SMTP Authentication...');
  console.log(`- Host: ${host}`);
  console.log(`- Port: ${port}`);
  console.log(`- User: ${user}`);
  console.log(`- Pass length: ${pass.length} chars (hidden: ${pass.slice(0, 2)}****${pass.slice(-2)})`);

  if (!user || !pass) {
    console.error('ERROR: EMAIL_USER or EMAIL_PASS is empty in .env');
    process.exit(1);
  }

  const transporter = getTransporter();

  try {
    await transporter.verify();
    console.log('\n SUCCESS! cPanel SMTP credentials are valid and ready to send emails.');
  } catch (error) {
    console.error('\n AUTHENTICATION FAILED:');
    console.error(error.message);
  }
}

testConnection();

