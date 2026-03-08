// Nav scroll effect
const nav = document.getElementById('nav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  });
}

// Background grid cells
const bgGrid = document.getElementById('bgGrid');
if (bgGrid) {
  const colors = [
    ['#0d0520','#2a1060'],['#05101a','#0e2a4a'],['#0a1505','#1a3510'],
    ['#150505','#3a1010'],['#051515','#103535'],
    ['#150a05','#3a2510'],['#080815','#20204a'],['#051005','#103a20'],
    ['#151005','#3a301a'],['#100515','#351040'],
    ['#050a15','#10253a'],['#150510','#3a102a'],['#051015','#103040'],
    ['#100f05','#2a2810'],['#100808','#302020'],
  ];
  colors.forEach(([c1, c2]) => {
    const d = document.createElement('div');
    d.className = 'bg-cell';
    d.style.background = `linear-gradient(145deg, ${c1}, ${c2})`;
    bgGrid.appendChild(d);
  });
}

// Fade up on scroll
const obs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));

// Add fade-up to cards
document.querySelectorAll('.mini-card, .step, .fitur-card').forEach((el, i) => {
  el.classList.add('fade-up');
  el.style.transitionDelay = `${i * 0.08}s`;
  obs.observe(el);
});
