/**
 * KITCHEN WRAP MASTERS — Core JavaScript
 * kwm.js v1.0
 * No external dependencies — vanilla JS only
 */

'use strict';

/* =====================================================
   ANALYTICS HELPERS
   ===================================================== */
function trackEvent(eventName, params = {}) {
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
}

/* =====================================================
   NAVIGATION
   ===================================================== */
(function initNav() {
  const header = document.querySelector('.site-header');
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileMenu = document.querySelector('.nav__mobile-menu');
  if (!header) return;

  // Scroll: add .scrolled class
  function onScroll() {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Hamburger toggle
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close on mobile link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!header.contains(e.target) && mobileMenu.classList.contains('open')) {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  // Highlight active nav link
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.nav__link, .nav__mobile-link').forEach(link => {
    const href = (link.getAttribute('href') || '').replace(/\/+$/, '');
    if (href && href !== '' && currentPath === href) {
      link.classList.add('active');
    }
  });
})();

/* =====================================================
   SCROLL REVEAL
   ===================================================== */
(function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => io.observe(el));
})();

/* =====================================================
   FAQ ACCORDION
   ===================================================== */
(function initFaq() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function () {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      const answer = document.getElementById(this.getAttribute('aria-controls'));

      // Close all others in same parent
      const parent = this.closest('.faq-list') || document;
      parent.querySelectorAll('.faq-question').forEach(other => {
        if (other !== this) {
          other.setAttribute('aria-expanded', 'false');
          const a = document.getElementById(other.getAttribute('aria-controls'));
          if (a) a.classList.remove('open');
        }
      });

      this.setAttribute('aria-expanded', !expanded);
      if (answer) answer.classList.toggle('open', !expanded);
    });
  });
})();

/* =====================================================
   BEFORE/AFTER SLIDER
   ===================================================== */
function initBeforeAfter(container) {
  if (!container) return;
  const afterEl = container.querySelector('.ba-after');
  const handle  = container.querySelector('.ba-handle');
  if (!afterEl || !handle) return;

  let dragging = false;
  let pos = 50;

  function setPos(x) {
    const rect = container.getBoundingClientRect();
    let pct = ((x - rect.left) / rect.width) * 100;
    pct = Math.max(2, Math.min(98, pct));
    pos = pct;
    afterEl.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left = `${pct}%`;
  }

  // Mouse
  container.addEventListener('mousedown', (e) => { dragging = true; setPos(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (dragging) setPos(e.clientX); });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Touch
  container.addEventListener('touchstart', (e) => { dragging = true; setPos(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (dragging) setPos(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; });

  // Keyboard
  container.setAttribute('tabindex', '0');
  container.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  setPos(container.getBoundingClientRect().left + (pos - 5) / 100 * container.offsetWidth);
    if (e.key === 'ArrowRight') setPos(container.getBoundingClientRect().left + (pos + 5) / 100 * container.offsetWidth);
  });

  setPos(container.getBoundingClientRect().left + container.offsetWidth * 0.5);
}

document.querySelectorAll('.ba-container').forEach(initBeforeAfter);

/* =====================================================
   GALLERY FILTER + LIGHTBOX
   ===================================================== */
(function initGallery() {
  // Filter
  document.querySelectorAll('.gallery-filter__btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const filter = this.dataset.filter;
      this.closest('.gallery-filter').querySelectorAll('.gallery-filter__btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      document.querySelectorAll('.gallery-item').forEach(item => {
        const show = filter === 'all' || item.dataset.category === filter;
        item.style.display = show ? '' : 'none';
      });
    });
  });

  // Lightbox
  const lightbox = document.querySelector('.lightbox');
  if (!lightbox) return;
  const lbImg   = lightbox.querySelector('.lightbox__img');
  const lbClose = lightbox.querySelector('.lightbox__close');
  const lbPrev  = lightbox.querySelector('.lightbox__prev');
  const lbNext  = lightbox.querySelector('.lightbox__next');

  let items = [];
  let current = 0;

  function openLightbox(idx) {
    items = [...document.querySelectorAll('.gallery-item:not([style*="display: none"])')];
    current = idx;
    lbImg.src = items[current].querySelector('img').src;
    lbImg.alt = items[current].querySelector('img').alt;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.gallery-item').forEach((item, idx) => {
    item.addEventListener('click', () => openLightbox(idx));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(idx); } });
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
  });

  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

  if (lbPrev) lbPrev.addEventListener('click', () => {
    current = (current - 1 + items.length) % items.length;
    lbImg.src = items[current].querySelector('img').src;
    lbImg.alt = items[current].querySelector('img').alt;
  });
  if (lbNext) lbNext.addEventListener('click', () => {
    current = (current + 1) % items.length;
    lbImg.src = items[current].querySelector('img').src;
    lbImg.alt = items[current].querySelector('img').alt;
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && lbPrev) lbPrev.click();
    if (e.key === 'ArrowRight' && lbNext) lbNext.click();
  });
})();

/* =====================================================
   FORM HANDLING (Formspree)
   ===================================================== */
function initForm(formEl) {
  if (!formEl) return;
  const successEl = formEl.closest('.form-wrap')?.querySelector('.form-success');
  const submitBtn = formEl.querySelector('[type="submit"]');

  formEl.addEventListener('submit', async function (e) {
    e.preventDefault();

    // Basic validation
    let valid = true;
    formEl.querySelectorAll('[required]').forEach(field => {
      const errEl = field.parentElement.querySelector('.form-error');
      if (!field.value.trim()) {
        valid = false;
        field.classList.add('error');
        if (errEl) errEl.classList.add('visible');
      } else {
        field.classList.remove('error');
        if (errEl) errEl.classList.remove('visible');
      }
    });
    if (!valid) return;

    if (submitBtn) submitBtn.setAttribute('data-loading', 'true');
    if (submitBtn) submitBtn.textContent = 'Sending…';

    try {
      const data = new FormData(formEl);
      const res = await fetch(formEl.action, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' }
      });

      if (res.ok) {
        formEl.reset();
        formEl.style.display = 'none';
        if (successEl) successEl.classList.add('visible');

        // Track conversion
        const formType = formEl.dataset.formType || 'contact';
        trackEvent('form_submit', { form_type: formType });
      } else {
        const j = await res.json();
        alert(j.errors?.[0]?.message || 'Something went wrong. Please try again or WhatsApp us.');
      }
    } catch {
      alert('Network error. Please try again or WhatsApp us directly.');
    } finally {
      if (submitBtn) submitBtn.removeAttribute('data-loading');
      if (submitBtn) submitBtn.textContent = submitBtn.dataset.label || 'Send';
    }
  });

  // Real-time clear errors
  formEl.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input', () => {
      field.classList.remove('error');
      const errEl = field.parentElement.querySelector('.form-error');
      if (errEl) errEl.classList.remove('visible');
    });
  });
}

document.querySelectorAll('form[data-kwm-form]').forEach(initForm);

/* =====================================================
   ECOMMERCE — CART
   ===================================================== */
const KWMCart = (function () {
  const STORAGE_KEY = 'kwm_cart';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }

  function save(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function getItems() { return load(); }

  function addItem(product) {
    const items = load();
    const key = `${product.id}__${product.variant || ''}`;
    const existing = items.find(i => `${i.id}__${i.variant || ''}` === key);
    if (existing) {
      existing.qty = (existing.qty || 1) + (product.qty || 1);
    } else {
      items.push({ ...product, qty: product.qty || 1 });
    }
    save(items);
    renderCart();
    openCart();
    trackEvent('add_to_cart', { item_name: product.name, value: product.price, currency: 'ZAR' });
  }

  function removeItem(key) {
    let items = load();
    items = items.filter(i => `${i.id}__${i.variant || ''}` !== key);
    save(items);
    renderCart();
  }

  function updateQty(key, delta) {
    const items = load();
    const item = items.find(i => `${i.id}__${i.variant || ''}` === key);
    if (!item) return;
    item.qty = Math.max(1, (item.qty || 1) + delta);
    save(items);
    renderCart();
  }

  function getCount() {
    return load().reduce((sum, i) => sum + (i.qty || 1), 0);
  }

  function getTotal() {
    return load().reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0);
  }

  function renderCart() {
    const drawer = document.querySelector('.cart-drawer__body');
    const countEls = document.querySelectorAll('.cart-count');
    const count = getCount();

    countEls.forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });

    if (!drawer) return;
    const items = load();

    if (!items.length) {
      drawer.innerHTML = `
        <div class="cart-drawer__empty">
          <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          <p>Your cart is empty.</p>
          <a href="/shop/" class="btn btn--outline btn--sm">Browse Products</a>
        </div>`;
    } else {
      drawer.innerHTML = items.map(item => {
        const key = `${item.id}__${item.variant || ''}`;
        return `
          <div class="cart-item">
            <img class="cart-item__img" src="${item.image || '/assets/images/logo.png'}" alt="${item.name}" loading="lazy">
            <div class="cart-item__info">
              <div class="cart-item__name">${item.name}</div>
              ${item.variant ? `<div class="cart-item__variant">${item.variant}</div>` : ''}
              <div class="cart-item__controls">
                <button class="qty-btn" onclick="KWMCart.updateQty('${key}', -1)" aria-label="Decrease quantity">−</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="KWMCart.updateQty('${key}', 1)" aria-label="Increase quantity">+</button>
                <button class="cart-item__remove" onclick="KWMCart.removeItem('${key}')">Remove</button>
              </div>
            </div>
            <div class="cart-item__price">R${(item.price * item.qty).toFixed(2)}</div>
          </div>`;
      }).join('');
    }

    // Update totals in footer
    const subtotalEl = document.querySelector('.cart-subtotal');
    const totalEl    = document.querySelector('.cart-grand-total');
    const total      = getTotal();
    if (subtotalEl) subtotalEl.textContent = `R${total.toFixed(2)}`;
    if (totalEl) totalEl.textContent = `R${total.toFixed(2)}`;
  }

  function openCart() {
    const overlay = document.querySelector('.cart-overlay');
    const drawer  = document.querySelector('.cart-drawer');
    if (overlay) overlay.classList.add('open');
    if (drawer)  { drawer.classList.add('open'); document.body.style.overflow = 'hidden'; }
    trackEvent('view_cart');
  }

  function closeCart() {
    const overlay = document.querySelector('.cart-overlay');
    const drawer  = document.querySelector('.cart-drawer');
    if (overlay) overlay.classList.remove('open');
    if (drawer)  { drawer.classList.remove('open'); document.body.style.overflow = ''; }
  }

  // Wire cart open/close buttons
  document.addEventListener('DOMContentLoaded', function () {
    renderCart();

    document.querySelectorAll('[data-open-cart]').forEach(btn => {
      btn.addEventListener('click', openCart);
    });

    const overlay = document.querySelector('.cart-overlay');
    const closeBtn = document.querySelector('.cart-drawer__close');
    if (overlay) overlay.addEventListener('click', closeCart);
    if (closeBtn) closeBtn.addEventListener('click', closeCart);
  });

  return { addItem, removeItem, updateQty, getItems, getCount, getTotal, renderCart, openCart, closeCart };
})();

// Expose globally
window.KWMCart = KWMCart;

/* =====================================================
   TRACKING — WhatsApp / Phone clicks
   ===================================================== */
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('a[href^="https://wa.me"]').forEach(link => {
    link.addEventListener('click', () => trackEvent('whatsapp_click', { location: link.dataset.location || 'unknown' }));
  });
  document.querySelectorAll('a[href^="tel:"]').forEach(link => {
    link.addEventListener('click', () => trackEvent('phone_click'));
  });
});

/* =====================================================
   HERO SLIDESHOW (lightweight, no library)
   ===================================================== */
(function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;
  let current = 0;

  function next() {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }

  slides[0].classList.add('active');
  setInterval(next, 5000);
})();

/* =====================================================
   COUNTER ANIMATION
   ===================================================== */
(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length || !('IntersectionObserver' in window)) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count, 10);
      const suffix = el.dataset.suffix || '';
      const duration = 1500;
      const step = target / (duration / 16);
      let current = 0;

      const tick = () => {
        current = Math.min(current + step, target);
        el.textContent = Math.floor(current) + suffix;
        if (current < target) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });

  counters.forEach(el => io.observe(el));
})();
