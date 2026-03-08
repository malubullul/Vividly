// Dramatic blur effect for hero title
(function() {
  const wrap = document.getElementById('titleWrap');
  const cv   = document.getElementById('blurCanvas');
  if (!cv || !wrap) return;
  const cx = cv.getContext('2d');

  let W=0, H=0, b1=null, b2=null, b3=null;
  let mx=-1, my=-1, smx=-1, smy=-1, over=false, act=0;

  document.addEventListener('mousemove', e => {
    const r = wrap.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    over = true;
  });
  document.addEventListener('mouseleave', () => { over = false; });

  function setup() {
    const r = wrap.getBoundingClientRect();
    W = Math.round(r.width);
    H = Math.round(r.height);
    cv.width = W; cv.height = H;

    const tt = document.getElementById('titleText');
    const fs = parseFloat(getComputedStyle(tt).fontSize);

    // Sharp source
    const sh = document.createElement('canvas');
    sh.width = W; sh.height = H;
    const sc = sh.getContext('2d');
    sc.font = `800 ${fs}px "Plus Jakarta Sans", sans-serif`;
    sc.textAlign = 'center'; sc.textBaseline = 'middle';
    sc.fillStyle = '#fff';
    sc.fillText('Vividly', W/2, H/2);

    // Fine blur
    b1 = document.createElement('canvas'); b1.width=W; b1.height=H;
    const c1 = b1.getContext('2d');
    c1.filter = 'blur(6px) brightness(1.3)';
    c1.drawImage(sh, 0, 0);

    // Medium blur
    b2 = document.createElement('canvas'); b2.width=W; b2.height=H;
    const c2 = b2.getContext('2d');
    c2.filter = 'blur(16px) brightness(1.8)';
    c2.drawImage(sh, 0, 0);

    // Wide dramatic blur
    b3 = document.createElement('canvas'); b3.width=W; b3.height=H;
    const c3 = b3.getContext('2d');
    c3.filter = 'blur(40px) brightness(2.5)';
    c3.drawImage(sh, 0, 0);
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!b1 || W <= 0) return;

    if (over && mx >= 0) {
      if (smx < 0) { smx = mx; smy = my; }
      smx += (mx - smx) * 0.07;
      smy += (my - smy) * 0.07;
    }
    act += ((over ? 1 : 0) - act) * 0.08;

    cx.clearRect(0, 0, W, H);
    if (act < 0.005 || smx < 0) return;

    const R = Math.min(W, H) * 0.85;

    // Layer 1: fine blur
    const of1 = document.createElement('canvas'); of1.width=W; of1.height=H;
    const oc1 = of1.getContext('2d');
    oc1.globalAlpha = 0.7;
    oc1.drawImage(b1, 0, 0);
    oc1.globalCompositeOperation = 'destination-in';
    const g1 = oc1.createRadialGradient(smx,smy,0,smx,smy,R*0.5);
    g1.addColorStop(0, `rgba(0,0,0,${act})`);
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    oc1.fillStyle = g1; oc1.fillRect(0,0,W,H);

    // Layer 2: medium blur
    const of2 = document.createElement('canvas'); of2.width=W; of2.height=H;
    const oc2 = of2.getContext('2d');
    oc2.globalAlpha = 0.6;
    oc2.drawImage(b2, 0, 0);
    oc2.globalCompositeOperation = 'destination-in';
    const g2 = oc2.createRadialGradient(smx,smy,0,smx,smy,R*0.7);
    g2.addColorStop(0, `rgba(0,0,0,${act})`);
    g2.addColorStop(0.5, `rgba(0,0,0,${act*0.6})`);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    oc2.fillStyle = g2; oc2.fillRect(0,0,W,H);

    // Layer 3: wide dramatic glow
    const of3 = document.createElement('canvas'); of3.width=W; of3.height=H;
    const oc3 = of3.getContext('2d');
    oc3.globalAlpha = 0.45;
    oc3.drawImage(b3, 0, 0);
    oc3.globalCompositeOperation = 'destination-in';
    const g3 = oc3.createRadialGradient(smx,smy,0,smx,smy,R);
    g3.addColorStop(0, `rgba(0,0,0,${act*0.9})`);
    g3.addColorStop(0.4, `rgba(0,0,0,${act*0.5})`);
    g3.addColorStop(1, 'rgba(0,0,0,0)');
    oc3.fillStyle = g3; oc3.fillRect(0,0,W,H);

    // Composite all layers
    cx.drawImage(of3, 0, 0);
    cx.globalCompositeOperation = 'screen';
    cx.drawImage(of2, 0, 0);
    cx.drawImage(of1, 0, 0);
    cx.globalCompositeOperation = 'source-over';
  }

  document.fonts.ready.then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => { setup(); frame(); }));
  });
  window.addEventListener('resize', () => requestAnimationFrame(() => setup()));
})();
