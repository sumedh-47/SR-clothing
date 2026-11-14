import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultSiteContent } from './siteDefaults.js';
import { apiUrl, mediaUrl } from './api.js';
import { sampleProducts } from '../../server/data/products.js';

const defaultCategories = ['T-Shirts', 'Shirts', 'Hoodies', 'Jackets'];
const isStaticPreview = import.meta.env.VITE_STATIC_PREVIEW === 'true';
const isCommerceEnabled = !isStaticPreview && (import.meta.env.VITE_COMMERCE_ENABLED === 'true'
  || (!import.meta.env.PROD && import.meta.env.VITE_COMMERCE_ENABLED === undefined));
const isAdminOnlyMode = !isStaticPreview && !isCommerceEnabled;
const formatPrice = (price) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(price) || 0);
const hasAvailableStock = (product) => product.isAvailable !== false
  && product.available !== false
  && (product.variants?.length ? product.variants.some((variant) => variant.stock > 0) : product.stock !== 0);

function loadStoredArray(key, isValidItem) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(stored) ? stored.filter(isValidItem) : [];
  } catch (error) {
    console.error(`Could not restore ${key} from local storage.`, error);
    return [];
  }
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your internet connection and try again.'));
    document.body.appendChild(script);
  });
}

function Icon({ name, size = 20, fill = 'none' }) {
  const paths = {
    bag: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    arrow: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    minus: <path d="M5 12h14" />,
    user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef(null);
  const [products, setProducts] = useState(() => {
    if (isStaticPreview) {
      try {
        const stored = JSON.parse(localStorage.getItem('fasion-admin-products') || 'null');
        if (Array.isArray(stored) && stored.length > 0) return stored;
      } catch {}
      return sampleProducts;
    }
    return [];
  });
  const [categories, setCategories] = useState(() => {
    if (isStaticPreview) {
      try {
        const storedCats = JSON.parse(localStorage.getItem('fasion-admin-categories') || 'null');
        if (Array.isArray(storedCats) && storedCats.length > 0) return storedCats.map((c) => c.name || c);
      } catch {}
      return [...new Set(sampleProducts.map((product) => product.category))];
    }
    return defaultCategories;
  });
  const [siteContent, setSiteContent] = useState(() => {
    if (isStaticPreview) {
      try {
        const stored = JSON.parse(localStorage.getItem('fasion-admin-site-content') || 'null');
        if (stored) return { ...defaultSiteContent, ...stored };
      } catch {}
    }
    return defaultSiteContent;
  });
  const [category, setCategory] = useState('All pieces');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('featured');
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedProductIds, setSavedProductIds] = useState(() => loadStoredArray('fasion-saved-products', (id) => typeof id === 'string'));
  const [cart, setCart] = useState(() => loadStoredArray('fasion-cart', (item) => item
    && typeof item === 'object'
    && typeof item._id === 'string'
    && Number.isInteger(item.quantity)
    && item.quantity > 0
    && Number.isFinite(Number(item.price))));
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantSku, setSelectedVariantSku] = useState('');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const [notice, setNotice] = useState('');
  const [orderReceipt, setOrderReceipt] = useState(null);
  const [loading, setLoading] = useState(!isStaticPreview);
  const [apiError, setApiError] = useState('');

  // Client Authentication State
  const [customer, setCustomer] = useState(() => {
    if (!isCommerceEnabled) return null;
    try {
      return JSON.parse(localStorage.getItem('fasion-customer'));
    } catch {
      return null;
    }
  });
  const [customerToken, setCustomerToken] = useState(() => isCommerceEnabled ? localStorage.getItem('fasion-customer-token') || '' : '');
  const [authMode, setAuthMode] = useState('guest'); // 'guest', 'login', 'register', 'account'
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [paymentLoading, setPaymentLoading] = useState(false);

  useEffect(() => {
    if (isStaticPreview) {
      setLoading(false);
      return;
    }
    fetch(apiUrl('/api/products'))
      .then((response) => {
        if (!response.ok) throw new Error('The shop could not load right now.');
        return response.json();
      })
      .then(setProducts)
      .catch((error) => setApiError(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isStaticPreview) return;
    fetch(apiUrl('/api/site-content'))
      .then((response) => {
        if (!response.ok) throw new Error('Store content could not load right now.');
        return response.json();
      })
      .then((content) => setSiteContent({ ...defaultSiteContent, ...content }))
      .catch((error) => setApiError((current) => current || error.message));
  }, []);

  useEffect(() => {
    if (isStaticPreview) return;
    fetch(apiUrl('/api/categories'))
      .then((response) => {
        if (!response.ok) throw new Error('Product categories could not load right now.');
        return response.json();
      })
      .then((result) => setCategories(result.map((item) => item.name)))
      .catch((error) => setApiError((current) => current || error.message));
  }, []);

  useEffect(() => {
    localStorage.setItem('fasion-cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('fasion-saved-products', JSON.stringify(savedProductIds));
  }, [savedProductIds]);

  // Sync / Verify Customer Session on mount
  useEffect(() => {
    if (isCommerceEnabled && customerToken) {
      fetch(apiUrl('/api/customer/me'), {
        headers: { Authorization: `Bearer ${customerToken}` },
      })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          setCustomer(data.customer);
          localStorage.setItem('fasion-customer', JSON.stringify(data.customer));
        })
        .catch(() => {
          setCustomer(null);
          setCustomerToken('');
          localStorage.removeItem('fasion-customer');
          localStorage.removeItem('fasion-customer-token');
        });
    }
  }, [customerToken]);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const categoryMatches = category === 'All pieces' || product.category === category;
    const searchMatches = `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query.toLowerCase());
    const savedMatches = !savedOnly || savedProductIds.includes(String(product._id));
    return categoryMatches && searchMatches && savedMatches;
  }).sort((a, b) => {
    if (sortOrder === 'price-low') return Number(a.price) - Number(b.price);
    if (sortOrder === 'price-high') return Number(b.price) - Number(a.price);
    if (sortOrder === 'name') return a.name.localeCompare(b.name);
    if (sortOrder === 'newest') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    return 0;
  }), [category, products, query, savedOnly, savedProductIds, sortOrder]);

  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const activeProductVariant = selectedProduct?.variants?.find((variant) => variant.sku === selectedVariantSku);
  const selectedProductUnavailable = selectedProduct && (!hasAvailableStock(selectedProduct)
    || (selectedProduct.variants?.length ? !activeProductVariant || activeProductVariant.stock === 0 : false));
  const categoryLabel = (name) => {
    const labels = { 'T-Shirts': siteContent.tshirtsLabel, Shirts: siteContent.shirtsLabel, Hoodies: siteContent.hoodiesLabel, Jackets: siteContent.jacketsLabel };
    return labels[name] || name;
  };

  function handleLogoTap() {
    logoTapCount.current += 1;
    window.clearTimeout(logoTapTimer.current);
    if (logoTapCount.current === 5) {
      window.location.hash = 'admin';
      return;
    }
    logoTapTimer.current = window.setTimeout(() => {
      logoTapCount.current = 0;
    }, 2500);
  }

  function addToCart(product, variant) {
    if (!hasAvailableStock(product) || (variant && variant.stock === 0)) {
      setNotice(`${product.name} is currently out of stock.`);
      window.setTimeout(() => setNotice(''), 2400);
      return;
    }
    if (product.variants?.length && !variant) {
      setNotice('Choose a size and colour before adding this piece.');
      window.setTimeout(() => setNotice(''), 2400);
      return;
    }
    const variantSku = variant?.sku || '';
    const existing = cart.find((item) => item._id === product._id && (item.variantSku || '') === variantSku);
    const stockLimit = variant ? variant.stock : product.stock;
    if (stockLimit != null && existing?.quantity >= stockLimit) {
      setNotice(`Only ${stockLimit} available for ${product.name}${variant ? ` (${variant.size} / ${variant.color})` : ''}.`);
      window.setTimeout(() => setNotice(''), 2400);
      return;
    }
    setCart((items) => {
      const existingItem = items.find((item) => item._id === product._id && (item.variantSku || '') === variantSku);
      if (existingItem) return items.map((item) => item._id === product._id && (item.variantSku || '') === variantSku ? { ...item, quantity: item.quantity + 1 } : item);
      return [...items, { ...product, variantSku, variantSize: variant?.size || '', variantColor: variant?.color || '', quantity: 1 }];
    });
    setNotice(`${product.name} added to your bag`);
    window.setTimeout(() => setNotice(''), 2400);
  }

  function changeQuantity(id, variantSku, amount) {
    const item = cart.find((entry) => entry._id === id && (entry.variantSku || '') === variantSku);
    if (item && amount > 0) {
      const variant = variantSku ? item.variants?.find((entry) => entry.sku === variantSku) : null;
      const stockLimit = variant ? variant.stock : item.stock;
      if (item.isAvailable === false || (stockLimit != null && item.quantity >= stockLimit)) {
        setNotice(stockLimit === 0 ? `${item.name} is currently out of stock.` : `Only ${stockLimit} available for ${item.name}.`);
        window.setTimeout(() => setNotice(''), 2400);
        return;
      }
    }
    setCart((items) => items.map((item) => item._id === id && (item.variantSku || '') === variantSku ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0));
  }

  function openProduct(product) {
    setSelectedImageIndex(0);
    setSelectedProduct(product);
    setSelectedVariantSku(product.variants?.find((variant) => variant.stock > 0)?.sku || '');
  }

  function toggleSavedProduct(product) {
    const productId = String(product._id);
    const isSaved = savedProductIds.includes(productId);
    setSavedProductIds((ids) => isSaved ? ids.filter((id) => id !== productId) : [...ids, productId]);
    setNotice(isSaved ? `${product.name} removed from saved pieces` : `${product.name} saved for later`);
    window.setTimeout(() => setNotice(''), 2400);
  }

  async function handleCustomerLogin(event) {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(apiUrl('/api/customer/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not sign in.');
      setCustomer(data.customer);
      setCustomerToken(data.token);
      localStorage.setItem('fasion-customer', JSON.stringify(data.customer));
      localStorage.setItem('fasion-customer-token', data.token);
      setNotice(`Welcome back, ${data.customer.name}!`);
      window.setTimeout(() => setNotice(''), 3000);
      setAuthMode('guest');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCustomerRegister(event) {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(apiUrl('/api/customer/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          address: form.get('address') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create account.');
      setCustomer(data.customer);
      setCustomerToken(data.token);
      localStorage.setItem('fasion-customer', JSON.stringify(data.customer));
      localStorage.setItem('fasion-customer-token', data.token);
      setNotice(`Account created! Welcome, ${data.customer.name}.`);
      window.setTimeout(() => setNotice(''), 3000);
      setAuthMode('guest');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleCustomerLogout() {
    setCustomer(null);
    setCustomerToken('');
    setCustomerOrders([]);
    localStorage.removeItem('fasion-customer');
    localStorage.removeItem('fasion-customer-token');
    setNotice('You have signed out.');
    window.setTimeout(() => setNotice(''), 3000);
    setAuthMode('guest');
  }

  function fetchCustomerOrders() {
    if (!customerToken) return;
    fetch(apiUrl('/api/customer/orders'), {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setCustomerOrders)
      .catch(() => setCustomerOrders([]));
  }

  async function placeOrder(event) {
    event.preventDefault();
    if (!isCommerceEnabled) {
      setNotice(isStaticPreview ? 'Checkout is unavailable in this static preview.' : 'Customer checkout is disabled on this site.');
      window.setTimeout(() => setNotice(''), 4000);
      return;
    }
    if (paymentLoading) return;
    const form = new FormData(event.currentTarget);
    setPaymentLoading(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (customerToken) {
        headers['Authorization'] = `Bearer ${customerToken}`;
      }
      const response = await fetch(apiUrl('/api/payments/razorpay/order'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customer: { name: form.get('name'), email: form.get('email'), address: form.get('address') },
          items: cart.map(({ _id, quantity, variantSku }) => ({ product: _id, quantity, ...(variantSku ? { variantSku } : {}) })),
        }),
      });
      const paymentOrder = await response.json();
      if (!response.ok) throw new Error(paymentOrder.message || 'We could not start your payment.');
      await loadRazorpayCheckout();
      const checkoutWindow = new window.Razorpay({
        key: paymentOrder.keyId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        name: siteContent.brandName,
        description: `Order ${paymentOrder.orderNumber}`,
        order_id: paymentOrder.orderId,
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay by UPI',
                instruments: [{ method: 'upi' }],
              },
              other: {
                name: 'Other payment methods',
                instruments: [
                  { method: 'card' },
                  { method: 'netbanking' },
                  { method: 'wallet' },
                ],
              },
            },
            sequence: ['block.upi', 'block.other'],
            preferences: { show_default_blocks: false },
          },
        },
        prefill: {
          name: paymentOrder.customer.name,
          email: paymentOrder.customer.email,
        },
        theme: { color: '#252923' },
        modal: { ondismiss: () => setPaymentLoading(false) },
        handler: async (paymentResult) => {
          try {
            const verifyResponse = await fetch(apiUrl('/api/payments/razorpay/verify'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(paymentResult),
            });
            const order = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(order.message || 'Payment was received but order confirmation is pending. Refresh your order history.');
            setCart([]);
            setCheckout(false);
            setCartOpen(false);
            setOrderReceipt(order);
            const productsResponse = await fetch(apiUrl('/api/products'));
            if (productsResponse.ok) setProducts(await productsResponse.json());
            setNotice(`Order ${order.orderNumber} paid and placed. Thank you!`);
            window.setTimeout(() => setNotice(''), 4000);
            if (customerToken) fetchCustomerOrders();
          } catch (error) {
            setNotice(error.message);
            window.setTimeout(() => setNotice(''), 6000);
          } finally {
            setPaymentLoading(false);
          }
        },
      });
      checkoutWindow.on('payment.failed', (failure) => {
        setNotice(failure.error?.description || 'Payment was not completed. Your bag is still saved.');
        window.setTimeout(() => setNotice(''), 5000);
        setPaymentLoading(false);
      });
      checkoutWindow.open();
    } catch (error) {
      setNotice(error.message);
      window.setTimeout(() => setNotice(''), 4000);
      setPaymentLoading(false);
    }
  }

  return (
    <>
      {isStaticPreview && <div className="preview-banner" role="status">Static preview · Browse pieces or open <a href="#admin" style={{ color: 'inherit', fontWeight: 'bold', textDecoration: 'underline' }}>Studio Admin</a>.</div>}
      {isAdminOnlyMode && <div className="preview-banner" role="status">Customer accounts and checkout are disabled on this site.</div>}
      <div className="announcement">{siteContent.announcement}</div>
      <header className="site-header">
        <button className="wordmark" type="button" onClick={handleLogoTap} aria-label="Tap the logo five times to open Admin sign-in">{siteContent.brandName}<span>®</span></button>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#collection" onClick={() => setCategory('All pieces')}>Shop all</a>
          {categories.map((name) => <a key={name} href="#collection" onClick={() => setCategory(name)}>{categoryLabel(name)}</a>)}
          <a href="#story">{siteContent.storyNavLabel}</a>
        </nav>
        <div className="header-actions">
          <label className="search-control" aria-label="Search pieces">
            <Icon name="search" size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
          </label>
          {isCommerceEnabled && <button
            className="account-button"
            type="button"
            onClick={() => {
              setCartOpen(true);
              if (customer) {
                setAuthMode('account');
                fetchCustomerOrders();
              } else {
                setAuthMode('login');
              }
              setCheckout(false);
            }}
            aria-label="Client account"
          >
            <Icon name="user" size={18} />
            <span className="account-label">{customer ? customer.name.split(' ')[0] : 'Sign in'}</span>
          </button>}
          <button className="bag-button" onClick={() => { setCartOpen(true); setCheckout(false); setAuthMode('guest'); }} aria-label={`Open bag, ${itemCount} items`}>
            <Icon name="bag" size={20} /><span className="bag-label">Bag</span><span className="bag-count">{itemCount}</span>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{siteContent.heroEyebrow}</p>
            <h1>{siteContent.heroTitle.split('\n')[0]}<br /><em>{siteContent.heroTitle.split('\n').slice(1).join(' ')}</em></h1>
            <p className="hero-description">{siteContent.heroDescription}</p>
            <a className="text-link" href="#collection">{siteContent.heroButton} <Icon name="arrow" size={18} /></a>
            <span className="hero-index">{siteContent.heroIndex}</span>
          </div>
          <div className="hero-image" role="img" aria-label={siteContent.heroImageAlt} style={{ backgroundImage: `url("${mediaUrl(siteContent.heroImage)}")` }}>
            <div className="image-note"><span>{siteContent.heroNoteOne}</span><span>{siteContent.heroNoteTwo}</span></div>
            <div className="hero-caption">{siteContent.heroCaption} <span>↗</span></div>
          </div>
          <div className="hero-side-note">{siteContent.heroSideNote}</div>
        </section>

        <section className="collection section-wrap" id="collection">
          <div className="section-heading">
            <div><p className="eyebrow">{siteContent.collectionEyebrow}</p><h2>{siteContent.collectionTitle}<span>.</span></h2></div>
            <p className="collection-note">{siteContent.collectionDescription}</p>
          </div>
          <div className="catalog-toolbar">
            <div className="category-tabs" role="tablist" aria-label="Filter by category">
              {['All pieces', ...categories].map((option) => <button key={option} className={category === option ? 'active' : ''} onClick={() => setCategory(option)} role="tab" aria-selected={category === option}>{option === 'All pieces' ? option : categoryLabel(option)}</button>)}
            </div>
            <div className="catalog-options">
              <button className={`saved-filter ${savedOnly ? 'active' : ''}`} type="button" onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}>
                <Icon name="heart" size={14} fill={savedOnly ? 'currentColor' : 'none'} /> Saved <span>{savedProductIds.length}</span>
              </button>
              <label className="sort-control">Sort
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort products">
                  <option value="featured">Featured</option>
                  <option value="newest">Newest</option>
                  <option value="price-low">Price: low to high</option>
                  <option value="price-high">Price: high to low</option>
                  <option value="name">Name: A to Z</option>
                </select>
              </label>
              <span className="result-count">{visibleProducts.length} pieces</span>
            </div>
          </div>
          {loading ? <div className="catalog-message">Gathering the good things…</div> : apiError ? <div className="catalog-message error-message">{apiError}<br /><small>Start the API with <code>npm run dev</code>.</small></div> : visibleProducts.length ? (
            <div className="product-grid">
              {visibleProducts.map((product, index) => <article className="product-card" key={product._id} style={{ '--delay': `${index * 65}ms` }}>
                <div className="product-image-wrap">
                  <button className="product-image-button" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}>
                    <img src={mediaUrl(product.image)} alt={product.name} loading={index > 3 ? 'lazy' : 'eager'} />
                    {product.badge && <span className="product-badge">{product.badge}</span>}
                    <span className={`quick-add ${!hasAvailableStock(product) ? 'is-unavailable' : ''}`} onClick={(event) => { event.stopPropagation(); if (product.variants?.length) openProduct(product); else addToCart(product); }}>{!hasAvailableStock(product) ? 'Out of stock' : product.variants?.length ? 'Choose options' : 'Add to bag'}{hasAvailableStock(product) && <Icon name="plus" size={16} />}</span>
                  </button>
                  <button className={`wishlist-button ${savedProductIds.includes(String(product._id)) ? 'is-saved' : ''}`} type="button" onClick={() => toggleSavedProduct(product)} aria-label={`${savedProductIds.includes(String(product._id)) ? 'Remove' : 'Save'} ${product.name} ${savedProductIds.includes(String(product._id)) ? 'from' : 'to'} saved pieces`} aria-pressed={savedProductIds.includes(String(product._id))}>
                    <Icon name="heart" size={17} fill={savedProductIds.includes(String(product._id)) ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="product-meta"><div><h3>{product.name}</h3><span>{product.color}</span><span className={`product-stock ${hasAvailableStock(product) ? 'is-available' : 'is-unavailable'}`}>{hasAvailableStock(product) ? 'In stock' : 'Out of stock'}</span></div><strong>{formatPrice(product.price)}</strong></div>
              </article>)}
            </div>
          ) : <div className="catalog-message">{savedOnly && !savedProductIds.length ? 'Save pieces you love and they’ll show up here.' : savedOnly ? 'No saved pieces match these filters.' : 'No pieces found. Try another search.'}</div>}
        </section>

        <section className="story" id="story">
          <div className="story-image" role="img" aria-label="Natural textures and details from the collection" style={{ backgroundImage: `url("${mediaUrl(siteContent.storyImage)}")` }} />
          <div className="story-copy"><p className="eyebrow">{siteContent.storyEyebrow}</p><h2>{siteContent.storyTitle.split('\n')[0]}<br /><em>{siteContent.storyTitle.split('\n').slice(1).join(' ')}</em></h2><p>{siteContent.storyDescription}</p><a className="text-link" href="#collection">{siteContent.storyButton} <Icon name="arrow" size={18} /></a></div>
          <div className="story-mark">{siteContent.storyMark}</div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="#top">{siteContent.brandName}<span>®</span></a>
        <span>{siteContent.footerTagline}</span>
        <span>{siteContent.footerCopyright} · <a href="#admin" style={{ color: 'inherit', textDecoration: 'none', opacity: 0.8 }}>Studio</a></span>
      </footer>

      {cartOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside className="drawer" aria-label="Shopping bag">
          <div className="drawer-head">
            <div>
              <p className="eyebrow">
                {authMode === 'account' ? 'Client Studio' : authMode === 'login' ? 'Client Sign In' : authMode === 'register' ? 'Join FASION' : checkout ? 'Complete Order' : 'Your Good Things'}
              </p>
              <h2>
                {authMode === 'account' ? (customer ? `Hello, ${customer.name.split(' ')[0]}.` : 'Account') :
                 authMode === 'login' ? 'Welcome back.' :
                 authMode === 'register' ? 'Create account.' :
                 checkout ? 'Almost yours.' :
                 `Your bag (${itemCount})`}
              </h2>
            </div>
            <button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close drawer"><Icon name="close" /></button>
          </div>

          {/* VIEW 1: Customer Profile & Order History */}
          {authMode === 'account' && customer ? (
            <div className="account-view">
              <div className="account-card">
                <div className="account-avatar">{customer.name.charAt(0).toUpperCase()}</div>
                <div>
                  <strong>{customer.name}</strong>
                  <span>{customer.email}</span>
                  {customer.address && <p>{customer.address}</p>}
                </div>
              </div>

              <div className="account-orders-section">
                <div className="account-section-head">
                  <h3>Your order history</h3>
                  <button className="text-button" type="button" onClick={fetchCustomerOrders}>Refresh</button>
                </div>
                {customerOrders.length ? (
                  <div className="account-orders-list">
                    {customerOrders.map((order) => (
                      <div className="account-order-item" key={order._id}>
                        <div className="order-item-head">
                          <strong>#{order.orderNumber}</strong>
                          <span className={`status-pill ${order.status}`}>{order.status}</span>
                        </div>
                        <small>{new Date(order.createdAt).toLocaleDateString()}</small>
                        <div className="order-item-details">
                          <span>{order.items?.length || 0} pieces</span>
                          <strong>{formatPrice(order.total)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-subtext">No past orders found for this account.</p>
                )}
              </div>

              <div className="account-footer-actions">
                <button className="secondary-button" type="button" onClick={() => setAuthMode('guest')}>Back to Shopping Bag</button>
                <button className="back-link signout-link" type="button" onClick={handleCustomerLogout}>Sign out of FASION</button>
              </div>
            </div>
          ) : authMode === 'login' ? (
            /* VIEW 2: Client Login */
            <form className="auth-form" onSubmit={handleCustomerLogin}>
              <p className="auth-intro">Sign in to sync your bag, view orders, and checkout with saved details.</p>
              {authError && <div className="auth-error-banner">{authError}</div>}
              <label>
                Email address
                <input name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
              </label>
              <button className="primary-button" type="submit" disabled={authLoading}>
                {authLoading ? 'Signing in…' : 'Sign in to account'} <Icon name="arrow" size={18} />
              </button>
              <div className="auth-switcher">
                <span>New to FASION?</span>
                <button type="button" className="text-button" onClick={() => { setAuthMode('register'); setAuthError(''); }}>Create an account</button>
              </div>
              <button className="back-link" type="button" onClick={() => setAuthMode('guest')}>
                {checkout ? 'Continue as guest checkout' : 'Back to shopping bag'}
              </button>
            </form>
          ) : authMode === 'register' ? (
            /* VIEW 3: Client Registration */
            <form className="auth-form" onSubmit={handleCustomerRegister}>
              <p className="auth-intro">Join FASION to save your shipping details, track deliveries, and speed up checkout.</p>
              {authError && <div className="auth-error-banner">{authError}</div>}
              <label>
                Full name
                <input name="name" autoComplete="name" required placeholder="Your full name" />
              </label>
              <label>
                Email address
                <input name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
              </label>
              <label>
                Password (min. 6 characters)
                <input name="password" type="password" minLength={6} autoComplete="new-password" required placeholder="••••••••" />
              </label>
              <label>
                Shipping address (optional)
                <textarea name="address" autoComplete="street-address" rows="2" placeholder="Street address, city, postal code" />
              </label>
              <button className="primary-button" type="submit" disabled={authLoading}>
                {authLoading ? 'Creating account…' : 'Create account & continue'} <Icon name="arrow" size={18} />
              </button>
              <div className="auth-switcher">
                <span>Already have an account?</span>
                <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setAuthError(''); }}>Sign in here</button>
              </div>
              <button className="back-link" type="button" onClick={() => setAuthMode('guest')}>
                {checkout ? 'Continue as guest checkout' : 'Back to shopping bag'}
              </button>
            </form>
          ) : checkout ? (
            /* VIEW 4: Checkout Form with Client Sign-In option & prefill */
            <form className="checkout-form" onSubmit={placeOrder}>
              {!isCommerceEnabled ? (
                <p className="preview-checkout-note">{isStaticPreview ? 'This is a static preview. Checkout and order placement are unavailable.' : 'Customer checkout is disabled on this site.'}</p>
              ) : (
                <>
                  {customer ? (
                    <div className="client-signed-badge">
                      <div className="client-badge-avatar">{customer.name.charAt(0).toUpperCase()}</div>
                      <div className="client-badge-info">
                        <small>ORDERING AS REGISTERED CLIENT</small>
                        <strong>{customer.name}</strong>
                        <span>{customer.email}</span>
                      </div>
                      <button type="button" className="text-button badge-signout" onClick={handleCustomerLogout}>Switch</button>
                    </div>
                  ) : (
                    <div className="cart-client-banner">
                      <div>
                        <strong>Already have a client account?</strong>
                        <span>Sign in to use your saved details.</span>
                      </div>
                      <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setAuthError(''); }}>Sign in</button>
                    </div>
                  )}

                  <p className="checkout-intro">Shipping &amp; Delivery Details</p>
                  <label>
                    Your name
                    <input name="name" key={`name-${customer?._id || 'guest'}`} defaultValue={customer?.name || ''} autoComplete="name" required />
                  </label>
                  <label>
                    Email address
                    <input name="email" key={`email-${customer?._id || 'guest'}`} type="email" defaultValue={customer?.email || ''} autoComplete="email" required />
                  </label>
                  <label>
                    Shipping address
                    <textarea name="address" key={`addr-${customer?._id || 'guest'}`} defaultValue={customer?.address || ''} autoComplete="street-address" rows="3" required placeholder="Street address, city, state, postal code" />
                  </label>
                  <div className="checkout-total"><span>Order total</span><strong>{formatPrice(subtotal)}</strong></div>
                  <button className="primary-button" type="submit" disabled={paymentLoading}>{paymentLoading ? 'Opening secure payment…' : `Pay ${formatPrice(subtotal)} securely`} <Icon name="arrow" size={18} /></button>
                </>
              )}
              <button className="back-link" type="button" onClick={() => setCheckout(false)}>Back to your bag</button>
            </form>
          ) : cart.length ? (
            /* VIEW 5: Bag Items */
            <>
              {isCommerceEnabled && (customer ? (
                <div className="cart-user-bar">
                  <span>Signed in as <strong>{customer.name}</strong></span>
                  <button type="button" className="text-button" onClick={() => { setAuthMode('account'); fetchCustomerOrders(); }}>My Account</button>
                </div>
              ) : (
                <div className="cart-user-bar">
                  <span>Client exclusive perks</span>
                  <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setAuthError(''); }}>Sign in / Register</button>
                </div>
              ))}
              <div className="cart-items">
                {cart.map((item) => (
                  <div className="cart-item" key={`${item._id}-${item.variantSku || 'base'}`}>
                    <img src={mediaUrl(item.image)} alt="" />
                    <div className="cart-item-info">
                      <h3>{item.name}</h3>
                      <span>{item.variantSize ? `${item.variantSize} · ${item.variantColor}` : item.color}</span>
                      <strong>{formatPrice(item.price)}</strong>
                      <div className="quantity-control">
                        <button onClick={() => changeQuantity(item._id, item.variantSku || '', -1)} aria-label={`Remove one ${item.name}`}><Icon name="minus" size={14} /></button>
                        <span>{item.quantity}</span>
                        <button onClick={() => changeQuantity(item._id, item.variantSku || '', 1)} aria-label={`Add one ${item.name}`}><Icon name="plus" size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="drawer-bottom">
                <div className="subtotal"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
                <p>{isStaticPreview ? 'Your bag is saved only in this browser. No orders can be placed.' : isAdminOnlyMode ? 'Customer checkout is disabled on this site.' : 'Complimentary shipping on all orders. Applicable taxes calculated at checkout.'}</p>
                {!isCommerceEnabled
                  ? <button className="primary-button" type="button" disabled>{isStaticPreview ? 'Checkout unavailable in preview' : 'Checkout currently unavailable'}</button>
                  : <button className="primary-button" onClick={() => setCheckout(true)}>Continue to checkout <Icon name="arrow" size={18} /></button>}
              </div>
            </>
          ) : (
            /* VIEW 6: Empty Bag */
            <div className="empty-bag">
              <span className="empty-mark"><Icon name="bag" size={28} /></span>
              <h3>Nothing in here just yet.</h3>
              <p>Your next favorite piece is waiting in our collection.</p>
              <button className="text-link" onClick={() => setCartOpen(false)}>Explore clothing <Icon name="arrow" size={18} /></button>
            </div>
          )}
        </aside>
      </div>}

      {selectedProduct && <div className="overlay product-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
        <section className="product-modal" aria-label={selectedProduct.name}>
          <button className="icon-button modal-close" onClick={() => setSelectedProduct(null)} aria-label="Close product"><Icon name="close" /></button>
          <div className="product-gallery">
            <img className="product-gallery-main" src={mediaUrl((selectedProduct.images?.length ? selectedProduct.images : [selectedProduct.image])[selectedImageIndex])} alt={selectedProduct.name} />
            {(selectedProduct.images?.length || 0) > 1 && <div className="product-gallery-thumbnails">
              {selectedProduct.images.map((image, index) => <button key={`${image}-${index}`} className={index === selectedImageIndex ? 'selected' : ''} onClick={() => setSelectedImageIndex(index)} aria-label={`View product photo ${index + 1}`}><img src={mediaUrl(image)} alt="" /></button>)}
            </div>}
          </div>
          <div className="modal-copy"><p className="eyebrow">{selectedProduct.category} · {activeProductVariant?.color || selectedProduct.color}</p><h2>{selectedProduct.name}</h2><strong>{formatPrice(selectedProduct.price)}</strong><span className={`modal-availability ${hasAvailableStock(selectedProduct) ? 'is-available' : 'is-unavailable'}`}>{hasAvailableStock(selectedProduct) ? 'In stock' : 'Out of stock'}</span><p>{selectedProduct.description}</p>
            {selectedProduct.variants?.length > 0 && <label className="variant-picker">Size / colour
              <select value={selectedVariantSku} onChange={(event) => setSelectedVariantSku(event.target.value)} required>
                <option value="">Choose an option</option>
                {selectedProduct.variants.map((variant) => <option key={variant.sku} value={variant.sku} disabled={variant.stock === 0}>{variant.size} · {variant.color}{variant.stock === 0 ? ' · Out of stock' : ` · ${variant.stock} available`}</option>)}
              </select>
            </label>}
            {activeProductVariant && activeProductVariant.stock > 0 && activeProductVariant.stock <= (selectedProduct.stockThreshold ?? 5) && <small className="stock-note">Only {activeProductVariant.stock} left in this option</small>}
            {!selectedProduct.variants?.length && selectedProduct.stock != null && selectedProduct.stock > 0 && selectedProduct.stock <= (selectedProduct.stockThreshold ?? 5) && <small className="stock-note">Only {selectedProduct.stock} left</small>}
            <button className="primary-button" disabled={selectedProductUnavailable} onClick={() => { addToCart(selectedProduct, activeProductVariant); setSelectedProduct(null); }}>{selectedProductUnavailable ? 'Out of stock' : 'Add to bag'}{!selectedProductUnavailable && <Icon name="plus" size={18} />}</button>
          </div>
        </section>
      </div>}

      {orderReceipt && <div className="overlay receipt-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderReceipt(null); }}>
        <section className="receipt-modal" aria-label="Order Receipt">
          <button className="icon-button modal-close" onClick={() => setOrderReceipt(null)} aria-label="Close receipt"><Icon name="close" /></button>
          <div className="receipt-content" id="printable-receipt">
            <div className="receipt-header">
              <div>
                <p className="eyebrow">ORDER CONFIRMED</p>
                <h2>Official Receipt &amp; Invoice</h2>
              </div>
              <div className="receipt-brand">
                <span className="wordmark">{siteContent.brandName}<span>®</span></span>
                <small className="receipt-tagline">{siteContent.footerTagline}</small>
              </div>
            </div>

            <div className="receipt-meta-grid">
              <div className="receipt-meta-card">
                <small>ORDER NUMBER</small>
                <strong>#{orderReceipt.orderNumber}</strong>
              </div>
              <div className="receipt-meta-card">
                <small>DATE &amp; TIME</small>
                <span>{new Date(orderReceipt.createdAt || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
              <div className="receipt-meta-card">
                <small>PAYMENT STATUS</small>
                <span className="receipt-status-badge">Paid &amp; Placed</span>
              </div>
              <div className="receipt-meta-card">
                <small>ESTIMATED DELIVERY</small>
                <span>3–5 Business Days</span>
              </div>
            </div>

            <div className="receipt-customer-card">
              <div className="receipt-customer-col">
                <small>SHIPPED &amp; BILLED TO</small>
                <strong>{orderReceipt.customer?.name}</strong>
                <span>{orderReceipt.customer?.email}</span>
                <p>{orderReceipt.customer?.address}</p>
              </div>
            </div>

            <div className="receipt-items-table">
              <table>
                <thead>
                  <tr>
                    <th>PIECE</th>
                    <th>QTY</th>
                    <th>UNIT PRICE</th>
                    <th>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {(orderReceipt.items || []).map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.quantity}</td>
                      <td>{formatPrice(item.unitPrice)}</td>
                      <td><strong>{formatPrice(item.unitPrice * item.quantity)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="receipt-summary">
              <div className="receipt-summary-row">
                <span>Subtotal</span>
                <span>{formatPrice(orderReceipt.total)}</span>
              </div>
              <div className="receipt-summary-row">
                <span>Standard Shipping</span>
                <span>Complimentary ($0.00)</span>
              </div>
              <div className="receipt-summary-row">
                <span>Sales Tax</span>
                <span>Included</span>
              </div>
              <div className="receipt-summary-total">
                <span>Total Paid</span>
                <strong>{formatPrice(orderReceipt.total)}</strong>
              </div>
            </div>

            <p className="receipt-footer-note">Thank you for shopping with {siteContent.brandName}. A confirmation has been sent to {orderReceipt.customer?.email}. For any inquiries, reference your order number #{orderReceipt.orderNumber}.</p>
          </div>

          <div className="receipt-actions">
            <button className="primary-button" type="button" onClick={() => window.print()}>Print / Save Invoice <Icon name="arrow" size={18} /></button>
            <button className="back-link" type="button" onClick={() => setOrderReceipt(null)}>Close &amp; Continue Shopping</button>
          </div>
        </section>
      </div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </>
  );
}

export default App;
