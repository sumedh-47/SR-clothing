import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
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
  status: { type: String, enum: ['placed', 'processing', 'shipped', 'complete'], default: 'placed' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  paymentProvider: { type: String, default: '' },
  razorpayOrderId: { type: String, default: '' },
  paymentId: { type: String, default: '' },
  paymentMethod: { type: String, default: '' },
  paidAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
