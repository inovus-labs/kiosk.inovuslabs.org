var slides = document.querySelectorAll('.slide');
var dots   = document.querySelectorAll('.dot');
var line   = document.getElementById('progress-line');
var total  = slides.length;
var cur    = 0;
var DUR    = 10000; // ms per slide

function setProgress(accent) {
  if (!line) return;
  line.style.cssText =
    'position:absolute;bottom:0;left:0;height:3px;width:0;z-index:100;' +
    'background:' + accent + ';-webkit-animation:none;animation:none;';
  setTimeout(function () {
    line.style.cssText =
      'position:absolute;bottom:0;left:0;height:3px;width:0;z-index:100;' +
      'background:' + accent + ';' +
      '-webkit-animation:progressLine ' + DUR + 'ms linear forwards;' +
      'animation:progressLine ' + DUR + 'ms linear forwards;';
  }, 60);
}

function goTo(n) {
  if (total === 0) return;

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
  setProgress(accent);
}

// Boot
goTo(0);
setInterval(function () { goTo(cur + 1); }, DUR);

// Live clock — HH:MM with blinking separator
function tick() {
  var el = document.getElementById('clock');
  if (!el) return;
  var now = new Date();
  var h   = ('0' + now.getHours()).slice(-2);
  var m   = ('0' + now.getMinutes()).slice(-2);
  el.innerHTML = h + '<span class="clock-sep">:</span>' + m;
}
setInterval(tick, 1000);
tick();
