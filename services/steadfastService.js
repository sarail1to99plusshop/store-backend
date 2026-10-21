/**
 * Steadfast Courier / Packzy API Service
 * Handles live automated courier dispatch, consignment creation, COD calculations,
 * and delivery tracking for Sarail 1 to 99+ Shop.
 *
 * Official API Documentation:
 * Endpoint: POST https://portal.packzy.com/api/v1/create_order
 * Headers: Api-Key, Secret-Key, Content-Type: application/json, Accept: application/json
 */

const DEFAULT_BASE_URL = 'https://portal.packzy.com/api/v1';

/**
 * Get active API credentials and base URL from environment
 */
const getCredentials = () => {
  const apiKey = (process.env.STEADFAST_API_KEY || '').trim();
  const secretKey = (process.env.STEADFAST_SECRET_KEY || '').trim();
  const baseUrl = (process.env.STEADFAST_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

  const isConfigured = Boolean(apiKey && secretKey);

  return {
    apiKey,
    secretKey,
    baseUrl,
    isConfigured,
  };
};

/**
 * Standard request headers for Steadfast Courier API
 */
const getHeaders = () => {
  const { apiKey, secretKey } = getCredentials();
  return {
    'Api-Key': apiKey,
    'Secret-Key': secretKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
};

/**
 * Sanitize and validate Bangladeshi 11-digit mobile phone numbers
 * e.g. "+8801712345678", "8801712-345678", "01712345678" -> "01712345678"
 *
 * @param {string} rawPhone
 * @returns {{ valid: boolean, phone: string, reason?: string }}
 */
const formatBdPhone = (rawPhone) => {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, phone: '', reason: 'Phone number is missing.' };
  }

  const digits = rawPhone.replace(/[^0-9]/g, '');
  let normalized = digits;

  if (normalized.startsWith('880')) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('88') && normalized.length === 13) {
    normalized = normalized.slice(2);
  }

  if (normalized.length === 11 && normalized.startsWith('01')) {
    return { valid: true, phone: normalized };
  }

  return {
    valid: false,
    phone: normalized,
    reason: `Phone "${rawPhone}" is invalid. Steadfast requires a valid 11-digit Bangladeshi mobile number starting with 01.`,
  };
};

/**
 * Smart Cash on Delivery (COD) Amount Calculation
 *
 * 1. If admin explicitly provided custom cod_amount, use it.
 * 2. If order.paymentStatus === 'Paid', cod_amount is 0.
 * 3. If order.paymentMethod === 'bKash':
 *    - 'delivery' mode (customer prepaid delivery charge):
 *      COD is itemsSubtotal (due at customer's doorstep).
 *    - 'full' mode (customer prepaid entire order):
 *      COD is 0.
 * 4. Cash on Delivery (COD):
 *    - Full invoice totalAmount is due at customer's doorstep.
 *
 * @param {object} order
 * @param {number|string} [overrideCod]
 * @returns {number}
 */
const calculateOrderCodAmount = (order, overrideCod = undefined) => {
  if (overrideCod !== undefined && overrideCod !== null && !isNaN(Number(overrideCod))) {
    return Math.max(0, Math.round(Number(overrideCod)));
  }

  if (order.paymentStatus === 'Paid') {
    return 0;
  }

  const isBkash = order.paymentMethod === 'bKash';
  if (isBkash) {
    const paymentMode = (order.paymentDetails?.mode || 'full').toLowerCase();
    if (paymentMode === 'delivery') {
      // Customer prepaid delivery fee; items subtotal collected at delivery
      const subtotal = order.itemsSubtotal !== undefined
        ? Number(order.itemsSubtotal)
        : Math.max(0, Number(order.totalAmount || 0) - Number(order.deliveryFee || 0));
      return Math.max(0, Math.round(subtotal));
    }
    // Full bKash payment prepaid
    return 0;
  }

  // Default: Cash on Delivery (COD) collects full invoice total
  return Math.max(0, Math.round(Number(order.totalAmount || 0)));
};

/**
 * Build item description summary for the courier parcel label
 * e.g. "2x Nonstick Frypan, 1x Kitchen Knife"
 *
 * @param {object} order
 * @returns {string}
 */
const buildItemSummary = (order) => {
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return 'Sarail 1 to 99+ Shop Package';
  }

  const summary = order.items
    .map((it) => `${it.quantity || 1}x ${it.title || it.name || 'Item'}`)
    .join(', ');

  // Steadfast limits description length; truncate gracefully if long
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
};

/**
 * Build full combined recipient address including zone and landmarks
 *
 * @param {object} order
 * @returns {string}
 */
const buildDeliveryAddress = (order) => {
  const c = order.customerDetails || {};

  // Strict hierarchical address: [Detailed Street / Village / Landmark] + [Thana / Upazila] + [District]
  if (c.streetAddress && c.thana && c.district) {
    return `${c.streetAddress.trim()}, ${c.thana.trim()}, ${c.district.trim()}`;
  }
  if (c.fullAddress) {
    return c.fullAddress.trim();
  }

  const rawAddr = (c.address || '').trim();
  const thana = (c.thana || '').trim();
  const district = (c.district || '').trim();
  const division = (c.division || '').trim();
  const zone = (c.deliveryLocation || '').trim();

  // Format: `${customerDetails.address}, ${customerDetails.thana || ''}, ${customerDetails.district || ''}`
  const addressParts = [rawAddr];
  if (thana && !rawAddr.toLowerCase().includes(thana.toLowerCase())) {
    addressParts.push(thana);
  }
  if (district && !rawAddr.toLowerCase().includes(district.toLowerCase())) {
    addressParts.push(district);
  }
  if (division && !rawAddr.toLowerCase().includes(division.toLowerCase())) {
    addressParts.push(division);
  }
  if (zone && !rawAddr.toLowerCase().includes(zone.toLowerCase())) {
    addressParts.push(`[Zone: ${zone}]`);
  }

  const combined = addressParts.filter(Boolean).join(', ');
  return combined.length > 250 ? combined.slice(0, 250) : combined;
};

/**
 * Dispatch an order to Steadfast Courier via live Packzy API
 *
 * @param {object} order - Complete order document/object
 * @param {object} [options] - Optional custom overrides
 * @param {number|string} [options.codAmount] - Explicit COD amount override
 * @param {string} [options.note] - Delivery instructions or note
 * @param {boolean} [options.allowMockFallback=false] - Allow mock consignment in dev/test if unconfigured
 * @returns {Promise<{ success: boolean, consignmentId?: number, trackingCode?: string, trackingUrl?: string, status?: string, codAmount?: number, message?: string, error?: string, raw?: any }>}
 */
const createSteadfastConsignment = async (order, options = {}) => {
  const { isConfigured, baseUrl } = getCredentials();

  if (!order || !order.invoiceNumber) {
    return {
      success: false,
      error: 'Order or invoiceNumber is required for Steadfast dispatch.',
    };
  }

  // Validate phone number
  const phoneValidation = formatBdPhone(order.customerDetails?.phone);
  if (!phoneValidation.valid) {
    return {
      success: false,
      error: phoneValidation.reason,
    };
  }

  // Calculate COD amount
  const codAmount = calculateOrderCodAmount(order, options.codAmount);
  const recipientAddress = (options.recipientAddress || buildDeliveryAddress(order)).trim();
  const itemDescription = buildItemSummary(order);
  const note = (options.note || order.customerDetails?.note || 'Handle with care - Sarail 1 to 99+ Shop Delivery').trim();

  // If credentials are NOT configured (e.g. offline dev/testing) and fallback is allowed
  if (!isConfigured) {
    if (options.allowMockFallback || process.env.NODE_ENV === 'test') {
      const mockConsignmentId = Math.floor(600000 + Math.random() * 390000);
      const mockTrackingCode = `SF${Math.floor(10000000 + Math.random() * 90000000)}`;
      return {
        success: true,
        consignmentId: mockConsignmentId,
        trackingCode: mockTrackingCode,
        trackingUrl: `https://steadfast.com.bd/t/${mockTrackingCode}`,
        status: 'pending',
        codAmount,
        message: 'Mock consignment generated (STEADFAST_API_KEY not configured).',
        isMock: true,
      };
    }

    return {
      success: false,
      error: 'Steadfast Courier API credentials (STEADFAST_API_KEY & STEADFAST_SECRET_KEY) are not configured in environment.',
    };
  }

  // Steadfast API payload as documented:
  // POST https://portal.packzy.com/api/v1/create_order
  const payload = {
    invoice: String(order.invoiceNumber).trim(),
    recipient_name: (order.customerDetails?.name || 'Customer').trim().slice(0, 100),
    recipient_phone: phoneValidation.phone,
    recipient_address: recipientAddress,
    cod_amount: codAmount,
    note: note.slice(0, 200),
    item_description: itemDescription,
    total_lot: Number(order.totalQuantity || (Array.isArray(order.items) ? order.items.length : 1)) || 1,
    delivery_type: 0, // 0 = Home Delivery
  };

  const endpoint = `${baseUrl}/create_order`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => null);

    // Steadfast returns HTTP 200 on both success and application-level validation errors
    // A successful consignment has status === 200 AND consignment object
    if (data && data.status === 200 && data.consignment) {
      const c = data.consignment;
      const trackingCode = c.tracking_code || `SF${c.consignment_id}`;
      return {
        success: true,
        consignmentId: c.consignment_id,
        trackingCode,
        trackingUrl: `https://steadfast.com.bd/t/${trackingCode}`,
        status: c.status || 'pending',
        codAmount: c.cod_amount !== undefined ? c.cod_amount : codAmount,
        consignment: c,
        message: data.message || 'Consignment created successfully.',
        raw: data,
      };
    }

    // Extract exact error explanation from Steadfast response
    let errorDetail = 'Steadfast rejected the order.';
    if (data?.errors && typeof data.errors === 'object') {
      const messages = Object.values(data.errors).flat();
      if (messages.length > 0) {
        errorDetail = messages.join('; ');
      }
    } else if (data?.message) {
      errorDetail = data.message;
    }

    return {
      success: false,
      error: `Steadfast API error: ${errorDetail}`,
      raw: data,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Steadfast API request timed out (15s). Please check your internet connection and try again.',
      };
    }

    return {
      success: false,
      error: `Failed to connect to Steadfast Courier API: ${err.message}`,
    };
  }
};

/**
 * Fetch current merchant account balance from Steadfast Courier
 * Endpoint: GET https://portal.packzy.com/api/v1/get_balance
 *
 * @returns {Promise<{ success: boolean, balance?: number, error?: string, raw?: any }>}
 */
const getSteadfastAccountBalance = async () => {
  const { isConfigured, baseUrl } = getCredentials();
  if (!isConfigured) {
    return {
      success: false,
      error: 'Steadfast API credentials are not configured.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${baseUrl}/get_balance`, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => null);
    if (res.ok && data?.status === 200) {
      return {
        success: true,
        balance: data.current_balance,
        raw: data,
      };
    }

    return {
      success: false,
      error: data?.message || 'Unable to fetch Steadfast balance.',
      raw: data,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: `Steadfast balance query failed: ${err.message}`,
    };
  }
};

/**
 * Check delivery status for an existing parcel by invoice or tracking code
 *
 * @param {object} params
 * @param {string} [params.invoice]
 * @param {string} [params.trackingCode]
 * @param {number|string} [params.consignmentId]
 * @returns {Promise<{ success: boolean, status?: string, trackingCode?: string, error?: string, raw?: any }>}
 */
const checkSteadfastDeliveryStatus = async ({ invoice, trackingCode, consignmentId } = {}) => {
  const { isConfigured, baseUrl } = getCredentials();
  if (!isConfigured) {
    return { success: false, error: 'Steadfast API credentials are not configured.' };
  }

  let endpoint = null;
  if (trackingCode) {
    endpoint = `${baseUrl}/status_by_trackingcode/${encodeURIComponent(trackingCode)}`;
  } else if (invoice) {
    endpoint = `${baseUrl}/status_by_invoice/${encodeURIComponent(invoice)}`;
  } else if (consignmentId) {
    endpoint = `${baseUrl}/status_by_cid/${encodeURIComponent(consignmentId)}`;
  } else {
    return { success: false, error: 'Tracking code, invoice, or consignmentId is required.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => null);
    if (res.ok && data?.status === 200) {
      return {
        success: true,
        status: data.delivery_status || data.status,
        raw: data,
      };
    }

    return {
      success: false,
      error: data?.message || 'Failed to fetch status from Steadfast.',
      raw: data,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: `Steadfast status query error: ${err.message}`,
    };
  }
};

module.exports = {
  getCredentials,
  getHeaders,
  formatBdPhone,
  calculateOrderCodAmount,
  buildItemSummary,
  buildDeliveryAddress,
  createSteadfastConsignment,
  getSteadfastAccountBalance,
  checkSteadfastDeliveryStatus,
};

