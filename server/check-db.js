import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fasion';

console.log('Connecting to MongoDB at:', uri);

try {
  await mongoose.connect(uri);
  console.log('STATUS: Connected successfully to MongoDB!\n');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log(`Database: "${db.databaseName}"`);
  console.log(`Total Collections: ${collections.length}\n`);

  for (const col of collections) {
    const name = col.name;
    const count = await db.collection(name).countDocuments();
    console.log(`----------------------------------------`);
    console.log(`Collection: [${name}] (Total documents: ${count})`);
    console.log(`----------------------------------------`);

    if (name === 'products') {
      const products = await db.collection(name).find().toArray();
      products.forEach((p, idx) => {
        console.log(`  ${idx + 1}. [${p.category}] ${p.name} - $${p.price} (${p.color})`);
      });
    } else if (name === 'customers') {
      const customers = await db.collection(name).find().project({ passwordHash: 0, passwordSalt: 0 }).toArray();
      if (customers.length === 0) {
        console.log('  (No registered customers yet)');
      } else {
        customers.forEach((c, idx) => {
          console.log(`  ${idx + 1}. Name: ${c.name} | Email: ${c.email} | Address: ${c.address || '(none)'}`);
        });
      }
    } else if (name === 'orders') {
      const orders = await db.collection(name).find().toArray();
      if (orders.length === 0) {
        console.log('  (No orders placed yet)');
      } else {
        orders.forEach((o, idx) => {
          console.log(`  ${idx + 1}. Order #${o.orderNumber} | Customer: ${o.customer?.name} | Total: $${o.total} | Status: ${o.status}`);
        });
      }
    } else {
      const sample = await db.collection(name).findOne();
      console.log('  Sample keys:', Object.keys(sample || {}));
    }
    console.log('');
  }

} catch (error) {
  console.error('Error querying MongoDB:', error.message);
} finally {
  await mongoose.disconnect();
  console.log('Disconnected cleanly.');
}

