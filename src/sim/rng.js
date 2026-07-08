export class RNG {
    seed;
    state;
    constructor(seed = 12345) {
        this.seed = seed >>> 0;
        this.state = this.seed;
    }
    next() {
        this.state = (this.state * 1664525 + 1013904223) >>> 0;
        return this.state / 4294967296;
    }
    range(min, max) {
        return min + this.next() * (max - min);
    }
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }
    weighted(arr, weights) {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = this.next() * total;
        for (let i = 0; i < arr.length; i++) {
            r -= weights[i];
            if (r <= 0)
                return arr[i];
        }
        return arr[arr.length - 1];
    }
    bool(probability = 0.5) {
        return this.next() < probability;
    }
    reset(seed) {
        if (seed !== undefined)
            this.seed = seed >>> 0;
        this.state = this.seed;
    }
}
export function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function hashSeed(...parts) {
    let h = 2166136261;
    for (const p of parts) {
        h ^= p;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
//# sourceMappingURL=rng.js.map