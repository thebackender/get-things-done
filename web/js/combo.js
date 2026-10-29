// Searchable dropdown ("combobox"): a text box that filters a list as you type.
// The chosen value lives in a hidden input with the given name, so forms read it like a <select>.
import { esc } from './util.js';

/**
 * items: [{value, label, hint?}]; hint is shown greyed out and is searchable too.
 * The first entry of the list is always "— none —" (empty value).
 */
export function comboHTML(name, items, value, { placeholder = 'Type to search…', noneLabel = '— none —' } = {}) {
  const current = items.find((i) => String(i.value) === String(value ?? ''));
  return `<div class="combo">
    <input type="hidden" name="${name}" value="${esc(current ? current.value : '')}">
    <input type="text" class="combo-input" value="${esc(current?.label ?? '')}" placeholder="${esc(placeholder)}"
      autocomplete="off" role="combobox" aria-expanded="false">
    <ul class="combo-list" role="listbox" hidden>
      <li data-value="" data-label="" class="none">${esc(noneLabel)}</li>
      ${items.map((i) => `<li data-value="${esc(i.value)}" data-label="${esc(i.label)}"
        data-search="${esc(`${i.label} ${i.hint ?? ''}`.toLowerCase())}">${esc(i.label)}${i.hint ? ` <span class="muted">${esc(i.hint)}</span>` : ''}</li>`).join('')}
      <li class="combo-empty" hidden>No matches</li>
    </ul>
  </div>`;
}

/** Wire up every combo inside root. Call once after the markup is inserted. */
export function bindCombos(root) {
  root.querySelectorAll('.combo').forEach(setup);
}

function setup(box) {
  const hidden = box.querySelector('input[type=hidden]');
  const input = box.querySelector('.combo-input');
  const list = box.querySelector('.combo-list');
  const items = [...list.querySelectorAll('li[data-value]')];
  const empty = list.querySelector('.combo-empty');
  let active = -1;

  const visible = () => items.filter((li) => !li.hidden);
  const currentLabel = () => items.find((li) => li.dataset.value === hidden.value)?.dataset.label ?? '';

  function highlight(index) {
    const shown = visible();
    items.forEach((li) => li.classList.remove('active'));
    active = Math.max(-1, Math.min(index, shown.length - 1));
    if (active >= 0) {
      shown[active].classList.add('active');
      shown[active].scrollIntoView({ block: 'nearest' });
    }
  }
  function filter(query) {
    const q = query.trim().toLowerCase();
    // While searching, "— none —" is hidden; it shows again when the box is empty.
    items.forEach((li) => (li.hidden = q !== '' && !(li.dataset.search ?? '').includes(q)));
    empty.hidden = visible().length > 0;
  }
  function open() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    filter('');
    highlight(visible().findIndex((li) => li.dataset.value === hidden.value));
  }
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.value = currentLabel(); // typed text that wasn't picked is dropped
  }
  function choose(li) {
    hidden.value = li.dataset.value;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  input.addEventListener('focus', () => { open(); input.select(); });
  input.addEventListener('click', () => { if (list.hidden) open(); });
  input.addEventListener('input', () => {
    list.hidden = false;
    filter(input.value);
    highlight(0);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) open();
      else highlight(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active - 1);
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault(); // pick, don't submit the form
      const li = visible()[active];
      if (li) choose(li);
      else close();
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault(); // close the list, not the whole dialog
      e.stopPropagation();
      close();
    }
  });
  // mousedown (not click) so the choice lands before the input loses focus
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-value]');
    e.preventDefault();
    if (li) choose(li);
  });
  input.addEventListener('blur', () => { if (!list.hidden) close(); });
}
