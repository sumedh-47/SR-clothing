import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import Product from './models/Product.js';
import { sampleProducts } from './data/products.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

if (!process.env.MONGODB_URI) {
  console.error('Set MONGODB_URI before seeding the database.');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  await Product.deleteMany({});
  await Product.insertMany(sampleProducts.map(({ _id, ...product }) => product));
  console.log(`Seeded ${sampleProducts.length} products.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}