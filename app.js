document.addEventListener('DOMContentLoaded', () => {
    const API = 'https://corsproxy.io/?' + encodeURIComponent('https://crm.skch.cz/ajax0/procedure.php?cmd=');

    const els = {
        user: document.getElementById('userSelect'),
        drinks: document.getElementById('drinksContainer'),
        save: document.getElementById('saveBtn'),
        summary: document.getElementById('dailySummaryContainer'),
        toast: document.getElementById('toast')
    };

    let drinksData = [];
    let counts = {};

    init();

    async function init() {
        try {
            const [people, types] = await Promise.all([
                fetch(API + 'getPeopleList').then(r => r.json()),
                fetch(API + 'getTypesList').then(r => r.json())
            ]);

            let userHtml = '<option value="" disabled selected>Vyberte osobu...</option>';
            Object.values(people).forEach(u => {
                userHtml += `<option value="${u.ID}">${u.name}</option>`;
            });
            els.user.innerHTML = userHtml;

            const savedUser = localStorage.getItem('coffee_user');
            if (savedUser) els.user.value = savedUser;

            drinksData = Object.values(types);
            els.drinks.innerHTML = '';
            
            drinksData.forEach(d => {
                counts[d.typ] = 0;
                
                const card = document.createElement('div');
                card.className = 'drink-card';
                card.innerHTML = `
                    <span>${d.typ}</span>
                    <div class="counter-controls">
                        <button class="btn-counter btn-minus" disabled>-</button>
                        <span class="count-display">0</span>
                        <button class="btn-counter btn-plus">+</button>
                    </div>
                `;

                const btnMinus = card.querySelector('.btn-minus');
                const btnPlus = card.querySelector('.btn-plus');
                const display = card.querySelector('.count-display');

                btnMinus.onclick = () => update(d.typ, -1, display, btnMinus, card);
                btnPlus.onclick = () => update(d.typ, 1, display, btnMinus, card);

                els.drinks.appendChild(card);
            });
            
            els.user.onchange = (e) => {
                localStorage.setItem('coffee_user', e.target.value);
                reset();
                renderSummary(); 
            };

            els.save.onclick = handleSave;
            
            window.addEventListener('online', syncOffline);
            syncOffline();
            renderSummary();

        } catch (err) {
            els.drinks.innerHTML = '<div class="section" style="color:red">Chyba načítání. Zkuste to později.</div>';
        }
    }

    function update(type, delta, display, btnMinus, card) {
        counts[type] += delta;
        display.textContent = counts[type];
        btnMinus.disabled = counts[type] === 0;
        card.classList.toggle('active', counts[type] > 0);
        updateSaveBtn();
    }

    function updateSaveBtn() {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        els.save.disabled = total === 0 || !els.user.value;
        els.save.textContent = `Uložit záznam (${total})`;
    }

    async function handleSave() {
        const userId = els.user.value;
        const payloadDrinks = drinksData
            .map(d => ({ type: d.typ, value: counts[d.typ] }))
            .filter(d => d.value > 0);

        const payload = { user: userId, drinks: payloadDrinks };
        
        els.save.disabled = true;
        saveSummary(userId, payloadDrinks);
        renderSummary();

        if (!navigator.onLine) {
            saveOffline(payload);
            reset();
            showToast('Offline: Uloženo lokálně');
            return;
        }

        try {
            await fetch(API + 'saveDrinks', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            reset();
            showToast('Záznam uložen!');
        } catch (err) {
            saveOffline(payload);
            reset();
            showToast('Chyba serveru: Uloženo lokálně');
        }
    }

    function saveOffline(payload) {
        const records = JSON.parse(localStorage.getItem('coffee_offline') || '[]');
        records.push(payload);
        localStorage.setItem('coffee_offline', JSON.stringify(records));
    }

    async function syncOffline() {
        if (!navigator.onLine) return;
        const records = JSON.parse(localStorage.getItem('coffee_offline') || '[]');
        if (!records.length) return;

        const remaining = [];
        for (const rec of records) {
            try {
                const res = await fetch(API + 'saveDrinks', { method: 'POST', body: JSON.stringify(rec) });
                if (!res.ok) remaining.push(rec);
            } catch {
                remaining.push(rec);
            }
        }
        localStorage.setItem('coffee_offline', JSON.stringify(remaining));
        if (records.length > remaining.length) showToast('Offline záznamy odeslány!');
    }

    function saveSummary(userId, drinks) {
        const today = new Date().toISOString().split('T')[0];
        const storageKey = 'coffee_summary_' + userId;
        let sum = JSON.parse(localStorage.getItem(storageKey) || '{"date":"","data":{}}');
        
        // Reset pokud je nový den
        if (sum.date !== today) { 
            sum = { date: today, data: {} }; 
        }

        drinks.forEach(d => {
            sum.data[d.type] = (sum.data[d.type] || 0) + d.value;
        });
        
        localStorage.setItem(storageKey, JSON.stringify(sum));
    }

    function renderSummary() {
        const userId = els.user.value;
        
        if (!userId) {
            els.summary.textContent = 'Vyberte osobu...';
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const storageKey = 'coffee_summary_' + userId;
        const sum = JSON.parse(localStorage.getItem(storageKey) || '{"date":"","data":{}}');
        
        if (sum.date !== today || !sum.data || Object.keys(sum.data).length === 0) {
            els.summary.textContent = 'Zatím prázdno...';
            return;
        }
        
        els.summary.innerHTML = Object.entries(sum.data)
            .map(([type, count]) => `<strong>${count}x</strong> ${type}`)
            .join('<br>');
    }

    function reset() {
        Object.keys(counts).forEach(k => counts[k] = 0);
        document.querySelectorAll('.drink-card').forEach(card => {
            card.classList.remove('active');
            card.querySelector('.count-display').textContent = '0';
            card.querySelector('.btn-minus').disabled = true;
        });
        updateSaveBtn();
    }

    function showToast(msg) {
        els.toast.textContent = msg;
        els.toast.classList.remove('hidden');
        setTimeout(() => els.toast.classList.add('hidden'), 3000);
    }
});
