import { normalizeAddress } from './address.mjs';
const key = 'home_portal_addresses_v1';
const message = document.querySelector('#message');
let homes = [];
try {
  const saved = JSON.parse(localStorage.getItem(key) || '[]');
  if (Array.isArray(saved)) for (const item of saved.slice(0, 16)) {
    try {
      if (typeof item.name === 'string' && item.name.trim() && item.name.length <= 80 && typeof item.address === 'string') {
        homes.push({ name: item.name, address: normalizeAddress(item.address) });
      }
    } catch { /* Discard corrupt addresses instead of rendering unsafe links. */ }
  }
} catch { message.textContent = 'Browser storage is unavailable. You can still add and open an address during this visit.'; }
function save() {
  try { localStorage.setItem(key, JSON.stringify(homes)); }
  catch { message.textContent = 'This browser could not save the address. You can still open it below.'; }
  render();
}
function render() {
  const list = document.querySelector('#homes');
  list.replaceChildren();
  document.querySelector('#empty').hidden = homes.length > 0;
  for (const [index, home] of homes.entries()) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = home.address; link.referrerPolicy = 'no-referrer';
    link.textContent = home.name + ' — ' + home.address;
    const forget = document.createElement('button');
    forget.type = 'button'; forget.textContent = 'Forget'; forget.setAttribute('aria-label', 'Forget ' + home.name);
    forget.onclick = () => { homes.splice(index, 1); save(); };
    row.append(link, forget); list.append(row);
  }
}
document.querySelector('#add-home').addEventListener('submit', event => {
  event.preventDefault(); message.textContent = '';
  try {
    const name = document.querySelector('#name').value.trim();
    if (!name || name.length > 80) throw new Error('Enter a name up to 80 characters.');
    const address = normalizeAddress(document.querySelector('#address').value);
    const existing = homes.find(home => home.address === address);
    if (existing) existing.name = name;
    else {
      if (homes.length >= 16) throw new Error('Forget an address before adding another (maximum 16).');
      homes.push({ name, address });
    }
    message.textContent = 'Address saved. Check the displayed address, then select it to open your server.';
    save();
  } catch (error) { message.textContent = error.message; }
});
render();
