# FASION

A fashion storefront built with React, Vite, Express, Node.js, and MongoDB/Mongoose.

## Run locally

1. Install Node.js 18 or newer.
2. From the project root, run `npm install`.
3. Run `npm run dev` and open the Vite URL printed in the terminal.

The API starts on port 5000. Without `MONGODB_URI`, it uses the included sample catalog and keeps orders in memory for development. To persist products and orders, copy `.env.example` to `.env`, set `MONGODB_URI` to your MongoDB connection string, then restart the API. On an empty database, the API inserts the sample catalog at startup.

## Storefront

Customers can browse by category, search products, sort by featured/newest/price/name, and save pieces to a wishlist that persists in their browser. The bag is also stored locally, so it remains available after a refresh. Saved items and bag contents are browser-specific; customer accounts currently sync profile and order history, not saved items or bags.

## Deploy publicly

The app is split into a Vite storefront and an Express API. A Vercel frontend deployment alone is not enough: deploy the API separately and set `VITE_API_BASE_URL` in the Vercel project to the API's HTTPS origin (for example, `https://your-api.example.com`, with no trailing slash). Set the Vercel project root to `client`, build command to `npm run build`, and output directory to `dist`. The frontend uses this base URL for API requests and API-hosted product uploads; leave it unset for local development with the Vite proxy.

For the API service, run `npm ci` from the repository root and start it with `npm start`. Set `NODE_ENV=production` and configure `MONGODB_URI` with a remotely reachable MongoDB database, `CLIENT_ORIGIN` with the exact HTTPS Vercel site origin (no trailing slash), `ADMIN_ID`, `ADMIN_PASSWORD` (at least 16 characters), `ADMIN_TOKEN_SECRET` (at least 32 characters), both Razorpay API keys, and `RAZORPAY_WEBHOOK_SECRET`. The API refuses to start in production if required settings are missing, the database is local/unreachable, or the database connection fails; it will not silently switch to in-memory storage. Use Razorpay test keys until the public checkout is verified, then switch to live keys only after account onboarding is approved.

Uploads must use persistent storage. Configure `UPLOADS_DIR` to a mounted persistent volume path (for example, `/var/data/uploads` on a service with a disk mounted at `/var/data`) or move image storage to an object-storage service. Copy the existing `server/uploads` files to that storage when deploying; otherwise existing product image URLs will return missing images. The current deployment files do not create hosting accounts, databases, persistent disks, payment keys, or a public domain.

## Admin panel

Open `/admin` on the Vite site, or tap the storefront logo five times within 2.5 seconds, to reach the private studio dashboard. Set `ADMIN_ID`, `ADMIN_PASSWORD`, and a long random `ADMIN_TOKEN_SECRET` in `.env`, then restart the API before signing in. The panel includes sales and order summaries, product add/edit/remove controls, order status management, and a Storefront editor for homepage copy, navigation labels, announcement text, and footer content. Edit product details, buy and sell prices, and photos; the per-item profit or loss updates from the difference between the sell and buy prices. Upload up to eight JPG, PNG, WebP, or GIF photos per product (up to 5 MB each), replace the cover photo, and remove photos; customers can browse the product gallery. Product, hero, and story photos are served from `server/uploads`. Admin sessions are signed and expire after eight hours. Admin API routes require the session token; there is no public admin registration.

With MongoDB configured, product and storefront edits persist in the database. Without `MONGODB_URI`, catalog edits and storefront content use the development in-memory mode and reset when the API restarts; uploaded image files remain in `server/uploads`.

## Online payments

Checkout uses Razorpay, with UPI highlighted alongside the other available payment methods. Create API keys in the Razorpay Dashboard and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env` (use test keys while testing). UPI availability depends on the payment methods enabled for your Razorpay account and whether the selected mode supports the method. The secret stays on the server; never add it to frontend code. Restart the API after changing `.env`. For payment recovery when a customer closes checkout, configure a Razorpay webhook at `/api/payments/razorpay/webhook`, subscribe to `payment.captured`, and set the matching signing secret as `RAZORPAY_WEBHOOK_SECRET`. Test payments require Razorpay's test mode and test payment details. Live payments require live keys and a publicly reachable HTTPS deployment.

To reset the MongoDB catalog to the sample products, run `npm run seed` after configuring `.env`. Build the frontend with `npm run build`.

## API

- `GET /api/health` reports API and database mode.
- `GET /api/products?category=Clothing&search=shirt` lists and filters products.
- `POST /api/orders` accepts `{ "customer": { "name", "email", "address" }, "items": [{ "product", "quantity" }] }`. Prices are looked up by the API, not trusted from the browser.
- Admin endpoints are under `/api/admin`; authenticate with `POST /api/admin/login` using the configured admin password.