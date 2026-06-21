// =====================
// API CONFIGURATION
// =====================
const API_URL = "https://script.google.com/macros/s/AKfycbxQfS72jMrEh_J93h92csb4lYPyOJ7RZyzcXPUlRFUoxMfd0uu44mDr72fi-TaDrXQWjA/exec";

// Variables lagu maamulayo rasiidhada la raadiyey iyo counter-ka Sheets-ka
let currentActiveInvoiceId = null; 
// Local counter — keydsan localStorage si had iyo jeer uu kordho, ha noqoto
// inay Google Sheet-ku si sax ah uga jawaabo iyo in kale (ma ku xirna server-ka)
let nextInvoiceNumberFromServer = (function() {
    const stored = parseInt(localStorage.getItem('posNextInvoice'));
    return (!isNaN(stored) && stored > 0) ? stored : 1001;
})();

// Kordhi local counter-ka ka dib markii lambar la isticmaalay (Order/Pay),
// si lambarka xiga uu had iyo jeer cusub u noqdo
function bumpLocalNextInvoice(usedNum) {
    const next = parseInt(usedNum) + 1;
    if (next > nextInvoiceNumberFromServer) {
        nextInvoiceNumberFromServer = next;
    }
    localStorage.setItem('posNextInvoice', nextInvoiceNumberFromServer.toString());
}

let cart = [];
let allProducts = [];
let activeCategory = 'All';
let allAddIns = [];       // Add-ins Google Sheet ka soo akhrisan

// Test harness detection and safe alert wrapper
const __TEST_HARNESS__ = (typeof window !== 'undefined' && (window.__TEST_HARNESS__ || navigator.webdriver)) || false;
function safeAlert(msg) {
    if (!__TEST_HARNESS__) {
        alert(msg);
    } else {
        console.log('[safeAlert]', msg);
    }
}

// =====================
// CART LOGIC
// =====================
function addToCart(product) {
    const existing = cart.find(item => item.name === product.name && !item.isAddin);
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ ...product, qty: 1, isAddin: false, addins: [] });
    }
    updateCart();
}

// Add-in ku dar cart-ka — separate line ahaan + qiimaha alaabta ugu weyn kordhiyo
// Haddii isla add-in-kani horay loogu daray isla product-ka, qty kaliya kordhi
// (sida product caadiga ah) halkii laba saf oo isku mid ah loo abuuri lahaa
function addAddinToCart(addin) {
    // Hubi product ugu dambeeyay ee cart-ka (main item)
    const mainItems = cart.filter(i => !i.isAddin);
    if (mainItems.length === 0) {
        safeAlert("Marka hore alaab dooro, ka dibna add-in ku dar!");
        return;
    }
    const lastMain = mainItems[mainItems.length - 1];

    // Hubi haddii isla add-in-kani horay loogu daray isla product-kan
    const cleanName = addin.name;
    const existingAddin = cart.find(
        i => i.isAddin && i.parentName === lastMain.name && i.name === "↳ " + cleanName
    );

    if (existingAddin) {
        existingAddin.qty += 1;
        updateCart();
        return;
    }

    // Add-in separate line ahaan ku dar
    // NOTE: lastMain.price MA BEDELI — add-in's own line ayaa qiimaha ku dari
    //       Haddaad inflating gareyso, price labo jeer ayuu u xisaabin (double count)
    const addinLine = {
        name: "↳ " + addin.name,
        price: parseFloat(addin.price),
        qty: 1,
        isAddin: true,
        image: "",
        category: addin.category || "Add-in",
        parentName: lastMain.name
    };
    
    // Geli add-in-ka ka dib main item-kiisa
    const mainIdx = cart.indexOf(lastMain);
    cart.splice(mainIdx + 1, 0, addinLine);
    updateCart();
}

// Render add-ins list (used by test harness). Fills the addin popup list if present.
function renderAddIns() {
    const list = document.getElementById('addinPopupList');
    if (!list) return;
    list.innerHTML = '';
    if (!allAddIns || allAddIns.length === 0) {
        list.innerHTML = '<div class="empty-msg">No add-ins.</div>';
        return;
    }
    allAddIns.forEach(addin => {
        const row = document.createElement('label');
        row.className = 'addin-popup-row';
        row.innerHTML = `
            <input type="checkbox" data-addin-name="${addin.name}">
            <span class="addin-popup-name">${addin.name}</span>
            <span class="addin-popup-price">+$${parseFloat(addin.price).toFixed(2)}</span>
        `;
        list.appendChild(row);
    });
}

// Soo helid add-ins-ka ku habboon product gaarka ah
// addin.appliesTo waa liis (array) ka kooban product names iyo/ama category names
// (comma-separated-ka Sheet-ka ayaa la kala saaray markii la soo akhriyay)
function getAddinsForProduct(product) {
    if (!allAddIns || allAddIns.length === 0) return [];
    const productName = (product.name || '').trim().toLowerCase();
    const productCategory = (product.category || '').trim().toLowerCase();

    return allAddIns.filter(addin => {
        if (!addin.appliesTo || addin.appliesTo.length === 0) return false;
        return addin.appliesTo.some(tag => {
            const t = tag.trim().toLowerCase();
            return t === productName || t === productCategory;
        });
    });
}

// =====================
// ADD-INS POPUP (markaa product la taabto)
// Add-ins-ka waxay isku xiraan Product-ka iyada oo la barbar dhigayo
// "category" — Products sheet-ka iyo AddIns sheet-ka labadooduba waa inay
// isku category qabaan si addin-yadu u soo baxaan (tusaale: "FastFood")
// =====================
const addinPopupOverlay  = document.getElementById("addinPopupOverlay");
const addinPopupTitle    = document.getElementById("addinPopupTitle");
const addinPopupList     = document.getElementById("addinPopupList");
const addinPopupSkip     = document.getElementById("addinPopupSkip");
const addinPopupConfirm  = document.getElementById("addinPopupConfirm");

let pendingProduct = null;

function openAddinsPopup(product) {
    // Kaliya add-ins-ka ku habboon product-kan (magaca ama category-ga)
    const relevantAddins = getAddinsForProduct(product);

    // Haddii aanu lahayn wax add-ins ku xidhan, toos ugu gudub cart-ka
    if (!relevantAddins || relevantAddins.length === 0) {
        addToCart(product);
        return;
    }

    pendingProduct = product;

    if (addinPopupTitle) addinPopupTitle.textContent = `Add-ins — ${product.name}`;

    if (addinPopupList) {
        addinPopupList.innerHTML = "";
        relevantAddins.forEach(addin => {
            const row = document.createElement("label");
            row.className = "addin-popup-row";
            row.innerHTML = `
                <input type="checkbox" data-addin-name="${addin.name}">
                <span class="addin-popup-name">${addin.name}</span>
                <span class="addin-popup-price">+$${parseFloat(addin.price).toFixed(2)}</span>
            `;
            addinPopupList.appendChild(row);
        });
    }

    if (addinPopupOverlay) addinPopupOverlay.style.display = "flex";
}

function closeAddinsPopup() {
    if (addinPopupOverlay) addinPopupOverlay.style.display = "none";
    pendingProduct = null;
}

if (addinPopupConfirm) {
    addinPopupConfirm.addEventListener("click", () => {
        if (!pendingProduct) return;
        addToCart(pendingProduct);

        const checked = addinPopupList ? addinPopupList.querySelectorAll('input[type="checkbox"]:checked') : [];
        checked.forEach(chk => {
            const addin = allAddIns.find(a => a.name === chk.dataset.addinName);
            if (addin) addAddinToCart(addin);
        });

        closeAddinsPopup();
    });
}

if (addinPopupSkip) {
    addinPopupSkip.addEventListener("click", () => {
        if (!pendingProduct) return;
        addToCart(pendingProduct);
        closeAddinsPopup();
    });
}

if (addinPopupOverlay) {
    addinPopupOverlay.addEventListener("click", (e) => {
        // Kaliya haddii backdrop-ka la taabto (ee aan ahayn box-ka), iska celi
        if (e.target === addinPopupOverlay) closeAddinsPopup();
    });
}

function changeQuantity(name, delta) {
    const item = cart.find(item => item.name === name);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        removeFromCart(name);
        return;
    }
    updateCart();
}

// Add-ins-ka qty-gooda — scoped by parentName si aanay isugu jirin haddii
// labo product oo kala duwan isla add-in-ka isticmaalaan
function changeAddinQuantity(name, parentName, delta) {
    const item = cart.find(i => i.isAddin && i.name === name && i.parentName === parentName);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        removeAddinFromCart(name, parentName);
        return;
    }
    updateCart();
}

function removeAddinFromCart(name, parentName) {
    cart = cart.filter(i => !(i.isAddin && i.name === name && i.parentName === parentName));
    updateCart();
}

function removeFromCart(name) {
    // Haddii main item la tirtiro, add-ins-kiisa sidoo kale tirtir
    const item = cart.find(i => i.name === name);
    if (item && !item.isAddin) {
        cart = cart.filter(i => i.name !== name && i.parentName !== name);
    } else {
        cart = cart.filter(i => i.name !== name);
    }
    updateCart();
}

// Cart kaliya nadiifi - ID-ga xididaa (isticmaal Order ka dib)
function clearCart() {
    cart = [];
    updateCart();
}

// Cart iyo ID labadaba nadiifi (isticmaal Pay ka dib)
function clearCartFull() {
    cart = [];
    currentActiveInvoiceId = null;
    updateCart();
}

// =====================
// CART UI RENDERING
// =====================
const cartItemsContainer = document.getElementById("cart-items");
const subtotalElement    = document.getElementById("cart-subtotal");
const vatElement         = document.getElementById("cart-vat");
const totalElement       = document.getElementById("total");
const searchInput        = document.getElementById('search');
const categoryButtons    = document.querySelectorAll('.cat-btn');
const printBtn           = document.querySelector('.print-btn');

function formatMoney(amount) {
    return Number(amount).toFixed(2);
}

function updateCart() {
    renderCart();
}

function renderCart() {
    if (cartItemsContainer) cartItemsContainer.innerHTML = "";

    if (cart.length === 0) {
        if (cartItemsContainer) cartItemsContainer.innerHTML = "<div class='empty-cart'>Cart is empty</div>";
        if (subtotalElement) subtotalElement.textContent = "0.00";
        if (vatElement) vatElement.textContent = "0.00";
        if (totalElement) totalElement.textContent = "0.00";
        return;
    }

    let subtotal = 0;
    cart.forEach(item => {
        const lineTotal = item.qty * item.price;
        subtotal += lineTotal;

        if (item.isAddin) {
            // Add-in row — style gooni ah, qty wuxuu muujinayaa marka >1
            const row = document.createElement("div");
            row.className = "cart-addin-row";
            row.innerHTML = `
                <span class="cart-addin-label">${item.name}${item.qty > 1 ? ` x${item.qty}` : ""}</span>
                <span class="cart-addin-price">+$${formatMoney(item.qty * item.price)}</span>
                <div class="actions" style="display:flex; gap:3px;">
                    <button data-action="addin-increase" data-name="${item.name}" data-parent="${item.parentName}" style="padding:1px 6px;font-size:11px;cursor:pointer;">+</button>
                    <button data-action="addin-decrease" data-name="${item.name}" data-parent="${item.parentName}" style="padding:1px 6px;font-size:11px;cursor:pointer;">-</button>
                    <button data-action="addin-remove"   data-name="${item.name}" data-parent="${item.parentName}" style="padding:1px 6px;font-size:11px;background:#ffeded;border:1px solid #f5c6cb;color:#dc3545;border-radius:4px;cursor:pointer;">✕</button>
                </div>
            `;
            if (cartItemsContainer) cartItemsContainer.appendChild(row);
            return;
        }

        // Main product row
        const matchedProd = allProducts.find(p => p.name === item.name);
        const imgSrc = item.image || (matchedProd ? matchedProd.image : "sawirada/default.png");

        const row = document.createElement("div");
        row.className = "cart-row";
        row.style = "display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; gap: 8px;";
        
        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <img src="${imgSrc}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid #eee;" alt="${item.name}">
                <div style="display: flex; flex-direction: column;">
                    <span class="item-name" style="font-weight: 600; font-size: 13px; color:#333;">${item.name}</span>
                    <span class="item-line" style="font-size: 11px; color: #777;">x${item.qty} = $${formatMoney(item.qty * (item.price))}</span>
                </div>
            </div>
            <div class="actions" style="display: flex; gap: 3px;">
                <button data-action="increase" data-name="${item.name}" style="padding: 2px 8px; font-size: 12px; cursor:pointer;">+</button>
                <button data-action="decrease" data-name="${item.name}" style="padding: 2px 8px; font-size: 12px; cursor:pointer;">-</button>
                <button data-action="remove"   data-name="${item.name}" style="padding: 2px 6px; font-size: 12px; cursor:pointer; background:#dc3545; color:white; border:none; border-radius:4px;">🗑</button>
            </div>
        `;
        if (cartItemsContainer) cartItemsContainer.appendChild(row);
    });

    if (subtotalElement) subtotalElement.textContent = formatMoney(subtotal);
    if (vatElement) vatElement.textContent = "0.00"; 
    if (totalElement) totalElement.textContent = formatMoney(subtotal);
}

if (cartItemsContainer) {
    cartItemsContainer.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const name = btn.dataset.name;
        const parent = btn.dataset.parent;
        if (btn.dataset.action === "increase") changeQuantity(name, 1);
        if (btn.dataset.action === "decrease") changeQuantity(name, -1);
        if (btn.dataset.action === "remove")   removeFromCart(name);
        if (btn.dataset.action === "addin-increase") changeAddinQuantity(name, parent, 1);
        if (btn.dataset.action === "addin-decrease") changeAddinQuantity(name, parent, -1);
        if (btn.dataset.action === "addin-remove")   removeAddinFromCart(name, parent);
    });
}

if (searchInput) {
    searchInput.addEventListener('input', () => filterAndRender());
}

if (categoryButtons && categoryButtons.length) {
    categoryButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCategory = btn.textContent.trim();
            filterAndRender();
        });
    });
}

// =====================
// DEFAULT PRODUCTS (fallback)
// =====================
const defaultProducts = [
    { name: "Kobashin",   price: 1.5,  category: "Coffee",   image: "sawirada/Kobashin.png" },
    { name: "Expresso",   price: 2.5,  category: "Coffee",   image: "sawirada/Expresso.png" },
    { name: "Chicken",    price: 1.5,  category: "FastFood", image: "sawirada/Chicken.png" },
    { name: "Ice Coffee", price: 0.75, category: "Coffee",   image: "sawirada/Ice_coffee.png" },
    { name: "Mango",      price: 0.75, category: "Veg",      image: "sawirada/Mango.png" }
];

function renderProducts(list) {
    const grid = document.getElementById("productsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    list.forEach(product => {
        const card = document.createElement("div");
        card.className = "product-card";
        const imgSrc = product.image || "sawirada/default.png";
        card.innerHTML = `
            <img src="${imgSrc}" alt="${product.name}">
            <h4>${product.name}</h4>
            <p>$${parseFloat(product.price).toFixed(2)}</p>
        `;
        card.addEventListener("click", () => {
            openAddinsPopup({
                name:      product.name,
                price:     parseFloat(product.price) || 0,
                category:  product.category,
                image:     product.image
            });
        });
        grid.appendChild(card);
    });
}

function filterAndRender() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const filtered = allProducts.filter(p => {
        const name      = (p.name     || '').toLowerCase();
        const category  = (p.category || 'All');
        const matchesSearch   = !query || name.includes(query);
        const matchesCategory = activeCategory === 'All' || category === activeCategory;
        return matchesSearch && matchesCategory;
    });
    renderProducts(filtered);
}

// =====================
// SOO AQRI ALAABTA GOOGLE SHEET
// =====================
async function loadProducts() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        if (data && Array.isArray(data.products)) {
            allProducts = data.products;
        } else if (Array.isArray(data)) {
            allProducts = data;
        } else {
            allProducts = defaultProducts.slice();
        }

        // Soo akhri add-ins isla response-ka — allAddIns waxay u baahantahay
        // openAddinsPopup() (popup-ka soo baxa marka product la taabto)
        // addin.appliesTo waa string comma-separated ah (AppliesTo column-ka Sheet-ka)
        // halkan waxaan u beddelaynaa array si filter-ku u fudaydo
        if (data && Array.isArray(data.addins)) {
            allAddIns = data.addins.map(a => ({
                ...a,
                appliesTo: (a.appliesTo || '')
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(s => s.length > 0)
            }));
        }

        if (data && data.lastInvoiceId) {
            const serverNum = parseInt(data.lastInvoiceId) + 1;
            // Server-ka (Sheet-ka) waa "source of truth" — had iyo jeer raaci qiimihiisa,
            // si counter-ku u kor u kaco MARKA la iibiyo, ugu dambeyna u dhaco
            // marka Sales/Orders laga tirtiro Sheet-ka (doGet() wuxuu noqon doonaa 1000 -> 1001)
            if (!isNaN(serverNum) && serverNum !== nextInvoiceNumberFromServer) {
                nextInvoiceNumberFromServer = serverNum;
                localStorage.setItem('posNextInvoice', nextInvoiceNumberFromServer.toString());
            }
        }
        // Haddii field-ka 'lastInvoiceId' gabi ahaanba uusan ku jirin response-ka
        // (backend qaabkiisu wuu isbedelaa), ha taabano counter-ka local-ka ah — sii wad sidii hore

        filterAndRender();
    } catch (error) {
        console.error("Error loading data from Google Sheets:", error);
        allProducts = defaultProducts.slice();
        // Khalad shabakeed (network/CORS) kaliya — ma macnayno in Sheet-ku madhan yahay
        // ➜ ha taabano counter-ka invoice-ka ee local-ka ah (sii wad sidii uu horay u ahaa)
        filterAndRender();
    }
}

// =====================
// (Add-ins sidebar-ka hore waa la saaray — add-ins-ka hadda waxay
//  soo baxaan popup ahaan marka product la taabto, fiiri openAddinsPopup())
// =====================

// =====================
// ORDER FUNCTION - FIXED (loadProducts lama wacin, ID-ga wuu xididaa)
// =====================
async function handleOrder() {
    if (cart.length === 0) { safeAlert("Cart is empty"); return; }

    const orderBtn = document.getElementById("orderBtn");
    if (orderBtn) { orderBtn.innerText = "Processing..."; orderBtn.disabled = true; }

    // Haddii order hore jiro, isla ID isticmaal — haddaan jirin, cusub isticmaal
    let currentNum = currentActiveInvoiceId ? currentActiveInvoiceId : nextInvoiceNumberFromServer;
    const subtotal = cart.reduce((sum, i) => sum + (i.qty * i.price), 0);

    // Main items kaliya — add-ins waxay hal cell ku ururtaan (sida "Bariis, Half")
    // addinsPrice = qiimaha addins-ka haddii ay jiraan, haddii kale 0
    // totalPrice  = (price x qty) + addinsPrice
    const itemsArray = cart
        .filter(item => !item.isAddin)
        .map(item => {
            const myAddins    = cart.filter(a => a.isAddin && a.parentName === item.name);
            const addinsText  = myAddins.map(a => a.name.replace("\u21b3 ", "")).join(", ");
            const addinsPrice = myAddins.reduce((sum, a) => sum + parseFloat(a.price), 0);
            return {
                productName: item.name,
                qty:         item.qty,
                price:       Number(item.price).toFixed(2),
                addins:      addinsText,
                addinsPrice: Number(addinsPrice).toFixed(2),
                totalPrice:  Number((item.qty * parseFloat(item.price)) + addinsPrice).toFixed(2)
            };
        });

    const payload = {
        action:    "order",
        orderId:   currentNum.toString(),
        date:      new Date().toLocaleString(),
        items:     itemsArray,
        subtotal:  subtotal.toFixed(2),
        vat:       "0.00", 
        total:     subtotal.toFixed(2),
        orderType: "Order"
    };

    await saveToLocalHistory(currentNum, "order");
    
    try {
        await fetch(API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'text/plain' },
            body:    JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Error saving to Google Sheets:', err);
    }

    // Order-kan waa la keydiyay — ID-ga waa la xididaa si Order-ka xiga
    // uu lambar CUSUB helo, halkii uu isla ID-gan ku sii dari lahaa
    bumpLocalNextInvoice(currentNum);
    await loadProducts();
    clearCartFull();

    if (orderBtn) { orderBtn.innerText = "Order"; orderBtn.disabled = false; }
    safeAlert(`Order ${currentNum} si guul leh ayaa loogu gudbiyey Google Sheets!`);
}

// =====================
// PAY FUNCTION - FIXED
// =====================
async function handlePay() {
    if (cart.length === 0) { safeAlert("Cart is empty"); return; }

    const payBtn = document.getElementById("payBtn");
    if (payBtn) { payBtn.innerText = "Processing..."; payBtn.disabled = true; }

    let currentNum = currentActiveInvoiceId ? currentActiveInvoiceId : nextInvoiceNumberFromServer;
    const subtotal = cart.reduce((sum, i) => sum + (i.qty * i.price), 0);

    // Haddii order hore ka jiro Orders sheet-ka, tirtir
    if (currentActiveInvoiceId) {
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: "delete_order",
                    orderId: currentNum.toString()
                })
            });
        } catch (err) {
            console.error('Error deleting previous order from sheet:', err);
        }
    }

    // Main items kaliya — add-ins waxay hal cell ku ururtaan (sida "Bariis, Half")
    // addinsPrice = qiimaha addins-ka haddii ay jiraan, haddii kale 0
    // totalPrice  = (price x qty) + addinsPrice
    const itemsArray = cart
        .filter(item => !item.isAddin)
        .map(item => {
            const myAddins    = cart.filter(a => a.isAddin && a.parentName === item.name);
            const addinsText  = myAddins.map(a => a.name.replace("\u21b3 ", "")).join(", ");
            const addinsPrice = myAddins.reduce((sum, a) => sum + parseFloat(a.price), 0);
            return {
                productName: item.name,
                qty:         item.qty,
                price:       Number(item.price).toFixed(2),
                addins:      addinsText,
                addinsPrice: Number(addinsPrice).toFixed(2),
                totalPrice:  Number((item.qty * parseFloat(item.price)) + addinsPrice).toFixed(2)
            };
        });

    const payload = {
        action:    "sale",
        invoiceNo: currentNum.toString(), 
        date:      new Date().toLocaleString(),
        items:     itemsArray,
        subtotal:  subtotal.toFixed(2),
        vat:       "0.00",
        total:     subtotal.toFixed(2)
    };

    await saveToLocalHistory(currentNum, "sale");

    try {
        await fetch(API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'text/plain' },
            body:    JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Error saving sale to Google Sheets:', err);
    }
    
    // ✅ Pay ka dib kaliya ayaan loadProducts() wacnaa - ID cusub heli
    bumpLocalNextInvoice(currentNum);
    await loadProducts();
    clearCartFull();

    if (payBtn) { payBtn.innerText = "Pay"; payBtn.disabled = false; }
    safeAlert(`Invoice ${currentNum} waa la iibiyey, dalabkii horay u jirayna waa laga saaray Orders-ka!`);
}

// =====================
// SAVE TO LOCAL HISTORY 
// =====================
async function saveToLocalHistory(id, action) {
    const history = JSON.parse(localStorage.getItem('posHistory') || '[]');
    const cleanHistory = history.filter(h => h.id !== id.toString());
    const currentTotal = cart.reduce((sum, i) => sum + (i.qty * i.price), 0);
    
    cleanHistory.push({
        id: id.toString(),
        action: action,
        date: new Date().toLocaleString(),
        total: currentTotal.toFixed(2),
        items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, image: i.image }))
    });
    localStorage.setItem('posHistory', JSON.stringify(cleanHistory));
    renderOrdersList();
}

// =====================
// PRINT RECEIPT
// Marka la taabto: 1) daabac rasiidhka  2) keydi Sale-ga Sheet-ka  3) nadiifi cart-ka
// (isla habka Pay - sale waa la keydiyaa, order hore (haddii jiro) waa laga saaraa)
// =====================
async function printReceipt() {
    if (cart.length === 0) { safeAlert('Cart is empty'); return; }

    if (printBtn) { printBtn.innerText = "Processing..."; printBtn.disabled = true; }

    let currentNum = currentActiveInvoiceId ? currentActiveInvoiceId : nextInvoiceNumberFromServer;
    const now      = new Date();
    const dateStr  = now.toLocaleDateString();
    const timeStr  = now.toLocaleTimeString();

    // Snapshot-ka cart-ka — waxaan isticmaalaynaa kani rasiidhka iyo Sheet-ka labadaba,
    // si aan u xaqiijino in xogtu isku mid tahay isaga oo cart-ka aan weli la nadiifin
    const cartSnapshot = cart.map(i => ({ ...i }));

    // Subtotal = dhammaan cart lines (main + addins)
    const subtotal   = cartSnapshot.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const vat        = subtotal * 0.05;
    const grandTotal = subtotal + vat;

    // Build item rows — main item + add-ins sub-rows, layout QTY | DESC | AMT
    let itemsHTML = '';
    cartSnapshot.forEach(item => {
        if (item.isAddin) return;

        const myAddins  = cartSnapshot.filter(a => a.isAddin && a.parentName === item.name);
        const baseTotal = item.qty * parseFloat(item.price);

        itemsHTML += `
          <div class="item-row">
            <span class="col-qty">${item.qty}</span>
            <span class="col-desc">${item.name}</span>
            <span class="col-amt">$${Number(baseTotal).toFixed(2)}</span>
          </div>`;

        myAddins.forEach(a => {
            const cleanName = a.name.replace('\u21b3 ', '');
            const addinQtyLabel = a.qty > 1 ? ` x${a.qty}` : '';
            itemsHTML += `
          <div class="item-row addin-row">
            <span class="col-qty"></span>
            <span class="col-desc">+ ${cleanName}${addinQtyLabel}</span>
            <span class="col-amt">$${Number(a.qty * a.price).toFixed(2)}</span>
          </div>`;
        });
    });

    const receipt = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt - ${currentNum}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    background:#ffffff;
    font-family: Arial, Helvetica, sans-serif;
    color:#1a1a1a;
  }
  body {
    display:flex;
    justify-content:center;
    padding:30px 16px;
  }

  .paper { width:300px; }

  .center    { text-align:center; }
  .shopname  { font-weight:800; font-size:26px; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:8px; }
  .addr-line { font-size:12.5px; color:#222; line-height:1.5; }

  .dash { border:none; border-top:1px dashed #555; margin:12px 0; }

  .info-row  { display:flex; justify-content:space-between; font-size:12px; margin-bottom:3px; }

  .col-header { display:flex; font-weight:700; font-size:11.5px; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:2px; }
  .item-row   { display:flex; font-size:13px; margin-bottom:5px; align-items:baseline; }
  .col-qty    { width:26px; flex-shrink:0; }
  .col-desc   { flex:1; padding-right:6px; }
  .col-amt    { width:64px; flex-shrink:0; text-align:right; }
  .addin-row  { font-size:11.5px; color:#444; margin-top:-2px; }

  .summary-row   { display:flex; justify-content:flex-end; gap:18px; font-size:13px; margin-bottom:4px; }
  .summary-row .s-label { color:#333; }
  .summary-row .s-val   { min-width:62px; text-align:right; }
  .amount-row    { font-weight:800; font-size:16px; margin-top:6px; }

  .footer { font-size:13px; letter-spacing:0.5px; margin:16px 0 14px; color:#333; }

  @media print {
    body { padding:0; }
    .paper { width:80mm; padding:14px 16px; }
  }
</style>
</head>
<body>

  <div class="paper">

    <div class="center">
      <div class="shopname">HarsiWanaag Coffee</div>
      <div class="addr-line">Goob: Geed Jaceyl</div>
      <div class="addr-line">Address: D.g Warta-Nabada</div>
    </div>

    <hr class="dash">

    <div class="info-row"><span>${dateStr}</span><span>${timeStr}</span></div>
    <div class="info-row"><span>Receipt:</span><span>${currentNum}</span></div>

    <hr class="dash">

    <div class="col-header">
      <span class="col-qty">QTY</span>
      <span class="col-desc">DESC</span>
      <span class="col-amt">AMT</span>
    </div>

    <hr class="dash">

    ${itemsHTML}

    <hr class="dash">

    <div class="summary-row"><span class="s-label">SUBTOTAL:</span><span class="s-val">$${subtotal.toFixed(2)}</span></div>
    <div class="summary-row"><span class="s-label">SALE TAX (5%):</span><span class="s-val">$${vat.toFixed(2)}</span></div>
    <div class="summary-row amount-row"><span class="s-label">AMOUNT:</span><span class="s-val">$${grandTotal.toFixed(2)}</span></div>

    <hr class="dash">

    <div class="center footer">THANK YOU!</div>

    <div class="center">
      <svg id="barcode"></svg>
    </div>

  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"><\/script>
  <script>
    try {
      JsBarcode("#barcode", "${currentNum}", {
        format:       "CODE128",
        width:        2,
        height:       45,
        displayValue: true,
        fontSize:     12,
        margin:       6,
        background:   "#ffffff",
        lineColor:    "#000000"
      });
    } catch(e) {
      document.getElementById("barcode").outerHTML =
        '<p style="font-size:13px;letter-spacing:4px;margin-top:8px;">${currentNum}</p>';
    }
  <\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) {
        safeAlert('Please allow popups to print.');
        if (printBtn) { printBtn.innerText = "Print Receipt"; printBtn.disabled = false; }
        return;
    }
    win.document.write(receipt);
    win.document.close();
    win.focus();
    // 1500ms si JsBarcode CDN-ka u soo load gareeyo barcode-ka ka hor print
    setTimeout(() => { win.print(); win.close(); }, 1500);

    // ------------------------------------------
    // Sale-ga Sheet-ka u keydi + cart-ka nadiifi (isla habka Pay)
    // ------------------------------------------

    // Haddii order hore ka jiro Orders sheet-ka, tirtir
    if (currentActiveInvoiceId) {
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: "delete_order",
                    orderId: currentNum.toString()
                })
            });
        } catch (err) {
            console.error('Error deleting previous order from sheet:', err);
        }
    }

    // Main items kaliya — add-ins waxay hal cell ku ururtaan (sida "Bariis, Half")
    const itemsArray = cartSnapshot
        .filter(item => !item.isAddin)
        .map(item => {
            const myAddins    = cartSnapshot.filter(a => a.isAddin && a.parentName === item.name);
            const addinsText  = myAddins.map(a => `${a.name.replace("\u21b3 ", "")}${a.qty > 1 ? ` x${a.qty}` : ''}`).join(", ");
            const addinsPrice = myAddins.reduce((sum, a) => sum + (a.qty * parseFloat(a.price)), 0);
            return {
                productName: item.name,
                qty:         item.qty,
                price:       Number(item.price).toFixed(2),
                addins:      addinsText,
                addinsPrice: Number(addinsPrice).toFixed(2),
                totalPrice:  Number((item.qty * parseFloat(item.price)) + addinsPrice).toFixed(2)
            };
        });

    const payload = {
        action:    "sale",
        invoiceNo: currentNum.toString(),
        date:      new Date().toLocaleString(),
        items:     itemsArray,
        subtotal:  subtotal.toFixed(2),
        vat:       "0.00",
        total:     subtotal.toFixed(2)
    };

    await saveToLocalHistory(currentNum, "sale");

    try {
        await fetch(API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'text/plain' },
            body:    JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Error saving sale to Google Sheets:', err);
    }

    // ✅ ID cusub heli kadib Sale-ga
    bumpLocalNextInvoice(currentNum);
    await loadProducts();
    clearCartFull();

    if (printBtn) { printBtn.innerText = "Print Receipt"; printBtn.disabled = false; }
}

if (printBtn) printBtn.addEventListener('click', printReceipt);

// =====================
// SEARCH & LOAD TO CART
// =====================
function searchAndLoadToCart() {
    const invInput = document.getElementById('cartSearchInvInput');
    const statusSpan = document.getElementById('cartSearchStatus');
    const query = invInput ? invInput.value.trim() : '';

    if (!query) {
        if (statusSpan) { statusSpan.style.color = "red"; statusSpan.textContent = "⚠️ Geli nambarka!"; }
        return;
    }

    const history = JSON.parse(localStorage.getItem('posHistory') || '[]');
    const found = history.find(item => item.id === query);

    if (found) {
        cart = found.items.map(i => ({ name: i.name || i.productName, qty: i.qty, price: i.price, image: i.image }));
        currentActiveInvoiceId = found.id; 
        updateCart();
        
        if (statusSpan) {
            statusSpan.style.color = "green";
            statusSpan.textContent = `✅ Namber ${found.id} waa la keenay! Markaad Pay tiraahdo booska Order-ka waa laga tirtirayaa.`;
        }
    } else {
        if (statusSpan) { statusSpan.style.color = "red"; statusSpan.textContent = "❌ Namberka lagama helin kaydka hoose!"; }
    }
}

// =====================
// RECORDS LIST PAGE
// =====================
function renderOrdersList() {
    const ordersList = document.getElementById("ordersList");
    if (!ordersList) return;
    const history = JSON.parse(localStorage.getItem('posHistory') || '[]');
    if (history.length === 0) {
        ordersList.innerHTML = '<p class="empty-msg">No records yet.</p>';
        return;
    }
    ordersList.innerHTML = history.slice().reverse().map(o => `
        <div style="padding:10px; background:#f9f9f9; border-bottom:1px solid #eee; font-size:13px;">
            <strong>Namberka: ${o.id}</strong> - <span style="color:${o.action==='order'?'blue':'green'}">${o.action.toUpperCase()}</span> - Total: $${Number(o.total).toFixed(2)} <br>
            <small>${o.date}</small>
        </div>
    `).join('');
}

function showPage(pageId) {
    document.querySelectorAll('[id$="-page"]').forEach(p => p.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
    if (pageId === 'orders-page') renderOrdersList();
}

// =====================
// INIT
// =====================
function addProduct() {
    const nameEl = document.getElementById('newName');
    const priceEl = document.getElementById('newPrice');
    const catEl = document.getElementById('newCategory');
    const imgEl = document.getElementById('newImage');
    const name = nameEl ? nameEl.value.trim() : '';
    const price = priceEl ? parseFloat(priceEl.value) || 0 : 0;
    const category = catEl ? catEl.value.trim() : 'General';
    const image = imgEl ? imgEl.value.trim() : '';
    if (!name) { safeAlert('Please enter a product name'); return; }
    const prod = { name, price, category, image };
    allProducts.push(prod);
    filterAndRender();
    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    if (catEl) catEl.value = '';
    if (imgEl) imgEl.value = '';
    safeAlert('Product added');
}

document.addEventListener('DOMContentLoaded', () => {
    // load products (add-ins data isla loadProducts() ayaa la soo akhriyaa)
    loadProducts();
    updateCart();
    renderOrdersList();

    const orderBtn = document.getElementById('orderBtn');
    const payBtn = document.getElementById('payBtn');
    const clearCartBtn = document.getElementById('clearCartBtn');
    if (orderBtn) orderBtn.addEventListener('click', handleOrder);

    if (payBtn) payBtn.addEventListener('click', handlePay);
    if (clearCartBtn) clearCartBtn.addEventListener('click', () => {
        if (cart.length === 0) return;
        const ok = __TEST_HARNESS__ ? true : confirm("Ma hubtaa inaad rabto inaad tirtirto dhammaan alaabta cart-ka?");
        if (ok) clearCartFull();
    });

    // show default page
    try { showPage('sales-page'); } catch (e) { /* ignore */ }
});
