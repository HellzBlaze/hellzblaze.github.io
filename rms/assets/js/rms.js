const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentStaff = null;
let currentRestaurantId = null;
let currentTicket = [];
let realtimeChannel = null;

document.addEventListener('DOMContentLoaded', () => {
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            currentStaff = session.user;
            await loadProfile();
            document.getElementById('authScreen').classList.add('hidden');
            document.getElementById('dashboardScreen').classList.remove('hidden');
            initializeDashboard();
        } else {
            document.getElementById('authScreen').classList.remove('hidden');
            document.getElementById('dashboardScreen').classList.add('hidden');
        }
    });

    document.getElementById('btnLogin').addEventListener('click', handleLogin);
    document.getElementById('btnSignup').addEventListener('click', handleSignup);
    document.getElementById('btnLogout').addEventListener('click', () => supabase.auth.signOut());
    document.getElementById('btnDispatchTicket').addEventListener('click', dispatchPosTicket);
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
}

async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const restName = document.getElementById('authRestName').value;

    if (!restName) return alert("Restaurant Name required for signup");

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { restaurant_name: restName } }
    });
    if (error) alert(error.message);
    else alert("Signup successful! Please log in.");
}

async function loadProfile() {
    const { data, error } = await supabase.from('profiles').select('restaurant_id, restaurants(name)').eq('id', currentStaff.id).single();
    if (data) {
        currentRestaurantId = data.restaurant_id;
        document.getElementById('storeNameHeader').innerText = data.restaurants.name;
    }
}

function initializeDashboard() {
    loadPosMenu();
    loadKanbanOrders();
    loadAnalytics();
    setupRealtime();
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    event.target.classList.add('active');
}

// POS LOGIC
async function loadPosMenu() {
    const { data } = await supabase.from('menu_items').select('*').eq('restaurant_id', currentRestaurantId);
    const grid = document.getElementById('posMenuGrid');
    grid.innerHTML = (data || []).map(item => `
        <div class="pos-item-card" onclick="addToTicket('${item.id}', '${item.name}', ${item.price})">
            <h4>${item.name}</h4>
            <p>$${item.price.toFixed(2)}</p>
        </div>
    `).join('');
    window.rmsMenuItems = data || [];
}

function addToTicket(id, name, price) {
    const existing = currentTicket.find(i => i.id === id);
    if (existing) existing.qty++;
    else currentTicket.push({ id, name, price, qty: 1 });
    renderTicket();
}

function renderTicket() {
    const container = document.getElementById('ticketItems');
    let total = 0;
    container.innerHTML = currentTicket.map(i => {
        total += i.price * i.qty;
        return `<div>${i.name} x${i.qty} - $${(i.price * i.qty).toFixed(2)}</div>`;
    }).join('');
    document.getElementById('posTotal').innerText = total.toFixed(2);
}

async function dispatchPosTicket() {
    if (currentTicket.length === 0) return;
    const total = currentTicket.reduce((s, i) => s + (i.price * i.qty), 0);

    const { data: order, error } = await supabase.from('orders').insert({
        restaurant_id: currentRestaurantId,
        customer_name: 'Walk-in Counter',
        order_type: 'dine-in',
        total_amount: total,
        status: 'Pending'
    }).select().single();

    if (!error) {
        const items = currentTicket.map(i => ({
            order_id: order.id,
            menu_item_id: i.id,
            item_name: i.name,
            quantity: i.qty,
            price: i.price
        }));
        await supabase.from('order_items').insert(items);
        currentTicket = [];
        renderTicket();
    }
}

// OMS KANBAN LOGIC
async function loadKanbanOrders() {
    const { data: orders } = await supabase.from('orders').select('*, order_items(*)').eq('restaurant_id', currentRestaurantId);
    renderKanban(orders || []);
}

function renderKanban(orders) {
    ['Pending', 'Preparing', 'Ready', 'Completed'].forEach(status => {
        const container = document.querySelector(`#col-${status} .cards`);
        const statusOrders = orders.filter(o => o.status === status);
        
        container.innerHTML = statusOrders.map(o => `
            <div class="kanban-card">
                <h4>#${o.id.substr(0,4)} - ${o.customer_name}</h4>
                <p>Type: ${o.order_type}</p>
                <div class="items-list">
                    ${(o.order_items || []).map(i => `<div>${i.quantity}x ${i.item_name}</div>`).join('')}
                </div>
                <div class="actions">
                    ${getNextStatusButton(o.id, status)}
                </div>
            </div>
        `).join('');
    });
}

function getNextStatusButton(id, status) {
    if (status === 'Pending') return `<button onclick="updateOrderStatus('${id}', 'Preparing')">Start</button>`;
    if (status === 'Preparing') return `<button onclick="updateOrderStatus('${id}', 'Ready')">Ready</button>`;
    if (status === 'Ready') return `<button onclick="updateOrderStatus('${id}', 'Completed')">Complete</button>`;
    return '';
}

async function updateOrderStatus(orderId, newStatus) {
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
    loadKanbanOrders();
}

// REALTIME WEBSOCKET SUBSCRIPTION
function setupRealtime() {
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);

    realtimeChannel = supabase.channel(`rms:${currentRestaurantId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `restaurant_id=eq.${currentRestaurantId}`
        }, () => {
            loadKanbanOrders();
            loadAnalytics();
        })
        .subscribe();
}

// ANALYTICS LOGIC
async function loadAnalytics() {
    const { data: orders } = await supabase.from('orders').select('total_amount').eq('restaurant_id', currentRestaurantId);
    if (orders) {
        const rev = orders.reduce((acc, curr) => acc + parseFloat(curr.total_amount), 0);
        document.getElementById('metricRevenue').innerText = `$${rev.toFixed(2)}`;
        document.getElementById('metricTickets').innerText = orders.length;
    }
      }
