// 张大厨的餐厅 - 点餐网页应用
// 使用 CloudBase JS SDK + PG (app.rdb())

// ============ 配置 ============
const ENV_ID = 'able-gamefowl-d9gxn8faf0d85a43e';
const PUBLISHABLE_KEY = 'eyElsMejSgROZrO3HtZqBvgvEEH3PvFePlVgVfLePLXnU9TeASAvCV0rLZFbDQH5OQH6IqomSZDtCmM7.yvAme0WxTkSybBVimctiU3CrfUMiY5GjILQcl9ywDEqeyD36SjPeDAW0ICH6V6VrPOIlf0otiyphUFjqmMGdGCRmtP27WP6vAT99G0cmjYLgqNyhS83qGxyrl4YwWhzbFE7meuFfJtC3IEE7HvZacKVxD8NxJMWjj6xyUGujcB97ErGkUZT8URV9U6PgFYKhbFYdWhZfXNv2CNB2VhMkCqhazKH9BNm9KSFmSMEhSnjjqn3oV3YlPmP4DA3TnD77Z5DtQ73tL8cQmvhvsJDNKfdcEAUjfIXqkJE5HwIHGSziC7gYLjRKDzWzm9H3uVSyx6XaDLFqWZ8mHpzqBA4izjqfz7XxDybdf7SotSXaZuXfud2kwV6hmYUtRLUpex3vUGT6H1eiKofsGUCkDA3cTE4eAk64pW5fROp1putpXKUgOUl6UHDsNUVbSe4jbFMnGhoswItqoCGsyq1zJjGNqBKpoWGdHBIgVGbwwXA7CYCnt9riGrftSN1uwkWbDywsA4Izq140xT20yhH3gAY3DYbcLSJkH85ojRWvFGGeKge9BlMhw9WqXEPmCsghHU9rseggq2KmUzpzoYDhuublGJZqAxqgGpLav780wT25roStnHhpgGCktr3kKYQsCSE3DZX5fwNwDC8uFmdyUV6uhhmqx0EiEk5dVgOkNDRnaVatXMA1ZrHnFgIzcXPvjI57gRYgEzplF4fwVZ28V5PwVHOzTBGhf46nwSX9WM6hADGrqN8xWoIimATkrI.Ho4sQNzqfLpN4emo9qfACq6bJof0vuzngHn60eLSfIs-iMdTg9ImyaJKJjyAtDX7_kIyhVDY88KcSiV-Cn5wq4kd8ht-3cZbwPSL2gQXgZob_fwyXGy9VVGiu9Cc50bcLmDu9cAPju0K_afY-v1INEpRdhc7ZAfGhWAM8STwyC7V8y_g1Y3dZo_sf4SEwZYqKlOyWa0xfLlqpK1xnoej6tRYfB2oHgDX97dP4YCccq9LGoQf5m3--t5SD6HrCF9R7X6GPTvLhx-yZ8xUjua9CulRLVbGfD1uukStA_Z46BnSSGzKWil5IeFqmr-N0JrGfs9qYqXnFCBR_YkaaT8L5a';

// 管理员口令（进入管理员页面需要，可自行修改）
const ADMIN_PASSWORD = 'zhanggengbao';

// 菜品默认图片（本地资源）
const DISH_IMG = 'assets/dish-default.svg';

// 云存储 fileID -> 临时访问 URL 缓存
const cloudImgCache = {};

// 根据菜品对象的 image_url 返回实际图片地址（支持 cloud://、https://、base64，无则用默认图）
function dishImg(dish) {
    if (dish && dish.image_url) {
        if (dish.image_url.startsWith('cloud://')) {
            return cloudImgCache[dish.image_url] || DISH_IMG;
        }
        return dish.image_url;
    }
    return DISH_IMG;
}

// 批量将 cloud:// 图片地址解析为可访问的 HTTPS 链接
async function resolveCloudImages(list) {
    if (!app || typeof app.getTempFileURL !== 'function' || !Array.isArray(list)) return;
    const fileIDs = [...new Set(
        list
            .map(d => d && d.image_url)
            .filter(u => typeof u === 'string' && u.startsWith('cloud://') && !cloudImgCache[u])
    )];
    if (fileIDs.length === 0) return;
    try {
        const res = await app.getTempFileURL({ fileList: fileIDs });
        const fileList = (res && res.fileList) || [];
        fileList.forEach(item => {
            const url = item.tempFileURL || item.download_url;
            if (item.fileID && url) cloudImgCache[item.fileID] = url;
        });
    } catch (e) {
        console.warn('云存储图片链接解析失败', e);
    }
}

// ============ CloudBase 初始化 ============
let app = null;
let db = null;
let auth = null;

function initCloud() {
    if (app) return;
    app = cloudbase.init({
        env: ENV_ID,
        region: 'ap-shanghai',
        accessKey: PUBLISHABLE_KEY,
        auth: { detectSessionInUrl: true },
    });
    auth = app.auth;
    db = app.rdb();
}

// 确保有会话（匿名登录）
async function ensureSession() {
    const { data } = await auth.getSession();
    if (data && data.session) return true;
    const { error } = await auth.signInAnonymously();
    if (error) {
        console.error('匿名登录失败', error);
        return false;
    }
    return true;
}

// ============ 工具 ============
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// ============ 购物车（本地缓存） ============
function getCart() {
    try {
        return JSON.parse(localStorage.getItem('zdc_cart') || '[]');
    } catch (e) {
        return [];
    }
}
function setCart(cart) {
    localStorage.setItem('zdc_cart', JSON.stringify(cart));
    updateCartBadge();
}
function clearCart() {
    localStorage.removeItem('zdc_cart');
    updateCartBadge();
}
function updateCartBadge() {
    const cart = getCart();
    const total = cart.reduce((s, it) => s + it.qty, 0);
    const badge = document.getElementById('cartBadge');
    badge.textContent = total;
    if (total > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
}

// ============ 路由（支持 Hash 路由与浏览器返回键） ============
const VALID_PAGES = ['home', 'menu', 'dish', 'cart', 'checkout', 'orders', 'admin', 'completed'];
let currentPage = 'home';
let internalNavDepth = 0;

function parseHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (!raw) return { page: 'home', param: '' };
    const slashIdx = raw.indexOf('/');
    const page = slashIdx === -1 ? raw : raw.slice(0, slashIdx);
    const param = slashIdx === -1 ? '' : decodeURIComponent(raw.slice(slashIdx + 1));
    if (VALID_PAGES.indexOf(page) === -1) return { page: 'home', param: '' };
    return { page, param };
}

function buildHash(page, param = '') {
    return '#' + page + (param !== '' && param !== null && param !== undefined ? '/' + encodeURIComponent(String(param)) : '');
}

function navigate(page, push = true, param = '') {
    const targetHash = buildHash(page, param);
    if (push) {
        if (window.location.hash !== targetHash) {
            internalNavDepth++;
            window.location.hash = targetHash;
            return;
        }
    } else if (window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
    }
    showPage(page, param);
}

function handleHashChange() {
    const { page, param } = parseHash();
    showPage(page, param);
}

async function showPage(page, param = '') {
    // 菜品详情页支持直达或刷新恢复
    if (page === 'dish') {
        if (param) {
            const dishes = await loadDishes();
            selectedDish = dishes.find(d => String(d.id) === String(param)) || null;
        }
        if (!selectedDish) {
            navigate('menu', false);
            return;
        }
    }

    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');
    currentPage = page;

    // 更新导航栏
    const backBtn = document.getElementById('navBack');
    const title = document.getElementById('topbarTitle');
    const cartBtn = document.getElementById('navCart');
    const titles = {
        home: '张大厨的餐厅',
        menu: '点餐菜单',
        dish: '菜品详情',
        cart: '购物车',
        checkout: '确认订单',
        orders: '我的订单',
        admin: '张大厨入口',
        completed: '已完成菜品',
    };
    title.textContent = titles[page] || '张大厨的餐厅';
    backBtn.style.visibility = (page === 'home') ? 'hidden' : 'visible';
    cartBtn.style.visibility = (page === 'home' || page === 'cart' || page === 'admin' || page === 'completed') ? 'hidden' : 'visible';

    // 切页滚回顶部
    window.scrollTo(0, 0);

    // 页面加载逻辑
    if (page === 'menu') renderMenu();
    if (page === 'dish') renderDishDetail();
    if (page === 'cart') renderCart();
    if (page === 'checkout') renderCheckout();
    if (page === 'orders') renderOrders();
    if (page === 'admin') renderAdmin();
    if (page === 'completed') renderCompleted();
    if (page === 'home') refreshAdminAlert();
}

function goBack() {
    if (internalNavDepth > 0) {
        internalNavDepth--;
        window.history.back();
    } else {
        navigate(currentPage === 'dish' ? 'menu' : 'home', false);
    }
}

// ============ 后台待做提醒 ============
// 查询待处理订单数（status = pending 或 cooking，且有未完成菜品）
async function getPendingOrderCount() {
    const ok = await ensureSession();
    if (!ok) return 0;
    const { data, error } = await db.from('restaurant_orders')
        .select('id, status, items')
        .in('status', ['pending', 'cooking'])
        .limit(500);
    if (error) {
        console.error('查询待处理订单失败', error);
        return 0;
    }
    return (data || []).filter(o => (o.items || []).some(it => it.status !== 'done')).length;
}

// 刷新首页「张大厨入口」提醒角标
async function refreshAdminAlert() {
    const badge = document.getElementById('adminAlertBadge');
    if (!badge) return;
    const count = await getPendingOrderCount();
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'inline-block';
        badge.title = '后台有餐待做';
    } else {
        badge.style.display = 'none';
    }
}

// ============ 菜单数据 ============
let dishesCache = [];
let currentCategory = '全部';
let selectedDish = null;

async function loadDishes() {
    if (dishesCache.length > 0) return dishesCache;
    const { data, error } = await db.from('restaurant_dishes')
        .select('id, name, category, description, emoji, image_url, status, sort')
        .order('category', { ascending: true })
        .order('sort', { ascending: true });
    if (error) {
        console.error('加载菜单失败', error);
        toast('菜单加载失败');
        return [];
    }
    dishesCache = data || [];
    await resolveCloudImages(dishesCache);
    return dishesCache;
}

function getCategories() {
    const cats = ['全部'];
    dishesCache.forEach(d => {
        if (d.category && cats.indexOf(d.category) === -1) cats.push(d.category);
    });
    return cats;
}

function updateCategoryTabsFade() {
    const wrap = document.getElementById('categoryTabsWrap');
    const tabs = document.getElementById('categoryTabs');
    if (!wrap || !tabs) return;
    const hasOverflowRight = tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft > 4;
    wrap.classList.toggle('has-overflow-right', hasOverflowRight);
}

async function renderMenu() {
    const dishes = await loadDishes();
    const cats = getCategories();

    // 渲染分类 tabs
    const tabsEl = document.getElementById('categoryTabs');
    tabsEl.innerHTML = cats.map(c =>
        `<div class="category-tab ${c === currentCategory ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`
    ).join('');
    tabsEl.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentCategory = tab.dataset.cat;
            renderMenu();
        });
    });
    tabsEl.onscroll = updateCategoryTabsFade;
    requestAnimationFrame(updateCategoryTabsFade);

    // 渲染菜品列表
    const list = currentCategory === '全部' ? dishes : dishes.filter(d => d.category === currentCategory);
    const listEl = document.getElementById('dishList');
    listEl.innerHTML = list.map(d => {
        const off = d.status !== 'on';
        return `<div class="dish-card ${off ? 'dish-off' : ''}" data-id="${d.id}">
            <img class="dish-img" src="${dishImg(d)}" alt="${escapeHtml(d.name)}" loading="lazy">
            <div class="dish-info">
                <div class="dish-name">${escapeHtml(d.name)}${off ? '<span class="dish-soldout-tag">已下架</span>' : ''}</div>
                <div class="dish-desc">${escapeHtml(d.description || '')}</div>
            </div>
            ${off
                ? `<button class="dish-add dish-add-disabled" aria-label="已下架" disabled><i class="fa-solid fa-ban"></i></button>`
                : `<button class="dish-add" data-id="${d.id}" aria-label="加入购物车"><i class="fa-solid fa-plus"></i></button>`}
        </div>`;
    }).join('');

    // 自定义菜品提交入口（放在列表底部）
    listEl.insertAdjacentHTML('beforeend', `
        <div class="custom-dish-box">
            <div class="custom-dish-title"><i class="fa-solid fa-lightbulb"></i> 想吃点别的？</div>
            <p class="custom-dish-sub">菜单上没有想吃的菜？填好菜名加入购物车，和其他菜一起下单～</p>
            <div class="custom-dish-row">
                <input class="checkout-input" id="customDishName" placeholder="输入想吃的菜名" maxlength="30">
            </div>
            <div class="custom-dish-row">
                <div class="custom-dish-qty">
                    <span class="custom-dish-qty-label">数量</span>
                    <button class="qty-btn" id="customQtyMinus" aria-label="减少数量"><i class="fa-solid fa-minus"></i></button>
                    <span class="qty-num" id="customQtyNum">1</span>
                    <button class="qty-btn" id="customQtyPlus" aria-label="增加数量"><i class="fa-solid fa-plus"></i></button>
                </div>
                <button class="btn btn-primary" id="customDishSubmit"><i class="fa-solid fa-cart-plus"></i> 加入购物车</button>
            </div>
        </div>
    `);
    bindCustomDishSubmit();

    // 点击卡片 → 详情
    listEl.querySelectorAll('.dish-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.dish-add')) return;
            const id = card.dataset.id;
            selectedDish = dishes.find(d => String(d.id) === String(id));
            navigate('dish', true, id);
        });
    });
    // 加号按钮 → 直接加购物车
    listEl.querySelectorAll('.dish-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const dish = dishes.find(d => String(d.id) === String(id));
            if (!dish || dish.status !== 'on') {
                toast('该菜品已下架，无法加购');
                return;
            }
            addToCart(dish, 1);
            toast('已加入购物车');
        });
    });
}

// ============ 自定义菜品提交 ============
let customQty = 1;

function bindCustomDishSubmit() {
    const minus = document.getElementById('customQtyMinus');
    const plus = document.getElementById('customQtyPlus');
    const num = document.getElementById('customQtyNum');
    const submit = document.getElementById('customDishSubmit');
    const nameInput = document.getElementById('customDishName');
    if (!minus || !plus || !num || !submit || !nameInput) return;

    minus.addEventListener('click', () => {
        if (customQty > 1) { customQty--; num.textContent = customQty; }
    });
    plus.addEventListener('click', () => {
        customQty++; num.textContent = customQty;
    });
    submit.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) { toast('请先填写想吃的菜名'); return; }

        // 自定义菜加入购物车（不再直接下单）
        addToCart({
            id: 'custom_' + name,
            name: name,
            emoji: '🍽️',
            qty: customQty,
            isCustom: true,
        }, customQty);

        toast('已加入购物车');
        nameInput.value = '';
        customQty = 1;
        num.textContent = '1';
    });
}

// ============ 菜品详情 ============
let detailQty = 1;
function renderDishDetail() {
    const el = document.getElementById('dishDetail');
    if (!selectedDish) return;
    detailQty = 1;
    const off = selectedDish.status !== 'on';
    const imgSrc = dishImg(selectedDish);
    const isPlaceholder = imgSrc === DISH_IMG;
    const descText = selectedDish.description || '张大厨现点现做，家常好味';
    el.innerHTML = `
        <div class="detail-hero">
            <img class="detail-img ${isPlaceholder ? 'is-placeholder' : ''}" src="${imgSrc}" alt="${escapeHtml(selectedDish.name)}">
            <div class="detail-body">
                ${selectedDish.category ? `<span class="detail-category">${escapeHtml(selectedDish.category)}</span>` : ''}
                <div class="detail-name">${escapeHtml(selectedDish.name)}${off ? '<span class="dish-soldout-tag">已下架</span>' : ''}</div>
                <div class="detail-desc">${escapeHtml(descText)}</div>
                <div class="detail-qty">
                    <button class="qty-btn" id="qtyMinus" aria-label="减少数量"><i class="fa-solid fa-minus"></i></button>
                    <span class="qty-num" id="qtyNum">1</span>
                    <button class="qty-btn" id="qtyPlus" aria-label="增加数量"><i class="fa-solid fa-plus"></i></button>
                </div>
                ${off
                    ? `<button class="btn btn-lg detail-add-btn btn-disabled" disabled>
                        <i class="fa-solid fa-ban"></i> 该菜品已下架
                    </button>`
                    : `<button class="btn btn-primary btn-lg detail-add-btn" id="detailAddBtn">
                        <i class="fa-solid fa-cart-plus"></i> 加入购物车
                    </button>`}
            </div>
        </div>
    `;
    document.getElementById('qtyMinus').addEventListener('click', () => {
        if (detailQty > 1) { detailQty--; document.getElementById('qtyNum').textContent = detailQty; }
    });
    document.getElementById('qtyPlus').addEventListener('click', () => {
        detailQty++; document.getElementById('qtyNum').textContent = detailQty;
    });
    const addBtn = document.getElementById('detailAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (selectedDish.status !== 'on') {
                toast('该菜品已下架，无法加购');
                return;
            }
            addToCart(selectedDish, detailQty);
            toast('已加入购物车');
            navigate('cart');
        });
    }
}

// ============ 购物车操作 ============
function addToCart(dish, qty) {
    // 后端状态兜底：下架菜品（非自定义菜）禁止加购
    if (dish && !dish.isCustom && dish.status !== 'on') {
        toast('该菜品已下架，无法加购');
        return;
    }
    const cart = getCart();
    const existing = cart.find(it => String(it.id) === String(dish.id));
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({
            id: dish.id,
            name: dish.name,
            emoji: dish.emoji || '🍽️',
            image_url: dish.image_url || '',
            qty,
            isCustom: !!dish.isCustom,
        });
    }
    setCart(cart);
}

function changeQty(id, delta) {
    const cart = getCart();
    const item = cart.find(it => String(it.id) === String(id));
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        const idx = cart.indexOf(item);
        cart.splice(idx, 1);
    }
    setCart(cart);
    renderCart();
}

function removeItem(id) {
    let cart = getCart();
    cart = cart.filter(it => String(it.id) !== String(id));
    setCart(cart);
    renderCart();
}

function renderCart() {
    const cart = getCart();
    const contentEl = document.getElementById('cartContent');
    const footerEl = document.getElementById('cartFooter');

    if (cart.length === 0) {
        contentEl.innerHTML = `
            <div class="cart-empty">
                <i class="fa-solid fa-cart-shopping"></i>
                <p>购物车还是空的，去选几道菜吧～</p>
            </div>
        `;
        footerEl.innerHTML = '';
        return;
    }

    const totalQty = cart.reduce((s, it) => s + it.qty, 0);
    contentEl.innerHTML = cart.map(it => `
        <div class="cart-item">
            <img class="cart-item-img" src="${dishImg(it)}" alt="${escapeHtml(it.name)}">
            <div class="cart-item-info">
                <div class="cart-item-name">${escapeHtml(it.name)}</div>
            </div>
            <div class="cart-item-qty">
                <button class="qty-btn" data-act="minus" data-id="${it.id}" aria-label="减少数量"><i class="fa-solid fa-minus"></i></button>
                <span class="qty-num">${it.qty}</span>
                <button class="qty-btn" data-act="plus" data-id="${it.id}" aria-label="增加数量"><i class="fa-solid fa-plus"></i></button>
            </div>
            <button class="cart-item-del" data-id="${it.id}" aria-label="删除"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `).join('');

    footerEl.innerHTML = `
        <div class="cart-total">
            <span>共 ${totalQty} 道菜</span>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="checkoutBtn">
            <i class="fa-solid fa-check"></i> 去下单
        </button>
    `;

    contentEl.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
            changeQty(btn.dataset.id, btn.dataset.act === 'plus' ? 1 : -1);
        });
    });
    contentEl.querySelectorAll('.cart-item-del').forEach(btn => {
        btn.addEventListener('click', () => removeItem(btn.dataset.id));
    });
    document.getElementById('checkoutBtn').addEventListener('click', () => navigate('checkout'));
}

// ============ 结算页 ============
let checkoutNickname = '';
let checkoutRemark = '';

function renderCheckout() {
    const cart = getCart();
    const el = document.getElementById('checkoutContent');
    if (cart.length === 0) {
        el.innerHTML = '<div class="empty-tip"><i class="fa-solid fa-cart-shopping"></i><p>购物车是空的</p></div>';
        return;
    }
    el.innerHTML = `
        <div class="checkout-section">
            <div class="checkout-section-title"><i class="fa-solid fa-receipt"></i> 点餐清单</div>
            ${cart.map(it => `
                <div class="checkout-item">
                    <span>${escapeHtml(it.emoji)} ${escapeHtml(it.name)}</span>
                    <span>× ${it.qty}</span>
                </div>
            `).join('')}
        </div>
        <div class="checkout-section">
            <div class="checkout-section-title"><i class="fa-solid fa-user"></i> 你的称呼（选填）</div>
            <input class="checkout-input" id="checkoutNickname" placeholder="如：小明（不填则匿名）" maxlength="20">
        </div>
        <div class="checkout-section">
            <div class="checkout-section-title"><i class="fa-solid fa-pen"></i> 备注（选填）</div>
            <textarea class="checkout-input checkout-textarea" id="checkoutRemark" placeholder="如：不要辣、多放香菜" maxlength="100"></textarea>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="submitOrderBtn">
            <i class="fa-solid fa-paper-plane"></i> 提交订单
        </button>
    `;
    document.getElementById('checkoutNickname').addEventListener('input', (e) => checkoutNickname = e.target.value);
    document.getElementById('checkoutRemark').addEventListener('input', (e) => checkoutRemark = e.target.value);
    document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
}

async function submitOrder() {
    const cart = getCart();
    if (cart.length === 0) { toast('购物车是空的'); return; }

    const btn = document.getElementById('submitOrderBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 提交中...';

    const ok = await ensureSession();
    if (!ok) {
        toast('登录失败，请重试');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 提交订单';
        return;
    }

    // 后端校验：提交前重新查询菜单菜最新状态，拒绝下架菜品
    const menuIds = cart.filter(it => !it.isCustom).map(it => it.id);
    if (menuIds.length > 0) {
        const { data: dishData, error: dishErr } = await db.from('restaurant_dishes')
            .select('id, status')
            .in('id', menuIds);
        if (dishErr) {
            toast('提交失败：无法校验菜品状态');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 提交订单';
            return;
        }
        const offDish = (dishData || []).find(d => d.status !== 'on');
        if (offDish) {
            toast('「' + (cart.find(it => String(it.id) === String(offDish.id))?.name || '部分菜品') + '」已下架，请从购物车移除后再下单');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 提交订单';
            return;
        }
    }

    // 生成订单号
    const orderNo = 'ZD' + Date.now() + Math.floor(Math.random() * 1000);
    // 每道菜初始状态为待制作，绝不直接为已完成
    const items = cart.map(it => ({ name: it.name, emoji: it.emoji, qty: it.qty, isCustom: !!it.isCustom, status: 'pending' }));

    const { data, error } = await db.from('restaurant_orders').insert({
        order_no: orderNo,
        nickname: checkoutNickname.trim() || null,
        items: items,
        remark: checkoutRemark.trim() || null,
        status: 'pending',
    });

    if (error) {
        console.error('提交订单失败', error);
        toast('提交失败：' + (error.message || '请重试'));
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 提交订单';
        return;
    }

    clearCart();
    checkoutNickname = '';
    checkoutRemark = '';
    toast('下单成功！');
    navigate('orders');
}

// ============ 订单列表 ============
const STATUS_MAP = {
    pending: { text: '待制作', cls: 'status-pending' },
    cooking: { text: '制作中', cls: 'status-cooking' },
    done: { text: '已完成', cls: 'status-done' },
    cancelled: { text: '已取消', cls: 'status-cancelled' },
};

async function renderOrders() {
    const el = document.getElementById('ordersContent');
    el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner"></i><p>加载中...</p></div>';

    const ok = await ensureSession();
    if (!ok) { el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>'; return; }

    const { data, error } = await db.from('restaurant_orders')
        .select('id, order_no, nickname, items, remark, status, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('加载订单失败', error);
        el.innerHTML = '<div class="empty-tip"><p>订单加载失败</p></div>';
        return;
    }

    const orders = data || [];
    if (orders.length === 0) {
        el.innerHTML = '<div class="empty-tip"><i class="fa-solid fa-clipboard-list"></i><p>还没有订单，去点餐吧～</p></div>';
        return;
    }

    el.innerHTML = orders.map(o => {
        const st = STATUS_MAP[o.status] || STATUS_MAP.pending;
        const itemList = o.items || [];
        const items = itemList.length > 0
            ? itemList.map(it => {
                const itSt = STATUS_MAP[it.status] || STATUS_MAP.pending;
                return `<span class="order-item-tag">${escapeHtml(it.emoji)} ${escapeHtml(it.name)} <span class="qty">×${it.qty}</span> <span class="item-status ${itSt.cls}">${itSt.text}</span></span>`;
            }).join('')
            : '<span class="order-item-tag" style="color:var(--c-text-sub);">菜品已全部完成</span>';
        const time = o.created_at ? new Date(o.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        // 仅待制作（pending）且未取消的订单可取消
        const canCancel = o.status === 'pending';
        return `
            <div class="order-card ${o.status === 'cancelled' ? 'order-cancelled' : ''}">
                <div class="order-head">
                    <span class="order-no">#${escapeHtml(o.order_no)}</span>
                    <span class="status-badge ${st.cls}">${st.text}</span>
                </div>
                <div class="order-items">${items}</div>
                <div class="order-foot">
                    <span>${escapeHtml(o.nickname || '匿名')}</span>
                    ${o.remark ? `<span class="order-remark">备注：${escapeHtml(o.remark)}</span>` : ''}
                    <span>${escapeHtml(time)}</span>
                </div>
                ${canCancel ? `
                    <div class="order-cancel-row">
                        <button class="btn btn-outline btn-sm order-cancel-btn" data-cancel-id="${o.id}">
                            <i class="fa-solid fa-ban"></i> 取消订单
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // 绑定取消订单事件
    el.querySelectorAll('[data-cancel-id]').forEach(btn => {
        btn.addEventListener('click', () => cancelOrder(btn.dataset.cancelId));
    });
}

// ============ 取消订单 ============
async function cancelOrder(orderId) {
    if (!confirm('确定要取消这笔订单吗？取消后张大厨将不再制作。')) return;

    const ok = await ensureSession();
    if (!ok) { toast('登录失败，请重试'); return; }

    // 1. 校验订单当前状态：仅 pending 可取消
    const { data: order, error: e1 } = await db.from('restaurant_orders')
        .select('status, items').eq('id', Number(orderId)).single();
    if (e1 || !order) {
        console.error('读取订单失败', e1);
        toast('取消失败：订单不存在');
        return;
    }
    if (order.status === 'cancelled') {
        toast('订单已取消');
        renderOrders();
        return;
    }
    if (order.status !== 'pending') {
        toast('订单已开始制作，无法取消');
        renderOrders();
        return;
    }

    // 2. 更新为已取消
    const { error: e2 } = await db.from('restaurant_orders')
        .update({ status: 'cancelled' })
        .eq('id', Number(orderId));
    if (e2) {
        console.error('取消订单失败', e2);
        toast('取消失败，请重试');
        return;
    }

    toast('订单已取消');
    renderOrders();
}

// ============ 管理员页 ============
let adminAuthed = false;
let adminTab = 'orders'; // orders | dishes | completed | data

function renderAdmin() {
    const el = document.getElementById('adminContent');
    if (!adminAuthed) {
        el.innerHTML = `
            <div class="admin-lock">
                <i class="fa-solid fa-lock"></i>
                <div class="admin-lock-title">张大厨入口</div>
                <div class="admin-lock-desc">仅张大厨可进入，请输入口令</div>
                <input class="checkout-input" id="adminPwd" type="password" placeholder="请输入口令" style="margin-bottom:16px;">
                <button class="btn btn-primary btn-block" id="adminLoginBtn">进入</button>
            </div>
        `;
        document.getElementById('adminLoginBtn').addEventListener('click', () => {
            const pwd = document.getElementById('adminPwd').value.trim();
            if (pwd === ADMIN_PASSWORD) {
                adminAuthed = true;
                toast('欢迎回来，张大厨！');
                renderAdmin();
            } else {
                toast('口令错误');
            }
        });
        return;
    }

    // 已通过口令，显示页签导航
    renderAdminTabs();
}

function renderAdminTabs() {
    const el = document.getElementById('adminContent');
    el.innerHTML = `
        <div class="admin-tabs">
            <div class="admin-tab ${adminTab === 'orders' ? 'active' : ''}" data-tab="orders">订单管理<span class="admin-tab-badge" id="adminTabBadge" style="display:none;"></span></div>
            <div class="admin-tab ${adminTab === 'dishes' ? 'active' : ''}" data-tab="dishes">菜品管理</div>
            <div class="admin-tab ${adminTab === 'completed' ? 'active' : ''}" data-tab="completed">历史记录</div>
            <div class="admin-tab ${adminTab === 'data' ? 'active' : ''}" data-tab="data">数据清理</div>
        </div>
        <div class="admin-tab-body" id="adminTabBody"></div>
    `;
    el.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            adminTab = tab.dataset.tab;
            renderAdminTabs();
        });
    });

    // 异步刷新订单管理页签角标
    getPendingOrderCount().then(count => {
        const badge = document.getElementById('adminTabBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    });

    if (adminTab === 'orders') renderAdminOrders();
    else if (adminTab === 'dishes') renderAdminDishes();
    else if (adminTab === 'completed') renderAdminCompleted();
    else renderAdminDataClear();
}

async function renderAdminOrders() {
    const el = document.getElementById('adminTabBody');
    el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner"></i><p>加载订单...</p></div>';

    const ok = await ensureSession();
    if (!ok) { el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>'; return; }

    // 只展示还有未完成菜品的订单（status != 'done' 且 != 'cancelled'）
    const { data, error } = await db.from('restaurant_orders')
        .select('id, order_no, nickname, items, remark, status, created_at')
        .neq('status', 'done')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('加载订单失败', error);
        el.innerHTML = '<div class="empty-tip"><p>订单加载失败</p></div>';
        return;
    }

    const orders = (data || []).filter(o => (o.items || []).some(it => it.status !== 'done'));

    let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:700;">订单管理${orders.length > 0 ? ` <span class="admin-pending-count">${orders.length} 单待做</span>` : ''}</div>
            <button class="admin-btn admin-btn-cooking" id="adminRefresh" style="flex:0 0 auto;padding:6px 14px;">刷新</button>
        </div>
    `;

    if (orders.length === 0) {
        html += '<div class="empty-tip"><i class="fa-solid fa-clipboard-list"></i><p>暂无待处理订单</p></div>';
    } else {
        // 顶部醒目提醒横幅
        html += `
            <div class="admin-alert-banner" id="adminAlertBanner">
                <i class="fa-solid fa-bell"></i> 后台有餐待做，共 ${orders.length} 单，请尽快处理
            </div>
        `;
        html += `<div class="admin-orders">` + orders.map(o => {
            const time = o.created_at ? new Date(o.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            // 仅展示未完成菜品，保留原数组索引供制作/完成操作定位
            const pendingEntries = (o.items || [])
                .map((it, idx) => ({ it, idx }))
                .filter(entry => entry.it.status !== 'done');
            const dishRows = pendingEntries.map(({ it, idx }) => {
                const itSt = it.status || 'pending';
                const stBadge = STATUS_MAP[itSt] || STATUS_MAP.pending;
                let actions = '';
                if (itSt === 'pending') {
                    actions = `<button class="admin-btn admin-btn-cooking" data-act="cook" data-oid="${o.id}" data-idx="${idx}"><i class="fa-solid fa-fire"></i> 开始制作</button>`;
                } else if (itSt === 'cooking') {
                    actions = `<button class="admin-btn admin-btn-done" data-act="complete" data-oid="${o.id}" data-idx="${idx}"><i class="fa-solid fa-check"></i> 完成</button>`;
                }
                return `
                    <div class="dish-complete-row">
                        <div class="dish-complete-info">
                            <span class="dish-complete-name">${escapeHtml(it.name)}</span>
                            <span class="custom-dish-qty-badge">×${it.qty}</span>
                            ${it.isCustom ? '<span class="dish-custom-tag">自定义</span>' : ''}
                            <span class="status-badge ${stBadge.cls}" style="padding:2px 8px;font-size:11px;">${stBadge.text}</span>
                        </div>
                        ${actions}
                    </div>
                `;
            }).join('');
            return `
                <div class="order-card">
                    <div class="order-head">
                        <span class="order-no">#${escapeHtml(o.order_no)}</span>
                        <span class="custom-dish-qty-badge">${pendingEntries.length} 道菜</span>
                    </div>
                    <div style="font-size:14px;margin:4px 0 8px;">
                        <strong>${escapeHtml(o.nickname || '匿名')}</strong>
                    </div>
                    ${dishRows}
                    ${o.remark ? `<div style="font-size:13px;color:var(--c-wood);margin:8px 0 0;">备注：${escapeHtml(o.remark)}</div>` : ''}
                    <div style="font-size:12px;color:var(--c-text-sub);margin-top:8px;">${escapeHtml(time)}</div>
                </div>
            `;
        }).join('') + `</div>`;
    }

    el.innerHTML = html;

    document.getElementById('adminRefresh')?.addEventListener('click', renderAdminOrders);
    el.querySelectorAll('[data-act="cook"]').forEach(btn => {
        btn.addEventListener('click', () => cookDish(btn.dataset.oid, parseInt(btn.dataset.idx, 10)));
    });
    el.querySelectorAll('[data-act="complete"]').forEach(btn => {
        btn.addEventListener('click', () => completeDish(btn.dataset.oid, parseInt(btn.dataset.idx, 10)));
    });
}

// 菜品开始制作（pending -> cooking）
async function cookDish(orderId, itemIndex) {
    const btn = document.querySelector(`[data-act="cook"][data-oid="${orderId}"][data-idx="${itemIndex}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 处理中'; }

    const { data: order, error: e1 } = await db.from('restaurant_orders')
        .select('items').eq('id', Number(orderId)).single();
    if (e1 || !order) {
        console.error('读取订单失败', e1);
        toast('操作失败');
        renderAdminOrders();
        return;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const item = items[itemIndex];
    if (!item) {
        toast('菜品不存在');
        renderAdminOrders();
        return;
    }

    // 标记该菜品为制作中
    const newItems = items.map((it, i) => i === itemIndex ? { ...it, status: 'cooking' } : it);

    const { error: e2 } = await db.from('restaurant_orders')
        .update({ items: newItems, status: 'cooking' })
        .eq('id', Number(orderId));
    if (e2) {
        console.error('更新订单失败', e2);
        toast('操作失败');
        renderAdminOrders();
        return;
    }

    toast('已开始制作');
    renderAdminOrders();
}

async function completeDish(orderId, itemIndex) {
    const btn = document.querySelector(`[data-act="complete"][data-oid="${orderId}"][data-idx="${itemIndex}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 处理中'; }

    // 1. 读当前订单 items
    const { data: order, error: e1 } = await db.from('restaurant_orders')
        .select('items, status').eq('id', Number(orderId)).single();
    if (e1 || !order) {
        console.error('读取订单失败', e1);
        toast('操作失败');
        renderAdminOrders();
        return;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const item = items[itemIndex];
    if (!item || item.status === 'done') {
        toast('该菜品已处理');
        renderAdminOrders();
        return;
    }

    // 2. 将该菜品标记为已完成（保留在订单明细中以便顾客回看历史订单菜品）
    const newItems = items.map((it, i) => i === itemIndex ? { ...it, status: 'done' } : it);
    const remainingCount = newItems.filter(it => it.status !== 'done').length;
    // 全部菜品完成后，订单整体标记为 done
    const newStatus = remainingCount === 0 ? 'done' : (order.status === 'done' ? 'pending' : order.status);

    // 3. 写入历史记录（已完成菜品）
    const { error: e2 } = await db.from('restaurant_custom_dishes').insert({
        name: item.name,
        qty: item.qty || 1,
        status: 'done',
        done_at: new Date().toISOString(),
    });
    if (e2) {
        console.error('写入历史记录失败', e2);
        toast('操作失败');
        renderAdminOrders();
        return;
    }

    // 4. 更新订单（items + 若全部完成则 status=done）
    const { error: e3 } = await db.from('restaurant_orders')
        .update({ items: newItems, status: newStatus })
        .eq('id', Number(orderId));
    if (e3) {
        console.error('更新订单失败', e3);
        toast('操作失败');
        renderAdminOrders();
        return;
    }

    toast(remainingCount === 0 ? '订单已完成' : '菜品已完成');
    renderAdminOrders();
}

// ============ 管理员：数据清理（仅清除订单，不动菜品） ============
function renderAdminDataClear() {
    const el = document.getElementById('adminTabBody');
    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:700;">数据清理</div>
        </div>

        <div class="order-card">
            <div class="clear-module-title"><i class="fa-solid fa-broom"></i> 清理订单记录</div>
            <p class="clear-module-desc">此功能仅清除「订单记录」与「历史记录」（已完成菜品），<strong>不会删除或清空任何菜品数据</strong>。菜单、菜品图片与分类均保留不变。</p>

            <div class="clear-scope">
                <div class="clear-scope-title">清除范围说明</div>
                <ul class="clear-scope-list">
                    <li><i class="fa-solid fa-check"></i> 所有订单记录（待制作 / 制作中 / 已完成）</li>
                    <li><i class="fa-solid fa-check"></i> 所有历史记录（已完成菜品汇总）</li>
                    <li class="clear-scope-keep"><i class="fa-solid fa-shield-halved"></i> 菜品数据（菜单、图片、分类）—— <strong>不受影响，予以保留</strong></li>
                </ul>
            </div>

            <div class="clear-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>删除后无法恢复，请谨慎操作。</span>
            </div>

            <button class="btn btn-danger btn-block" id="clearOrdersBtn">
                <i class="fa-solid fa-trash-can"></i> 清除订单记录
            </button>
        </div>
    `;

    document.getElementById('clearOrdersBtn')?.addEventListener('click', showClearOrdersConfirm);
}

// 二次确认弹窗（仅针对订单记录，明确不含菜品）
function showClearOrdersConfirm() {
    const confirmed = confirm(
        '⚠️ 确定要清除订单记录吗？\n\n' +
        '将永久删除：\n' +
        '· 所有订单记录\n' +
        '· 所有历史记录（已完成菜品）\n\n' +
        '以下数据【不会被删除】并保持不变：\n' +
        '· 菜品数据（菜单、图片、分类）\n\n' +
        '删除后无法恢复！\n\n' +
        '点击「确定」继续删除，点击「取消」则不进行任何删除。'
    );
    if (!confirmed) {
        toast('已取消，未删除任何数据');
        return;
    }

    // 第二次确认，防止误触
    const doubleConfirmed = confirm(
        '🔒 最后确认：\n\n' +
        '真的要清除订单记录吗？\n' +
        '仅删除订单与历史记录，菜品数据不受影响，此操作不可撤销。'
    );
    if (!doubleConfirmed) {
        toast('已取消，未删除任何数据');
        return;
    }

    clearOrdersData();
}

async function clearOrdersData() {
    const btn = document.getElementById('clearOrdersBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 清除中...'; }

    const ok = await ensureSession();
    if (!ok) {
        toast('操作失败：登录异常');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 清除订单记录'; }
        return;
    }

    // 仅清空两张表（订单、历史记录），绝不触碰菜品表 restaurant_dishes
    const results = [];

    const r1 = await db.from('restaurant_orders').delete().neq('id', 0);
    results.push({ name: '订单', ok: !r1.error, err: r1.error });

    const r2 = await db.from('restaurant_custom_dishes').delete().neq('id', 0);
    results.push({ name: '历史记录', ok: !r2.error, err: r2.error });

    const failed = results.filter(r => !r.ok);
    if (failed.length > 0) {
        console.error('清除订单记录失败', failed);
        toast('清除失败：' + failed.map(f => f.name).join('、') + ' 删除出错');
    } else {
        toast('已清除订单记录（菜品数据保持不变）');
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 清除订单记录'; }

    // 仅刷新订单 / 历史相关页签；菜品管理不受影响
    if (adminTab === 'orders') renderAdminOrders();
    else if (adminTab === 'completed') renderAdminCompleted();
    else renderAdminDataClear();
}

// ============ 管理员：菜品管理 ============
async function loadAllDishes() {
    const { data, error } = await db.from('restaurant_dishes')
        .select('id, name, category, description, emoji, image_url, status, sort')
        .order('category', { ascending: true })
        .order('sort', { ascending: true });
    if (error) {
        console.error('加载全部菜品失败', error);
        return [];
    }
    const list = data || [];
    await resolveCloudImages(list);
    return list;
}

// 压缩图片并输出 Blob 与预览 dataURL
function compressImage(file, maxSize = 600, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve({ blob: null, dataUrl: '' }); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                const scale = Math.min(1, maxSize / Math.max(w, h));
                w = Math.round(w * scale);
                h = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                if (canvas.toBlob) {
                    canvas.toBlob(blob => resolve({ blob, dataUrl }), 'image/jpeg', quality);
                } else {
                    resolve({ blob: null, dataUrl });
                }
            };
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

// 优先上传至 CloudBase 云存储（数据库仅存 fileID，避免 base64 膨胀）；若云存储未开通权限则自动降级为压缩 base64
async function uploadDishImage(file) {
    const { blob, dataUrl } = await compressImage(file, 600, 0.82);
    if (blob && app && typeof app.uploadFile === 'function') {
        try {
            const filename = 'dish_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
            const uploadFileObj = new File([blob], filename, { type: 'image/jpeg' });
            const res = await app.uploadFile({
                cloudPath: 'restaurant-dishes/' + filename,
                filePath: uploadFileObj,
            });
            if (res && res.fileID) {
                cloudImgCache[res.fileID] = dataUrl;
                return { imageUrl: res.fileID, previewUrl: dataUrl, isCloud: true };
            }
        } catch (err) {
            console.warn('云存储上传不可用，降级为压缩图片保存', err);
        }
    }
    const fallback = await compressImage(file, 400, 0.78);
    return { imageUrl: fallback.dataUrl, previewUrl: fallback.dataUrl, isCloud: false };
}

async function renderAdminDishes() {
    const el = document.getElementById('adminTabBody');
    el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner"></i><p>加载菜品...</p></div>';

    const ok = await ensureSession();
    if (!ok) { el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>'; return; }

    const dishes = await loadAllDishes();
    const cats = [];
    dishes.forEach(d => { if (d.category && cats.indexOf(d.category) === -1) cats.push(d.category); });

    // 顶部：新增菜品 + 新增分类表单
    let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:700;">菜品管理</div>
            <button class="admin-btn admin-btn-cooking" id="dishRefresh" style="flex:0 0 auto;padding:6px 14px;">刷新</button>
        </div>

        <div class="order-card">
            <div style="font-size:14px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-plus"></i> 新增菜品</div>
            <div class="dish-form-row">
                <input class="checkout-input" id="newDishName" placeholder="菜品名称（必填）" maxlength="30">
            </div>
            <div class="dish-form-row">
                <select class="checkout-input" id="newDishCategory">
                    <option value="">选择分类（必填）</option>
                    ${cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                    <option value="__new__">＋ 新建分类…</option>
                </select>
            </div>
            <div class="dish-form-row" id="newCategoryRow" style="display:none;">
                <input class="checkout-input" id="newCategoryName" placeholder="输入新分类名称" maxlength="20">
            </div>
            <div class="dish-form-row">
                <input class="checkout-input" id="newDishDesc" placeholder="菜品描述（选填）" maxlength="50">
            </div>
            <div class="dish-form-row">
                <label class="dish-img-upload" id="newDishImgLabel">
                    <img id="newDishImgPreview" src="${DISH_IMG}" alt="预览">
                    <span>点击选择菜品照片</span>
                </label>
                <input type="file" id="newDishImgFile" accept="image/*" style="display:none;">
            </div>
            <button class="btn btn-primary btn-block" id="saveNewDishBtn" style="margin-top:10px;">
                <i class="fa-solid fa-check"></i> 保存菜品
            </button>
        </div>
    `;

    // 菜品列表（含已下架，置灰显示）
    if (dishes.length === 0) {
        html += '<div class="empty-tip"><i class="fa-solid fa-utensils"></i><p>暂无菜品</p></div>';
    } else {
        html += `<div style="font-size:14px;font-weight:700;margin-top:4px;">全部菜品（${dishes.length}）</div><div class="admin-orders">`;
        html += dishes.map(d => {
            const off = d.status !== 'on';
            return `
                <div class="order-card ${off ? 'dish-off' : ''}">
                    <div class="dish-manage-row">
                        <img class="cart-item-img" src="${dishImg(d)}" alt="${escapeHtml(d.name)}">
                        <div class="dish-manage-info">
                            <div class="dish-manage-name">${escapeHtml(d.name)}</div>
                            <div class="dish-manage-meta">${escapeHtml(d.category)}${off ? ' · 已下架' : ''}</div>
                        </div>
                        <span class="custom-dish-qty-badge">${off ? '已下架' : '在售'}</span>
                    </div>
                    <div class="admin-order-actions">
                        <button class="admin-btn admin-btn-cooking" data-act="chgimg" data-id="${d.id}"><i class="fa-solid fa-image"></i> 换图</button>
                        ${off
                            ? `<button class="admin-btn admin-btn-done" data-act="toggle" data-id="${d.id}" data-status="on"><i class="fa-solid fa-arrow-up"></i> 上架</button>`
                            : `<button class="admin-btn admin-btn-cooking" data-act="toggle" data-id="${d.id}" data-status="off"><i class="fa-solid fa-arrow-down"></i> 下架</button>`}
                        <button class="admin-btn admin-btn-danger" data-act="del" data-id="${d.id}"><i class="fa-solid fa-trash-can"></i> 删除</button>
                    </div>
                </div>
            `;
        }).join('') + `</div>`;
    }

    el.innerHTML = html;

    // 事件绑定
    document.getElementById('dishRefresh')?.addEventListener('click', renderAdminDishes);

    // 分类下拉切换：选择"新建分类"时显示输入框
    const catSelect = document.getElementById('newDishCategory');
    catSelect?.addEventListener('change', () => {
        document.getElementById('newCategoryRow').style.display = (catSelect.value === '__new__') ? 'flex' : 'none';
    });

    // 图片选择预览（优先上传至云存储，自动降级为压缩图片）
    let newDishImageData = '';
    const imgFileInput = document.getElementById('newDishImgFile');
    const imgLabel = document.getElementById('newDishImgLabel');
    const imgPreview = document.getElementById('newDishImgPreview');
    imgLabel?.addEventListener('click', () => imgFileInput.click());
    imgFileInput?.addEventListener('change', async () => {
        const file = imgFileInput.files[0];
        if (!file) return;
        try {
            toast('图片上传中...');
            const uploaded = await uploadDishImage(file);
            newDishImageData = uploaded.imageUrl;
            imgPreview.src = uploaded.previewUrl;
            toast(uploaded.isCloud ? '图片已上传至云存储' : '图片已处理完成');
        } catch (err) {
            toast('图片处理失败');
        }
    });

    document.getElementById('saveNewDishBtn')?.addEventListener('click', async () => {
        const name = document.getElementById('newDishName').value.trim();
        const desc = document.getElementById('newDishDesc').value.trim();
        let category = catSelect.value;
        if (!name) { toast('请填写菜品名称'); return; }
        if (category === '__new__') {
            category = document.getElementById('newCategoryName').value.trim();
            if (!category) { toast('请填写新分类名称'); return; }
        }
        if (!category) { toast('请选择分类'); return; }

        // 重名校验：同名菜品（忽略大小写、忽略前后空格）禁止重复添加
        const nameKey = name.toLowerCase();
        const duplicate = dishes.find(d => (d.name || '').trim().toLowerCase() === nameKey);
        if (duplicate) {
            toast('该菜品已添加过，请更换其他菜名');
            return;
        }

        const btn = document.getElementById('saveNewDishBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';

        // 计算 sort：同分类最大值 + 1
        const sameCat = dishes.filter(d => d.category === category);
        const maxSort = sameCat.reduce((m, d) => Math.max(m, d.sort || 0), 0);

        const { error } = await db.from('restaurant_dishes').insert({
            name,
            category,
            description: desc || null,
            emoji: '🍽️',
            image_url: newDishImageData || null,
            status: 'on',
            sort: maxSort + 1,
        });

        if (error) {
            console.error('新增菜品失败', error);
            toast('新增失败：' + (error.message || '请重试'));
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 保存菜品';
            return;
        }

        // 清空本地菜单缓存，下次重新加载
        dishesCache = [];
        toast('菜品已新增');
        renderAdminDishes();
    });

    // 菜品操作：换图 / 上架下架 / 删除
    el.querySelectorAll('[data-act="chgimg"]').forEach(btn => {
        btn.addEventListener('click', () => changeDishImage(btn.dataset.id));
    });
    el.querySelectorAll('[data-act="toggle"]').forEach(btn => {
        btn.addEventListener('click', () => toggleDishStatus(btn.dataset.id, btn.dataset.status));
    });
    el.querySelectorAll('[data-act="del"]').forEach(btn => {
        btn.addEventListener('click', () => deleteDish(btn.dataset.id));
    });
}

// 更换菜品图片（优先上传至 CloudBase 云存储）
function changeDishImage(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            toast('图片上传中...');
            const uploaded = await uploadDishImage(file);
            const { error } = await db.from('restaurant_dishes')
                .update({ image_url: uploaded.imageUrl })
                .eq('id', Number(id));
            if (error) {
                console.error('更换图片失败', error);
                toast('更换失败');
                return;
            }
            dishesCache = [];
            toast(uploaded.isCloud ? '图片已上传并更新' : '图片已更新');
            renderAdminDishes();
        } catch (err) {
            toast('图片处理失败');
        }
    };
    input.click();
}

// 上架 / 下架菜品
async function toggleDishStatus(id, status) {
    const { error } = await db.from('restaurant_dishes')
        .update({ status })
        .eq('id', Number(id));
    if (error) {
        console.error('更新菜品状态失败', error);
        toast('操作失败');
        return;
    }
    dishesCache = [];
    toast(status === 'on' ? '已上架' : '已下架');
    renderAdminDishes();
}

// 删除菜品
async function deleteDish(id) {
    if (!confirm('确定要删除这道菜吗？此操作不可恢复。')) return;
    const { error } = await db.from('restaurant_dishes')
        .delete()
        .eq('id', Number(id));
    if (error) {
        console.error('删除菜品失败', error);
        toast('删除失败：' + (error.message || '请重试'));
        return;
    }
    dishesCache = [];
    toast('已删除');
    renderAdminDishes();
}

// ============ 管理员：历史记录（同名合并统计） ============
async function renderAdminCompleted() {
    const el = document.getElementById('adminTabBody');
    el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner"></i><p>加载中...</p></div>';

    const ok = await ensureSession();
    if (!ok) { el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>'; return; }

    const { data, error } = await db.from('restaurant_custom_dishes')
        .select('id, name, qty, status, done_at')
        .eq('status', 'done')
        .order('done_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('加载已完成菜品失败', error);
        el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>';
        return;
    }

    const items = data || [];
    let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:700;">已完成菜品</div>
            <button class="admin-btn admin-btn-cooking" id="completedRefresh" style="flex:0 0 auto;padding:6px 14px;">刷新</button>
        </div>
    `;

    if (items.length === 0) {
        html += '<div class="empty-tip"><i class="fa-solid fa-check-double"></i><p>还没有已完成的菜品</p></div>';
    } else {
        // 按完成日期分组：同一日期一组，日期倒序排列；组内保留每条菜品记录（名称 + 数量）
        const groups = groupDishesByDate(items);

        html += groups.map(g => {
            return `
                <div class="completed-date-group">
                    <div class="completed-date-head"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(g.dateLabel)}</div>
                    <div class="admin-orders">` + g.items.map(m => {
                        return `
                            <div class="order-card completed-item">
                                <div class="order-head">
                                    <span class="custom-dish-name">${escapeHtml(m.name)}</span>
                                    <span class="custom-dish-qty-badge">共 ${m.qty} 份</span>
                                </div>
                            </div>
                        `;
                    }).join('') + `</div>
                </div>
            `;
        }).join('');
    }

    el.innerHTML = html;

    document.getElementById('completedRefresh')?.addEventListener('click', renderAdminCompleted);
}

// ============ 已完成菜品独立页（顾客/公共入口） ============
async function renderCompleted() {
    const el = document.getElementById('completedContent');
    el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner"></i><p>加载中...</p></div>';

    const ok = await ensureSession();
    if (!ok) { el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>'; return; }

    const { data, error } = await db.from('restaurant_custom_dishes')
        .select('id, name, qty, status, done_at')
        .eq('status', 'done')
        .order('done_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('加载已完成菜品失败', error);
        el.innerHTML = '<div class="empty-tip"><p>加载失败</p></div>';
        return;
    }

    const items = data || [];
    if (items.length === 0) {
        el.innerHTML = '<div class="empty-tip"><i class="fa-solid fa-check-double"></i><p>还没有已完成的菜品</p></div>';
        return;
    }

    // 按完成日期分组：同一日期一组，日期倒序排列；组内保留每条菜品记录（名称 + 数量）
    const groups = groupDishesByDate(items);

    el.innerHTML = groups.map(g => {
        return `
            <div class="completed-date-group">
                <div class="completed-date-head"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(g.dateLabel)}</div>
                <div class="completed-list">` + g.items.map(m => {
                    return `
                        <div class="order-card completed-item">
                            <div class="order-head">
                                <span class="custom-dish-name">${escapeHtml(m.name)}</span>
                                <span class="custom-dish-qty-badge">共 ${m.qty} 份</span>
                            </div>
                        </div>
                    `;
                }).join('') + `</div>
            </div>
        `;
    }).join('');
}

// ============ 按日期分组工具函数 ============
// 将已完成菜品记录按 done_at 的日期分组，日期倒序（最新在前）
// 组内保留每条原始记录（名称 + 数量），不合并同名
function groupDishesByDate(items) {
    const groups = {};
    items.forEach(c => {
        const d = c.done_at ? new Date(c.done_at) : new Date(0);
        const dateKey = isNaN(d.getTime())
            ? '未知日期'
            : d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const sortKey = isNaN(d.getTime()) ? 0 : d.getTime();
        if (!groups[dateKey]) {
            groups[dateKey] = { dateLabel: dateKey, sortKey, items: [] };
        }
        groups[dateKey].items.push({ name: c.name, qty: c.qty || 0 });
    });

    // 日期倒序排列
    return Object.values(groups).sort((a, b) => b.sortKey - a.sortKey);
}

// ============ 事件绑定 ============
function bindEvents() {
    document.getElementById('navBack').addEventListener('click', goBack);
    document.getElementById('navCart').addEventListener('click', () => navigate('cart'));

    // 首页按钮
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.nav));
    });

    // 监听浏览器/手机返回键与窗口缩放
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('resize', updateCategoryTabsFade);
}

// ============ 启动 ============
async function bootstrap() {
    initCloud();
    updateCartBadge();
    bindEvents();
    // 预登录
    try { await ensureSession(); } catch (e) { console.warn('预登录失败', e); }
    // 按当前 Hash 初始化页面
    handleHashChange();
}

document.addEventListener('DOMContentLoaded', bootstrap);
