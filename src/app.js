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
  slides[cur].className = 'slide';
  if (dots[cur]) {
    dots[cur].className    = 'dot';
    dots[cur].style.background    = '';
    dots[cur].style.width         = '';
    dots[cur].style.borderRadius  = '';
  }

  // Advance
  cur = ((n % total) + total) % total;

  // Activate next
  slides[cur].className = 'slide active';
  var accent = slides[cur].getAttribute('data-accent') || '#6C63FF';
  if (dots[cur]) {
    dots[cur].className        = 'dot active';
    dots[cur].style.background = accent;
  }
  setProgress(accent);
}

// Boot
goTo(0);
setInterval(function () { goTo(cur + 1); }, DUR);

(function () {
  var stations = [
    'https://ice1.somafm.com/deepspaceone-128-mp3',
    'https://ice1.somafm.com/dronezone-128-mp3',
    'https://ice1.somafm.com/spacestation-128-mp3',
    'https://ice2.somafm.com/deepspaceone-128-mp3',
    'https://ice2.somafm.com/dronezone-128-mp3'
  ];

  // Rotate station every 30-min block — aligns with page auto-refresh cycle
  var block = Math.floor(Date.now() / 1800000);
  var idx   = block % stations.length;

  var audio    = new Audio();
  audio.volume = 0.3;

  function tryPlay(i) {
    idx = ((i % stations.length) + stations.length) % stations.length;
    audio.src = stations[idx];
    audio.load();
    var p = audio.play();
    if (p !== undefined) {
      p.catch(function () {
        document.addEventListener('click', function unlock() {
          audio.play();
          document.removeEventListener('click', unlock);
        }, { once: true });
      });
    }
  }

  // Stream error or stall → skip to next station
  audio.addEventListener('error',   function () { tryPlay(idx + 1); });
  audio.addEventListener('stalled', function () { setTimeout(function () { tryPlay(idx + 1); }, 5000); });

  tryPlay(idx);
}());

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
