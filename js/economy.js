/* CitySim economy — hourly city budget and company accounting. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function citizenById(citizens, id) {
    for (var i = 0; i < citizens.length; i++) {
      if (citizens[i].id === id) return citizens[i];
    }
    return null;
  }

  function init(cfg) {
    return {
      budget: 50000,
      taxRates: cfg.taxRates,
      upkeepPerHour: cfg.cityUpkeepPerHour,
      employmentRate: 0,
      lastHour: -1,
      stats: { wages: 0, taxes: 0, revenue: 0, expenses: 0, upkeep: 0 },
      history: []
    };
  }

  function demandFactor(type, hour) {
    if (type === 'entertainment') {
      if (hour >= 17 && hour < 23) return 1.6;
      if (hour >= 12 && hour < 17) return 0.9;
      return 0.1;
    }
    if (type === 'commercial') {
      if (hour >= 10 && hour < 18) return 1.3;
      if (hour >= 8 && hour < 22) return 0.6;
      return 0.05;
    }
    // industrial
    if (hour >= 6 && hour < 16) return 1.2;
    return 0.1;
  }

  function tick(economy, sim, ctx) {
    var hour = sim.getHour();
    var totalWages = 0, totalRevenue = 0, totalExpenses = 0;
    var companies = ctx.companies;

    for (var i = 0; i < companies.length; i++) {
      var c = companies[i];
      var employees = c.employees;
      var open = hour >= c.openHour && hour < c.closeHour;
      var demand = demandFactor(c.type, hour);

      var employeesPresent = 0;
      for (var e = 0; e < employees.length; e++) {
        var emp = citizenById(ctx.citizens, employees[e]);
        if (emp && emp.current && emp.current.activity === 'WORK') employeesPresent++;
      }

      var revenue = employeesPresent > 0 && open ? employeesPresent * 8 * demand : 0;
      var wages = 0;
      for (var w = 0; w < employees.length; w++) {
        var worker = citizenById(ctx.citizens, employees[w]);
        if (!worker) continue;
        var hourly = worker.wage / 24;
        wages += hourly;
        worker.cash += hourly;
      }

      var upkeep = 15 + employees.length * 2;
      var expenses = wages + upkeep;
      var profit = revenue - expenses;

      c.revenue = revenue;
      c.expenses = expenses;
      c.profit = profit;
      c.budget += profit;
      c.profitHistory.push(profit);
      if (c.profitHistory.length > 48) c.profitHistory.shift();

      totalWages += wages;
      totalRevenue += revenue;
      totalExpenses += expenses;
    }

    var taxes = totalWages * economy.taxRates.income +
      Math.max(0, totalRevenue - totalExpenses) * economy.taxRates.corporate +
      totalRevenue * economy.taxRates.sales;
    var upkeepTotal = economy.upkeepPerHour;
    economy.budget += taxes - upkeepTotal;

    economy.stats.wages = totalWages;
    economy.stats.taxes = taxes;
    economy.stats.revenue = totalRevenue;
    economy.stats.expenses = totalExpenses;
    economy.stats.upkeep = upkeepTotal;

    var employedTotal = 0;
    for (var ci = 0; ci < ctx.citizens.length; ci++) {
      if (ctx.citizens[ci].workId != null) employedTotal++;
    }
    economy.employmentRate = ctx.citizens.length ? employedTotal / ctx.citizens.length : 0;

    economy.history.push({ hour: hour, budget: economy.budget, taxes: taxes, revenue: totalRevenue });
    if (economy.history.length > 96) economy.history.shift();
  }

  CitySim.economy = {
    init: init,
    tick: tick,
    demandFactor: demandFactor
  };
})(typeof window !== 'undefined' ? window : globalThis);