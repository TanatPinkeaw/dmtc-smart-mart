# 🎁 Expiry Discount Feature — Add to Sprint 2

> Deadline-based auto-discount + staff override + block expired sales

---

## 📌 Requirement

**Auto-discount products 1 day before expiry** (40% off)  
**Block sales if expired**  
**Alert cashier when product expires**  
**Staff can override discount price**

---

## 🎯 Database Changes

### `ALTER TABLE products`

```sql
ALTER TABLE products ADD COLUMN (
  expiry_date DATE DEFAULT NULL,
  discount_percent INT DEFAULT 40,
  is_expired BOOLEAN GENERATED ALWAYS AS (expiry_date IS NOT NULL AND expiry_date < CURDATE()) STORED
);
```

**Why `GENERATED ALWAYS`**: Auto-compute expired status, no need for cron.

---

## 🧮 Backend Implementation

### 1. Expiry Status Helper (server.js ~line 600)

```javascript
function getProductExpiry(product) {
  if (!product.expiry_date) return { status: 'no_expiry' };
  
  const today = new Date();
  const expiry = new Date(product.expiry_date);
  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft === 0) return { status: 'expires_today', daysLeft: 0 };
  if (daysLeft === 1) return { status: 'near_expiry', daysLeft: 1, applyDiscount: true };
  return { status: 'ok', daysLeft };
}
```

### 2. Update `GET /api/products`

```javascript
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, price, stock, category_id, expiry_date, discount_percent,
             CASE 
               WHEN expiry_date IS NULL THEN 'no_expiry'
               WHEN expiry_date < CURDATE() THEN 'expired'
               WHEN expiry_date = CURDATE() THEN 'expires_today'
               WHEN DATEDIFF(expiry_date, CURDATE()) = 1 THEN 'near_expiry'
               ELSE 'ok'
             END as expiry_status
      FROM products
      WHERE is_active = 1
      ORDER BY name
    `);
    
    // Enrich with discount info
    const products = rows.map(p => {
      const expiry = getProductExpiry(p);
      const discount = expiry.applyDiscount ? Math.round(p.price * p.discount_percent / 100) : 0;
      return {
        ...p,
        expiry_status: expiry.status,
        days_left: expiry.daysLeft,
        discount_amount: discount,
        price_after_discount: p.price - discount
      };
    });
    
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});
```

### 3. Update Checkout Validation (POST /api/sales/checkout ~line 1850)

```javascript
// BEFORE checkout calculation:
// Check: no expired products in cart
const expiredItems = payload.items.filter(item => {
  const product = cartProducts.find(p => p.id === item.product_id);
  return product && product.expiry_status === 'expired';
});

if (expiredItems.length > 0) {
  return res.status(400).json({ 
    error: `Cannot sell expired products: ${expiredItems.map(i => i.product_name).join(', ')}` 
  });
}

// DURING price calculation:
// Apply auto-discount if near_expiry
const itemTotal = items.reduce((sum, item) => {
  const product = cartProducts.find(p => p.id === item.product_id);
  let itemPrice = product.price * item.quantity;
  
  if (product.expiry_status === 'near_expiry') {
    const discountAmount = Math.round(itemPrice * product.discount_percent / 100);
    itemPrice -= discountAmount;
    // Log discount reason
    console.log(`[CHECKOUT] Auto 40% discount applied to ${product.name}`);
  }
  
  return sum + itemPrice;
}, 0);
```

### 4. Socket.io Alert (When product expires)

```javascript
// Add cron job to check expired products every hour (or at 6am)
const cron = require('node-cron');

cron.schedule('0 * * * *', async () => {
  // Find products that just expired (expiry_date = yesterday)
  const [expiredToday] = await db.query(`
    SELECT id, name FROM products
    WHERE expiry_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    AND is_active = 1
  `);
  
  if (expiredToday.length > 0) {
    // Notify all connected cashiers
    io.emit('products_expired', {
      count: expiredToday.length,
      products: expiredToday.map(p => p.name),
      timestamp: new Date()
    });
  }
});
```

### 5. Product Management Routes (ADMIN can set expiry)

```javascript
app.put('/api/products/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { name, price, expiry_date, discount_percent, ...rest } = req.body;
  
  try {
    // Validate expiry_date if provided
    if (expiry_date && new Date(expiry_date) < new Date()) {
      return res.status(400).json({ error: 'Expiry date cannot be in the past' });
    }
    
    const sql = `UPDATE products SET name=?, price=?, expiry_date=?, discount_percent=? WHERE id=?`;
    await db.query(sql, [name, price, expiry_date || null, discount_percent || 40, id]);
    
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});
```

---

## 🎨 Frontend Implementation

### 1. POS.tsx — Show Expiry Status & Allow Override

```typescript
// When loading products
const [products, setProducts] = useState([]);
const [priceOverride, setPriceOverride] = useState<{[key: number]: number}>({});

useEffect(() => {
  const loadProducts = async () => {
    const res = await api.get('/api/products');
    setProducts(res.data);
  };
  loadProducts();
}, []);

// In product display / add-to-cart
const renderProductCard = (product) => {
  const showDiscount = product.expiry_status === 'near_expiry';
  const overridePrice = priceOverride[product.id];
  const finalPrice = overridePrice ?? (showDiscount ? product.price_after_discount : product.price);
  
  return (
    <div className={`product-card ${showDiscount ? 'border-yellow-400 bg-yellow-50' : ''} ${product.expiry_status === 'expired' ? 'opacity-50 pointer-events-none' : ''}`}>
      <h3>{product.name}</h3>
      
      {/* Expiry Badge */}
      {showDiscount && (
        <div className="bg-yellow-200 text-yellow-800 px-2 py-1 rounded text-xs font-bold">
          🎁 Expires in 1 day - 40% OFF
        </div>
      )}
      
      {product.expiry_status === 'expired' && (
        <div className="bg-red-200 text-red-800 px-2 py-1 rounded text-xs font-bold">
          ❌ EXPIRED - Can't sell
        </div>
      )}
      
      {product.expiry_status === 'expires_today' && (
        <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs">
          ⚠️ Expires today
        </div>
      )}
      
      {/* Price Display */}
      <div>
        {showDiscount && (
          <>
            <s className="text-gray-400">฿{product.price.toFixed(2)}</s>
            <span className="text-red-600 font-bold ml-2">฿{finalPrice.toFixed(2)}</span>
          </>
        )}
        {!showDiscount && <span className="text-lg font-bold">฿{product.price.toFixed(2)}</span>}
      </div>
      
      {/* Staff Override Price */}
      {showDiscount && (
        <div className="mt-2">
          <label className="text-xs text-gray-600">Override price (฿):</label>
          <input 
            type="number" 
            value={overridePrice ?? ''} 
            onChange={(e) => setPriceOverride({...priceOverride, [product.id]: parseFloat(e.target.value)})}
            className="w-full px-2 py-1 border rounded text-sm"
            placeholder={product.price_after_discount.toFixed(2)}
          />
        </div>
      )}
      
      {/* Add Button (disabled if expired) */}
      <button 
        onClick={() => addToCart(product, finalPrice)}
        disabled={product.expiry_status === 'expired'}
        className={product.expiry_status === 'expired' ? 'bg-gray-300' : 'bg-blue-600 text-white'}
      >
        {product.expiry_status === 'expired' ? 'ไม่สามารถขายได้' : 'เพิ่มลงตะกร้า'}
      </button>
    </div>
  );
};
```

### 2. Socket.io Listener (POS.tsx)

```typescript
useEffect(() => {
  const socket = useSocket();
  
  socket.on('products_expired', (data) => {
    Swal.fire({
      icon: 'warning',
      title: 'สินค้าหมดอายุ',
      html: `
        <p>สินค้าต่อไปนี้หมดอายุแล้ว:</p>
        <ul>${data.products.map(p => `<li>${p}</li>`).join('')}</ul>
        <p>สินค้าเหล่านี้ถูกลบออกจากการขายแล้ว</p>
      `,
      confirmButtonText: 'เข้าใจแล้ว'
    });
    
    // Reload products to refresh expiry status
    loadProducts();
  });
  
  return () => socket.off('products_expired');
}, []);
```

### 3. Inventory Management (Settings.tsx)

```typescript
// In product edit form
<div className="mb-4">
  <label className="block text-sm font-medium">วันหมดอายุ (ถ้ามี):</label>
  <input 
    type="date" 
    value={editProduct.expiry_date || ''} 
    onChange={(e) => setEditProduct({...editProduct, expiry_date: e.target.value})}
    className="w-full px-3 py-2 border rounded"
  />
</div>

<div className="mb-4">
  <label className="block text-sm font-medium">ลดราคา % (ใกล้หมดอายุ):</label>
  <input 
    type="number" 
    min="0" 
    max="100" 
    value={editProduct.discount_percent || 40} 
    onChange={(e) => setEditProduct({...editProduct, discount_percent: parseInt(e.target.value)})}
    className="w-full px-3 py-2 border rounded"
    placeholder="40"
  />
</div>
```

---

## ✅ Acceptance Criteria

- [ ] `ALTER TABLE products` (expiry_date, discount_percent) added
- [ ] GET /api/products returns expiry_status + discount info
- [ ] POST /api/sales/checkout blocks expired products
- [ ] POST /api/sales/checkout auto-applies 40% discount for near-expiry
- [ ] Cron job emits products_expired event hourly
- [ ] POS.tsx shows expiry badges + override price input
- [ ] Expired products disabled in POS (can't add to cart)
- [ ] Socket.io alert displayed when products expire
- [ ] Settings.tsx allows ADMIN to set expiry_date + discount_percent
- [ ] tsc + node --check clean

---

## 🎬 Send to CLD

```
CLD, Expiry Discount Feature (add to Sprint 2).

Implement complete: database → backend → frontend

Database:
- ALTER TABLE products: add expiry_date, discount_percent, is_expired (generated)

Backend:
1. Helper: getProductExpiry(product) → status + daysLeft
2. GET /api/products: return expiry_status, discount_amount, price_after_discount
3. POST /api/sales/checkout: 
   - Block if expired
   - Auto-apply 40% discount if near_expiry
4. Cron job: check expired products hourly, emit Socket.io alert
5. PUT /api/products/:id: allow ADMIN to set expiry_date + discount_percent

Frontend (POS.tsx):
1. Show expiry badges (near-expiry yellow, expired red)
2. Staff override price input (if near-expiry)
3. Disable add-to-cart if expired
4. Socket.io listener: "products_expired" alert + reload

Frontend (Settings.tsx):
- Add expiry_date + discount_percent fields to product edit form

Acceptance: All criteria above + tsc/node --check clean

Go. 🚀
```

---

## 📝 Notes

- **Expiry calculation**: Uses GENERATED ALWAYS column for auto-expired status (no code needed)
- **Discount applies on checkout**: Backend calculates, not pre-stored in DB (flexible for override)
- **Socket alert**: Hourly check, or can be event-triggered on admin expire-product action
- **Staff override**: Frontend only (UI), backend uses overridden price from checkout payload

---

## 🎯 Payroll System (Backlog)

```
For later (after go-live):
- Payroll calculation engine
- Hourly rate settings (configurable per role)
- Bonus/penalty tracking (no absent +10%, late >2hr -100 baht)
- Monthly payroll report generation + email
- Payment records + history

Plan: Estimated 2-3 days Sprint in Month 2
```
