/* CitySim HUD — top overlay stats and speed controls. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function init(root, sim, onSpeed) {
    var els = {
      population: root.querySelector('[data-testid="hud-population"]'),
      employment: root.querySelector('[data-testid="hud-employment"]'),
      time: root.querySelector('[data-testid="hud-time"]'),
      budget: root.querySelector('[data-testid="hud-budget"]')
    };
    var speedBtns = root.querySelectorAll('[data-speed]');

    function setActive(idx) {
      for (var i = 0; i < speedBtns.length; i++) {
        var b = speedBtns[i];
        b.classList.toggle('active', Number(b.getAttribute('data-speed')) === idx);
      }
    }

    for (var i = 0; i < speedBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-speed'));
          onSpeed(idx);
          setActive(idx);
        });
      })(speedBtns[i]);
    }

    return { els: els, setActive: setActive };
  }

  function update(hud, sim, economy) {
    var els = hud.els;
    if (els.population) els.population.textContent = String(sim.citizens.length);
    if (els.employment) els.employment.textContent = Math.round((economy.employmentRate || 0) * 100) + '%';
    if (els.time) els.time.textContent = 'Day ' + sim.day + ' · ' + CitySim.utils.weekdayName(sim.day) + ' · ' + sim.getTimeString();
    if (els.budget) els.budget.textContent = CitySim.utils.formatMoney(economy.budget);
  }

  CitySim.hud = { init: init, update: update };
})(typeof window !== 'undefined' ? window : globalThis);