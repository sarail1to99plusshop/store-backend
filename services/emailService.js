const nodemailer = require('nodemailer');

/**
 * Configure Nodemailer Transporter with custom cPanel SMTP hosting
 * Explicitly configured for port 465 (SSL), host, and credentials without any Google/Gmail fallbacks.
 */
const getTransporter = () => {
  const host = (process.env.EMAIL_HOST || 'orion.snowyserver.com').trim();
  const port = Number(process.env.EMAIL_PORT) || 465;
  const user = (process.env.EMAIL_USER || 'support@sarail1to99plus-shop.com').trim();
  const pass = (process.env.EMAIL_PASS || '').trim();

  if (!user || !pass) {
    console.warn('[emailService] Warning: EMAIL_USER or EMAIL_PASS not fully configured in environment.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: true,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

/**
 * Shared transporter instance
 */
const transporter = getTransporter();

/**
 * Startup SMTP Connection Verification Callback
 * Logs whether SMTP connection and authentication are established on boot.
 */
if (process.env.NODE_ENV !== 'test') {
  transporter.verify((error, success) => {
    if (error) {
      console.error('[emailService] SMTP connection/authentication failed on boot:', error.message);
    } else {
      console.log('[emailService] SMTP connection and authentication successfully established on boot.');
    }
  });
}

/**
 * Verify SMTP Transporter Connection
 */
const verifyEmailService = async () => {
  try {
    await transporter.verify();
    console.log('[emailService] SMTP Transporter successfully connected & authenticated.');
    return { success: true };
  } catch (error) {
    console.error('[emailService] SMTP Verification Error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Helper to format date in localized human-readable format
 */
const formatDate = (dateValue) => {
  try {
    const d = dateValue ? new Date(dateValue) : new Date();
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date().toLocaleDateString();
  }
};

/**
 * Helper to format currency
 */
const formatBDT = (amount) => {
  return `৳${Number(amount || 0).toLocaleString('en-BD')}`;
};

/**
 * Generate Professional HTML & Text Templates for Order Status Notifications
 */
const buildOrderEmailContent = (order, statusType = 'Shipped') => {
  const invoice = order.invoiceNumber || 'N/A';
  const customerName = order.customerDetails?.name || 'Valued Customer';
  const phone = order.customerDetails?.phone || 'N/A';
  const address = order.customerDetails?.address || 'N/A';
  const deliveryLocation = order.customerDetails?.deliveryLocation || 'Inside Dhaka';
  const orderDate = formatDate(order.createdAt);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsSubtotal = Number(order.itemsSubtotal || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const totalAmount = Number(order.totalAmount || 0);
  const paymentMethod = order.paymentMethod === 'bKash' ? 'bKash Online' : 'Cash on Delivery (COD)';
  const paymentStatus = order.paymentStatus || 'Pending';
  const courierData = order.courierData || {};
  const trackingCode = courierData.trackingCode || '';
  const trackingUrl = courierData.trackingUrl || (trackingCode ? `https://steadfast.com.bd/t/${trackingCode}` : '');
  const supportPhone = process.env.SUPPORT_PHONE || '01998-789157';
  const storeEmail = (process.env.EMAIL_USER || 'support@sarail1to99plus-shop.com').trim();
  const frontendUrl = process.env.FRONTEND_URL || 'https://sarail1to99plus-shop.com';
  const trackingPageUrl = `${frontendUrl.replace(/\/$/, '')}/track-order?invoice=${encodeURIComponent(invoice)}`;

  const isShipped = statusType.toLowerCase() === 'shipped';
  const isDelivered = statusType.toLowerCase() === 'delivered';
  const isCancelled = statusType.toLowerCase() === 'cancelled';

  // Dynamic Theme & Text Content based on Status
  let theme;
  if (isShipped) {
    theme = {
      accent: '#003D73',
      badgeBg: '#EFF6FF',
      badgeText: '#1D4ED8',
      badgeBorder: '#BFDBFE',
      statusHeadline: '🚚 Your Order is Shipped!',
      statusSubtext: 'আপনার অর্ডারটি পাঠানো হয়েছে এবং দ্রুত আপনার ঠিকানায় পৌঁছে দেওয়া হবে।',
      description: 'Great news! Your package is now on its way with our trusted courier partner. Please keep your phone available for delivery updates.',
    };
  } else if (isDelivered) {
    theme = {
      accent: '#059669',
      badgeBg: '#ECFDF5',
      badgeText: '#047857',
      badgeBorder: '#A7F3D0',
      statusHeadline: '✅ Your Order has been Delivered!',
      statusSubtext: 'আপনার অর্ডার সফলভাবে ডেলিভারি সম্পন্ন হয়েছে!',
      description: 'Thank you for shopping with Sarail 1 to 99 Plus Shop! We hope you love your purchase. If you have any feedback or require assistance, please reach out to us anytime.',
    };
  } else if (isCancelled) {
    theme = {
      accent: '#DC2626',
      badgeBg: '#FEF2F2',
      badgeText: '#B91C1C',
      badgeBorder: '#FECACA',
      statusHeadline: '❌ Your Order has been Cancelled',
      statusSubtext: 'আপনার অর্ডারটি বাতিল করা হয়েছে।',
      description: 'This is to confirm that your order has been cancelled. If you already made an advance payment (via bKash), our support team will process your refund according to our policy. If you have any questions or cancelled by mistake, please contact our helpline.',
    };
  } else {
    theme = {
      accent: '#003D73',
      badgeBg: '#F1F5F9',
      badgeText: '#334155',
      badgeBorder: '#CBD5E1',
      statusHeadline: `Order #${invoice} Details`,
      statusSubtext: `Current Order Status: ${statusType}`,
      description: 'Here are the latest details and invoice breakdown for your order.',
    };
  }

  // Generate Items Table HTML Rows (Pure, lightweight semantic HTML without hotlinked media)
  const itemRowsHtml = items
    .map((item, idx) => {
      const title = item.title || 'Product';
      const color = item.color || item.selectedVariant?.colorName || 'Standard';
      const qty = item.quantity || 1;
      const price = Number(item.price || 0);
      const subtotal = Number(item.subtotal || price * qty);

      return `
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 10px; vertical-align: middle;">
            <div style="font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.35;">${title}</div>
            <div style="font-size: 11px; color: #64748B; margin-top: 3px;">
              <span style="display: inline-block; background-color: #F1F5F9; color: #475569; padding: 2px 7px; border-radius: 4px; font-weight: 600;">Variant: ${color}</span>
            </div>
          </td>
          <td style="padding: 12px 8px; text-align: center; font-size: 13px; font-weight: 600; color: #334155; vertical-align: middle;">
            ${qty}
          </td>
          <td style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 600; color: #334155; vertical-align: middle;">
            ${formatBDT(price)}
          </td>
          <td style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 700; color: #0F172A; vertical-align: middle;">
            ${formatBDT(subtotal)}
          </td>
        </tr>
      `;
    })
    .join('');

  // Plain text fallback for items
  const itemsText = items
    .map(
      (item, idx) =>
        `${idx + 1}. ${item.title || 'Product'} (Color: ${item.color || 'Standard'}) x ${item.quantity || 1} = ${formatBDT(item.subtotal || item.price * (item.quantity || 1))}`
    )
    .join('\n');

  // Tracking box HTML if available
  const courierBoxHtml = trackingCode
    ? `
      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin: 20px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td>
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #64748B;">Courier Tracking Information</div>
              <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-top: 4px;">Steadfast Courier Code: <span style="color: #003D73; font-family: monospace;">${trackingCode}</span></div>
              <div style="font-size: 12px; color: #64748B; margin-top: 2px;">Use this code to track your parcel live on the courier network.</div>
            </td>
            ${
              trackingUrl
                ? `
            <td style="text-align: right; vertical-align: middle; padding-left: 12px;">
              <a href="${trackingUrl}" target="_blank" style="display: inline-block; background-color: #003D73; color: #FFFFFF; font-size: 12px; font-weight: 700; text-decoration: none; padding: 8px 16px; border-radius: 8px;">
                Track Courier &rarr;
              </a>
            </td>
            `
                : ''
            }
          </tr>
        </table>
      </div>
    `
    : '';

  // Main HTML Body
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${theme.statusHeadline} - #${invoice}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F1F5F9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container (Max Width 620px) -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 620px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border: 1px solid #E2E8F0;">
          
          <!-- BRAND HEADER -->
          <tr>
            <td style="background: linear-gradient(135deg, #003D73 0%, #002244 100%); padding: 24px; text-align: center; color: #FFFFFF;">
              <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="padding-bottom: 10px;">
                    <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${frontendUrl.replace(/\/$/, '')}/logo.png" alt="Sarail 1 to 99 Plus Shop" width="56" height="56" style="display: block; width: 56px; height: 56px; object-fit: contain; border: 0; outline: none; margin: 0 auto;" />
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px; line-height: 1.2; color: #FFFFFF;">
                      Sarail 1 to 99 Plus Shop
                    </div>
                    <div style="font-size: 12px; color: #93C5FD; margin-top: 4px; font-weight: 500;">
                      Daily Household, Kitchen &amp; Lifestyle Solutions • সরাইল ১ টু ৯৯ প্লাস শপ
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STATUS HERO BANNER -->
          <tr>
            <td style="padding: 24px 28px 16px; text-align: center; border-bottom: 1px solid #F1F5F9;">
              <span style="display: inline-block; background-color: ${theme.badgeBg}; color: ${theme.badgeText}; border: 1px solid ${theme.badgeBorder}; font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
                Order Status: ${statusType.toUpperCase()}
              </span>
              <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #0F172A; line-height: 1.3;">
                ${theme.statusHeadline}
              </h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #475569; font-weight: 500;">
                ${theme.statusSubtext}
              </p>
              <p style="margin: 10px 0 0; font-size: 13px; color: #64748B; line-height: 1.5;">
                ${theme.description}
              </p>
            </td>
          </tr>

          <!-- COURIER TRACKING (IF SHIPPED & TRACKING CODE AVAILABLE) -->
          ${
            courierBoxHtml
              ? `
          <tr>
            <td style="padding: 0 28px;">
              ${courierBoxHtml}
            </td>
          </tr>
          `
              : ''
          }

          <!-- ORDER META & CUSTOMER DETAILS -->
          <tr>
            <td style="padding: 16px 28px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px;">
                <tr>
                  <td width="50%" style="vertical-align: top; padding-right: 12px;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">Invoice Number</div>
                    <div style="font-size: 14px; font-weight: 800; color: #003D73; margin-top: 2px; font-family: monospace;">#${invoice}</div>
                    
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px; margin-top: 12px;">Order Placed On</div>
                    <div style="font-size: 13px; font-weight: 600; color: #334155; margin-top: 2px;">${orderDate}</div>

                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px; margin-top: 12px;">Payment Method</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A; margin-top: 2px;">
                      ${paymentMethod} <span style="font-size: 11px; font-weight: 600; color: ${paymentStatus === 'Paid' ? '#059669' : '#D97706'};">(${paymentStatus})</span>
                    </div>
                  </td>
                  <td width="50%" style="vertical-align: top; padding-left: 12px; border-left: 1px dashed #CBD5E1;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">Shipping To</div>
                    <div style="font-size: 14px; font-weight: 800; color: #0F172A; margin-top: 2px;">${customerName}</div>
                    <div style="font-size: 12px; font-weight: 600; color: #334155; margin-top: 2px;">Phone: ${phone}</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 4px; line-height: 1.4;">${address}</div>
                    <div style="font-size: 11px; font-weight: 600; color: #0284C7; margin-top: 4px;">Zone: ${deliveryLocation}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ITEMIZED ORDER INVOICE TABLE -->
          <tr>
            <td style="padding: 16px 28px;">
              <div style="font-size: 14px; font-weight: 800; color: #0F172A; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                Order Items & Invoice Breakdown
              </div>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
                <thead>
                  <tr style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; border-bottom: 2px solid #CBD5E1;">
                    <th align="left" style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Product</th>
                    <th align="center" style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Qty</th>
                    <th align="right" style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Unit Price</th>
                    <th align="right" style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRowsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- TOTALS SUMMARY -->
          <tr>
            <td style="padding: 8px 28px 24px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="50%"></td>
                  <td width="50%">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 13px; line-height: 1.8;">
                      <tr>
                        <td style="color: #64748B;">Items Subtotal:</td>
                        <td align="right" style="font-weight: 600; color: #334155;">${formatBDT(itemsSubtotal)}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748B;">Delivery Fee (${deliveryLocation}):</td>
                        <td align="right" style="font-weight: 600; color: #334155;">${formatBDT(deliveryFee)}</td>
                      </tr>
                      <tr style="border-top: 2px solid #E2E8F0; border-bottom: 2px solid #E2E8F0;">
                        <td style="padding: 8px 0; font-size: 15px; font-weight: 800; color: #0F172A;">Total Payable:</td>
                        <td align="right" style="padding: 8px 0; font-size: 16px; font-weight: 800; color: #003D73;">${formatBDT(totalAmount)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ACTION BUTTONS -->
          <tr>
            <td align="center" style="padding: 0 28px 28px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding: 0 6px;">
                    <a href="${trackingPageUrl}" target="_blank" style="display: inline-block; background-color: #003D73; color: #FFFFFF; font-size: 13px; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 61, 115, 0.2);">
                      Track Order Live &rarr;
                    </a>
                  </td>
                  <td style="padding: 0 6px;">
                    <a href="${frontendUrl}" target="_blank" style="display: inline-block; background-color: #F1F5F9; color: #334155; font-size: 13px; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 8px; border: 1px solid #CBD5E1;">
                      Visit Store
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HELPLINE & FOOTER -->
          <tr>
            <td style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 24px 28px; text-align: center;">
              <div style="font-size: 13px; font-weight: 700; color: #0F172A;">Need Help with your Order?</div>
              <div style="font-size: 12px; color: #64748B; margin-top: 4px; line-height: 1.5;">
                Hotline / WhatsApp: <strong style="color: #0F172A;">${supportPhone}</strong> &bull; Email: <a href="mailto:${storeEmail}" style="color: #003D73; text-decoration: none; font-weight: 600;">${storeEmail}</a>
              </div>
              <div style="font-size: 11px; color: #94A3B8; margin-top: 12px; line-height: 1.4;">
                &copy; ${new Date().getFullYear()} Sarail 1 to 99 Plus Shop. All rights reserved.<br/>
                Sarail, Brahmanbaria, Bangladesh.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  // Text version
  const text = `
Sarail 1 to 99 Plus Shop - Order ${statusType} Update
=====================================================

${theme.statusHeadline}
${theme.statusSubtext}

${theme.description}

Invoice Number: #${invoice}
Order Date: ${orderDate}
Status: ${statusType}

Customer Information:
- Name: ${customerName}
- Phone: ${phone}
- Address: ${address}
- Delivery Location: ${deliveryLocation}

${trackingCode ? `Courier Tracking Code: ${trackingCode}\nLive Courier Tracking: ${trackingUrl}\n` : ''}

Order Items:
${itemsText}

Financial Breakdown:
- Items Subtotal: ${formatBDT(itemsSubtotal)}
- Delivery Charge: ${formatBDT(deliveryFee)}
- Total Payable: ${formatBDT(totalAmount)}
- Payment Method: ${paymentMethod} (${paymentStatus})

Track Your Order Live:
${trackingPageUrl}

Need Help?
- Helpline / WhatsApp: ${supportPhone}
- Email: ${storeEmail}
- Website: ${frontendUrl}

Thank you for shopping with Sarail 1 to 99 Plus Shop!
  `.trim();

  let subject;
  if (isShipped) {
    subject = `🚚 Your Order #${invoice} is Shipped! - Sarail 1 to 99 Plus Shop`;
  } else if (isDelivered) {
    subject = `✅ Your Order #${invoice} has been Delivered! - Sarail 1 to 99 Plus Shop`;
  } else if (isCancelled) {
    subject = `❌ Your Order #${invoice} has been Cancelled - Sarail 1 to 99 Plus Shop`;
  } else {
    subject = `Order #${invoice} Update (${statusType}) - Sarail 1 to 99 Plus Shop`;
  }

  return { subject, html, text };
};

/**
 * Send Order Shipped Email to Customer
 */
const sendOrderShippedEmail = async (order) => {
  return sendOrderInvoiceEmail(order, 'Shipped');
};

/**
 * Send Order Delivered Email to Customer
 */
const sendOrderDeliveredEmail = async (order) => {
  return sendOrderInvoiceEmail(order, 'Delivered');
};

/**
 * Send Order Cancelled Email to Customer
 */
const sendOrderCancelledEmail = async (order) => {
  return sendOrderInvoiceEmail(order, 'Cancelled');
};

/**
 * Send Order Invoice Email to Customer with Custom/Provided Status
 * Gracefully handles missing email, errors, and provides detailed logging.
 */
const sendOrderInvoiceEmail = async (order, statusType = 'Shipped') => {
  try {
    if (!order) {
      return { success: false, error: 'No order object provided.' };
    }

    const customerEmail = (
      order.customerDetails?.email ||
      order.email ||
      ''
    ).trim();

    if (!customerEmail || !customerEmail.includes('@')) {
      console.log(
        `[emailService] Order #${order.invoiceNumber} has no valid customer email address. Skipping email dispatch.`
      );
      return {
        success: false,
        skipped: true,
        message: 'No valid customer email address found on order.',
      };
    }

    const transporter = getTransporter();
    const fromName = (process.env.EMAIL_FROM_NAME || 'Sarail 1 to 99+ Shop').replace(/^"|"$/g, '').trim();
    const fromAddress = (process.env.EMAIL_USER || 'support@sarail1to99plus-shop.com').trim();
    const from = `"${fromName}" <${fromAddress}>`;

    const { subject, html, text } = buildOrderEmailContent(order, statusType);

    console.log(
      `[emailService] Sending "${statusType}" invoice notification to ${customerEmail} for Order #${order.invoiceNumber}...`
    );

    const info = await transporter.sendMail({
      from,
      to: customerEmail,
      subject,
      text,
      html,
    });

    console.log(
      `[emailService] Successfully sent "${statusType}" email to ${customerEmail}. MessageId: ${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
      recipient: customerEmail,
      status: statusType,
    };
  } catch (error) {
    console.error(
      `[emailService] Failed to send "${statusType}" email for Order #${order?.invoiceNumber}:`,
      error.message
    );
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  getTransporter,
  verifyEmailService,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
  sendOrderInvoiceEmail,
  buildOrderEmailContent,
};
