"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCity = exports.SpatialIndex = exports.BuildingPlacer = exports.NameGenerator = void 0;
__exportStar(require("./types"), exports);
var NameGenerator_1 = require("./NameGenerator");
Object.defineProperty(exports, "NameGenerator", { enumerable: true, get: function () { return NameGenerator_1.NameGenerator; } });
var BuildingPlacer_1 = require("./BuildingPlacer");
Object.defineProperty(exports, "BuildingPlacer", { enumerable: true, get: function () { return BuildingPlacer_1.BuildingPlacer; } });
var spatialIndex_1 = require("./spatialIndex");
Object.defineProperty(exports, "SpatialIndex", { enumerable: true, get: function () { return spatialIndex_1.SpatialIndex; } });
var CityGenerator_1 = require("./CityGenerator");
Object.defineProperty(exports, "generateCity", { enumerable: true, get: function () { return CityGenerator_1.generateCity; } });
