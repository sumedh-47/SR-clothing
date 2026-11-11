import mongoose from 'mongoose';

const productVariantSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true },
  size: { type: String, required: true, trim: true },
  color: { type: String, required: true, trim: true },
  stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
}, { _id: false });

const inventoryHistorySchema = new mongoose.Schema({
  previousStock: { type: Number, default: null },
  newStock: { type: Number, required: true, min: 0 },
  productName: { type: String, required: true },
  sku: { type: String, required: true },
  admin: { type: String, required: true },
  previousVariants: { type: [productVariantSchema], default: [] },
  newVariants: { type: [productVariantSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  sku: { type: String, trim: true, sparse: true, unique: true },
  purchasePrice: { type: Number, min: 0, default: null },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, min: 0, default: null },
  stockThreshold: { type: Number, min: 0, default: 5, validate: Number.isInteger },
  isAvailable: { type: Boolean, default: true },
  variants: { type: [productVariantSchema], default: [] },
  inventoryHistory: { type: [inventoryHistorySchema], default: [] },
  color: { type: String, required: true },
  badge: { type: String, default: '' },
  image: { type: String, required: true },
  images: { type: [String], default: [] },
  description: { type: String, required: true },
}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text', category: 'text' });

export default mongoose.model('Product', productSchema);
