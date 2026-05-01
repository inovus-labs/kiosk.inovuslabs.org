var SCREENSHOT_MATCH = location.search.match(/[?&]screenshot=(\d+)/);
var SCREENSHOT_INDEX = SCREENSHOT_MATCH ? parseInt(SCREENSHOT_MATCH[1], 10) : -1;

var slides = document.querySelectorAll('.slide');
var dots   = document.querySelectorAll('.dot');
var line   = document.getElementById('progress-line');
var total  = slides.length;
var cur    = 0;
var DUR    = 10000; // ms per slide

function setProgress(accent) {
  if (!line) return;
  line.style.cssText =
    'position:absolute;bottom:4px;left:0;height:3px;width:0;z-index:100;' +
    'background:' + accent + ';-webkit-animation:none;animation:none;';
  setTimeout(function () {
    line.style.cssText =
      'position:absolute;bottom:4px;left:0;height:3px;width:0;z-index:100;' +
      'background:' + accent + ';' +
      '-webkit-animation:progressLine ' + DUR + 'ms linear forwards;' +
      'animation:progressLine ' + DUR + 'ms linear forwards;';
  }, 60);
}

function setProgressFull(accent) {
  if (!line) return;
  line.style.cssText =
    'position:absolute;bottom:4px;left:0;height:3px;width:100%;z-index:100;' +
    'background:' + accent + ';-webkit-animation:none;animation:none;';
}

function goTo(n, opts) {
  if (total === 0) return;
  opts = opts || {};

  // Deactivate current
  slides[cur].classList.remove('active');
  if (dots[cur]) {
    dots[cur].classList.remove('active');
    dots[cur].style.background   = '';
    dots[cur].style.width        = '';
    dots[cur].style.borderRadius = '';
  }

  // Advance
  cur = ((n % total) + total) % total;

  // Activate next
  slides[cur].classList.add('active');
  var accent = slides[cur].getAttribute('data-accent') || '#6C63FF';
  if (dots[cur]) {
    dots[cur].classList.add('active');
    dots[cur].style.background = accent;
  }
  if (opts.progressFull) {
    setProgressFull(accent);
  } else {
    setProgress(accent);
  }
}

// Boot
if (SCREENSHOT_INDEX >= 0) {
  goTo(SCREENSHOT_INDEX, { progressFull: true });
  var clk = document.getElementById('clock');
  if (clk) clk.style.display = 'none';
  var dotsBar = document.querySelector('.dots-bar');
  if (dotsBar) dotsBar.remove();
  var wimgs = document.querySelectorAll('img.podcast-wave');
  for (var wi = 0; wi < wimgs.length; wi++) {
    var srcAttr = wimgs[wi].getAttribute('src');
    if (srcAttr && /wave\.svg/i.test(srcAttr) && !/wave-static\.svg/i.test(srcAttr)) {
      wimgs[wi].setAttribute('src', srcAttr.replace(/wave\.svg/i, 'wave-static.svg'));
    }
  }
} else {
  goTo(0);
  setInterval(function () { goTo(cur + 1); }, DUR);
}

// Live clock — HH:MM with blinking separator
function tick() {
  var el = document.getElementById('clock');
  if (!el || SCREENSHOT_INDEX >= 0) return;
  var now = new Date();
  var h   = ('0' + now.getHours()).slice(-2);
  var m   = ('0' + now.getMinutes()).slice(-2);
  el.innerHTML = h + '<span class="clock-sep">:</span>' + m;
}
setInterval(tick, 1000);
tick();
