/* CitySim companies — employers attached to commercial/entertainment/industrial buildings. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var TYPE_NAMES = {
    commercial: ['Corner Store', 'Central Market', 'Blue Bank', 'Grand Office', 'Sunrise Cafe', 'Civic Clinic', 'Union Shop', 'Harbor Office'],
    entertainment: ['Starlight Cinema', 'Moon Bar', 'Oasis Restaurant', 'Pavilion Theater', 'Fox Gym', 'Velvet Lounge', 'Beacon Club', 'Anchor Diner'],
    industrial: ['Iron Works', 'Steel Foundry', 'Forge Factory', 'Delta Warehouse', 'Orion Workshop', 'Atlas Plant', 'Vulcan Works', 'Keystone Depot']
  };

  function create(cfg, city, buildings) {
    var utils = CitySim.utils;
    var rng = city.rng;
    var companies = [];
    var id = 0;

    buildings.forEach(function (b) {
      if (b.type === 'residential') return;
      if (!utils.chance(rng, 0.85)) return; // some buildings are independent / empty
      var openHour = b.type === 'industrial' ? 6 : b.type === 'entertainment' ? 12 : 9;
      var closeHour = b.type === 'industrial' ? 16 : b.type === 'entertainment' ? 23 : 18;
      var company = {
        id: id++,
        name: utils.pick(rng, TYPE_NAMES[b.type]),
        type: b.type,
        buildingId: b.id,
        employees: [],
        wage: Math.round(utils.rand(rng, 14, 26)),
        revenue: 0,
        expenses: 0,
        profit: 0,
        profitHistory: [],
        budget: utils.randInt(rng, 4000, 12000),
        openHour: openHour,
        closeHour: closeHour
      };
      b.companyId = company.id;
      companies.push(company);
    });

    return companies;
  }

  function hire(company, citizen) {
    if (company.employees.indexOf(citizen.id) !== -1) return;
    company.employees.push(citizen.id);
    citizen.companyId = company.id;
    citizen.wage = company.wage;
  }

  function fire(company, citizenId) {
    var i = company.employees.indexOf(citizenId);
    if (i !== -1) company.employees.splice(i, 1);
  }

  function companyById(companies, id) {
    for (var i = 0; i < companies.length; i++) {
      if (companies[i].id === id) return companies[i];
    }
    return null;
  }

  CitySim.companies = {
    create: create,
    hire: hire,
    fire: fire,
    companyById: companyById
  };
})(typeof window !== 'undefined' ? window : globalThis);