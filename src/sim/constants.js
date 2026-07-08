import * as THREE from 'three';
import { ERAS } from './types';
export const BLOCK_SIZE = 80;
export const ROAD_WIDTH = 8;
export const SIDEWALK_WIDTH = 2.5;
export const GRID_DIVISIONS = 4;
export const VEHICLE_COUNT_PER_ERA = 12;
export const PEDESTRIAN_COUNT_PER_ERA = 40;
export const VEHICLE_BASE_SPEED = 6;
export const PEDESTRIAN_BASE_SPEED = 1.2;
export const TRANSITION_DURATION = 2.5;
export const BUILDING_LOTS = [
    { x: -22, z: -22, w: 14, d: 14 },
    { x: 0, z: -22, w: 14, d: 14 },
    { x: 22, z: -22, w: 14, d: 14 },
    { x: -22, z: 0, w: 14, d: 14 },
    { x: 0, z: 0, w: 14, d: 14 },
    { x: 22, z: 0, w: 14, d: 14 },
    { x: -22, z: 22, w: 14, d: 14 },
    { x: 0, z: 22, w: 14, d: 14 },
    { x: 22, z: 22, w: 14, d: 14 },
];
export const ERA_PALETTES = {
    '1945': {
        buildings: [0x8b7355, 0x6b5a3e, 0x9a8b6e, 0x5c4a35, 0x7a6a4f],
        vehicles: [0x3a3a3a, 0x5a2a2a, 0x2a3a5a, 0x4a4a4a, 0x6a4a2a],
        outfits: [0x3a3a4a, 0x5a4a3a, 0x2a2a3a, 0x4a3a2a, 0x6a5a4a],
    },
    '1965': {
        buildings: [0xa0a0a0, 0xb0a090, 0x9090a0, 0xc0b0a0, 0x8a8a8a],
        vehicles: [0xaa1010, 0x1010aa, 0x10aa10, 0xaaaa10, 0xaa10aa],
        outfits: [0xaa3a3a, 0x3a5aaa, 0x5aaa3a, 0xaa8a3a, 0x6a3aaa],
    },
    '1985': {
        buildings: [0xb8b8b8, 0xa8a8a8, 0xc8c8b8, 0x989898, 0xd0c8b0],
        vehicles: [0x888888, 0xaa0000, 0x0000aa, 0x00aa00, 0xaaaaaa],
        outfits: [0x000000, 0xaa00aa, 0x00aaaa, 0xff5500, 0x5500ff],
    },
    '2005': {
        buildings: [0xc8d0d8, 0xa0b8d0, 0xb0c8d8, 0xd8d8e0, 0x98b0c8],
        vehicles: [0xcccccc, 0x333333, 0x666666, 0x99aacc, 0xaa3333],
        outfits: [0x5577aa, 0x885533, 0x333355, 0x777777, 0xaa5555],
    },
    '2025': {
        buildings: [0x2a3a4a, 0x3a4a5a, 0x4a5a6a, 0x2a4a3a, 0x5a6a7a],
        vehicles: [0xeeeeee, 0x222222, 0x3366aa, 0x22aa44, 0xaa2222],
        outfits: [0x222222, 0x444444, 0x666666, 0x333366, 0x664422],
    },
};
export const ERA_THEMES = {
    '1945': {
        skyColor: 0xc4b59a,
        fogColor: 0xc4b59a,
        fogDensity: 0.012,
        groundColor: 0x6b5a3e,
        ambientIntensity: 0.45,
        sunIntensity: 1.1,
        sunColor: 0xffe8c4,
        sunPosition: new THREE.Vector3(40, 50, 20),
    },
    '1965': {
        skyColor: 0x8ab4d8,
        fogColor: 0xa8c4d8,
        fogDensity: 0.008,
        groundColor: 0x7a7060,
        ambientIntensity: 0.55,
        sunIntensity: 1.25,
        sunColor: 0xfff0d8,
        sunPosition: new THREE.Vector3(45, 55, 25),
    },
    '1985': {
        skyColor: 0x9ab8c8,
        fogColor: 0xb0c4cc,
        fogDensity: 0.015,
        groundColor: 0x6a6868,
        ambientIntensity: 0.6,
        sunIntensity: 1.2,
        sunColor: 0xfff5e0,
        sunPosition: new THREE.Vector3(50, 60, 30),
    },
    '2005': {
        skyColor: 0x7aa0c4,
        fogColor: 0xa0b8cc,
        fogDensity: 0.011,
        groundColor: 0x5a6068,
        ambientIntensity: 0.65,
        sunIntensity: 1.3,
        sunColor: 0xffffff,
        sunPosition: new THREE.Vector3(55, 65, 35),
    },
    '2025': {
        skyColor: 0x4a6a8a,
        fogColor: 0x6a8aaa,
        fogDensity: 0.009,
        groundColor: 0x4a5058,
        ambientIntensity: 0.7,
        sunIntensity: 1.4,
        sunColor: 0xfff8ff,
        sunPosition: new THREE.Vector3(60, 70, 40),
    },
};
export const ERA_LABELS = {
    '1945': 'Post-War Era',
    '1965': 'Space Age',
    '1985': 'Neon Decade',
    '2005': 'Digital Boom',
    '2025': 'Smart Future',
};
export const ERA_BUILDING_HEIGHTS = {
    '1945': [6, 18],
    '1965': [10, 30],
    '1985': [14, 45],
    '2005': [18, 60],
    '2025': [22, 75],
};
export const STOREFRONT_DATA = {
    '1945': {
        labels: ['DINER', 'BAKERY', 'TAILOR', 'PHARMACY', 'BARBER'],
        colors: [
            [0xcc8833, 0x332211],
            [0xaa3322, 0x221111],
            [0x3344aa, 0x111122],
            [0x22aa44, 0x112211],
            [0xaa6622, 0x221100],
        ],
    },
    '1965': {
        labels: ['GAS STATION', 'DRIVE-IN', 'RECORDS', 'DINER', 'GROCERY'],
        colors: [
            [0xdd4422, 0x221100],
            [0xffaa00, 0x332200],
            [0x2266ff, 0x001133],
            [0xff3388, 0x330011],
            [0x44aa44, 0x112211],
        ],
    },
    '1985': {
        labels: ['ARCADE', 'VIDEO', 'MALL', 'PIZZA', 'ELECTRONICS'],
        colors: [
            [0xff00ff, 0x220022],
            [0x00ffff, 0x002222],
            [0xff6600, 0x331100],
            [0xffff00, 0x333300],
            [0x00ff00, 0x003300],
        ],
    },
    '2005': {
        labels: ['CYBER CAFE', 'CELL STORE', 'STARBUCKS', 'DVD RENT', 'GAMESTOP'],
        colors: [
            [0x3388dd, 0x112233],
            [0xddaa22, 0x332211],
            [0x226633, 0x112211],
            [0x8833aa, 0x221133],
            [0xaa2222, 0x331111],
        ],
    },
    '2025': {
        labels: ['E-CHARGE', 'DRONE PICKUP', 'VR LOUNGE', 'BIO CAFE', 'AI HUB'],
        colors: [
            [0x22ff88, 0x002211],
            [0x88aaff, 0x112233],
            [0xaa22ff, 0x220033],
            [0x44ddaa, 0x113322],
            [0xff4488, 0x330011],
        ],
    },
};
export const BILLBOARD_DATA = {
    '1945': {
        texts: ['BUY BONDS', 'Coca-Cola', 'CIGARETTES', 'FORD', 'WAR EFFORT'],
        colors: [0xcc4422, 0xaa2211, 0x442222, 0x224488, 0x886622],
    },
    '1965': {
        texts: ['SPACE AGE', 'MUSTANG', 'Pepsi', 'BELL TELEPHONE', 'GAS $0.30'],
        colors: [0x2244aa, 0xaa2222, 0x2266cc, 0x228844, 0xccaa22],
    },
    '1985': {
        texts: ['MIAMI VICE', 'SONY', 'McDONALDS', 'MTV', 'IBM PC'],
        colors: [0xff44ff, 0x4444ff, 0xff8822, 0x44ffff, 0x444444],
    },
    '2005': {
        texts: ['GOOGLE', 'iPod', 'XBOX', 'MySpace', 'EBAY'],
        colors: [0x4488ff, 0xffffff, 0x88ff22, 0x4488cc, 0xff4422],
    },
    '2025': {
        texts: ['TESLA', 'METAVERSE', 'AI INSIDE', 'NETFLIX', 'PRIME'],
        colors: [0xff2222, 0x88aaff, 0x22ff88, 0xff2222, 0x44aaff],
    },
};
export const VEHICLE_TYPES_BY_ERA = ERAS.map(() => '');
export const CLOCK_HOURS_PER_SECOND = 60;
export const DAY_LENGTH_SECONDS = 120;
//# sourceMappingURL=constants.js.map