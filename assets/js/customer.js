const SUPABASE_URL = "https://hbcyqusivblucwphhfui.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xwFsCz8CdeeElgzN5ETWRw_jqSihBjQ";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentRestaurantId = null;
let cart = [];
let activeSubscription = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadRestaurants();
    
    document.getElementById('restaurantSelect').addEventListener('change', async (e) => {
        currentRestaurantId = e.target.value;
        if (currentRestaurantId) {
            document.getElementById('menuSection').classList.remove('hidden');
            document.getElementById('cartSection').classList.remove('hidden');
            await loadMenu(currentRestaurantId);
        } else {
            document.getElementById('menuSection').classList.add('hidden');
            document.getElementById('cartSection').classList.add('hidden');
        }
    });

    document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
});

async function loadRestaurants() {
    const { data, error } = await supabase.from('restaurants').select('id, name').eq('is_online', true);
    if (error) return console.error(error);
    
    const select = document.getElementById('restaurantSelect');
    select.innerHTML = '<option value="">-- Choose Store --</option>' + 
        data.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}

async function loadMenu(restaurantId) {
    const { data, error } = await supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).eq('is_available', true);
    if (error) return console.error(error);

    const categories = ['All', ...new Set(data.map(i => i.category))];
    const categoryTabs = document.getElementById('categoryTabs');
    categoryTabs.innerHTML = categories.map((c, i) => 
        `<button class="${i === 0 ? 'active' : ''}" onclick="filterCategory('${c}')">${c}</button>`
    ).join('');

    window.menuData = data;
    renderMenu(data);
}

function renderMenu(items) {
    const grid = document.getElementById('menuGrid');
    grid.innerHTML = items.map(item => `
        <div class="card">
            <h3>${item.name}</h3>
            <p>$${item.price.toFixed(2)}</p>
            <button class="btn-primary" onclick="addToCart('${item.id}')">Add to Order</button>
        </div>
    `).join('');
}

function filterCategory(category) {
    const buttons = document.querySelectorAll('.categories-nav button');
    buttons.forEach(b => b.classList.toggle('active', b.innerText === category));
    
    if (category === 'All') renderMenu(window.menuData);
    else renderMenu(window.menuData.filter(i => i.category === category));
}

function addToCart(itemId) {
    const item = window.menuData.find(i => i.id === itemId);
    const existing = cart.find(i => i.id === itemId);
    if (existing) existing.quantity++;
    else cart.push({ ...item, quantity: 1 });
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cartItems');
    let total = 0;
    container.innerHTML = cart.map(item => {
        total += item.price * item.quantity;
        return `<div>${item.name} x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}</div>`;
    }).join('');
    document.getElementById('cartTotal').innerText = total.toFixed(2);
}

async function submitOrder() {
    const name = document.getElementById('customerName').value;
    const table = document.getElementById('tableNumber').value;
    const type = document.getElementById('orderType').value;
    
    if (!name || cart.length === 0) return alert('Please enter your name and add items.');

    const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);

    const { data: order, error } = await supabase.from('orders').insert({
        restaurant_id: currentRestaurantId,
        customer_name: name,
        table_number: table,
        order_type: type,
        total_amount: total,
        status: 'Pending'
    }).select().single();

    if (error) return alert('Failed to place order.');

    const orderItems = cart.map(item => ({
        order_id: order.id,
        menu_item_id: item.id,
        item_name: item.name,
        quantity: item.quantity,
        price: item.price
    }));

    await supabase.from('order_items').insert(orderItems);

    cart = [];
    renderCart();
    trackOrder(order.id);
}

function trackOrder(orderId) {
    document.getElementById('cartSection').classList.add('hidden');
    document.getElementById('menuSection').classList.add('hidden');
    document.getElementById('trackerSection').classList.remove('hidden');
    document.getElementById('trackerOrderId').innerText = orderId;

    if (activeSubscription) supabase.removeChannel(activeSubscription);

    activeSubscription = supabase.channel(`public:orders:id=eq.${orderId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, payload => {
            document.getElementById('trackerStatus').innerText = payload.new.status;
        })
        .subscribe();
}
  
