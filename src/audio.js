function startAudio() {
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
  audio.volume = 1.0;

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
}
startAudio();
