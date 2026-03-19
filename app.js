document.addEventListener('DOMContentLoaded', () => {
    // Použití CORS proxy pro obejití blokace na GitHub Pages
    const TARGET_API = 'https://crm.skch.cz/ajax0/procedure.php';
    const PROXY_URL = 'https://corsproxy.io/?';
    
    // Pomocná funkce pro sestavení správné URL
    const getApiUrl = (cmd) => `${PROXY_URL}${encodeURIComponent(`${TARGET_API}?cmd=${cmd}`)}`;

    // DOM Elements
    const userSelect = document.getElementById('userSelect');
    const drinksContainer = document.getElementById('drinksContainer');
    const saveBtn = document.getElementById('saveBtn');
    const toast = document.getElementById('toast');

    // State
    let users = [];
    let drinks = [];
    let drinkCounts = {}; // drinkName -> count
    
    // Konstanty pro Local Storage
    const OFFLINE_STORAGE_KEY = 'coffee_offline_records';
    const DAILY_SUMMARY_KEY = 'coffee_daily_summary';

    init();

    async function init() {
        try {
            const [peopleData, typesData] = await Promise.all([
                fetchData(getApiUrl('getPeopleList')),
                fetchData(getApiUrl('getTypesList'))
            ]);

            users = Object.values(peopleData);
            drinks = Object.values(typesData);

            // Initialize counts
            drinks.forEach(drink => {
                drinkCounts[drink.typ] = 0;
            });

            renderUsers();
            renderDrinks();

            // Re-store last selected user
            const savedUserId = getSavedUser();
            if (savedUserId && users.find(u => u.ID === savedUserId)) {
                userSelect.value = savedUserId;
            }

            // Events
            userSelect.addEventListener('change', (e) => {
                saveUserPreference(e.target.value);
                updateSaveButtonState();
            });

            saveBtn.addEventListener('click', handleSave);
            updateSaveButtonState();
            
            // Posluchač pro návrat online
            window.addEventListener('online', syncOfflineRecords);
            
            // Pokus o synchronizaci při načtení (pokud uživatel stránku zavřel offline a otevřel online)
            syncOfflineRecords();

        } catch (error) {
            console.error('Initialization error:', error);
            drinksContainer.innerHTML = `<div class="error-message">Nepodařilo se načíst data. Zkuste to prosím později.</div>`;
            userSelect.innerHTML = `<option value="" disabled selected>Chyba načítání</option>`;
        }
    }

    async function fetchData(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    }

    function renderUsers() {
        let options = '<option value="" disabled selected>Vyberte osobu...</option>';
        users.forEach(user => {
            options += `<option value="${user.ID}">${user.name}</option>`;
        });
        userSelect.innerHTML = options;
    }

    function renderDrinks() {
        drinksContainer.innerHTML = '';
        drinks.forEach(drink => {
            const card = document.createElement('div');
            card.className = 'drink-card';
            card.dataset.type = drink.typ;

            card.innerHTML = `
                <div class="drink-info">
                    <span class="drink-name">${drink.typ}</span>
                </div>
                <div class="counter-controls">
                    <button class="btn-counter btn-minus" disabled>-</button>
                    <span class="count-display">0</span>
                    <button class="btn-counter btn-plus">+</button>
                </div>
            `;

            const btnMinus = card.querySelector('.btn-minus');
            const btnPlus = card.querySelector('.btn-plus');
            const display = card.querySelector('.count-display');

            btnMinus.addEventListener('click', () => updateCount(drink.typ, -1, display, btnMinus, card));
            btnPlus.addEventListener('click', () => updateCount(drink.typ, 1, display, btnMinus, card));

            drinksContainer.appendChild(card);
        });
    }

    function updateCount(type, delta, displayEl, btnMinusEl, cardEl) {
        let currentCount = drinkCounts[type];
        let newCount = currentCount + delta;

        if (newCount < 0) return;

        drinkCounts[type] = newCount;
        displayEl.textContent = newCount;

        btnMinusEl.disabled = newCount === 0;

        if (newCount > 0) {
            cardEl.classList.add('active');
        } else {
            cardEl.classList.remove('active');
        }

        updateSaveButtonState();
    }

    function getTotalDrinks() {
        return Object.values(drinkCounts).reduce((sum, count) => sum + count, 0);
    }

    function updateSaveButtonState() {
        const total = getTotalDrinks();
        const hasUser = userSelect.value !== "";

        saveBtn.disabled = !(total > 0 && hasUser);
        saveBtn.textContent = `Uložit záznam (${total})`;
    }

    async function handleSave() {
        const userId = userSelect.value;
        if (!userId) {
            showToast('Prosím vyberte uživatele.', true);
            return;
        }

        const total = getTotalDrinks();
        if (total === 0) {
            showToast('Musíte přidat alespoň jeden nápoj.', true);
            return;
        }

        const payloadDrinks = drinks.map(drink => ({
            type: drink.typ,
            value: drinkCounts[drink.typ]
        })).filter(d => d.value > 0); // Odesíláme jen ty nápoje, co mají hodnotu > 0

        const payload = {
            user: userId,
            drinks: payloadDrinks
        };

        saveBtn.disabled = true;
        saveBtn.textContent = 'Ukládám...';
        
        // Zaznamenáme do denního přehledu ihned
        updateDailySummary(payloadDrinks);

        // Kontrola, zda jsme online ještě před pokusem o volání
        if (!navigator.onLine) {
            saveOfflineRecord(payload);
            resetCounts();
            showToast(`Offline! Uloženo lokálně. Dnes: ${getDailySummaryText()}`, true, 5000);
            saveBtn.disabled = false;
            updateSaveButtonState();
            return;
        }

        try {
            const response = await fetch(getApiUrl('saveDrinks'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Failed to save');

            // Reset UI
            resetCounts();
            showToast(`Uloženo! ☕ Dnes: ${getDailySummaryText()}`, false, 5000);

        } catch (error) {
            console.error('Error saving drinks, API might be down:', error);
            // Spadneme do offline uložení, pokud API neodpovídá
            saveOfflineRecord(payload);
            resetCounts();
            showToast(`API nedostupné! Uloženo lokálně. Dnes: ${getDailySummaryText()}`, true, 5000);
        } finally {
            saveBtn.disabled = false;
            updateSaveButtonState();
        }
    }
    
    // --- OFFLINE & SYNC LOGIC ---

    function saveOfflineRecord(payload) {
        const records = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '[]');
        records.push({ ...payload, timestamp: Date.now() });
        localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(records));
    }

    async function syncOfflineRecords() {
        if (!navigator.onLine) return;
        
        const records = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '[]');
        if (records.length === 0) return;

        const remainingRecords = [];
        let syncedCount = 0;

        for (const record of records) {
            try {
                const response = await fetch(getApiUrl('saveDrinks'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user: record.user, drinks: record.drinks })
                });

                if (response.ok) {
                    syncedCount++;
                } else {
                    // Pokud odeslání konkrétního záznamu selže, ponecháme si ho pro příště
                    remainingRecords.push(record);
                }
            } catch (e) {
                // Pokud spojení opět spadne uprostřed cyklu, ponecháme ho
                remainingRecords.push(record);
            }
        }

        // Aktualizujeme localStorage o zbylé nedosynchronizované záznamy
        localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(remainingRecords));
        
        if (syncedCount > 0) {
            showToast(`Úspěšně synchronizováno ${syncedCount} offline záznamů!`, false, 4000);
        }
    }
    
    // --- DAILY SUMMARY LOGIC (BONUS) ---
    
    function getTodayDateString() {
        return new Date().toISOString().split('T')[0];
    }

    function updateDailySummary(consumedDrinks) {
        const dateStr = getTodayDateString();
        const stored = JSON.parse(localStorage.getItem(DAILY_SUMMARY_KEY) || '{}');

        // Reset the summary if it's a new day
        if (stored.date !== dateStr) {
            stored.date = dateStr;
            stored.drinks = {};
        }

        consumedDrinks.forEach(d => {
            stored.drinks[d.type] = (stored.drinks[d.type] || 0) + d.value;
        });

        localStorage.setItem(DAILY_SUMMARY_KEY, JSON.stringify(stored));
    }

    function getDailySummaryText() {
        const stored = JSON.parse(localStorage.getItem(DAILY_SUMMARY_KEY) || '{}');
        if (stored.date !== getTodayDateString() || !stored.drinks) return '';

        const summaryItems = Object.entries(stored.drinks)
            .map(([type, count]) => `${count}x ${type}`)
            .join(', ');

        return summaryItems;
    }

    function resetCounts() {
        Object.keys(drinkCounts).forEach(key => {
            drinkCounts[key] = 0;
        });

        const cards = drinksContainer.querySelectorAll('.drink-card');
        cards.forEach(card => {
            const display = card.querySelector('.count-display');
            const btnMinus = card.querySelector('.btn-minus');

            display.textContent = '0';
            btnMinus.disabled = true;
            card.classList.remove('active');
        });

        updateSaveButtonState();
    }

    // Storage Managers
    function saveUserPreference(userId) {
        // LocalStorage
        localStorage.setItem('coffee_selected_user', userId);

        // Cookie (expires in 30 days)
        const d = new Date();
        d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000));
        document.cookie = `coffee_selected_user=${userId};expires=${d.toUTCString()};path=/`;
    }

    function getSavedUser() {
        // Try localStorage first
        let userId = localStorage.getItem('coffee_selected_user');
        if (userId) return userId;

        // Try Cookie fallback
        const name = "coffee_selected_user=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length, c.length);
            }
        }
        return null;
    }

    // Upravený showToast podporující delší zobrazení textu a zamezující konfliktům časovačů
    let toastTimeout;
    function showToast(message, isError = false, duration = 3000) {
        toast.textContent = message;
        if (isError) {
            toast.classList.add('toast-error');
        } else {
            toast.classList.remove('toast-error');
        }

        toast.classList.remove('hidden');

        // Vyčistíme předchozí timeout, aby se nám Toast neschoval moc brzy, pokud klikneme rychle po sobě
        if(toastTimeout) clearTimeout(toastTimeout);
        
        toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
        }, duration);
    }
});
