// Keep the native select as the form value; enhance only its presentation.
(() => {
  const menus = [];
  for (const id of ['product', 'want']) {
    const select = document.getElementById(id);
    if (!select) continue;
    const wrap = document.createElement('div');
    wrap.className = 'studio-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${id}-trigger`;
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-options`);
    const value = document.createElement('span');
    const chevron = document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron);
    const list = document.createElement('div');
    list.id = `${id}-options`;
    list.className = 'select-options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const labels = Array.from(select.labels || []);
    labels.forEach((label, index) => {
      label.id ||= `${id}-label-${index}`;
      label.htmlFor = trigger.id;
    });
    const labelIds = labels.map(label => label.id).join(' ');
    trigger.setAttribute('aria-labelledby', labelIds);
    list.setAttribute('aria-labelledby', labelIds);
    if (select.required) trigger.setAttribute('aria-required', 'true');
    const options = Array.from(select.options);
    let cursor = select.selectedIndex;
    const items = options.map((option, index) => {
      const item = document.createElement('div');
      item.id = `${id}-option-${index}`;
      item.className = 'select-option';
      item.setAttribute('role', 'option');
      item.textContent = option.textContent;
      // Keep focus on the combobox until click commits the option.
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => choose(index));
      list.append(item);
      return item;
    });
    const paint = () => {
      value.textContent = options[select.selectedIndex]?.textContent || '';
      items.forEach((item, index) => {
        item.setAttribute('aria-selected', String(index === select.selectedIndex));
        item.classList.toggle('is-active', index === cursor);
      });
      if (!list.hidden) trigger.setAttribute('aria-activedescendant', items[cursor].id);
    };
    function close() {
      list.hidden = true;
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
    }
    function open() {
      if (trigger.matches(':disabled')) return;
      menus.forEach(menu => menu.close());
      cursor = select.selectedIndex;
      list.hidden = false;
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      paint();
    }
    function choose(index) {
      if (trigger.matches(':disabled')) return;
      select.selectedIndex = index;
      cursor = index;
      paint();
      close();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.focus({ preventScroll: true });
    }
    trigger.addEventListener('click', () => list.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape') { if (!list.hidden) event.preventDefault(); close(); return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (list.hidden) open(); else choose(cursor);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (list.hidden) { open(); return; }
      cursor = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1)));
      paint();
    });
    wrap.addEventListener('focusout', event => { if (!wrap.contains(event.relatedTarget)) close(); });
    select.addEventListener('change', () => { cursor = select.selectedIndex; paint(); });
    select.form?.addEventListener('reset', () => setTimeout(() => { close(); cursor = select.selectedIndex; paint(); }, 0));
    select.before(wrap);
    wrap.append(select, trigger, list);
    select.hidden = true;
    paint();
    menus.push({ wrap, close });
  }
  document.addEventListener('pointerdown', event => {
    menus.forEach(menu => { if (!menu.wrap.contains(event.target)) menu.close(); });
  });
  window.addEventListener('hashchange', () => menus.forEach(menu => menu.close()));
})();
