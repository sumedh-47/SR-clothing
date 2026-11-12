import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import Category from './models/Category.js';
import Customer from './models/Customer.js';
import Order from './models/Order.js';
import PaymentAttempt from './models/PaymentAttempt.js';
import Product from './models/Product.js';
import SiteSettings from './models/SiteSettings.js';
import { sampleProducts } from './data/products.js';
import { defaultSiteContent } from './data/siteContent.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = express();
const port = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const uploadsDirectory = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'uploads');
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
mkdirSync(uploadsDirectory, { recursive: true });
let databaseReady = false;
const localCustomers = [];
const localOrders = [];
const localPaymentAttempts = new Map();
const localProducts = sampleProducts.map((product) => ({ ...product }));
const localCategories = [...new Set(localProducts.map((product) => product.category))]
  .map((name) => ({ _id: crypto.randomUUID(), name, slug: categorySlug(name) }));
let localSiteContent = { ...defaultSiteContent };
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex');
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${imageExtensions[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!imageExtensions[file.mimetype]) return callback(new Error('Choose a JPG, PNG, WebP, or GIF image.'));
    callback(null, true);
  },
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  try {
    const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'));
  } catch {
    return false;
  }
}

function createCustomerToken(customerId) {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const signature = crypto.createHmac('sha256', tokenSecret).update(`${customerId}.${expiresAt}`).digest('hex');
  return `${customerId}.${expiresAt}.${signature}`;
}

async function getCustomerFromToken(authorizationHeader) {
  if (!authorizationHeader) return null;
  const token = authorizationHeader.replace(/^Bearer\s+/i, '');
  const [customerId, expiresAt, signature] = token.split('.');
  if (!customerId || !expiresAt || !signature) return null;
  const expected = crypto.createHmac('sha256', tokenSecret).update(`${customerId}.${expiresAt}`).digest('hex');
  if (expected !== signature || Number(expiresAt) < Date.now()) return null;
  if (databaseReady) {
    try {
      return await Customer.findById(customerId).select('-passwordHash -passwordSalt').lean();
    } catch {
      return null;
    }
  }
  return localCustomers.find((c) => String(c._id) === String(customerId)) || null;
}

function createAdminToken() {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const signature = crypto.createHmac('sha256', tokenSecret).update(String(expiresAt)).digest('hex');
  return `${expiresAt}.${signature}`;
}

function requireAdmin(request, response, next) {
  const token = request.get('authorization')?.replace(/^Bearer\s+/i, '');
  const [expiresAt, signature] = token?.split('.') || [];
  const expected = expiresAt && crypto.createHmac('sha256', tokenSecret).update(expiresAt).digest('hex');
  const validSignature = signature && expected && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!validSignature || Number(expiresAt) < Date.now()) {
    return response.status(401).json({ message: 'Your admin session is invalid or has expired.' });
  }
  next();
}

function categorySlug(name) {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `category-${crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 12)}`;
}

function normalizeCategoryName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60 || !/^[\p{L}\p{N}][\p{L}\p{N}\s&'-]*$/u.test(name)) return null;
  return name;
}

function presentProduct(product) {
  const plainProduct = typeof product.toObject === 'function' ? product.toObject() : product;
  const { inventoryHistory: _inventoryHistory, ...storeProduct } = plainProduct;
  return {
    ...storeProduct,
    sku: storeProduct.sku || String(storeProduct._id),
    stockThreshold: storeProduct.stockThreshold ?? 5,
    isAvailable: storeProduct.isAvailable !== false,
    variants: storeProduct.variants || [],
    available: storeProduct.isAvailable !== false && (storeProduct.stock == null || storeProduct.stock > 0),
  };
}

function paymentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function razorpayCredentials() {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret } = process.env;
  if (!keyId || !keySecret) throw paymentError('Online payments are not configured. Add Razorpay API keys to the server .env file.', 503);
  return { keyId, keySecret };
}

async function razorpayRequest(endpoint, { method = 'GET', body } = {}) {
  const { keyId, keySecret } = razorpayCredentials();
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/${endpoint}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw paymentError(`Could not connect to Razorpay: ${error.message}`, 502);
  }
  const result = await response.json();
  if (!response.ok) {
    throw paymentError(result.error?.description || 'Razorpay could not process the payment request.', 502);
  }
  return result;
}

function findPaymentAttempt(razorpayOrderId) {
  return databaseReady
    ? PaymentAttempt.findOne({ razorpayOrderId }).lean()
    : Promise.resolve(localPaymentAttempts.get(razorpayOrderId) || null);
}

async function validateCapturedPayment(razorpayOrderId, paymentId, attempt) {
  const payment = await razorpayRequest(`payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== razorpayOrderId
    || payment.status !== 'captured'
    || payment.currency !== 'INR'
    || payment.amount !== Math.round(attempt.total * 100)) {
    throw paymentError('Razorpay could not confirm a captured payment for this order.', 400);
  }
  return payment;
}

async function finalizeRazorpayPayment(razorpayOrderId, paymentId) {
  const attempt = await findPaymentAttempt(razorpayOrderId);
  if (!attempt) throw paymentError('Payment order was not found.', 404);
  if (attempt.status === 'paid') {
    const paidOrder = databaseReady ? await Order.findById(attempt.orderId).lean() : localOrders.find((order) => order._id === attempt.orderId);
    if (paidOrder) return paidOrder;
    throw paymentError('The paid order could not be loaded. Contact the store for help.', 500);
  }
  if (attempt.status === 'refund_required') {
    throw paymentError('Payment was captured but stock could not be confirmed. Contact the store to arrange a refund.', 409);
  }
  const payment = await validateCapturedPayment(razorpayOrderId, paymentId, attempt);
  const paidAt = payment.created_at ? new Date(payment.created_at * 1000) : new Date();

  if (databaseReady) {
    const claimed = await PaymentAttempt.findOneAndUpdate(
      { razorpayOrderId, status: 'pending' },
      { $set: { status: 'processing', paymentId, paymentMethod: payment.method || '', paidAt } },
      { new: true },
    ).lean();
    if (!claimed) {
      const current = await PaymentAttempt.findOne({ razorpayOrderId }).lean();
      if (current?.status === 'paid') {
        const paidOrder = await Order.findById(current.orderId).lean();
        if (paidOrder) return paidOrder;
      }
      throw paymentError('This payment is already being confirmed. Refresh your orders in a moment.', 409);
    }
  } else {
    if (attempt.status !== 'pending') throw paymentError('This payment is already being confirmed.', 409);
    attempt.status = 'processing';
    attempt.paymentId = paymentId;
    attempt.paymentMethod = payment.method || '';
    attempt.paidAt = paidAt;
  }

  const reservations = [];
  let createdOrder;
  try {
    const orderItems = attempt.items.map((item) => ({
      product: item.product,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      ...(item.variantSku ? { variantSku: item.variantSku, size: item.size, color: item.color } : {}),
    }));

    if (databaseReady) {
      for (const item of attempt.items) {
        const product = await Product.findById(item.product).select('name isAvailable stock variants').lean();
        if (!product || product.isAvailable === false) {
          throw paymentError(`${item.name} is no longer available. Contact the store to arrange a refund.`, 409);
        }
        let update;
        if (item.variantSku) {
          const variant = product.variants?.find((entry) => entry.sku === item.variantSku);
          if (!variant) throw paymentError(`${item.name} is no longer available. Contact the store to arrange a refund.`, 409);
          update = await Product.updateOne(
            { _id: item.product, isAvailable: { $ne: false }, variants: { $elemMatch: { sku: item.variantSku, stock: { $gte: item.quantity } } } },
            { $inc: { 'variants.$.stock': -item.quantity, stock: -item.quantity } },
          );
          if (update.modifiedCount === 1) reservations.push({ productId: item.product, variantSku: item.variantSku, quantity: item.quantity });
        } else if (product.stock != null) {
          update = await Product.updateOne(
            { _id: item.product, isAvailable: { $ne: false }, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
          );
          if (update.modifiedCount === 1) reservations.push({ productId: item.product, quantity: item.quantity });
        } else {
          update = await Product.updateOne(
            { _id: item.product, isAvailable: { $ne: false }, stock: null },
            { $set: { updatedAt: new Date() } },
          );
        }
        if (update.matchedCount !== 1) {
          throw paymentError(`${item.name} no longer has enough stock. Contact the store to arrange a refund.`, 409);
        }
      }
      [createdOrder] = await Order.create([{
        orderNumber: attempt.orderNumber,
        customerId: attempt.customerId,
        customer: attempt.customer,
        items: orderItems,
        total: attempt.total,
        status: 'placed',
        paymentStatus: 'paid',
        paymentProvider: 'razorpay',
        razorpayOrderId,
        paymentId,
        paymentMethod: payment.method || '',
        paidAt,
      }]);
      const completed = await PaymentAttempt.updateOne(
        { razorpayOrderId, status: 'processing' },
        { $set: { status: 'paid', orderId: createdOrder._id, paymentId, paymentMethod: payment.method || '', paidAt } },
      );
      if (completed.modifiedCount !== 1) throw paymentError('Order confirmation is still processing. Please refresh your order history.', 409);
      return createdOrder.toObject();
    }

    for (const item of attempt.items) {
      const product = localProducts.find((entry) => String(entry._id) === String(item.product));
      if (!product || product.isAvailable === false) throw paymentError(`${item.name} is no longer available. Contact the store to arrange a refund.`, 409);
      if (item.variantSku) {
        const variant = product.variants?.find((entry) => entry.sku === item.variantSku);
        if (!variant || variant.stock < item.quantity) throw paymentError(`${item.name} no longer has enough stock. Contact the store to arrange a refund.`, 409);
        reservations.push({ product, variantSku: item.variantSku, quantity: item.quantity });
      } else if (product.stock != null) {
        if (product.stock < item.quantity) throw paymentError(`${item.name} no longer has enough stock. Contact the store to arrange a refund.`, 409);
        reservations.push({ product, quantity: item.quantity });
      }
    }
    for (const reservation of reservations) {
      if (reservation.variantSku) {
        const variant = reservation.product.variants.find((entry) => entry.sku === reservation.variantSku);
        variant.stock -= reservation.quantity;
      }
      if (reservation.product.stock != null) reservation.product.stock -= reservation.quantity;
    }
    createdOrder = {
      _id: crypto.randomUUID(),
      orderNumber: attempt.orderNumber,
      customerId: attempt.customerId,
      customer: attempt.customer,
      items: orderItems,
      total: attempt.total,
      status: 'placed',
      paymentStatus: 'paid',
      paymentProvider: 'razorpay',
      razorpayOrderId,
      paymentId,
      paymentMethod: payment.method || '',
      paidAt,
      createdAt: new Date().toISOString(),
    };
    localOrders.push(createdOrder);
    attempt.status = 'paid';
    attempt.orderId = createdOrder._id;
    attempt.paymentId = paymentId;
    if (attempt.customerId) {
      const localCustomer = localCustomers.find((entry) => String(entry._id) === String(attempt.customerId));
      if (localCustomer && !localCustomer.address) localCustomer.address = attempt.customer.address;
    }
    return createdOrder;
  } catch (error) {
    for (const reservation of reservations.reverse()) {
      if (databaseReady) {
        const filter = reservation.variantSku
          ? { _id: reservation.productId, variants: { $elemMatch: { sku: reservation.variantSku } } }
          : { _id: reservation.productId };
        const increment = reservation.variantSku
          ? { $inc: { 'variants.$.stock': reservation.quantity, stock: reservation.quantity } }
          : { $inc: { stock: reservation.quantity } };
        await Product.updateOne(filter, increment);
      } else {
        if (reservation.variantSku) {
          const variant = reservation.product.variants.find((entry) => entry.sku === reservation.variantSku);
          variant.stock += reservation.quantity;
        }
        if (reservation.product.stock != null) reservation.product.stock += reservation.quantity;
      }
    }
    if (databaseReady) {
      if (createdOrder) await Order.findByIdAndDelete(createdOrder._id);
      await PaymentAttempt.updateOne(
        { razorpayOrderId, status: 'processing' },
        { $set: { status: error.status === 409 ? 'refund_required' : 'pending' } },
      );
    } else {
      if (createdOrder) {
        const index = localOrders.findIndex((order) => order._id === createdOrder._id);
        if (index !== -1) localOrders.splice(index, 1);
      }
      attempt.status = error.status === 409 ? 'refund_required' : 'pending';
    }
    throw error;
  }
}

function generateProductSku() {
  return `FS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function normalizeInventory(body) {
  let variants = body.variants;
  if (typeof variants === 'string') {
    try {
      variants = JSON.parse(variants);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(variants)) return null;
  variants = variants.map((variant) => ({
    sku: String(variant.sku || `VAR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim(),
    size: String(variant.size || '').trim(),
    color: String(variant.color || '').trim(),
    stock: Number(variant.stock),
  }));
  const variantSkus = variants.map((variant) => variant.sku.toUpperCase());
  const stock = variants.length ? variants.reduce((total, variant) => total + variant.stock, 0) : Number(body.stock);
  const stockThreshold = Number(body.stockThreshold);
  if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(stockThreshold) || stockThreshold < 0
    || variants.length > 100
    || variants.some((variant) => !variant.sku || !variant.size || !variant.color || !Number.isInteger(variant.stock) || variant.stock < 0)
    || new Set(variantSkus).size !== variantSkus.length) return null;
  return {
    stock,
    stockThreshold,
    isAvailable: body.isAvailable !== false && body.isAvailable !== 'false',
    variants,
  };
}

async function ensureProductCategory(name) {
  const slug = categorySlug(name);
  if (!slug) return;
  if (databaseReady) {
    await Category.updateOne({ slug }, { $setOnInsert: { name, slug } }, { upsert: true });
  } else if (!localCategories.some((category) => category.slug === slug)) {
    localCategories.push({ _id: crypto.randomUUID(), name, slug });
  }
}

function normalizeProduct(body) {
  let images = body.images;
  if (typeof images === 'string') {
    try {
      images = JSON.parse(images);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(images)) images = body.image ? [body.image] : [];
  images = [...new Set(images.map((image) => String(image).trim()).filter(Boolean))];
  let variants = body.variants;
  if (typeof variants === 'string') {
    try {
      variants = JSON.parse(variants);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(variants)) variants = [];
  variants = variants.map((variant) => ({
    sku: String(variant.sku || `VAR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim(),
    size: String(variant.size || '').trim(),
    color: String(variant.color || '').trim(),
    stock: Number(variant.stock),
  }));
  const variantSkus = variants.map((variant) => variant.sku.toUpperCase());
  const stockThreshold = body.stockThreshold == null || body.stockThreshold === '' ? 5 : Number(body.stockThreshold);
  const stock = variants.length
    ? variants.reduce((total, variant) => total + variant.stock, 0)
    : body.stock === '' || body.stock == null ? null : Number(body.stock);
  const product = {
    name: String(body.name || '').trim(),
    category: normalizeCategoryName(body.category) || '',
    sku: String(body.sku || '').trim(),
    purchasePrice: body.purchasePrice === '' || body.purchasePrice == null ? NaN : Number(body.purchasePrice),
    price: Number(body.price),
    stock,
    stockThreshold,
    isAvailable: body.isAvailable !== false && body.isAvailable !== 'false',
    variants,
    color: String(body.color || '').trim(),
    badge: String(body.badge || '').trim(),
    images,
    image: images[0] || String(body.image || '').trim(),
    description: String(body.description || '').trim(),
  };
  if (!images.length && product.image) product.images = [product.image];
  if (!product.name || !normalizeCategoryName(product.category)
    || !Number.isFinite(product.purchasePrice) || product.purchasePrice < 0
    || !Number.isFinite(product.price) || product.price < 0
    || (product.stock !== null && (!Number.isInteger(product.stock) || product.stock < 0)) || !product.color
    || !Number.isInteger(product.stockThreshold) || product.stockThreshold < 0
    || variants.length > 100 || variants.some((variant) => !variant.sku || !variant.size || !variant.color || !Number.isInteger(variant.stock) || variant.stock < 0)
    || new Set(variantSkus).size !== variantSkus.length
    || (product.sku && !/^[a-z0-9_-]{2,40}$/i.test(product.sku))
    || !product.image || product.images.length > 8 || !product.description) return null;
  return product;
}

function normalizeSiteContent(body) {
  const content = {};
  for (const [key, defaultValue] of Object.entries(defaultSiteContent)) {
    const value = body[key];
    if (typeof value !== 'string' || value.length > 2000) return null;
    content[key] = value.trim();
    if (['heroImage', 'storyImage'].includes(key) && !content[key]) return null;
    if (typeof defaultValue === 'string' && !content[key] && ['brandName'].includes(key)) return null;
  }
  return content;
}

function getSalesBuckets(period) {
  const now = new Date();
  const buckets = [];
  if (period === 'year') {
    const firstMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1);
    for (let index = 0; index < 12; index += 1) {
      const date = new Date(firstMonth);
      date.setUTCMonth(date.getUTCMonth() + index);
      const key = date.toISOString().slice(0, 7);
      buckets.push({ key, label: date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), revenue: 0, orders: 0 });
    }
    return { start: new Date(firstMonth), buckets, format: '%Y-%m' };
  }
  const count = period === 'month' ? 30 : 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - count + 1));
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    buckets.push({
      key,
      label: date.toLocaleDateString('en-IN', { day: 'numeric', month: count === 7 ? 'short' : undefined, timeZone: 'UTC' }),
      revenue: 0,
      orders: 0,
    });
  }
  return { start, buckets, format: '%Y-%m-%d' };
}

app.use(cors({ origin: isProduction ? process.env.CLIENT_ORIGIN : true }));
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '100kb' }), async (request, response) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = request.get('x-razorpay-signature') || '';
  if (!webhookSecret) return response.status(503).json({ message: 'Payment webhook is not configured.' });
  if (!Buffer.isBuffer(request.body)) return response.status(400).json({ message: 'Invalid webhook request body.' });
  const expected = crypto.createHmac('sha256', webhookSecret).update(request.body).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return response.status(400).json({ message: 'Invalid webhook signature.' });
  }
  try {
    const event = JSON.parse(request.body.toString('utf8'));
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) await finalizeRazorpayPayment(payment.order_id, payment.id);
    }
    response.json({ received: true });
  } catch (error) {
    console.error('Razorpay webhook processing failed:', error);
    response.status(error.status || 500).json({ message: error.message || 'Webhook processing failed.' });
  }
});
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(uploadsDirectory, { maxAge: '1d', immutable: true }));

app.get('/api/health', (_request, response) => response.json({ status: 'ok', database: databaseReady ? 'connected' : 'memory' }));

app.get('/api/site-content', async (_request, response, next) => {
  try {
    const settings = databaseReady ? await SiteSettings.findOne({ key: 'storefront' }).lean() : null;
    response.json(settings?.content || localSiteContent);
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories', async (_request, response, next) => {
  try {
    const categories = databaseReady
      ? await Category.find().select('name slug').sort({ name: 1 }).lean()
      : [...localCategories].sort((a, b) => a.name.localeCompare(b.name));
    response.json(categories.map(({ name, slug }) => ({ name, slug })));
  } catch (error) {
    next(error);
  }
});

// Customer Authentication
app.post('/api/customer/register', async (request, response, next) => {
  try {
    const { name, email, password, address, phone } = request.body || {};
    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return response.status(400).json({ message: 'Name, email, and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return response.status(400).json({ message: 'Please provide a valid email address.' });
    }
    if (password.length < 6) {
      return response.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    if (databaseReady) {
      const existing = await Customer.findOne({ email: normalizedEmail }).lean();
      if (existing) {
        return response.status(409).json({ message: 'An account with this email already exists. Please sign in.' });
      }
      const { hash, salt } = hashPassword(password);
      const newCustomer = await Customer.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hash,
        passwordSalt: salt,
        address: String(address || '').trim(),
        phone: String(phone || '').trim(),
      });
      const token = createCustomerToken(String(newCustomer._id));
      return response.status(201).json({
        token,
        customer: {
          _id: newCustomer._id,
          name: newCustomer.name,
          email: newCustomer.email,
          address: newCustomer.address,
          phone: newCustomer.phone,
        },
      });
    } else {
      const existing = localCustomers.find((c) => c.email === normalizedEmail);
      if (existing) {
        return response.status(409).json({ message: 'An account with this email already exists. Please sign in.' });
      }
      const { hash, salt } = hashPassword(password);
      const newCustomer = {
        _id: crypto.randomUUID(),
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hash,
        passwordSalt: salt,
        address: String(address || '').trim(),
        phone: String(phone || '').trim(),
        createdAt: new Date().toISOString(),
      };
      localCustomers.push(newCustomer);
      const token = createCustomerToken(newCustomer._id);
      return response.status(201).json({
        token,
        customer: {
          _id: newCustomer._id,
          name: newCustomer.name,
          email: newCustomer.email,
          address: newCustomer.address,
          phone: newCustomer.phone,
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/customer/login', async (request, response, next) => {
  try {
    const { email, password } = request.body || {};
    if (!email?.trim() || !password?.trim()) {
      return response.status(400).json({ message: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const customer = databaseReady
      ? await Customer.findOne({ email: normalizedEmail }).lean()
      : localCustomers.find((c) => c.email === normalizedEmail);

    if (!customer || !verifyPassword(password, customer.passwordHash, customer.passwordSalt)) {
      return response.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = createCustomerToken(String(customer._id));
    response.json({
      token,
      customer: {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        address: customer.address || '',
        phone: customer.phone || '',
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/customer/me', async (request, response, next) => {
  try {
    const customer = await getCustomerFromToken(request.get('authorization'));
    if (!customer) {
      return response.status(401).json({ message: 'Session expired or invalid.' });
    }
    response.json({ customer });
  } catch (error) {
    next(error);
  }
});

app.put('/api/customer/me', async (request, response, next) => {
  try {
    const customer = await getCustomerFromToken(request.get('authorization'));
    if (!customer) {
      return response.status(401).json({ message: 'Unauthorized' });
    }
    const { name, address, phone } = request.body || {};
    if (databaseReady) {
      const updated = await Customer.findByIdAndUpdate(
        customer._id,
        {
          ...(name ? { name: String(name).trim() } : {}),
          ...(address !== undefined ? { address: String(address).trim() } : {}),
          ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
        },
        { new: true }
      ).select('-passwordHash -passwordSalt').lean();
      return response.json({ customer: updated });
    } else {
      const local = localCustomers.find((c) => String(c._id) === String(customer._id));
      if (local) {
        if (name) local.name = String(name).trim();
        if (address !== undefined) local.address = String(address).trim();
        if (phone !== undefined) local.phone = String(phone).trim();
      }
      return response.json({ customer: local });
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/customer/orders', async (request, response, next) => {
  try {
    const customer = await getCustomerFromToken(request.get('authorization'));
    if (!customer) {
      return response.status(401).json({ message: 'Unauthorized' });
    }
    const orders = databaseReady
      ? await Order.find({
        $or: [
          { customerId: customer._id },
          { 'customer.email': customer.email }
        ]
      }).sort({ createdAt: -1 }).lean()
      : localOrders.filter((o) => String(o.customerId) === String(customer._id) || o.customer?.email === customer.email);
    response.json(orders);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/login', (request, response) => {
  const configuredId = process.env.ADMIN_ID;
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredId || !configuredPassword) return response.status(503).json({ message: 'Admin access is not configured. Set ADMIN_ID and ADMIN_PASSWORD in .env.' });
  const submittedId = Buffer.from(String(request.body.adminId || ''));
  const expectedId = Buffer.from(configuredId);
  const submittedPassword = String(request.body.password || '');
  const submitted = Buffer.from(submittedPassword);
  const expected = Buffer.from(configuredPassword);
  const validId = submittedId.length === expectedId.length && crypto.timingSafeEqual(submittedId, expectedId);
  const validPassword = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
  if (!validId || !validPassword) return response.status(401).json({ message: 'The admin ID or password did not match.' });
  response.json({ token: createAdminToken(), expiresIn: 28800 });
});

app.get('/api/products', async (request, response, next) => {
  try {
    const { category, search } = request.query;
    if (!databaseReady) {
      const normalizedSearch = String(search || '').toLowerCase();
      const products = localProducts.filter((product) => {
        const categoryMatches = !category || category === 'All pieces' || product.category === category;
        const searchMatches = !normalizedSearch || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(normalizedSearch);
        return categoryMatches && searchMatches;
      });
      return response.json(products.map(presentProduct));
    }
    const filter = {};
    if (category && category !== 'All pieces') filter.category = category;
    if (search) filter.$text = { $search: String(search) };
    const products = await Product.find(filter).select('-inventoryHistory').sort({ createdAt: -1 }).lean();
    response.json(products.map(presentProduct));
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/razorpay/order', async (request, response, next) => {
  try {
    const { customer, items } = request.body || {};
    if (!customer?.name?.trim() || !customer?.email?.trim() || !customer?.address?.trim()) {
      return response.status(400).json({ message: 'Please provide your name, email, and shipping address.' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return response.status(400).json({ message: 'Your bag is empty or contains too many different pieces.' });
    }
    const productIds = items.map((item) => String(item.product));
    if (new Set(productIds).size !== productIds.length) {
      return response.status(400).json({ message: 'Your bag contains duplicate product entries. Refresh it and try again.' });
    }
    if (databaseReady && productIds.some((id) => !mongoose.isValidObjectId(id))) {
      return response.status(400).json({ message: 'One or more pieces in your bag are invalid. Refresh the page and try again.' });
    }

    const customerUser = await getCustomerFromToken(request.get('authorization'));
    const products = databaseReady
      ? await Product.find({ _id: { $in: productIds } }).select('name price stock isAvailable variants').lean()
      : localProducts.filter((product) => productIds.includes(String(product._id)));
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    const orderItems = [];
    for (const item of items) {
      const product = productMap.get(String(item.product));
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return response.status(400).json({ message: 'One or more pieces in your bag are unavailable.' });
      }
      if (product.isAvailable === false) {
        return response.status(409).json({ message: `${product.name} is currently unavailable.` });
      }
      let selectedVariant = null;
      if (product.variants?.length) {
        selectedVariant = product.variants.find((variant) => variant.sku === String(item.variantSku || ''));
        if (!selectedVariant) return response.status(400).json({ message: `Choose an available size and colour for ${product.name}.` });
        if (selectedVariant.stock < quantity) return response.status(409).json({ message: `${product.name} in ${selectedVariant.size} / ${selectedVariant.color} no longer has enough stock.` });
      } else if (product.stock != null && product.stock < quantity) {
        return response.status(409).json({ message: `${product.name} no longer has enough stock. Please update your bag.` });
      }
      orderItems.push({
        product: product._id,
        name: product.name,
        quantity,
        unitPrice: product.price,
        ...(selectedVariant ? { variantSku: selectedVariant.sku, size: selectedVariant.size, color: selectedVariant.color } : {}),
      });
    }
    const total = Number(orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
    const amount = Math.round(total * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      return response.status(400).json({ message: 'The order total must be at least ₹1.00.' });
    }
    const orderNumber = `FS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const razorpayOrder = await razorpayRequest('orders', {
      method: 'POST',
      body: { amount, currency: 'INR', receipt: orderNumber, notes: { orderNumber } },
    });
    const attempt = {
      orderNumber,
      customerId: customerUser?._id || null,
      customer: {
        name: customer.name.trim(),
        email: customer.email.trim(),
        address: customer.address.trim(),
      },
      items: orderItems,
      total,
      razorpayOrderId: razorpayOrder.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    if (databaseReady) await PaymentAttempt.create(attempt);
    else localPaymentAttempts.set(razorpayOrder.id, { ...attempt });
    response.status(201).json({
      keyId: razorpayCredentials().keyId,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      orderNumber,
      customer: attempt.customer,
    });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
});

app.post('/api/payments/razorpay/verify', async (request, response, next) => {
  try {
    const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.body || {};
    const { keySecret } = razorpayCredentials();
    if (!razorpayOrderId || !paymentId || !/^[a-f0-9]{64}$/i.test(String(signature || ''))) {
      return response.status(400).json({ message: 'Razorpay returned incomplete payment details.' });
    }
    const expected = crypto.createHmac('sha256', keySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected))) {
      return response.status(400).json({ message: 'Payment verification failed. Please contact the store before trying again.' });
    }
    const order = await finalizeRazorpayPayment(razorpayOrderId, paymentId);
    response.status(201).json(order);
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
});

app.post('/api/orders', async (request, response, next) => {
  try {
    const { customer, items } = request.body;
    if (!customer?.name?.trim() || !customer?.email?.trim() || !customer?.address?.trim()) {
      return response.status(400).json({ message: 'Please provide your name, email, and shipping address.' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return response.status(400).json({ message: 'Your bag is empty or contains too many different pieces.' });
    }

    const customerUser = await getCustomerFromToken(request.get('authorization'));
    const customerId = customerUser?._id || null;
    const productIds = items.map((item) => String(item.product));
    if (new Set(productIds).size !== productIds.length) {
      return response.status(400).json({ message: 'Your bag contains duplicate product entries. Refresh it and try again.' });
    }

    const orderNumber = `FS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();
    let order;
    let orderItems = [];
    let total = 0;
    if (databaseReady) {
      const session = await mongoose.startSession();
      let transactionUnsupported = false;
      try {
        await session.withTransaction(async () => {
          const products = await Product.find({ _id: { $in: productIds } }).session(session).lean();
          const productMap = new Map(products.map((product) => [String(product._id), product]));
          const nextOrderItems = [];
          for (const item of items) {
            const product = productMap.get(String(item.product));
            const quantity = Number(item.quantity);
            if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
              const error = new Error('One or more pieces in your bag are unavailable.');
              error.status = 400;
              throw error;
            }
            if (product.isAvailable === false) {
              const error = new Error(`${product.name} is currently unavailable.`);
              error.status = 409;
              throw error;
            }
            if (product.variants?.length) {
              const variantSku = String(item.variantSku || '');
              const variant = product.variants.find((candidate) => candidate.sku === variantSku);
              if (!variant) {
                const error = new Error(`Choose an available size and colour for ${product.name}.`);
                error.status = 400;
                throw error;
              }
              const result = await Product.updateOne(
                { _id: product._id, isAvailable: { $ne: false }, variants: { $elemMatch: { sku: variantSku, stock: { $gte: quantity } } } },
                { $inc: { 'variants.$.stock': -quantity, stock: -quantity } },
                { session },
              );
              if (result.modifiedCount !== 1) {
                const error = new Error(`${product.name} in ${variant.size} / ${variant.color} no longer has enough stock.`);
                error.status = 409;
                throw error;
              }
            } else if (product.stock != null) {
              const result = await Product.updateOne(
                { _id: product._id, isAvailable: { $ne: false }, stock: { $gte: quantity } },
                { $inc: { stock: -quantity } },
                { session },
              );
              if (result.modifiedCount !== 1) {
                const error = new Error(`${product.name} no longer has enough stock. Please update your bag.`);
                error.status = 409;
                throw error;
              }
            }
            const selectedVariant = product.variants?.find((variant) => variant.sku === String(item.variantSku || ''));
            nextOrderItems.push({
              product: product._id,
              name: product.name,
              quantity,
              unitPrice: product.price,
              ...(selectedVariant ? { variantSku: selectedVariant.sku, size: selectedVariant.size, color: selectedVariant.color } : {}),
            });
          }
          orderItems = nextOrderItems;
          total = Number(orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
          [order] = await Order.create([{ orderNumber, customerId, customer, items: orderItems, total }], { session });
        });
      } catch (error) {
        if (error.code === 20 || error.codeName === 'IllegalOperation') transactionUnsupported = true;
        else throw error;
      } finally {
        await session.endSession();
      }
      if (transactionUnsupported) {
        orderItems = [];
        const products = await Product.find({ _id: { $in: productIds } }).lean();
        const productMap = new Map(products.map((product) => [String(product._id), product]));
        const reservations = [];
        try {
          for (const item of items) {
            const product = productMap.get(String(item.product));
            const quantity = Number(item.quantity);
            if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
              const error = new Error('One or more pieces in your bag are unavailable.');
              error.status = 400;
              throw error;
            }
            if (product.isAvailable === false) {
              const error = new Error(`${product.name} is currently unavailable.`);
              error.status = 409;
              throw error;
            }
            let selectedVariant = null;
            let update;
            let reservation = null;
            if (product.variants?.length) {
              const variantSku = String(item.variantSku || '');
              selectedVariant = product.variants.find((variant) => variant.sku === variantSku);
              if (!selectedVariant) {
                const error = new Error(`Choose an available size and colour for ${product.name}.`);
                error.status = 400;
                throw error;
              }
              update = await Product.updateOne(
                { _id: product._id, isAvailable: { $ne: false }, variants: { $elemMatch: { sku: variantSku, stock: { $gte: quantity } } } },
                { $inc: { 'variants.$.stock': -quantity, stock: -quantity } },
              );
              reservation = { productId: product._id, quantity, variantSku };
            } else if (product.stock != null) {
              update = await Product.updateOne(
                { _id: product._id, isAvailable: { $ne: false }, stock: { $gte: quantity } },
                { $inc: { stock: -quantity } },
              );
              reservation = { productId: product._id, quantity };
            } else {
              update = await Product.updateOne(
                { _id: product._id, isAvailable: { $ne: false }, stock: null },
                { $set: { updatedAt: new Date() } },
              );
            }
            if (update.matchedCount !== 1) {
              const error = new Error(selectedVariant
                ? `${product.name} in ${selectedVariant.size} / ${selectedVariant.color} no longer has enough stock.`
                : `${product.name} is unavailable or no longer has enough stock.`);
              error.status = 409;
              throw error;
            }
            if (reservation) reservations.push(reservation);
            orderItems.push({
              product: product._id,
              name: product.name,
              quantity,
              unitPrice: product.price,
              ...(selectedVariant ? { variantSku: selectedVariant.sku, size: selectedVariant.size, color: selectedVariant.color } : {}),
            });
          }
          total = Number(orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
          order = await Order.create({ orderNumber, customerId, customer, items: orderItems, total });
        } catch (error) {
          for (const reservation of reservations.reverse()) {
            const filter = reservation.variantSku
              ? { _id: reservation.productId, variants: { $elemMatch: { sku: reservation.variantSku } } }
              : { _id: reservation.productId };
            const increment = reservation.variantSku
              ? { $inc: { 'variants.$.stock': reservation.quantity, stock: reservation.quantity } }
              : { $inc: { stock: reservation.quantity } };
            await Product.updateOne(filter, increment);
          }
          throw error;
        }
      }
      if (customerUser && !customerUser.address && customer.address) {
        await Customer.findByIdAndUpdate(customerUser._id, { address: customer.address.trim() });
      }
    } else {
      const productMap = new Map(localProducts.map((product) => [String(product._id), product]));
      orderItems = [];
      for (const item of items) {
        const product = productMap.get(String(item.product));
        const quantity = Number(item.quantity);
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
          return response.status(400).json({ message: 'One or more pieces in your bag are unavailable.' });
        }
        if (product.isAvailable === false) {
          return response.status(409).json({ message: `${product.name} is currently unavailable.` });
        }
        let selectedVariant = null;
        if (product.variants?.length) {
          selectedVariant = product.variants.find((candidate) => candidate.sku === String(item.variantSku || ''));
          if (!selectedVariant) return response.status(400).json({ message: `Choose an available size and colour for ${product.name}.` });
          if (selectedVariant.stock < quantity) return response.status(409).json({ message: `${product.name} in ${selectedVariant.size} / ${selectedVariant.color} no longer has enough stock.` });
        } else if (product.stock != null && product.stock < quantity) {
          return response.status(409).json({ message: `${product.name} no longer has enough stock. Please update your bag.` });
        }
        orderItems.push({
          product: product._id,
          name: product.name,
          quantity,
          unitPrice: product.price,
          ...(selectedVariant ? { variantSku: selectedVariant.sku, size: selectedVariant.size, color: selectedVariant.color } : {}),
        });
      }
      total = Number(orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
      order = { _id: crypto.randomUUID(), orderNumber, customerId, customer, items: orderItems, total, status: 'placed', createdAt };
      for (const item of items) {
        const product = productMap.get(String(item.product));
        const selectedVariant = product.variants?.find((variant) => variant.sku === String(item.variantSku || ''));
        if (selectedVariant) selectedVariant.stock -= Number(item.quantity);
        if (product.stock != null) product.stock -= Number(item.quantity);
      }
      localOrders.push(order);
      if (customerUser && !customerUser.address && customer.address) {
        customerUser.address = customer.address.trim();
      }
    }
    response.status(201).json({
      orderNumber,
      customerId,
      customer,
      items: orderItems,
      total,
      status: 'placed',
      createdAt: order.createdAt || createdAt,
    });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
});

app.get('/api/admin/summary', requireAdmin, async (request, response, next) => {
  try {
    const period = ['week', 'month', 'year'].includes(request.query.period) ? request.query.period : 'week';
    const { start, buckets, format } = getSalesBuckets(period);
    let products;
    let orders;
    let revenue;
    let periodRevenue;
    let pendingOrders;
    let completedOrders;
    let registeredClients;
    let lowStock;
    let outOfStock;
    if (databaseReady) {
      const [productCount, orderCount, revenueRows, pendingCount, completeCount, customerCount, lowStockCount, outOfStockCount, trendRows] = await Promise.all([
        Product.countDocuments(),
        Order.countDocuments(),
        Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
        Order.countDocuments({ status: { $in: ['placed', 'processing'] } }),
        Order.countDocuments({ status: 'complete' }),
        Customer.countDocuments(),
        Product.countDocuments({ $expr: { $and: [
          { $gt: ['$stock', 0] },
          { $lt: ['$stock', { $ifNull: ['$stockThreshold', 5] }] },
        ] } }),
        Product.countDocuments({ stock: 0 }),
        Order.aggregate([
          { $match: { createdAt: { $gte: start } } },
          { $group: {
            _id: { $dateToString: { format, date: '$createdAt', timezone: 'UTC' } },
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
          } },
        ]),
      ]);
      products = productCount;
      orders = orderCount;
      revenue = revenueRows[0]?.total || 0;
      pendingOrders = pendingCount;
      completedOrders = completeCount;
      registeredClients = customerCount;
      lowStock = lowStockCount;
      outOfStock = outOfStockCount;
      const trendMap = new Map(trendRows.map((row) => [row._id, row]));
      for (const bucket of buckets) {
        const row = trendMap.get(bucket.key);
        if (row) Object.assign(bucket, { revenue: row.revenue, orders: row.orders });
      }
    } else {
      products = localProducts.length;
      orders = localOrders.length;
      revenue = localOrders.reduce((sum, order) => sum + order.total, 0);
      pendingOrders = localOrders.filter((order) => ['placed', 'processing'].includes(order.status)).length;
      completedOrders = localOrders.filter((order) => order.status === 'complete').length;
      registeredClients = localCustomers.length;
      lowStock = localProducts.filter((product) => product.stock > 0 && product.stock < (product.stockThreshold ?? 5)).length;
      outOfStock = localProducts.filter((product) => product.stock === 0).length;
      const trendMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
      for (const order of localOrders) {
        const createdAt = new Date(order.createdAt);
        if (createdAt < start) continue;
        const key = period === 'year' ? createdAt.toISOString().slice(0, 7) : createdAt.toISOString().slice(0, 10);
        const bucket = trendMap.get(key);
        if (bucket) {
          bucket.revenue += order.total;
          bucket.orders += 1;
        }
      }
    }
    periodRevenue = buckets.reduce((sum, bucket) => sum + bucket.revenue, 0);
    response.json({
      products,
      orders,
      revenue,
      periodRevenue,
      pendingOrders,
      completedOrders,
      registeredClients,
      lowStock,
      outOfStock,
      salesTrend: buckets,
      database: databaseReady ? 'connected' : 'memory',
    });
  } catch (error) { next(error); }
});

app.get('/api/admin/customers', requireAdmin, async (_request, response, next) => {
  try {
    const [customers, orders] = databaseReady
      ? await Promise.all([
        Customer.find().select('name email address phone createdAt').sort({ createdAt: -1 }).lean(),
        Order.find().select('customer customerId total createdAt').sort({ createdAt: -1 }).lean(),
      ])
      : [
        localCustomers.map(({ _id, name, email, address, phone, createdAt }) => ({ _id, name, email, address, phone, createdAt })),
        [...localOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      ];
    const clientsByEmail = new Map();
    for (const customer of customers) {
      const email = customer.email.toLowerCase();
      clientsByEmail.set(email, {
        ...customer,
        clientType: 'registered',
        orderCount: 0,
        totalSpent: 0,
        lastOrderAt: null,
      });
    }
    for (const order of orders) {
      const email = order.customer?.email?.toLowerCase();
      if (!email) continue;
      const customer = clientsByEmail.get(email) || {
        _id: `guest-${email}`,
        name: order.customer.name,
        email,
        address: order.customer.address || '',
        phone: order.customer.phone || '',
        createdAt: null,
        clientType: 'guest',
        orderCount: 0,
        totalSpent: 0,
        lastOrderAt: null,
      };
      customer.orderCount += 1;
      customer.totalSpent += order.total;
      if (!customer.lastOrderAt) customer.lastOrderAt = order.createdAt || null;
      if (!customer.address && order.customer.address) customer.address = order.customer.address;
      if (!customer.name && order.customer.name) customer.name = order.customer.name;
      clientsByEmail.set(email, customer);
    }
    response.json([...clientsByEmail.values()].sort((a, b) => {
      const dateA = new Date(a.lastOrderAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.lastOrderAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    }));
  } catch (error) { next(error); }
});

app.get('/api/admin/payments', requireAdmin, async (_request, response, next) => {
  try {
    const [attempts, orders] = databaseReady
      ? await Promise.all([
        PaymentAttempt.find().sort({ createdAt: -1 }).lean(),
        Order.find().select('orderNumber customer items total status paymentStatus paymentProvider razorpayOrderId paymentId paymentMethod paidAt createdAt').lean(),
      ])
      : [
        [...localPaymentAttempts.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
        [...localOrders],
      ];
    const ordersByNumber = new Map(orders.map((order) => [order.orderNumber, order]));
    const paymentNumbers = new Set(attempts.map((attempt) => attempt.orderNumber));
    const paymentRows = attempts.map((attempt) => {
      const order = ordersByNumber.get(attempt.orderNumber);
      return {
        _id: attempt._id || attempt.razorpayOrderId,
        orderNumber: attempt.orderNumber,
        customer: attempt.customer,
        items: attempt.items,
        total: attempt.total,
        currency: 'INR',
        paymentStatus: attempt.status,
        paymentProvider: 'razorpay',
        paymentMethod: attempt.paymentMethod || order?.paymentMethod || '',
        razorpayOrderId: attempt.razorpayOrderId,
        paymentId: attempt.paymentId || order?.paymentId || '',
        orderStatus: order?.status || '',
        createdAt: attempt.createdAt || order?.createdAt || null,
        paidAt: attempt.paidAt || order?.paidAt || null,
      };
    });
    for (const order of orders) {
      if (paymentNumbers.has(order.orderNumber)) continue;
      paymentRows.push({
        _id: order._id,
        orderNumber: order.orderNumber,
        customer: order.customer,
        items: order.items,
        total: order.total,
        currency: 'INR',
        paymentStatus: order.paymentStatus || 'unrecorded',
        paymentProvider: order.paymentProvider || '',
        paymentMethod: order.paymentMethod || '',
        razorpayOrderId: order.razorpayOrderId || '',
        paymentId: order.paymentId || '',
        orderStatus: order.status || '',
        createdAt: order.createdAt || null,
        paidAt: order.paidAt || null,
      });
    }
    paymentRows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    response.json(paymentRows);
  } catch (error) { next(error); }
});

app.get('/api/admin/categories', requireAdmin, async (_request, response, next) => {
  try {
    const categories = databaseReady
      ? await Category.find().sort({ name: 1 }).lean()
      : [...localCategories].sort((a, b) => a.name.localeCompare(b.name));
    response.json(categories);
  } catch (error) { next(error); }
});

app.post('/api/admin/categories', requireAdmin, async (request, response, next) => {
  try {
    const name = normalizeCategoryName(request.body?.name);
    const slug = name && categorySlug(name);
    if (!name || !slug) return response.status(400).json({ message: 'Enter a category name using letters, numbers, spaces, or hyphens.' });
    const duplicate = databaseReady
      ? await Category.exists({ slug })
      : localCategories.some((category) => category.slug === slug);
    if (duplicate) return response.status(409).json({ message: 'A category with this name already exists.' });
    const category = databaseReady
      ? await Category.create({ name, slug })
      : { _id: crypto.randomUUID(), name, slug };
    if (!databaseReady) localCategories.push(category);
    response.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ message: 'A category with this name already exists.' });
    next(error);
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (request, response, next) => {
  try {
    const name = normalizeCategoryName(request.body?.name);
    const slug = name && categorySlug(name);
    if (!name || !slug) return response.status(400).json({ message: 'Enter a valid category name.' });
    const existing = databaseReady
      ? await Category.findById(request.params.id)
      : localCategories.find((category) => category._id === request.params.id);
    if (!existing) return response.status(404).json({ message: 'Category not found.' });
    const duplicate = databaseReady
      ? await Category.exists({ slug, _id: { $ne: existing._id } })
      : localCategories.some((category) => category.slug === slug && category._id !== existing._id);
    if (duplicate) return response.status(409).json({ message: 'A category with this name already exists.' });
    const oldName = existing.name;
    if (databaseReady) {
      await Promise.all([
        Category.findByIdAndUpdate(existing._id, { name, slug }, { runValidators: true }),
        Product.updateMany({ category: oldName }, { category: name }),
      ]);
    } else {
      existing.name = name;
      existing.slug = slug;
      for (const product of localProducts) {
        if (product.category === oldName) product.category = name;
      }
    }
    response.json({ _id: existing._id, name, slug });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ message: 'A category with this name already exists.' });
    next(error);
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (request, response, next) => {
  try {
    const category = databaseReady
      ? await Category.findById(request.params.id)
      : localCategories.find((item) => item._id === request.params.id);
    if (!category) return response.status(404).json({ message: 'Category not found.' });
    const productCount = databaseReady
      ? await Product.countDocuments({ category: category.name })
      : localProducts.filter((product) => product.category === category.name).length;
    if (productCount) return response.status(409).json({ message: 'Move or remove this category’s products before deleting it.' });
    if (databaseReady) await Category.findByIdAndDelete(category._id);
    else localCategories.splice(localCategories.indexOf(category), 1);
    response.json({ success: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/products', requireAdmin, async (_request, response, next) => {
  try {
    const products = databaseReady ? await Product.find().select('-inventoryHistory').sort({ createdAt: -1 }).lean() : localProducts;
    response.json(products.map(presentProduct));
  } catch (error) { next(error); }
});

app.put('/api/admin/products/:id/inventory', requireAdmin, async (request, response, next) => {
  try {
    const inventory = normalizeInventory(request.body || {});
    if (!inventory) {
      return response.status(400).json({ message: 'Enter valid non-negative whole-number stock quantities, threshold, and variant details.' });
    }
    const existing = databaseReady
      ? await Product.findById(request.params.id).select('name sku stock stockThreshold isAvailable variants updatedAt').lean()
      : localProducts.find((product) => product._id === request.params.id);
    if (!existing) return response.status(404).json({ message: 'Product not found.' });

    const previousVariants = (existing.variants || []).map((variant) => ({ sku: variant.sku, size: variant.size, color: variant.color, stock: variant.stock }));
    const updatedAt = new Date();
    const historyEntry = {
      previousStock: existing.stock ?? null,
      newStock: inventory.stock,
      productName: existing.name,
      sku: existing.sku || String(existing._id),
      admin: process.env.ADMIN_ID || 'Configured administrator',
      previousVariants,
      newVariants: inventory.variants,
      updatedAt,
    };
    if (databaseReady) {
      const versionFilter = existing.updatedAt ? { updatedAt: existing.updatedAt } : { updatedAt: { $exists: false } };
      const updated = await Product.findOneAndUpdate(
        { _id: request.params.id, ...versionFilter },
        {
          $set: inventory,
          $push: { inventoryHistory: { $each: [historyEntry], $slice: -100 } },
        },
        { new: true, runValidators: true },
      ).select('-inventoryHistory').lean();
      if (!updated) return response.status(409).json({ message: 'Inventory changed during this edit. Refresh and try again.' });
      return response.json(presentProduct(updated));
    }
    Object.assign(existing, inventory, { updatedAt });
    existing.inventoryHistory = [...(existing.inventoryHistory || []), historyEntry].slice(-100);
    response.json(presentProduct(existing));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/products/:id/inventory-history', requireAdmin, async (request, response, next) => {
  try {
    const product = databaseReady
      ? await Product.findById(request.params.id).select('inventoryHistory').lean()
      : localProducts.find((item) => item._id === request.params.id);
    if (!product) return response.status(404).json({ message: 'Product not found.' });
    response.json(product.inventoryHistory || []);
  } catch (error) { next(error); }
});

app.post('/api/admin/uploads', requireAdmin, (request, response, next) => {
  imageUpload.array('images', 8)(request, response, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return response.status(413).json({ message: 'Images must be 5 MB or smaller.' });
      }
      if (error.message === 'Choose a JPG, PNG, WebP, or GIF image.') {
        return response.status(400).json({ message: error.message });
      }
      return next(error);
    }
    if (!request.files?.length) return response.status(400).json({ message: 'Choose at least one image to upload.' });
    const urls = request.files.map((file) => `/uploads/${file.filename}`);
    response.status(201).json({ url: urls[0], urls });
  });
});

app.put('/api/admin/site-content', requireAdmin, async (request, response, next) => {
  try {
    const content = normalizeSiteContent(request.body);
    if (!content) return response.status(400).json({ message: 'Check the site content fields and uploaded images, then try again.' });
    if (databaseReady) {
      await SiteSettings.findOneAndUpdate(
        { key: 'storefront' },
        { key: 'storefront', content },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
    } else {
      localSiteContent = content;
    }
    response.json(content);
  } catch (error) { next(error); }
});

app.post('/api/admin/products', requireAdmin, async (request, response, next) => {
  try {
    const product = normalizeProduct(request.body);
    if (!product) return response.status(400).json({ message: 'Complete all required product fields with valid buy and sell prices.' });
    product.sku = product.sku || generateProductSku();
    await ensureProductCategory(product.category);
    const created = databaseReady ? await Product.create(product) : { ...product, _id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    if (!databaseReady) localProducts.unshift(created);
    response.status(201).json(created);
  } catch (error) { next(error); }
});

app.put('/api/admin/products/:id', requireAdmin, async (request, response, next) => {
  try {
    const product = normalizeProduct(request.body);
    if (!product) return response.status(400).json({ message: 'Complete all required product fields with valid buy and sell prices.' });
    if (databaseReady) {
      const existing = await Product.findById(request.params.id).select('sku').lean();
      if (!existing) return response.status(404).json({ message: 'Product not found.' });
      product.sku = product.sku || existing.sku || `FS-${String(existing._id).slice(-10).toUpperCase()}`;
    } else {
      const existing = localProducts.find((item) => item._id === request.params.id);
      if (!existing) return response.status(404).json({ message: 'Product not found.' });
      product.sku = product.sku || existing.sku || `FS-${String(existing._id).slice(-10).toUpperCase()}`;
    }
    await ensureProductCategory(product.category);
    const updated = databaseReady
      ? await Product.findByIdAndUpdate(request.params.id, product, { new: true, runValidators: true })
      : Object.assign(localProducts.find((item) => item._id === request.params.id) || {}, product);
    if (!updated || (!databaseReady && !updated._id)) return response.status(404).json({ message: 'Product not found.' });
    response.json(updated);
  } catch (error) { next(error); }
});

app.delete('/api/admin/products/:id', requireAdmin, async (request, response, next) => {
  try {
    const productIndex = localProducts.findIndex((item) => item._id === request.params.id);
    const deleted = databaseReady
      ? await Product.findByIdAndDelete(request.params.id)
      : productIndex === -1 ? null : localProducts.splice(productIndex, 1)[0];
    if (!deleted) return response.status(404).json({ message: 'Product not found.' });
    response.json({ success: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/orders', requireAdmin, async (_request, response, next) => {
  try {
    const orders = databaseReady ? await Order.find().sort({ createdAt: -1 }).lean() : [...localOrders].reverse();
    response.json(orders);
  } catch (error) { next(error); }
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (request, response, next) => {
  try {
    const { status } = request.body;
    if (!['placed', 'processing', 'shipped', 'complete'].includes(status)) {
      return response.status(400).json({ message: 'Choose a valid order status.' });
    }
    const order = databaseReady
      ? await Order.findByIdAndUpdate(request.params.id, { status }, { new: true, runValidators: true })
      : localOrders.find((item) => item._id === request.params.id);
    if (!order) return response.status(404).json({ message: 'Order not found.' });
    if (!databaseReady) order.status = status;
    response.json(order);
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: 'Something went wrong. Please try again.' });
});

async function start() {
  if (isProduction) validateProductionConfiguration();
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      databaseReady = true;
      const count = await Product.countDocuments();
      if (count === 0) await Product.insertMany(sampleProducts.map(({ _id, ...product }) => product));
      const categoryNames = await Product.distinct('category');
      for (const name of categoryNames) await ensureProductCategory(name);
      console.log('Connected to MongoDB.');
    } catch (error) {
      if (isProduction) throw error;
      console.error(`MongoDB connection failed; using in-memory catalog: ${error.message}`);
    }
  } else {
    if (isProduction) throw new Error('MONGODB_URI is required in production.');
    console.log('MONGODB_URI not set; using in-memory catalog and orders.');
  }
  app.listen(port, () => console.log(`FASION API listening on http://localhost:${port}`));
}

function validateProductionConfiguration() {
  const required = [
    'MONGODB_URI',
    'CLIENT_ORIGIN',
    'ADMIN_ID',
    'ADMIN_PASSWORD',
    'ADMIN_TOKEN_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  if (process.env.ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters in production.');
  if (process.env.ADMIN_TOKEN_SECRET.length < 32) throw new Error('ADMIN_TOKEN_SECRET must be at least 32 characters in production.');
  if (!/^https:\/\//i.test(process.env.CLIENT_ORIGIN) || new URL(process.env.CLIENT_ORIGIN).origin !== process.env.CLIENT_ORIGIN) {
    throw new Error('CLIENT_ORIGIN must be the exact HTTPS origin of the deployed storefront, without a trailing slash or path.');
  }
  if (/localhost|127\.0\.0\.1/i.test(process.env.MONGODB_URI)) {
    throw new Error('MONGODB_URI must point to a remotely reachable production database.');
  }
  if (process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
    console.warn('Razorpay is configured with test keys; payments will not collect real money.');
  }
}

start().catch((error) => {
  console.error(`FASION API failed to start: ${error.message}`);
  process.exitCode = 1;
});
