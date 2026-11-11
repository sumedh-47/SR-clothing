import mongoose from 'mongoose';

const paymentAttemptSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customer: {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
  },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    variantSku: { type: String, default: '' },
    size: { type: String, default: '' },
    color: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  }],
  total: { type: Number, required: true, min: 0 },
  razorpayOrderId: { type: String, required: true, unique: true },
  paymentId: { type: String, default: '' },
  paymentMethod: { type: String, default: '' },
  paidAt: { type: Date, default: null },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  status: { type: String, enum: ['pending', 'processing', 'paid', 'refund_required'], default: 'pending' },
}, { timestamps: true });

export default mongoose.model('PaymentAttempt', paymentAttemptSchema);
