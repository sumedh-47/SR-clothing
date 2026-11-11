import { useCallback, useEffect, useState } from 'react';
import './admin.css';
import { defaultSiteContent } from './siteDefaults.js';
import { apiUrl, mediaUrl } from './api.js';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));
const statuses = ['placed', 'processing', 'shipped', 'complete'];
const emptyProduct = { name: '', category: 'T-Shirts', purchasePrice: '', price: '', stock: '', stockThreshold: 5, isAvailable: true, sku: '', variants: [], color: '', badge: '', image: '', images: [], description: '' };
const siteFields = [
  { title: 'Announcement and navigation', fields: [
    { key: 'announcement', label: 'Announcement bar', multiline: true },
    { key: 'brandName', label: 'Brand name' },
    { key: 'tshirtsLabel', label: 'T-Shirts link' },
    { key: 'shirtsLabel', label: 'Shirts link' },
    { key: 'hoodiesLabel', label: 'Hoodies link' },
    { key: 'jacketsLabel', label: 'Jackets link' },
    { key: 'storyNavLabel', label: 'Story link' },
  ] },
  { title: 'Homepage hero', fields: [
    { key: 'heroEyebrow', label: 'Small heading' },
    { key: 'heroTitle', label: 'Main heading (use a new line for the italic second line)', multiline: true },
    { key: 'heroDescription', label: 'Description', multiline: true },
    { key: 'heroButton', label: 'Button label' },
    { key: 'heroImageAlt', label: 'Image description' },
    { key: 'heroNoteOne', label: 'Image note one' },
    { key: 'heroNoteTwo', label: 'Image note two' },
    { key: 'heroCaption', label: 'Image caption' },
    { key: 'heroSideNote', label: 'Side note' },
    { key: 'heroIndex', label: 'Collection index' },
  ] },
  { title: 'Product collection', fields: [
    { key: 'collectionEyebrow', label: 'Small heading' },
    { key: 'collectionTitle', label: 'Section heading' },
    { key: 'collectionDescription', label: 'Description', multiline: true },
  ] },
  { title: 'Our story', fields: [
    { key: 'storyEyebrow', label: 'Small heading' },
    { key: 'storyTitle', label: 'Main heading (use a new line for the italic second line)', multiline: true },
    { key: 'storyDescription', label: 'Description', multiline: true },
    { key: 'storyButton', label: 'Button label' },
    { key: 'storyMark', label: 'Section mark' },
  ] },
  { title: 'Footer', fields: [
    { key: 'footerTagline', label: 'Tagline' },
    { key: 'footerCopyright', label: 'Copyright text' },
  ] },
];

function ImageField({ label, name, value, onUpload }) {
  return <div className="image-upload-field"><span>{label}</span>
    <input type="file" aria-label={label} accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) onUpload([file]);
      event.target.value = '';
    }} />
    <input type="hidden" name={name} value={value || ''} />
    <small>Choose a JPG, PNG, WebP, or GIF image (up to 5 MB).</small>
    {value && <img className="image-upload-preview" src={mediaUrl(value)} alt={`${label} preview`} />}
  </div>;
}

function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem('fasion-admin-token') || '');
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [section, setSection] = useState('Overview');
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summaryPeriod, setSummaryPeriod] = useState('week');
  const [orderStatus, setOrderStatus] = useState('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [siteContent, setSiteContent] = useState(defaultSiteContent);
  const [search, setSearch] = useState('');
  const [productDialog, setProductDialog] = useState(null);
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [inventoryDialog, setInventoryDialog] = useState(null);
  const [inventoryHistoryDialog, setInventoryHistoryDialog] = useState(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const request = useCallback(async (url, options = {}) => {
    const response = await fetch(apiUrl(url), {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...options.headers },
    });
    const result = await response.json();
    if (response.status === 401) {
      localStorage.removeItem('fasion-admin-token');
      setToken('');
    }
    if (!response.ok) throw new Error(result.message || 'The request could not be completed.');
    return result;
  }, [token]);

  const uploadRequest = useCallback(async (url, body) => {
    const response = await fetch(apiUrl(url), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body,
    });
    const result = await response.json();
    if (response.status === 401) {
      localStorage.removeItem('fasion-admin-token');
      setToken('');
    }
    if (!response.ok) throw new Error(result.message || 'The image could not be uploaded.');
    return result;
  }, [token]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextSummary, nextProducts, nextOrders, nextSiteContent, nextCustomers, nextCategories, nextPayments] = await Promise.all([
        request(`/api/admin/summary?period=${summaryPeriod}`), request('/api/admin/products'), request('/api/admin/orders'),
        request('/api/site-content'), request('/api/admin/customers'), request('/api/admin/categories'), request('/api/admin/payments'),
      ]);
      setSummary(nextSummary);
      setProducts(nextProducts);
      setOrders(nextOrders);
      setPayments(nextPayments);
      setCustomers(nextCustomers);
      setCategories(nextCategories);
      setSiteContent({ ...defaultSiteContent, ...nextSiteContent });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }, [request, summaryPeriod, token]);

  useEffect(() => { loadData(); }, [loadData]);

  async function signIn(event) {
    event.preventDefault();
    setLoginError('');
    try {
      const response = await fetch(apiUrl('/api/admin/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminId, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Sign in failed.');
      localStorage.setItem('fasion-admin-token', result.token);
      setToken(result.token);
      setAdminId('');
      setPassword('');
    } catch (error) {
      setLoginError(error.message);
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const product = Object.fromEntries(form.entries());
    product.price = Number(product.price);
    product.purchasePrice = Number(product.purchasePrice);
    product.images = productDialog.images || (product.image ? [product.image] : []);
    product.image = product.images[0] || '';
    if (!product.image) {
      setNotice('Upload a product image before saving.');
      setSaving(false);
      return;
    }
    try {
      await request(productDialog._id ? `/api/admin/products/${productDialog._id}` : '/api/admin/products', {
        method: productDialog._id ? 'PUT' : 'POST', body: JSON.stringify(product),
      });
      setProductDialog(null);
      setNotice(productDialog._id ? 'Product changes saved.' : 'Product added to the catalog.');
      await loadData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file, target, key) {
    setImageUploading(true);
    const form = new FormData();
    for (const item of file) form.append('images', item);
    try {
      const result = await uploadRequest('/api/admin/uploads', form);
      if (target === 'product') {
        setProductDialog((current) => {
          const images = [...new Set([...(current.images || (current.image ? [current.image] : [])), ...result.urls])];
          return { ...current, images: images.slice(0, 8), image: images[0] };
        });
      } else if (target === 'product-cover') {
        setProductDialog((current) => {
          const images = current.images || (current.image ? [current.image] : []);
          const nextImages = [...new Set([result.urls[0], ...images.slice(1)])];
          return { ...current, images: nextImages.slice(0, 8), image: nextImages[0] };
        });
      } else {
        setSiteContent((current) => ({ ...current, [key]: result.url }));
      }
      setNotice('Image uploaded. Save your changes to publish it.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setImageUploading(false);
    }
  }

  async function saveSiteContent(event) {
    event.preventDefault();
    setSaving(true);
    const content = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const savedContent = await request('/api/admin/site-content', { method: 'PUT', body: JSON.stringify(content) });
      setSiteContent({ ...defaultSiteContent, ...savedContent });
      setNotice('Storefront content saved.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Remove ${product.name} from the catalog?`)) return;
    try {
      await request(`/api/admin/products/${product._id}`, { method: 'DELETE' });
      setNotice('Product removed.');
      await loadData();
    } catch (error) { setNotice(error.message); }
  }

  async function updateOrder(id, status) {
    try {
      await request(`/api/admin/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      setOrders((current) => current.map((order) => order._id === id ? { ...order, status } : order));
      setNotice('Order status updated.');
      await loadData();
    } catch (error) { setNotice(error.message); }
  }

  async function saveCategory(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await request(categoryDialog._id ? `/api/admin/categories/${categoryDialog._id}` : '/api/admin/categories', {
        method: categoryDialog._id ? 'PUT' : 'POST',
        body: JSON.stringify({ name: categoryDialog.name }),
      });
      setCategoryDialog(null);
      setNotice(categoryDialog._id ? 'Category updated.' : 'Category created.');
      await loadData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category) {
    if (!window.confirm(`Delete the ${category.name} category?`)) return;
    try {
      await request(`/api/admin/categories/${category._id}`, { method: 'DELETE' });
      setNotice('Category deleted.');
      await loadData();
    } catch (error) {
      setNotice(error.message);
    }
  }

  function openInventoryEditor(product) {
    setInventoryDialog({
      ...product,
      stock: product.stock ?? 0,
      stockThreshold: product.stockThreshold ?? 5,
      isAvailable: product.isAvailable !== false,
      variants: (product.variants || []).map((variant) => ({ ...variant })),
      stockOperation: 'set',
      stockInput: product.stock ?? 0,
    });
  }

  async function saveInventory(event) {
    event.preventDefault();
    setSaving(true);
    const operationValue = Number(inventoryDialog.stockInput);
    let stock = Number(inventoryDialog.stock);
    if (!inventoryDialog.variants.length) {
      if (!Number.isInteger(operationValue) || operationValue < 0) {
        setNotice('Enter a non-negative whole-number stock quantity.');
        setSaving(false);
        return;
      }
      if (inventoryDialog.stockOperation === 'increase') stock += operationValue;
      else if (inventoryDialog.stockOperation === 'decrease') stock -= operationValue;
      else stock = operationValue;
      if (!Number.isInteger(stock) || stock < 0) {
        setNotice('Stock cannot be decreased below zero.');
        setSaving(false);
        return;
      }
    }
    try {
      await request(`/api/admin/products/${inventoryDialog._id}/inventory`, {
        method: 'PUT',
        body: JSON.stringify({
          stock,
          stockThreshold: Number(inventoryDialog.stockThreshold),
          isAvailable: inventoryDialog.isAvailable,
          variants: inventoryDialog.variants,
        }),
      });
      setInventoryDialog(null);
      setNotice('Inventory changes saved.');
      await loadData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function showInventoryHistory(product) {
    try {
      const history = await request(`/api/admin/products/${product._id}/inventory-history`);
      setInventoryHistoryDialog({ product, history });
    } catch (error) {
      setNotice(error.message);
    }
  }

  function signOut() {
    localStorage.removeItem('fasion-admin-token');
    setToken('');
    setSummary(null);
  }

  if (!token) return (
    <main className="admin-login-shell">
      <a href="/" className="admin-back">← Back to storefront</a>
      <section className="admin-login-panel">
        <a className="admin-wordmark" href="/">FASION<span> / STUDIO</span></a>
        <p className="admin-kicker">THE BACK OFFICE</p>
        <h1>Good to have<br /><em>you back.</em></h1>
        <p className="admin-login-copy">Sign in to look after your shop.</p>
        <form onSubmit={signIn} className="admin-login-form">
          <label htmlFor="admin-id">Admin ID</label>
          <input id="admin-id" type="text" autoComplete="username" value={adminId} onChange={(event) => setAdminId(event.target.value)} required />
          <label htmlFor="admin-password">Admin password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {loginError && <p className="admin-error" role="alert">{loginError}</p>}
          <button type="submit" className="admin-primary">Enter the studio <span>↗</span></button>
        </form>
        <p className="admin-security-note">Admin access is configured on the server.</p>
      </section>
      <span className="login-side-note">FASION STUDIO · PRIVATE ACCESS</span>
    </main>
  );

  const filteredProducts = products.filter((product) => `${product.name} ${product.category} ${product.color}`.toLowerCase().includes(search.toLowerCase()));
  const filteredOrders = orders.filter((order) => (orderStatus === 'all' || order.status === orderStatus)
    && `${order.orderNumber} ${order.customer?.name} ${order.customer?.email} ${order.status}`.toLowerCase().includes(search.toLowerCase()));
  const filteredCustomers = customers.filter((customer) => `${customer.name} ${customer.email} ${customer.phone || ''} ${customer.address || ''} ${customer.clientType || ''}`.toLowerCase().includes(search.toLowerCase()));
  const filteredPayments = payments.filter((payment) => (paymentStatusFilter === 'all' || payment.paymentStatus === paymentStatusFilter)
    && `${payment.orderNumber} ${payment.customer?.name} ${payment.customer?.email} ${payment.paymentStatus} ${payment.paymentMethod} ${payment.paymentId} ${payment.razorpayOrderId}`.toLowerCase().includes(search.toLowerCase()));
  const filteredInventory = products.filter((product) => {
    const term = inventorySearch.trim().toLowerCase();
    const matchesSearch = !term || `${product.name} ${product.sku || product._id}`.toLowerCase().includes(term);
    const status = product.isAvailable === false ? 'disabled'
      : product.stock === 0 ? 'out'
        : product.stock != null && product.stock < (product.stockThreshold ?? 5) ? 'low'
          : product.stock == null ? 'untracked' : 'in';
    return matchesSearch && (inventoryStatusFilter === 'all' || status === inventoryStatusFilter);
  });
  const categoryChoices = categories.length ? categories.map((category) => category.name) : ['T-Shirts', 'Shirts', 'Hoodies', 'Jackets'];
  const purchasePrice = Number(productDialog?.purchasePrice);
  const sellingPrice = Number(productDialog?.price);
  const hasProductCosts = productDialog?.purchasePrice !== '' && Number.isFinite(purchasePrice) && Number.isFinite(sellingPrice);
  const productProfitLoss = hasProductCosts ? sellingPrice - purchasePrice : null;

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <a className="admin-wordmark" href="/">FASION<span> / STUDIO</span></a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="admin-nav" aria-label="Admin sections">
          {['Overview', 'Products', 'Categories', 'Inventory', 'Orders', 'Payments', 'Clients', 'Storefront'].map((item) => <button key={item} className={section === item ? 'selected' : ''} onClick={() => { setSection(item); setSearch(''); }}><span className="nav-dot" />{item}{item === 'Orders' && summary?.pendingOrders > 0 && <span className="nav-count">{summary.pendingOrders}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><a href="/">View storefront <span>↗</span></a><button onClick={signOut}>Sign out <span>→</span></button><small>FASION STUDIO · 2026</small></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span className="topbar-label">FASION / STUDIO</span><span className="topbar-divider">/</span><span>{section}</span></div><div className="topbar-user"><span className="connection-dot" />{summary?.database === 'connected' ? 'MongoDB connected' : 'Local data mode'}<span className="avatar">F</span></div></header>
        <div className="admin-content">
          {section === 'Overview' && <>
            <div className="page-title-row"><div><p className="admin-kicker">YOUR SHOP, AT A GLANCE</p><h1>Good morning<span>.</span></h1><p className="admin-subtitle">Here’s what’s happening with your store.</p></div><button className="refresh-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
            <section className="stats-grid" aria-label="Store statistics">
              <article className="stat-block"><span>Gross sales</span><strong>{money(summary?.revenue)}</strong><small>All recorded orders</small><span className="stat-index">01</span></article>
              <article className="stat-block"><span>Orders</span><strong>{summary?.orders ?? '—'}</strong><small>Orders placed</small><span className="stat-index">02</span></article>
              <article className="stat-block"><span>To fulfill</span><strong>{summary?.pendingOrders ?? '—'}</strong><small>Placed or processing</small><span className="stat-index">03</span></article>
              <article className="stat-block"><span>Customers</span><strong>{summary?.registeredClients ?? '—'}</strong><small>Registered customer accounts</small><span className="stat-index">04</span></article>
              <article className="stat-block"><span>Products</span><strong>{summary?.products ?? '—'}</strong><small>Catalog listings</small><span className="stat-index">05</span></article>
              <article className="stat-block"><span>Completed</span><strong>{summary?.completedOrders ?? '—'}</strong><small>Successfully fulfilled</small><span className="stat-index">06</span></article>
              <article className="stat-block"><span>Low stock</span><strong>{summary?.lowStock ?? '—'}</strong><small>Tracked inventory: 1–5</small><span className="stat-index">07</span></article>
              <article className="stat-block"><span>Out of stock</span><strong>{summary?.outOfStock ?? '—'}</strong><small>Tracked inventory: zero</small><span className="stat-index">08</span></article>
            </section>
            <section className="sales-panel">
              <div className="table-heading"><div><p className="admin-kicker">PERFORMANCE</p><h2>Sales overview</h2></div>
                <label className="period-select">Period<select value={summaryPeriod} onChange={(event) => setSummaryPeriod(event.target.value)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">Last 12 months</option></select></label>
              </div>
              <SalesChart data={summary?.salesTrend || []} />
              <p className="chart-total">Period revenue <strong>{money(summary?.periodRevenue)}</strong></p>
            </section>
            <section className="admin-table-section">
              <div className="table-heading"><div><p className="admin-kicker">THE LATEST</p><h2>Recent orders</h2></div><button className="plain-action" onClick={() => setSection('Orders')}>All orders <span>→</span></button></div>
              <OrderTable orders={orders.slice(0, 5)} onStatus={updateOrder} />
            </section>
            <section className="admin-bottom-note"><span>F / 01</span><p>Thoughtful things, well looked after.</p><span>STUDIO NOTES · {new Date().getFullYear()}</span></section>
          </>}

          {section === 'Products' && <>
            <div className="page-title-row"><div><p className="admin-kicker">YOUR ASSORTMENT</p><h1>Products<span>.</span></h1><p className="admin-subtitle">The pieces your customers can take home.</p></div><button className="admin-primary compact" onClick={() => setProductDialog({ ...emptyProduct })}><span>+</span> Add a product</button></div>
            <div className="list-toolbar"><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" /></label><span>{filteredProducts.length} products</span></div>
            <section className="admin-table-section"><ProductTable products={filteredProducts} onEdit={(product) => setProductDialog({ ...product, purchasePrice: product.purchasePrice ?? '', stock: product.stock ?? '', images: product.images?.length ? product.images : [product.image] })} onRemove={removeProduct} /></section>
          </>}

          {section === 'Categories' && <>
            <div className="page-title-row"><div><p className="admin-kicker">ORGANIZE THE ASSORTMENT</p><h1>Categories<span>.</span></h1><p className="admin-subtitle">Categories power product filters and storefront navigation.</p></div><button className="admin-primary compact" onClick={() => setCategoryDialog({ name: '' })}><span>+</span> Add category</button></div>
            <section className="admin-table-section"><CategoryTable categories={categories} products={products} onEdit={(category) => setCategoryDialog({ ...category })} onRemove={removeCategory} /></section>
          </>}

          {section === 'Inventory' && <>
            <div className="page-title-row"><div><p className="admin-kicker">STOCK CONTROL</p><h1>Inventory<span>.</span></h1><p className="admin-subtitle">Adjust stock, availability, and size / colour variants.</p></div><button className="refresh-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
            <section className="stats-grid inventory-stats" aria-label="Inventory status">
              <article className="stat-block"><span>Tracked items</span><strong>{products.filter((product) => product.stock != null).length}</strong><small>Inventory enabled</small></article>
              <article className="stat-block"><span>Low stock</span><strong>{summary?.lowStock ?? 0}</strong><small>Below each item’s minimum</small></article>
              <article className="stat-block"><span>Out of stock</span><strong>{summary?.outOfStock ?? 0}</strong><small>Unavailable for purchase</small></article>
            </section>
            <div className="list-toolbar inventory-toolbar">
              <label className="admin-search"><span>⌕</span><input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search product name or SKU" /></label>
              <label className="filter-select">Stock status<select value={inventoryStatusFilter} onChange={(event) => setInventoryStatusFilter(event.target.value)}><option value="all">All products</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="disabled">Disabled</option><option value="untracked">Not tracked</option></select></label>
              <span>{filteredInventory.length} products</span>
            </div>
            <section className="admin-table-section"><InventoryTable products={filteredInventory} onEdit={openInventoryEditor} onHistory={showInventoryHistory} /></section>
          </>}

          {section === 'Storefront' && <form onSubmit={saveSiteContent}>
            <div className="page-title-row"><div><p className="admin-kicker">MAKE IT YOURS</p><h1>Storefront<span>.</span></h1><p className="admin-subtitle">Update the words and photos visitors see across your shop.</p></div><button className="admin-primary compact" type="submit" disabled={saving || imageUploading}>{saving ? 'Saving…' : 'Save storefront'} <span>↗</span></button></div>
            <div className="storefront-editor">
              {siteFields.map((group) => <section className="site-content-group" key={group.title}>
                <h2>{group.title}</h2>
                <div className="editor-fields site-content-fields">
                  {group.fields.map((field) => <label key={field.key}>{field.label}
                    {field.multiline
                      ? <textarea name={field.key} value={siteContent[field.key]} rows={field.key.includes('Title') ? 2 : 3} onChange={(event) => setSiteContent((current) => ({ ...current, [field.key]: event.target.value }))} />
                      : <input name={field.key} value={siteContent[field.key]} onChange={(event) => setSiteContent((current) => ({ ...current, [field.key]: event.target.value }))} />}
                  </label>)}
                  {group.title === 'Homepage hero' && <ImageField name="heroImage" label="Hero image" value={siteContent.heroImage} onUpload={(file) => uploadImage(file, 'site', 'heroImage')} />}
                  {group.title === 'Our story' && <ImageField name="storyImage" label="Story image" value={siteContent.storyImage} onUpload={(file) => uploadImage(file, 'site', 'storyImage')} />}
                </div>
              </section>)}
            </div>
            <div className="site-save-row"><button className="admin-primary" type="submit" disabled={saving || imageUploading}>{saving ? 'Saving…' : 'Save storefront'} <span>↗</span></button></div>
          </form>}

          {section === 'Orders' && <>
            <div className="page-title-row"><div><p className="admin-kicker">CUSTOMER ACTIVITY</p><h1>Orders<span>.</span></h1><p className="admin-subtitle">Keep every good thing moving.</p></div><button className="refresh-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
            <div className="list-toolbar"><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order or customer" /></label><label className="filter-select">Status<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><span>{filteredOrders.length} orders</span></div>
            <section className="admin-table-section"><OrderTable orders={filteredOrders} onStatus={updateOrder} expanded /></section>
          </>}
          {section === 'Payments' && <>
            <div className="page-title-row"><div><p className="admin-kicker">TRANSACTION RECORDS</p><h1>Payments<span>.</span></h1><p className="admin-subtitle">Gateway status, payment method, references, and associated customer details. Sensitive card and bank credentials are never stored here.</p></div><button className="refresh-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
            <div className="list-toolbar payments-toolbar"><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, customer, or payment ID" /></label><label className="filter-select">Payment status<select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}><option value="all">All payments</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="refund_required">Refund required</option><option value="unrecorded">Unrecorded</option><option value="unpaid">Unpaid</option></select></label><span>{filteredPayments.length} payments</span></div>
            <section className="admin-table-section"><PaymentTable payments={filteredPayments} /></section>
          </>}
          {section === 'Clients' && <>
            <div className="page-title-row"><div><p className="admin-kicker">YOUR COMMUNITY</p><h1>Clients<span>.</span></h1><p className="admin-subtitle">Registered accounts and guest clients, with contact, shipping, and order totals.</p></div><button className="refresh-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
            <div className="list-toolbar"><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients" /></label><span>{filteredCustomers.length} clients</span></div>
            <section className="admin-table-section"><CustomerTable customers={filteredCustomers} /></section>
          </>}
          {loading && <div className="admin-loading">Updating your studio…</div>}
        </div>
      </main>

      {productDialog && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProductDialog(null); }}>
        <form className="product-editor" onSubmit={saveProduct}>
          <div className="editor-heading"><div><p className="admin-kicker">CATALOG DETAILS</p><h2>{productDialog._id ? 'Edit piece' : 'Add a piece'}</h2></div><button type="button" className="editor-close" onClick={() => setProductDialog(null)} aria-label="Close editor">×</button></div>
          <input type="hidden" name="sku" value={productDialog.sku || ''} />
          <input type="hidden" name="stockThreshold" value={productDialog.stockThreshold ?? 5} />
          <input type="hidden" name="isAvailable" value={productDialog.isAvailable !== false} />
          <input type="hidden" name="variants" value={JSON.stringify(productDialog.variants || [])} />
          <div className="editor-fields">
            <label>Product name<input name="name" defaultValue={productDialog.name} required /></label>
            <div className="field-pair"><label>Category<select name="category" defaultValue={productDialog.category || categoryChoices[0]}>{categoryChoices.map((value) => <option key={value}>{value}</option>)}</select></label><label>Sell price<input name="price" type="number" min="0" step="0.01" value={productDialog.price} onChange={(event) => setProductDialog((current) => ({ ...current, price: event.target.value }))} required /></label></div>
            <div className="field-pair"><label>Buy price<input name="purchasePrice" type="number" min="0" step="0.01" value={productDialog.purchasePrice} onChange={(event) => setProductDialog((current) => ({ ...current, purchasePrice: event.target.value }))} required /></label><div className={`product-profit-loss ${productProfitLoss < 0 ? 'is-loss' : ''}`} aria-live="polite"><span>{productProfitLoss === null ? 'Profit / loss per item' : productProfitLoss > 0 ? 'Profit per item' : productProfitLoss < 0 ? 'Loss per item' : 'Break-even'}</span><strong>{productProfitLoss === null ? 'Enter both prices' : money(Math.abs(productProfitLoss))}</strong></div></div>
            <label>Stock quantity<input name="stock" type="number" min="0" step="1" value={productDialog.stock ?? ''} placeholder="Leave blank to disable stock tracking" onChange={(event) => setProductDialog((current) => ({ ...current, stock: event.target.value }))} /></label>
            <div className="field-pair"><label>Color / finish<input name="color" defaultValue={productDialog.color} required /></label><label>Badge<input name="badge" defaultValue={productDialog.badge} placeholder="Optional" /></label></div>
            <div className="image-upload-field product-photos">
              <span>Product photos ({productDialog.images?.length || 0}/8)</span>
              <label>Replace cover photo<input type="file" aria-label="Replace cover photo" accept="image/jpeg,image/png,image/webp,image/gif" disabled={imageUploading} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadImage([file], 'product-cover');
                event.target.value = '';
              }} /></label>
              <input type="file" aria-label="Product photos" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={(productDialog.images?.length || 0) >= 8} onChange={(event) => {
                const files = Array.from(event.target.files || []).slice(0, 8 - (productDialog.images?.length || 0));
                if (files.length) uploadImage(files, 'product');
                event.target.value = '';
              }} />
              <input type="hidden" name="images" value={JSON.stringify(productDialog.images || [])} />
              <small>Select multiple JPG, PNG, WebP, or GIF photos (up to 5 MB each). The first photo is the cover.</small>
              <div className="product-photo-grid">
                {(productDialog.images || []).map((image, index) => <div className="product-photo-item" key={`${image}-${index}`}>
                  <img src={mediaUrl(image)} alt={`Product photo ${index + 1}`} />
                  <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setProductDialog((current) => {
                    const images = current.images.filter((_, imageIndex) => imageIndex !== index);
                    return { ...current, images, image: images[0] || '' };
                  })}>×</button>
                  {index === 0 && <span>Cover</span>}
                </div>)}
              </div>
            </div>
            <label>Description<textarea name="description" defaultValue={productDialog.description} rows="3" required /></label>
          </div>
          <div className="editor-actions"><button type="button" className="editor-cancel" onClick={() => setProductDialog(null)}>Cancel</button><button type="submit" className="admin-primary compact" disabled={saving || imageUploading}>{saving ? 'Saving…' : 'Save product'} <span>↗</span></button></div>
        </form>
      </div>}
      {categoryDialog && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryDialog(null); }}>
        <form className="product-editor category-editor" onSubmit={saveCategory}>
          <div className="editor-heading"><div><p className="admin-kicker">CATALOG ORGANIZATION</p><h2>{categoryDialog._id ? 'Rename category' : 'New category'}</h2></div><button type="button" className="editor-close" onClick={() => setCategoryDialog(null)} aria-label="Close editor">×</button></div>
          <div className="editor-fields"><label>Category name<input autoFocus value={categoryDialog.name} onChange={(event) => setCategoryDialog((current) => ({ ...current, name: event.target.value }))} maxLength="60" required /></label></div>
          <div className="editor-actions"><button type="button" className="editor-cancel" onClick={() => setCategoryDialog(null)}>Cancel</button><button type="submit" className="admin-primary compact" disabled={saving}>{saving ? 'Saving…' : 'Save category'} <span>↗</span></button></div>
        </form>
      </div>}
      {inventoryDialog && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInventoryDialog(null); }}>
        <form className="product-editor inventory-editor" onSubmit={saveInventory}>
          <div className="editor-heading">
            <div><p className="admin-kicker">INVENTORY CONTROL · {inventoryDialog.sku || inventoryDialog._id}</p><h2>Edit stock</h2><p className="admin-subtitle">{inventoryDialog.name}</p></div>
            <button type="button" className="editor-close" onClick={() => setInventoryDialog(null)} aria-label="Close inventory editor">×</button>
          </div>
          <div className="editor-fields">
            <label className="availability-toggle"><input type="checkbox" checked={inventoryDialog.isAvailable} onChange={(event) => setInventoryDialog((current) => ({ ...current, isAvailable: event.target.checked }))} /><span>Product available for purchase</span></label>
            {inventoryDialog.variants.length ? <>
              <div className="variant-editor-heading"><strong>Size and colour stock</strong><span>{inventoryDialog.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0)} units total</span></div>
              <div className="inventory-variant-list">
                {inventoryDialog.variants.map((variant, index) => <div className="inventory-variant-row" key={`${variant.sku || 'new'}-${index}`}>
                  <label>Size<input value={variant.size} onChange={(event) => setInventoryDialog((current) => ({ ...current, variants: current.variants.map((item, row) => row === index ? { ...item, size: event.target.value } : item) }))} required /></label>
                  <label>Colour<input value={variant.color} onChange={(event) => setInventoryDialog((current) => ({ ...current, variants: current.variants.map((item, row) => row === index ? { ...item, color: event.target.value } : item) }))} required /></label>
                  <label>Qty<input type="number" min="0" step="1" value={variant.stock} onChange={(event) => setInventoryDialog((current) => ({ ...current, variants: current.variants.map((item, row) => row === index ? { ...item, stock: event.target.value } : item) }))} required /></label>
                  <button type="button" className="variant-remove" onClick={() => setInventoryDialog((current) => ({ ...current, variants: current.variants.filter((_, row) => row !== index) }))} aria-label={`Remove ${variant.size} ${variant.color} variant`}>×</button>
                </div>)}
              </div>
              <button type="button" className="variant-add" onClick={() => setInventoryDialog((current) => ({ ...current, variants: [...current.variants, { sku: '', size: '', color: '', stock: 0 }] }))}>+ Add size / colour variant</button>
            </> : <>
              <label>Stock adjustment
                <select value={inventoryDialog.stockOperation} onChange={(event) => setInventoryDialog((current) => ({ ...current, stockOperation: event.target.value, stockInput: event.target.value === 'set' ? current.stock : '' }))}>
                  <option value="set">Set exact quantity</option><option value="increase">Increase by</option><option value="decrease">Decrease by</option>
                </select>
              </label>
              <label>{inventoryDialog.stockOperation === 'set' ? 'Available quantity' : `${inventoryDialog.stockOperation === 'increase' ? 'Add' : 'Remove'} quantity`}
                <input type="number" min="0" step="1" value={inventoryDialog.stockInput} onChange={(event) => setInventoryDialog((current) => ({ ...current, stockInput: event.target.value }))} required />
              </label>
              {inventoryDialog.stockOperation !== 'set' && <p className="inventory-adjust-preview">Current: {inventoryDialog.stock} · New quantity: {Math.max(0, Number(inventoryDialog.stock) + (inventoryDialog.stockOperation === 'increase' ? 1 : -1) * Number(inventoryDialog.stockInput || 0))}</p>}
              <button type="button" className="variant-add" onClick={() => setInventoryDialog((current) => ({ ...current, variants: [{ sku: '', size: '', color: '', stock: Number(current.stock || 0) }] }))}>+ Manage size / colour variants instead</button>
            </>}
            <label>Low stock alert below<input type="number" min="0" step="1" value={inventoryDialog.stockThreshold} onChange={(event) => setInventoryDialog((current) => ({ ...current, stockThreshold: event.target.value }))} required /></label>
            <p className="inventory-editor-note">Stock is rechecked during checkout. Changes are saved with an administrator and timestamp history.</p>
          </div>
          <div className="editor-actions"><button type="button" className="editor-cancel" onClick={() => setInventoryDialog(null)}>Cancel</button><button type="submit" className="admin-primary compact" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'} <span>↗</span></button></div>
        </form>
      </div>}
      {inventoryHistoryDialog && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInventoryHistoryDialog(null); }}>
        <section className="product-editor inventory-history-editor">
          <div className="editor-heading"><div><p className="admin-kicker">AUDIT TRAIL · {inventoryHistoryDialog.product.sku || inventoryHistoryDialog.product._id}</p><h2>Stock history</h2><p className="admin-subtitle">{inventoryHistoryDialog.product.name}</p></div><button type="button" className="editor-close" onClick={() => setInventoryHistoryDialog(null)} aria-label="Close inventory history">×</button></div>
          {inventoryHistoryDialog.history.length ? <div className="inventory-history-list">
            {[...inventoryHistoryDialog.history].reverse().map((entry, index) => <article className="inventory-history-item" key={`${entry.updatedAt}-${index}`}>
              <div><strong>{entry.previousStock ?? 'Untracked'} → {entry.newStock} units</strong><small>{entry.admin} · {entry.sku}</small><small>{new Date(entry.updatedAt).toLocaleString()}</small></div>
              {!!entry.newVariants?.length && <ul>{entry.newVariants.map((variant) => <li key={variant.sku}>{variant.size} / {variant.color}: {variant.stock} <small>({variant.sku})</small></li>)}</ul>}
            </article>)}
          </div> : <div className="empty-admin">No inventory changes recorded yet.</div>}
          <div className="editor-actions"><button type="button" className="admin-primary compact" onClick={() => setInventoryHistoryDialog(null)}>Close</button></div>
        </section>
      </div>}
      {notice && <div className="admin-toast" role="status" onAnimationEnd={() => {}}>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
    </div>
  );
}

function ProductTable({ products, onEdit, onRemove }) {
  if (!products.length) return <div className="empty-admin">No products to show.</div>;
  return <div className="table-scroll"><table className="admin-table product-admin-table"><thead><tr><th>PIECE</th><th>CATEGORY</th><th>COLOR</th><th>STOCK</th><th>BUY PRICE</th><th>SELL PRICE</th><th>PROFIT / LOSS</th><th aria-label="Actions" /></tr></thead><tbody>
    {products.map((product) => {
      const profitLoss = product.purchasePrice == null ? null : Number(product.price) - Number(product.purchasePrice);
      return <tr key={product._id}><td><div className="product-cell"><img src={mediaUrl(product.image)} alt="" /><div><strong>{product.name}</strong><small>{product.badge || 'Standard listing'}</small></div></div></td><td>{product.category}</td><td>{product.color}</td><td>{product.stock == null ? 'Untracked' : product.stock}</td><td className="price-cell">{product.purchasePrice == null ? '—' : money(product.purchasePrice)}</td><td className="price-cell">{money(product.price)}</td><td className={`price-cell ${profitLoss !== null && profitLoss < 0 ? 'loss-value' : 'profit-value'}`}>{profitLoss === null ? 'Add buy price' : `${profitLoss < 0 ? 'Loss' : profitLoss > 0 ? 'Profit' : 'Break-even'} · ${money(Math.abs(profitLoss))}`}</td><td><div className="row-actions"><button onClick={() => onEdit(product)}>Edit</button><button onClick={() => onRemove(product)} aria-label={`Remove ${product.name}`}>Remove</button></div></td></tr>;
    })}
  </tbody></table></div>;
}

function CategoryTable({ categories, products, onEdit, onRemove }) {
  if (!categories.length) return <div className="empty-admin">No categories yet. Add one to organize your products.</div>;
  return <div className="table-scroll"><table className="admin-table"><thead><tr><th>CATEGORY</th><th>PRODUCTS</th><th>STORE NAVIGATION</th><th aria-label="Actions" /></tr></thead><tbody>
    {categories.map((category) => <tr key={category._id}><td className="order-id">{category.name}</td><td>{products.filter((product) => product.category === category.name).length}</td><td><span className="category-live-status">Live filter enabled</span></td><td><div className="row-actions"><button onClick={() => onEdit(category)}>Rename</button><button onClick={() => onRemove(category)} aria-label={`Delete ${category.name}`}>Delete</button></div></td></tr>)}
  </tbody></table></div>;
}

function InventoryTable({ products, onEdit, onHistory }) {
  if (!products.length) return <div className="empty-admin">No products to track.</div>;
  return <div className="table-scroll"><table className="admin-table inventory-table"><thead><tr><th>PRODUCT</th><th>SKU</th><th>AVAILABLE</th><th>STATUS</th><th aria-label="Actions" /></tr></thead><tbody>
    {products.map((product) => {
      const tracked = product.stock != null;
      const label = product.isAvailable === false ? 'Disabled' : !tracked ? 'Not tracked' : product.stock === 0 ? 'Out of stock' : product.stock < (product.stockThreshold ?? 5) ? 'Low stock' : 'In stock';
      const statusClass = product.isAvailable === false ? 'is-disabled' : product.stock === 0 ? 'is-out' : tracked && product.stock < (product.stockThreshold ?? 5) ? 'is-low' : '';
      return <tr key={product._id}><td><div className="product-cell"><img src={mediaUrl(product.image)} alt="" /><div><strong>{product.name}</strong><small>{product.category} · {product.variants?.length ? `${product.variants.length} size / colour variants` : product.color}</small></div></div></td><td className="date-cell">{product.sku || String(product._id).toUpperCase()}</td><td>{tracked ? product.stock : '—'}{product.variants?.length > 0 && <small className="variant-count">{product.variants.length} variants</small>}</td><td><span className={`inventory-status ${statusClass}`}>{label}</span></td><td><div className="row-actions"><button onClick={() => onEdit(product)}>Edit Stock</button><button onClick={() => onHistory(product)}>History</button></div></td></tr>;
    })}
  </tbody></table></div>;
}

function CustomerTable({ customers }) {
  if (!customers.length) return <div className="empty-admin">No clients to show yet.</div>;
  return <div className="table-scroll"><table className="admin-table customer-table"><thead><tr><th>CLIENT</th><th>TYPE</th><th>PHONE</th><th>SHIPPING ADDRESS</th><th>JOINED</th><th>LAST ORDER</th><th>ORDERS</th><th>TOTAL SPEND</th></tr></thead><tbody>
    {customers.map((customer) => <tr key={customer._id}><td><strong className="customer-name">{customer.name}</strong><small className="customer-email">{customer.email}</small></td><td>{customer.clientType === 'registered' ? 'Registered' : 'Guest'}</td><td>{customer.phone || '—'}</td><td className="client-address">{customer.address || '—'}</td><td className="date-cell">{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : '—'}</td><td className="date-cell">{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : '—'}</td><td>{customer.orderCount}</td><td className="price-cell">{money(customer.totalSpent)}</td></tr>)}
  </tbody></table></div>;
}

function PaymentTable({ payments }) {
  if (!payments.length) return <div className="empty-admin">No payment attempts or order payment records to show.</div>;
  return <div className="table-scroll"><table className="admin-table payment-table"><thead><tr><th>ORDER / CLIENT</th><th>ITEMS</th><th>AMOUNT</th><th>GATEWAY / METHOD</th><th>PAYMENT STATUS</th><th>GATEWAY REFERENCES</th><th>ORDER STATUS</th><th>CREATED / PAID</th></tr></thead><tbody>
    {payments.map((payment) => <tr key={payment._id}>
      <td><strong className="customer-name">{payment.orderNumber}</strong><small className="customer-email">{payment.customer?.name || '—'} · {payment.customer?.email || '—'}</small><small className="payment-address">{payment.customer?.address || 'No shipping address recorded'}</small></td>
      <td className="payment-items">{(payment.items || []).map((item, index) => <span key={`${item.name}-${index}`}>{item.name} × {item.quantity}{item.size ? ` · ${item.size}` : ''}</span>)}</td>
      <td className="price-cell">{money(payment.total)} <small>{payment.currency || 'INR'}</small></td>
      <td>{payment.paymentProvider || '—'}<small className="payment-method">{payment.paymentMethod ? payment.paymentMethod.toUpperCase() : 'Method not recorded'}</small></td>
      <td><span className={`payment-status payment-${payment.paymentStatus}`}>{String(payment.paymentStatus || 'unknown').replaceAll('_', ' ')}</span></td>
      <td className="payment-refs"><span>Razorpay order: {payment.razorpayOrderId || '—'}</span><span>Payment: {payment.paymentId || 'Not captured'}</span></td>
      <td>{payment.orderStatus || '—'}</td>
      <td className="date-cell"><span>{payment.createdAt ? new Date(payment.createdAt).toLocaleString() : '—'}</span><small>{payment.paidAt ? `Paid ${new Date(payment.paidAt).toLocaleString()}` : 'Not paid'}</small></td>
    </tr>)}
  </tbody></table></div>;
}

function SalesChart({ data }) {
  if (!data.length) return <div className="empty-admin">Sales data will appear here when orders are placed.</div>;
  const max = Math.max(...data.map((point) => point.revenue), 1);
  const points = data.map((point, index) => `${(index / Math.max(data.length - 1, 1)) * 100},${100 - (point.revenue / max) * 82}`).join(' ');
  return <div className="sales-chart">
    <svg viewBox="0 0 100 110" preserveAspectRatio="none" role="img" aria-label="Sales revenue trend">
      <line x1="0" x2="100" y1="18" y2="18" />
      <line x1="0" x2="100" y1="59" y2="59" />
      <line x1="0" x2="100" y1="100" y2="100" />
      <polyline points={points} />
      {data.map((point, index) => <circle key={point.key} cx={(index / Math.max(data.length - 1, 1)) * 100} cy={100 - (point.revenue / max) * 82} r="1.25"><title>{`${point.label}: ${money(point.revenue)} (${point.orders} orders)`}</title></circle>)}
    </svg>
    <div className="chart-labels"><span>{data[0].label}</span><span>{data[Math.floor(data.length / 2)].label}</span><span>{data[data.length - 1].label}</span></div>
  </div>;
}

function OrderTable({ orders, onStatus, expanded = false }) {
  if (!orders.length) return <div className="empty-admin">No orders yet. New orders will appear here.</div>;
  return <div className="table-scroll"><table className="admin-table order-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th>{expanded && <th>ITEMS</th>}<th>TOTAL</th><th>PAYMENT</th><th>STATUS</th><th>PLACED</th></tr></thead><tbody>
    {orders.map((order) => <tr key={order._id}><td className="order-id">{order.orderNumber}</td><td><strong className="customer-name">{order.customer?.name || 'Customer'}</strong><small className="customer-email">{order.customer?.email}</small></td>{expanded && <td>{order.items?.reduce((total, item) => total + item.quantity, 0) || 0} items</td>}<td className="price-cell">{money(order.total)}</td><td>{order.paymentStatus === 'paid' ? `Paid${order.paymentProvider ? ` · ${order.paymentProvider}` : ''}` : 'Unpaid'}</td><td><select className={`status-select status-${order.status}`} value={order.status} onChange={(event) => onStatus(order._id, event.target.value)} aria-label={`Status for ${order.orderNumber}`}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></td><td className="date-cell">{order.createdAt ? new Date(order.createdAt).toLocaleDateString() : '—'}</td></tr>)}
  </tbody></table></div>;
}

export default Admin;