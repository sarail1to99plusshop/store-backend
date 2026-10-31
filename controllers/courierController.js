const Order = require('../models/Order');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');
const {
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
} = require('../services/emailService');

/**
 * POST /api/courier/steadfast-webhook
 * 
 * Real-time automated order synchronization with Steadfast Courier Webhook.
 * Steadfast automatically sends a POST callback whenever a parcel's status changes:
 * - delivered: orderStatus -> 'Delivered', paymentStatus -> 'Paid', deliveredAt set
 * - cancelled / returned: orderStatus -> 'Cancelled', cancelledAt set
 * - partial_delivered: orderStatus -> 'Partially Delivered'
 * 
 * Payload structure from Steadfast:
 * {
 *   "consignment_id": 123456,
 *   "invoice": "SAR-261021-1234",
 *   "status": "delivered", // or 'cancelled', 'returned', 'partial_delivered', 'in_transit'
 *   "tracking_code": "SF12345678"
 * }
 */
const handleSteadfastWebhook = async (req, res) => {
  try {
    const consignment_id =
      req.body?.consignment_id !== undefined && req.body?.consignment_id !== null
        ? req.body.consignment_id
        : req.body?.consignmentId;

    const status = req.body?.status || req.body?.delivery_status;

    // 1. Validation: both consignment_id and status are strictly required
    if (
      consignment_id === undefined ||
      consignment_id === null ||
      consignment_id === '' ||
      !status ||
      typeof status !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        message: 'consignment_id and status are required parameters in Steadfast webhook payload.',
      });
    }

    const rawStatus = status.trim().toLowerCase();
    const now = new Date();

    // 2. Map Steadfast Status to Database Status
    let mappedOrderStatus = null;
    const updateFields = {
      'courierData.status': rawStatus,
      'courierData.deliveryStatus': rawStatus,
      'courierData.lastWebhookAt': now,
    };

    if (rawStatus === 'delivered') {
      mappedOrderStatus = 'Delivered';
      updateFields.orderStatus = 'Delivered';
      // When COD parcel is delivered, payment is completed
      updateFields.paymentStatus = 'Paid';
    } else if (rawStatus === 'cancelled' || rawStatus === 'returned') {
      mappedOrderStatus = 'Cancelled';
      updateFields.orderStatus = 'Cancelled';
      updateFields.cancelledAt = now;
    } else if (rawStatus === 'partial_delivered') {
      mappedOrderStatus = 'Partially Delivered';
      updateFields.orderStatus = 'Partially Delivered';
    } else if (['in_transit', 'delivering', 'picked_up', 'dispatched'].includes(rawStatus)) {
      updateFields.orderStatus = 'Shipped';
    }

    // 3. Database Query: Match Order by courierData.consignmentId (String, Number) or invoice
    const queryConditions = [
      { 'courierData.consignmentId': String(consignment_id) },
      { 'courierData.consignmentId': Number(consignment_id) },
      { 'courierData.consignmentId': consignment_id },
    ].filter((cond) => {
      const val = Object.values(cond)[0];
      return val !== undefined && val !== null && !Number.isNaN(val);
    });

    if (req.body?.invoice) {
      queryConditions.push({ invoiceNumber: String(req.body.invoice).trim() });
    }
    if (req.body?.tracking_code) {
      queryConditions.push({ 'courierData.trackingCode': String(req.body.tracking_code).trim() });
    }

    const query = { $or: queryConditions };

    let updatedOrder = null;

    if (isMongoConnected()) {
      if (rawStatus === 'delivered') {
        const existing = await Order.findOne(query).select('deliveredAt courierData.deliveredAt').lean();
        updateFields.deliveredAt = existing?.deliveredAt || now;
        updateFields['courierData.deliveredAt'] =
          existing?.courierData?.deliveredAt || existing?.deliveredAt || now;
      }

      updatedOrder = await Order.findOneAndUpdate(
        query,
        { $set: updateFields },
        { new: true, runValidators: false }
      );
    } else {
      // In-Memory store fallback for dev/test mode
      const match = memoryStore.orders.find((o) => {
        const cid = o.courierData?.consignmentId;
        const inv = o.invoiceNumber;
        return (
          String(cid) === String(consignment_id) ||
          Number(cid) === Number(consignment_id) ||
          (req.body?.invoice && inv === String(req.body.invoice).trim())
        );
      });

      if (match) {
        if (!match.courierData) match.courierData = {};
        match.courierData.status = rawStatus;
        match.courierData.deliveryStatus = rawStatus;
        match.courierData.lastWebhookAt = now.toISOString();

        if (mappedOrderStatus) {
          match.orderStatus = mappedOrderStatus;
          if (mappedOrderStatus === 'Delivered') {
            // Idempotent delivery timestamp preservation (REP-02)
            if (!match.deliveredAt) {
              match.deliveredAt = now.toISOString();
            }
            if (!match.courierData.deliveredAt) {
              match.courierData.deliveredAt = match.deliveredAt;
            }
            match.paymentStatus = 'Paid';
          } else if (mappedOrderStatus === 'Cancelled') {
            match.cancelledAt = now.toISOString();
          }
        }
        match.updatedAt = now.toISOString();
        updatedOrder = match;
      }
    }

    // 4. Response Handshaking: Always return 200 OK JSON to prevent Steadfast retry loops
    if (!updatedOrder) {
      console.warn(`[Steadfast Webhook] No order found matching consignment_id: "${consignment_id}". Acknowledging webhook.`);
      return res.status(200).json({
        success: true,
        message: `Webhook received. No matching order found for consignment ID: ${consignment_id}`,
      });
    }

    console.log(
      `[Steadfast Webhook] Order #${updatedOrder.invoiceNumber} status synchronized to "${updatedOrder.orderStatus}" (Steadfast status: "${rawStatus}").`
    );

    // 5. Trigger automated customer email notifications asynchronously
    if (mappedOrderStatus === 'Delivered') {
      sendOrderDeliveredEmail(updatedOrder).catch((err) =>
        console.error('[Steadfast Webhook] Failed to send Delivered email:', err.message)
      );
    } else if (mappedOrderStatus === 'Cancelled') {
      sendOrderCancelledEmail(updatedOrder).catch((err) =>
        console.error('[Steadfast Webhook] Failed to send Cancelled email:', err.message)
      );
    }

    return res.status(200).json({
      success: true,
      message: `Order #${updatedOrder.invoiceNumber} status synchronized successfully to ${updatedOrder.orderStatus}`,
      orderId: updatedOrder._id,
      invoiceNumber: updatedOrder.invoiceNumber,
      orderStatus: updatedOrder.orderStatus,
      deliveryStatus: rawStatus,
    });
  } catch (error) {
    console.error('[Steadfast Webhook] Internal server error handling webhook:', error);
    // Return 200 OK with success: false on internal parsing error to prevent aggressive retry spamming
    return res.status(200).json({
      success: false,
      message: 'Error processing webhook payload.',
      error: error.message,
    });
  }
};

module.exports = {
  handleSteadfastWebhook,
};

